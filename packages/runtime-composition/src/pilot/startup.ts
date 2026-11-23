import type { DataSource } from "typeorm";

import {
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";
import {
  type RuntimeRegistration,
  RuntimeRegistrationRepository,
} from "@awp/platform-persistence-typeorm";

import { type DeploymentPolicy, parseDeploymentPolicy } from "./deployment-config.ts";
import { PinnedNetworkTransport } from "./network-policy.ts";

export interface DeploymentStartupPort {
  assertReady(scope: ProjectScope, deploymentRef: ExactRevisionRef): Promise<void>;
}
export interface DeploymentStartupOptions {
  readonly policy: unknown;
  readonly component: "api" | "worker";
  readonly instanceId: string;
  readonly imageDigest: string;
  readonly leaseMs: number;
  readonly validationDeadlineMs: number;
  readonly network: PinnedNetworkTransport;
  readonly requests: readonly Readonly<{ purpose: string; url: string; method: string }>[];
  readonly browser: Readonly<{
    origin: string;
    callbackUrl: string;
    identityPolicyRef: ExactRevisionRef;
  }>;
  /** Resolves all exact published input/policy/binding refs; no permissive default exists. */
  readonly references: {
    assertCurrent(
      policy: DeploymentPolicy,
      signal: AbortSignal,
    ): Promise<Readonly<{ validUntil: string }>>;
  };
}
const owned = new WeakSet<object>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const safeReasons = new Set([
  "DEPLOYMENT_RUNTIME_STOPPED",
  "DEPLOYMENT_STARTUP_REQUIRED",
  "DEPLOYMENT_PEER_MISSING",
  "DEPLOYMENT_LEASE_EXPIRED",
  "DEPLOYMENT_DIGEST_MISMATCH",
  "DEPLOYMENT_REVISION_STALE",
  "DEPLOYMENT_SCOPE_DENIED",
  "DEPLOYMENT_INPUT_UNAVAILABLE",
  "DEPLOYMENT_NETWORK_DENIED",
  "DEPLOYMENT_REGISTRATION_LIMIT",
]);
const fail = (code: string): never => {
  throw new Error(code);
};

/** Validated before database bootstrap, then registered only after current published inputs resolve. */
export class DeploymentStartup implements DeploymentStartupPort {
  readonly policy: DeploymentPolicy;
  readonly instanceId: string;
  readonly browserOrigin: string;
  readonly component: "api" | "worker";
  readonly #options: DeploymentStartupOptions;
  readonly #registration: RuntimeRegistration;
  readonly #repository: RuntimeRegistrationRepository;
  #started = false;
  #starting = false;
  #stopped = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #refreshing: Promise<void> | undefined;

  constructor(source: DataSource, input: DeploymentStartupOptions) {
    this.policy = parseDeploymentPolicy(input.policy);
    try {
      const { ref: networkRef, ...networkBody } = input.network.policy;
      if (
        ![
          this.policy.deploymentId,
          this.policy.workspaceId,
          input.instanceId,
          ...this.policy.projectIds,
        ].every((id) => uuid.test(id)) ||
        !["api", "worker"].includes(input.component) ||
        input.imageDigest !== this.policy.imageDigest ||
        !Number.isSafeInteger(input.leaseMs) ||
        input.leaseMs < 1000 ||
        input.leaseMs > 30_000 ||
        !Number.isSafeInteger(input.validationDeadlineMs) ||
        input.validationDeadlineMs < 100 ||
        input.validationDeadlineMs > 5000 ||
        input.validationDeadlineMs > input.leaseMs ||
        !(input.network instanceof PinnedNetworkTransport) ||
        !samePilotRef(networkRef, this.policy.networkPolicyRef) ||
        pilotContentHash(networkBody) !== networkRef.contentHash ||
        input.network.policy.mode !==
          (this.policy.deploymentProfile === "local" ? "LOCAL_FIXTURE" : "CORPORATE") ||
        !samePilotRef(input.browser.identityPolicyRef, this.policy.identityPolicyRef) ||
        typeof input.references?.assertCurrent !== "function"
      )
        throw new Error();
      const origin = new URL(input.browser.origin);
      if (
        origin.origin !== input.browser.origin ||
        origin.username ||
        origin.password ||
        input.browser.callbackUrl !== `${origin.origin}/api/v1/auth/callback` ||
        this.policy.endpoints.find((value) => value.purpose === "browser")?.url !==
          input.browser.origin ||
        this.policy.endpoints.find((value) => value.purpose === "callback")?.url !==
          input.browser.callbackUrl
      )
        throw new Error();
      const outbound = this.policy.endpoints.filter(
        (value) => !["browser", "callback"].includes(value.purpose),
      );
      if (
        input.requests.length !== outbound.length ||
        new Set(input.requests.map((value) => value.purpose)).size !== outbound.length ||
        outbound.some(
          (value) =>
            !input.requests.some(
              (request) =>
                request.purpose === value.purpose &&
                request.url === value.url &&
                ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method),
            ),
        )
      )
        throw new Error();
    } catch {
      throw new Error("DEPLOYMENT_STARTUP_INVALID");
    }
    this.instanceId = input.instanceId;
    this.component = input.component;
    this.browserOrigin = input.browser.origin;
    this.#options = Object.freeze({
      ...input,
      policy: this.policy,
      requests: freezePilotValue(structuredClone(input.requests)),
      browser: freezePilotValue(structuredClone(input.browser)),
      references: Object.freeze({
        assertCurrent: input.references.assertCurrent.bind(input.references),
      }),
    });
    this.#registration = Object.freeze({
      instanceId: input.instanceId,
      workspaceId: this.policy.workspaceId,
      deploymentId: this.policy.deploymentId,
      deploymentVersion: this.policy.version,
      component: input.component,
      configDigest: pilotContentHash(this.policy),
      imageDigest: input.imageDigest,
    });
    this.#repository = new RuntimeRegistrationRepository(source, input.validationDeadlineMs);
    owned.add(this);
  }

  async start(): Promise<void> {
    if (this.#started || this.#starting || this.#stopped) fail("DEPLOYMENT_RUNTIME_STOPPED");
    this.#starting = true;
    try {
      const proof = await this.current();
      await this.#repository.register(this.#registration, this.lease(proof.validUntil));
      if (this.#stopped) {
        await this.#repository.stop(this.instanceId);
        fail("DEPLOYMENT_RUNTIME_STOPPED");
      }
      this.#started = true;
    } catch (error) {
      this.#stopped = true;
      throw error;
    } finally {
      this.#starting = false;
    }
  }
  /** Installed by the application lifecycle; tests may drive refresh explicitly. */
  keepAlive(): void {
    this.assertStarted();
    this.#timer ??= setInterval(
      () => {
        void this.refresh().catch(() => undefined);
      },
      Math.max(100, Math.floor(this.#options.leaseMs / 3)),
    );
    this.#timer.unref();
  }
  async refresh(): Promise<void> {
    this.assertStarted();
    this.#refreshing ??= (async () => {
      try {
        const proof = await this.current();
        if (this.#stopped) fail("DEPLOYMENT_RUNTIME_STOPPED");
        await this.#repository.refresh(this.#registration, this.lease(proof.validUntil));
      } catch (error) {
        await this.stop();
        throw error;
      } finally {
        this.#refreshing = undefined;
      }
    })();
    return this.#refreshing;
  }
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#started) await this.#repository.stop(this.instanceId);
  }
  async assertReady(scope: ProjectScope, deploymentRef: ExactRevisionRef): Promise<void> {
    this.assertStarted();
    if (
      scope.workspaceId !== this.policy.workspaceId ||
      !this.policy.projectIds.includes(scope.projectId)
    )
      fail("DEPLOYMENT_SCOPE_DENIED");
    const proof = await this.current();
    if (!samePilotRef(proof.deployments.get(scope.projectId), deploymentRef))
      fail("DEPLOYMENT_REVISION_STALE");
    await this.#repository.assertAgreement(this.#registration);
    this.ensureFresh(proof.validUntil);
  }
  async readiness(): Promise<Readonly<{ ready: boolean; reasonCode: string }>> {
    try {
      this.assertStarted();
      const proof = await this.current();
      await this.#repository.assertAgreement(this.#registration);
      this.ensureFresh(proof.validUntil);
      return { ready: true, reasonCode: "READY" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return {
        ready: false,
        reasonCode: safeReasons.has(code) ? code : "DEPLOYMENT_INPUT_UNAVAILABLE",
      };
    }
  }
  assertBinding(component: "api" | "worker", policy: DeploymentPolicy): void {
    this.assertStarted();
    if (
      this.component !== component ||
      pilotContentHash(policy) !== this.#registration.configDigest
    )
      fail("DEPLOYMENT_DIGEST_MISMATCH");
  }
  private assertStarted(): void {
    if (this.#stopped) fail("DEPLOYMENT_RUNTIME_STOPPED");
    if (!this.#started) fail("DEPLOYMENT_STARTUP_REQUIRED");
  }
  private ensureFresh(validUntil: number): void {
    if (this.#stopped || validUntil <= Date.now()) fail("DEPLOYMENT_INPUT_UNAVAILABLE");
  }
  private lease(validUntil: number): number {
    this.ensureFresh(validUntil);
    const lease = Math.min(this.#options.leaseMs, Math.floor(validUntil - Date.now()));
    if (lease < 100) fail("DEPLOYMENT_INPUT_UNAVAILABLE");
    return lease;
  }
  private async current(): Promise<{
    validUntil: number;
    deployments: Map<string, ExactRevisionRef>;
  }> {
    const signal = AbortSignal.timeout(this.#options.validationDeadlineMs);
    let interrupt: (() => void) | undefined;
    try {
      return await Promise.race([
        (async () => {
          let receipt: Readonly<{ validUntil: string }>;
          try {
            receipt = await this.#options.references.assertCurrent(this.policy, signal);
          } catch {
            return fail("DEPLOYMENT_INPUT_UNAVAILABLE");
          }
          let validUntil = Math.min(
            Date.parse(receipt.validUntil),
            Date.parse(this.#options.network.policy.validUntil),
          );
          if (!Number.isFinite(validUntil) || validUntil <= Date.now())
            fail("DEPLOYMENT_INPUT_UNAVAILABLE");
          const approved = await Promise.all(
            this.#options.requests.map((request) =>
              this.#options.network.authorizeEndpoint(request.url, request.method, signal),
            ),
          );
          if (signal.aborted || approved.some((value) => !value)) fail("DEPLOYMENT_NETWORK_DENIED");
          try {
            const current = await this.#options.references.assertCurrent(this.policy, signal);
            validUntil = Math.min(validUntil, Date.parse(current.validUntil));
          } catch {
            return fail("DEPLOYMENT_INPUT_UNAVAILABLE");
          }
          if (!Number.isFinite(validUntil) || validUntil <= Date.now() || signal.aborted)
            fail("DEPLOYMENT_INPUT_UNAVAILABLE");
          const rows = await this.#repository.deployments(
            this.#registration,
            this.policy.projectIds,
          );
          const deployments = new Map<string, ExactRevisionRef>();
          for (const row of rows) {
            const body = row.semantic_body;
            if (
              row.version !== this.policy.version ||
              row.record_id !== this.policy.deploymentId ||
              body.id !== row.record_id ||
              body.version !== row.version ||
              body.projectId !== row.project_id ||
              body.workspaceId !== this.policy.workspaceId ||
              body.kind !== "DEPLOYMENT" ||
              body.schemaVersion !== 1 ||
              pilotContentHash(body) !== row.content_hash ||
              pilotContentHash(body.body) !== this.#registration.configDigest
            )
              fail("DEPLOYMENT_REVISION_STALE");
            deployments.set(row.project_id, {
              id: row.record_id,
              version: row.version,
              contentHash: row.content_hash as `sha256:${string}`,
            });
          }
          if (deployments.size !== this.policy.projectIds.length || signal.aborted)
            fail("DEPLOYMENT_REVISION_STALE");
          this.ensureFresh(validUntil);
          return { validUntil, deployments };
        })(),
        new Promise<never>((_resolve, reject) => {
          interrupt = () => reject(new Error("DEPLOYMENT_INPUT_UNAVAILABLE"));
          signal.addEventListener("abort", interrupt, { once: true });
        }),
      ]);
    } finally {
      if (interrupt) signal.removeEventListener("abort", interrupt);
    }
  }
}

export function assertDeploymentStartupBinding(
  value: DeploymentStartup,
  component: "api" | "worker",
  policy: DeploymentPolicy,
): void {
  if (!owned.has(value)) fail("DEPLOYMENT_STARTUP_REQUIRED");
  value.assertBinding(component, policy);
}

import { AsyncLocalStorage } from "node:async_hooks";

import {
  GitLabAuth,
  type GitLabConnectionConfiguration,
  type GitLabPipelineTriggerInvocation,
  GitLabRestClient,
  type GitLabSecretResolver,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import { JiraRestClient } from "@awp/connector-jira";
import { MattermostRestClient } from "@awp/connector-mattermost";
import {
  assertExactRevisionRef,
  assertProjectScope,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
} from "@awp/platform-core";

import type { VaultHttpClient } from "../security/vault-http-client.ts";
import {
  secretAllowedUseHash,
  type VaultSecretAuthorization,
  type VaultSecretMapping,
  VaultSecretResolver,
} from "../security/vault-secret-resolver.ts";
import type { PinnedNetworkTransport } from "./network-policy.ts";

type Purpose = "CONNECTOR_READ" | "CONNECTOR_WRITE" | "CONNECTOR_WEBHOOK";
type Method = "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
type Authentication =
  | "JIRA_BASIC"
  | "BEARER"
  | "GITLAB_PRIVATE_TOKEN"
  | "GITLAB_TRIGGER_TOKEN"
  | "STANDARD_WEBHOOK_HMAC";
export interface CorporateConnectorBinding extends ProjectScope {
  readonly ref: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly policyRef: ExactRevisionRef;
  readonly servicePrincipalId: string;
  readonly provider: "JIRA" | "GITLAB" | "MATTERMOST";
  readonly mode: "CORPORATE" | "LOCAL_FIXTURE";
  readonly endpoint: string;
  readonly expiresAt: string;
  /** C1-selected provider facts. Pipeline naming must be implemented by the approved CI workflow. */
  readonly gitlab?: Readonly<{
    numericProjectId: number;
    trigger?: Readonly<{
      dialect: "TYPED_INPUTS" | "BOUNDED_VARIABLES";
      ref: string;
      pipelineNameInput: string;
    }>;
  }>;
  readonly routes: readonly Readonly<{
    method: Method;
    path: string;
    match: "EXACT" | "PREFIX";
    purpose: Exclude<Purpose, "CONNECTOR_WEBHOOK">;
  }>[];
}
export interface CorporateConnectorCredential {
  readonly mapping: VaultSecretMapping;
  readonly authentication: Authentication;
}
/** The host composes current Core rights/pins and, for writes, the exact command effect guard. */
export interface CorporateConnectorRequestAuthority {
  authorize(
    binding: CorporateConnectorBinding,
    purpose: Purpose,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export interface CorporateConnectorFactoryOptions {
  readonly network: PinnedNetworkTransport;
  readonly vault: VaultHttpClient;
  readonly authority: CorporateConnectorRequestAuthority;
  readonly secretAuthorization: VaultSecretAuthorization;
  readonly bindings: readonly Readonly<{
    binding: CorporateConnectorBinding;
    credentials: readonly CorporateConnectorCredential[];
  }>[];
}
interface Entry {
  readonly binding: CorporateConnectorBinding;
  readonly credentials: ReadonlyMap<Purpose, CorporateConnectorCredential>;
}
const denied = () => new Error("CORPORATE_CONNECTOR_DENIED");
const same = (left: ExactRevisionRef, right: ExactRevisionRef) =>
  left.id === right.id && left.version === right.version && left.contentHash === right.contentHash;
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw denied();
  let abort!: () => void;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(denied());
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
function token(bytes: Uint8Array): string {
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!value || value.length > 16384 || /[\p{Cc} ]/u.test(value)) throw denied();
  return value;
}

/** No environment secrets, global fetch, retries or local-authority substitution. */
export class CorporateConnectorFactories {
  readonly #entries = new Map<string, Entry>();
  readonly #leaseSignal = new AsyncLocalStorage<AbortSignal>();
  constructor(private readonly options: CorporateConnectorFactoryOptions) {
    try {
      if (
        !options.bindings.length ||
        options.bindings.length > 256 ||
        !options.vault.usesNetwork(options.network)
      )
        throw denied();
      for (const input of options.bindings) {
        const binding = freezePilotValue(structuredClone(input.binding));
        assertProjectScope(binding);
        [binding.ref, binding.profileRef, binding.connectionRef, binding.policyRef].forEach(
          assertExactRevisionRef,
        );
        const endpoint = new URL(binding.endpoint);
        if (
          endpoint.origin !== binding.endpoint ||
          binding.mode !== options.network.policy.mode ||
          (binding.mode === "CORPORATE" && endpoint.protocol !== "https:") ||
          !binding.servicePrincipalId ||
          !["JIRA", "GITLAB", "MATTERMOST"].includes(binding.provider) ||
          this.#entries.has(binding.ref.id) ||
          !Number.isFinite(Date.parse(binding.expiresAt)) ||
          Date.parse(binding.expiresAt) <= Date.now() ||
          !binding.routes.length ||
          binding.routes.length > 256 ||
          binding.routes.some(
            (route) =>
              !["GET", "HEAD", "POST", "PUT", "DELETE"].includes(route.method) ||
              !["EXACT", "PREFIX"].includes(route.match) ||
              !["CONNECTOR_READ", "CONNECTOR_WRITE"].includes(route.purpose) ||
              !route.path.startsWith("/") ||
              /[?#[\]\\\s]/u.test(route.path) ||
              new URL(route.path, endpoint).origin !== endpoint.origin ||
              new URL(route.path, endpoint).pathname !== route.path,
          )
        )
          throw denied();
        if (
          binding.provider === "GITLAB"
            ? !binding.gitlab ||
              !Number.isSafeInteger(binding.gitlab.numericProjectId) ||
              binding.gitlab.numericProjectId < 1
            : binding.gitlab !== undefined
        )
          throw denied();
        const trigger = binding.gitlab?.trigger;
        if (
          trigger &&
          (!["TYPED_INPUTS", "BOUNDED_VARIABLES"].includes(trigger.dialect) ||
            !trigger.ref ||
            trigger.ref.length > 255 ||
            /[\p{Cc} ]/u.test(trigger.ref) ||
            !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(trigger.pipelineNameInput))
        )
          throw denied();
        const credentials = new Map<Purpose, CorporateConnectorCredential>();
        for (const supplied of input.credentials) {
          const credential = freezePilotValue(structuredClone(supplied));
          const use = credential.mapping.use;
          const purpose = use.purpose as Purpose;
          const supported =
            binding.provider === "JIRA"
              ? ["JIRA_BASIC", "BEARER"]
              : binding.provider === "MATTERMOST"
                ? ["BEARER"]
                : purpose === "CONNECTOR_READ"
                  ? ["GITLAB_PRIVATE_TOKEN"]
                  : purpose === "CONNECTOR_WRITE"
                    ? ["GITLAB_TRIGGER_TOKEN"]
                    : ["STANDARD_WEBHOOK_HMAC"];
          if (
            !["CONNECTOR_READ", "CONNECTOR_WRITE", "CONNECTOR_WEBHOOK"].includes(purpose) ||
            credentials.has(purpose) ||
            !supported.includes(credential.authentication) ||
            use.workspaceId !== binding.workspaceId ||
            use.projectId !== binding.projectId ||
            use.servicePrincipalId !== binding.servicePrincipalId ||
            !same(use.profileRef, binding.profileRef) ||
            !same(use.connectionRef, binding.connectionRef) ||
            !same(use.policyRef, binding.policyRef)
          )
            throw denied();
          // Validate exact mapping syntax and purpose before any endpoint or credential use.
          new VaultSecretResolver(
            options.vault,
            use,
            [credential.mapping],
            options.secretAuthorization,
          );
          credentials.set(purpose, credential);
        }
        if (
          new Set([...credentials.values()].map(({ mapping }) => mapping.secretRef)).size !==
            credentials.size ||
          new Set(
            [...credentials.values()].map(
              ({ mapping }) => `${mapping.mount}/${mapping.path}/${mapping.field}`,
            ),
          ).size !== credentials.size ||
          binding.routes.some((route) => !credentials.has(route.purpose))
        )
          throw denied();
        this.#entries.set(binding.ref.id, { binding, credentials });
      }
    } catch {
      throw new Error("CORPORATE_CONNECTOR_CONFIGURATION_INVALID");
    }
  }

  jira(bindingId: string): JiraRestClient {
    const entry = this.entry(bindingId, "JIRA");
    return new JiraRestClient({
      baseUrl: entry.binding.endpoint,
      environment: entry.binding.mode === "CORPORATE" ? "NON_PROD" : "LOCAL",
      allowedOrigins: [entry.binding.endpoint],
      maxResponseBytes: this.options.network.policy.maximumResponseBytes,
      transport: async (input, init = {}) => {
        const signal = this.signal(init.signal);
        const url = this.url(input);
        const headers = new Headers(init.headers);
        if ([...headers.keys()].some((key) => /authorization|cookie|token|api-key/iu.test(key)))
          throw denied();
        const purpose = await this.prepare(entry, url, init.method ?? "GET", signal);
        return this.withSecret(entry, purpose, signal, async (bytes) => {
          const auth = entry.credentials.get(purpose)!.authentication;
          const value = token(bytes);
          if (auth === "JIRA_BASIC" && !/^[^:]+:.+$/u.test(value)) throw denied();
          headers.set(
            "authorization",
            auth === "JIRA_BASIC"
              ? `Basic ${Buffer.from(value).toString("base64")}`
              : `Bearer ${value}`,
          );
          headers.set("accept", "application/json");
          return this.send(entry, url, { ...init, headers, signal }, purpose);
        });
      },
    });
  }

  mattermost(
    bindingId: string,
    purpose: "CONNECTOR_READ" | "CONNECTOR_WRITE",
  ): MattermostRestClient {
    const entry = this.entry(bindingId, "MATTERMOST");
    if (!entry.credentials.has(purpose)) throw denied();
    return new MattermostRestClient({
      baseUrl: entry.binding.endpoint,
      environmentClass: entry.binding.mode === "CORPORATE" ? "TEST" : "LOCAL",
      allowedHosts: [new URL(entry.binding.endpoint).hostname],
      timeoutMs: this.options.network.policy.deadlineMs,
      credential: {
        use: async (consume) =>
          this.withSecret(entry, purpose, this.signal(), async (bytes) => consume(token(bytes))),
      },
      fetcher: async (input, init = {}) =>
        this.send(entry, this.url(input), { ...init, signal: this.signal(init.signal) }, purpose),
    });
  }

  gitlab(bindingId: string, value: GitLabConnectionConfiguration, numericProjectId: number) {
    const entry = this.entry(bindingId, "GITLAB");
    const connection = validateGitLabConnectionConfiguration(value);
    if (
      !Number.isSafeInteger(numericProjectId) ||
      numericProjectId < 1 ||
      entry.binding.gitlab?.numericProjectId !== numericProjectId
    )
      throw denied();
    const slots = [
      ["read", "CONNECTOR_READ"],
      ["trigger", "CONNECTOR_WRITE"],
      ["webhook", "CONNECTOR_WEBHOOK"],
    ] as const;
    for (const [slot, purpose] of slots) {
      const mapping = entry.credentials.get(purpose)?.mapping;
      const reference = connection.identityReferences[slot];
      if (
        !mapping ||
        reference.reference !== mapping.secretRef ||
        reference.referenceFingerprint !== secretAllowedUseHash(mapping)
      )
        throw denied();
    }
    const resolver: GitLabSecretResolver = {
      resolve: async (secretRef, allowedUseHash, signal) => {
        const credential = [...entry.credentials.values()].find(
          ({ mapping }) =>
            mapping.secretRef === secretRef && secretAllowedUseHash(mapping) === allowedUseHash,
        );
        if (!credential) throw denied();
        // The adapter's existing async lease is fulfilled by a bounded copy of the synchronous Core lease.
        let consumed = false;
        return Object.freeze({
          metadata: Object.freeze({ secretRef, allowedUseHash }),
          use: async <T>(_now: Date, consume: (bytes: Uint8Array) => Promise<T>) => {
            if (consumed) throw denied();
            consumed = true;
            return this.withSecret(
              entry,
              credential.mapping.use.purpose as Purpose,
              this.signal(signal),
              consume,
            );
          },
        });
      },
    };
    const auth = new GitLabAuth(connection, resolver);
    const client = new GitLabRestClient({
      baseUrl: entry.binding.endpoint,
      numericProjectId,
      environmentClass: entry.binding.mode === "CORPORATE" ? "TEST" : "LOCAL",
      allowedOrigins: [entry.binding.endpoint],
      auth,
      requestTimeoutMs: this.options.network.policy.deadlineMs,
      maxJsonResponseBytes: Math.min(10_485_760, this.options.network.policy.maximumResponseBytes),
      transport: async (input, init = {}) =>
        this.send(
          entry,
          this.url(input),
          { ...init, signal: this.signal(init.signal) },
          "CONNECTOR_READ",
        ),
    });
    const triggerTransport = Object.freeze({
      trigger: async (invocation: GitLabPipelineTriggerInvocation): Promise<unknown> => {
        const signal = this.signal(invocation.signal);
        const policy = entry.binding.gitlab?.trigger;
        if (!policy) throw new Error("GITLAB_TRIGGER_CONFORMANCE_REQUIRED");
        if (
          invocation.numericProjectId !== numericProjectId ||
          invocation.path !== `/api/v4/projects/${numericProjectId}/trigger/pipeline` ||
          invocation.dialect !== policy.dialect ||
          invocation.body.ref !== policy.ref ||
          invocation.body.name !== invocation.pipelineName ||
          !invocation.pipelineName ||
          invocation.pipelineName.length > 255 ||
          /\p{Cc}/u.test(invocation.pipelineName)
        )
          throw denied();
        const pairs =
          policy.dialect === "TYPED_INPUTS"
            ? Object.entries(invocation.body.inputs ?? {})
            : (invocation.body.variables ?? []).map(({ key, value }) => [key, value] as const);
        if (
          pairs.length > 64 ||
          new Set(pairs.map(([key]) => key)).size !== pairs.length ||
          pairs.some(
            ([key, value]) =>
              !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key) ||
              !["string", "number", "boolean"].includes(typeof value) ||
              (typeof value === "number" && !Number.isFinite(value)),
          ) ||
          (policy.dialect === "TYPED_INPUTS"
            ? !invocation.body.inputs || invocation.body.variables !== undefined
            : !invocation.body.variables || invocation.body.inputs !== undefined)
        )
          throw denied();
        const fields = Object.fromEntries(pairs);
        if (
          Object.hasOwn(fields, policy.pipelineNameInput) &&
          fields[policy.pipelineNameInput] !== invocation.pipelineName
        )
          throw denied();
        fields[policy.pipelineNameInput] = invocation.pipelineName;
        const content =
          policy.dialect === "TYPED_INPUTS"
            ? { inputs: fields }
            : {
                variables: Object.fromEntries(
                  Object.entries(fields).map(([key, value]) => [key, String(value)]),
                ),
              };
        const url = new URL(invocation.path, entry.binding.endpoint);
        if ((await this.prepare(entry, url, "POST", signal)) !== "CONNECTOR_WRITE") throw denied();
        return auth.withTriggerCredential(signal, async (bytes) => {
          const response = await this.send(
            entry,
            url,
            {
              method: "POST",
              signal,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ref: policy.ref, ...content, token: token(bytes) }),
            },
            "CONNECTOR_WRITE",
          );
          if (!response.ok) throw new Error(`GITLAB_HTTP_${response.status}`);
          try {
            return (await response.json()) as unknown;
          } catch {
            throw denied();
          }
        });
      },
    });
    return Object.freeze({ client, auth, triggerTransport });
  }

  private entry(id: string, provider: CorporateConnectorBinding["provider"]): Entry {
    const entry = this.#entries.get(id);
    if (!entry || entry.binding.provider !== provider) throw denied();
    return entry;
  }
  private signal(caller?: AbortSignal | null): AbortSignal {
    const timeout = AbortSignal.timeout(this.options.network.policy.deadlineMs);
    return caller ? AbortSignal.any([caller, timeout]) : timeout;
  }
  private url(input: RequestInfo | URL): URL {
    if (typeof input !== "string" && !(input instanceof URL)) throw denied();
    return new URL(input);
  }
  private async authorize(entry: Entry, purpose: Purpose, signal: AbortSignal): Promise<void> {
    try {
      if (
        signal.aborted ||
        Date.parse(entry.binding.expiresAt) <= Date.now() ||
        !(await bounded(
          this.options.authority.authorize(entry.binding, purpose, signal),
          signal,
        )) ||
        signal.aborted ||
        Date.parse(entry.binding.expiresAt) <= Date.now()
      )
        throw denied();
    } catch {
      throw denied();
    }
  }
  private async prepare(
    entry: Entry,
    url: URL,
    method: string,
    signal: AbortSignal,
  ): Promise<Exclude<Purpose, "CONNECTOR_WEBHOOK">> {
    const matches = entry.binding.routes.filter(
      (route) =>
        route.method === method &&
        (route.match === "EXACT"
          ? route.path === url.pathname
          : url.pathname === route.path ||
            url.pathname.startsWith(route.path.endsWith("/") ? route.path : `${route.path}/`)),
    );
    if (url.origin !== entry.binding.endpoint || matches.length !== 1) throw denied();
    const purpose = matches[0]!.purpose;
    await this.authorize(entry, purpose, signal);
    if (!(await this.options.network.authorizeEndpoint(url.href, method, signal))) throw denied();
    return purpose;
  }
  private async send(
    entry: Entry,
    url: URL,
    init: RequestInit & { signal: AbortSignal },
    purpose: Exclude<Purpose, "CONNECTOR_WEBHOOK">,
  ): Promise<Response> {
    const leaseSignal = this.#leaseSignal.getStore();
    if (!leaseSignal) throw denied();
    const signal = AbortSignal.any([
      init.signal,
      leaseSignal,
      AbortSignal.timeout(
        Math.max(
          1,
          Math.min(
            this.options.network.policy.deadlineMs,
            Date.parse(entry.binding.expiresAt) - Date.now(),
          ),
        ),
      ),
    ]);
    if ((await this.prepare(entry, url, init.method ?? "GET", signal)) !== purpose) throw denied();
    const response = await this.options.network.fetch(url, { ...init, signal, redirect: "error" });
    await this.authorize(entry, purpose, signal);
    return response;
  }
  private async withSecret<T>(
    entry: Entry,
    purpose: Purpose,
    signal: AbortSignal,
    consume: (bytes: Uint8Array) => Promise<T>,
  ): Promise<T> {
    let material: Buffer | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const erase = () => material?.fill(0);
    try {
      await this.authorize(entry, purpose, signal);
      const credential = entry.credentials.get(purpose);
      if (!credential) throw denied();
      const mapping = credential.mapping;
      if (
        pilotContentHash(mapping.use) !==
        pilotContentHash({
          workspaceId: entry.binding.workspaceId,
          projectId: entry.binding.projectId,
          servicePrincipalId: entry.binding.servicePrincipalId,
          purpose,
          profileRef: entry.binding.profileRef,
          connectionRef: entry.binding.connectionRef,
          policyRef: entry.binding.policyRef,
        })
      )
        throw denied();
      const resolver = new VaultSecretResolver(
        this.options.vault,
        mapping.use,
        [mapping],
        this.options.secretAuthorization,
      );
      const lease = await bounded(
        resolver.resolve(mapping.secretRef, secretAllowedUseHash(mapping), signal),
        signal,
      );
      const expiresAt = Date.parse(String(lease.metadata.expiresAt));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw denied();
      material = lease.withMaterial(new Date(), (bytes) => Buffer.from(bytes));
      signal.addEventListener("abort", erase, { once: true });
      timer = setTimeout(erase, Math.max(0, expiresAt - Date.now()));
      timer.unref();
      await this.authorize(entry, purpose, signal);
      if (
        signal.aborted ||
        expiresAt <= Date.now() ||
        !this.options.secretAuthorization.isCurrent(mapping.use, mapping)
      )
        throw denied();
      const leaseSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(1, expiresAt - Date.now())),
      ]);
      const result = await bounded(
        this.#leaseSignal.run(leaseSignal, () => consume(material!)),
        leaseSignal,
      );
      await this.authorize(entry, purpose, signal);
      if (
        expiresAt <= Date.now() ||
        !this.options.secretAuthorization.isCurrent(mapping.use, mapping)
      )
        throw denied();
      return result;
    } catch (error) {
      // HTTP status survives for classified recovery; provider payloads and secret errors never do.
      if (
        error instanceof Error &&
        /^(?:MATTERMOST|GITLAB)_HTTP_[1-5][0-9]{2}$/u.test(error.message)
      )
        throw error;
      throw denied();
    } finally {
      erase();
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", erase);
    }
  }
}

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

import {
  canonicalize,
  designContractRegistry,
  type JsonValue,
  pilotSchemaIds,
} from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type PilotExecutionVerifier,
  type PilotGateExecution,
  type PilotGateStatus,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";

export interface PilotReportReference {
  readonly path: string;
  readonly sha256: string;
}
export interface PilotReportDocument {
  readonly reportRef: ExactRevisionRef;
  readonly bytes: Uint8Array;
  readonly signature: Readonly<{
    executorId: string;
    keyRef: ExactRevisionRef;
    subjectRef: ExactRevisionRef;
    value: string;
  }>;
}
export interface PilotReportArtifactStore {
  readonly report: (
    scope: ProjectScope,
    ref: ExactRevisionRef,
    signal: AbortSignal,
  ) => Promise<PilotReportDocument>;
  readonly prerequisite: (
    scope: ProjectScope,
    parent: ExactRevisionRef,
    ref: PilotReportReference,
    signal: AbortSignal,
  ) => Promise<PilotReportDocument>;
  readonly evidence: (
    scope: ProjectScope,
    parent: ExactRevisionRef,
    ref: PilotReportReference,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
}
export interface PilotReportVerificationPolicy extends ProjectScope {
  readonly policyRef: ExactRevisionRef;
  readonly subjectRef: ExactRevisionRef;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly deploymentProfiles: readonly ("local" | "integration" | "pilot")[];
  readonly executionGates: Readonly<Record<string, readonly string[]>>;
  readonly maximumAgeMs: number;
  readonly keys: readonly Readonly<{
    executorId: string;
    keyRef: ExactRevisionRef;
    publicKey: JsonWebKey;
  }>[];
}
export interface PilotReportPolicyPort {
  /** Current published policy and fingerprints, including key revocations. */
  current(scope: ProjectScope): Promise<PilotReportVerificationPolicy>;
}
export interface VerifiedPilotReport {
  readonly execution: PilotGateExecution;
  readonly verificationPolicyRef: ExactRevisionRef;
  readonly verificationPolicyHash: string;
  readonly executorId: string;
}
interface Report {
  readonly runId: string;
  readonly gate: string;
  readonly status: PilotGateStatus;
  readonly deploymentProfile: "local" | "integration" | "pilot";
  readonly scope: { workspaceId: string; projectIds: string[] };
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly executorIdentity: string;
  readonly checks: readonly {
    id: string;
    status: PilotGateStatus;
    evidence: readonly PilotReportReference[];
  }[];
  readonly prerequisites: readonly PilotReportReference[];
  readonly measurementsRef?: PilotReportReference;
}
const invalid = () => new Error("PILOT_REPORT_UNVERIFIED");
const hashBytes = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digest = /^sha256:[a-f0-9]{64}$/u;
const fingerprintNames = [
  "source",
  "contracts",
  "migrations",
  "lockfile",
  "configuration",
  "inputs",
  "suite",
];
const scopeMatches = (a: ProjectScope, b: ProjectScope) =>
  a.workspaceId === b.workspaceId && a.projectId === b.projectId;
const instant = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z")
    ? parsed
    : NaN;
};

/** A signature binds report bytes, immutable locator, executor, key version and exact gate subject. */
export function pilotReportSigningBytes(
  document: Omit<PilotReportDocument, "signature"> & {
    signature: Omit<PilotReportDocument["signature"], "value">;
  },
): Buffer {
  const protectedValue = {
    format: "AWP_PILOT_REPORT_ED25519_V1",
    reportRef: document.reportRef,
    executorId: document.signature.executorId,
    keyRef: document.signature.keyRef,
    subjectRef: document.signature.subjectRef,
  };
  return Buffer.from(
    `${Buffer.from(canonicalize(protectedValue as unknown as JsonValue)).toString("base64url")}.${Buffer.from(document.bytes).toString("base64url")}`,
    "ascii",
  );
}

/** Validates actual immutable artifacts; a caller's copied PASS or digest is never an attestation. */
export class SignedPilotReportVerifier implements PilotExecutionVerifier {
  readonly #verified = new WeakSet<object>();
  constructor(
    private readonly store: PilotReportArtifactStore,
    private readonly policies: PilotReportPolicyPort,
    private readonly clock = () => Date.now(),
    private readonly deadlineMs = 20_000,
  ) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000) throw invalid();
  }
  async materialize(
    scope: ProjectScope,
    key: string,
    ref: ExactRevisionRef,
    parentSignal?: AbortSignal,
  ) {
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.deadlineMs)])
      : AbortSignal.timeout(this.deadlineMs);
    try {
      assertExactRevisionRef(ref);
      scope = freezePilotValue({ workspaceId: scope.workspaceId, projectId: scope.projectId });
      ref = freezePilotValue(structuredClone(ref));
      const policy = freezePilotValue(
        structuredClone(await this.bounded(this.policies.current(scope), signal)),
      );
      this.validatePolicy(scope, policy);
      if (!Object.hasOwn(policy.executionGates, key) || !policy.executionGates[key]?.length)
        throw invalid();
      const document = structuredClone(
        await this.bounded(this.store.report(scope, ref, signal), signal),
      );
      freezePilotValue(document.reportRef);
      freezePilotValue(document.signature);
      if (!samePilotRef(document.reportRef, ref)) throw invalid();
      const budget = { bytes: 0, artifacts: 0, reports: 0, validUntil: Infinity };
      const report = await this.checkDocument(scope, document, policy, signal, budget, new Set());
      if (!policy.executionGates[key]!.includes(report.gate)) throw invalid();
      if (
        pilotContentHash(policy) !==
        pilotContentHash(await this.bounded(this.policies.current(scope), signal))
      )
        throw invalid();
      const finished = instant(report.finishedAt);
      if (finished + policy.maximumAgeMs <= this.clock() || budget.validUntil <= this.clock())
        throw invalid();
      // Stable identity and timestamps make importing the same verified execution idempotent.
      const bytes = createHash("sha256")
        .update(
          pilotContentHash({
            scope,
            key,
            ref,
            policyRef: policy.policyRef,
            subjectRef: policy.subjectRef,
          }),
        )
        .digest();
      bytes[6] = (bytes[6]! & 15) | 64;
      bytes[8] = (bytes[8]! & 63) | 128;
      const hex = bytes.subarray(0, 16).toString("hex");
      const execution: PilotGateExecution = {
        ...scope,
        id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        version: 1,
        key,
        subjectRef: policy.subjectRef,
        reportRef: document.reportRef,
        status: report.status,
        assessment: "CURRENT",
        evaluatedAt: report.finishedAt,
        validUntil: new Date(budget.validUntil).toISOString(),
        checks: report.checks.map((check) => ({ id: check.id, status: check.status })),
      };
      const verified = freezePilotValue({
        execution,
        verificationPolicyRef: policy.policyRef,
        verificationPolicyHash: pilotContentHash(policy),
        executorId: report.executorIdentity,
      });
      this.#verified.add(verified);
      return verified;
    } catch {
      throw invalid();
    }
  }
  /** Only in-process results of real verification can reach the persistence boundary. */
  async assertCurrent(verified: VerifiedPilotReport, parentSignal?: AbortSignal): Promise<void> {
    try {
      if (!this.#verified.has(verified)) throw invalid();
      const scope = {
        workspaceId: verified.execution.workspaceId,
        projectId: verified.execution.projectId,
      };
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.deadlineMs)])
        : AbortSignal.timeout(this.deadlineMs);
      signal.throwIfAborted();
      const policy = await this.bounded(this.policies.current(scope), signal);
      this.validatePolicy(scope, policy);
      if (
        pilotContentHash(policy) !== verified.verificationPolicyHash ||
        Date.parse(verified.execution.validUntil) <= this.clock()
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  }
  async verify(execution: PilotGateExecution): Promise<boolean> {
    try {
      const value = await this.materialize(execution, execution.key, execution.reportRef);
      return pilotContentHash(value.execution) === pilotContentHash(execution);
    } catch {
      return false;
    }
  }
  private validatePolicy(scope: ProjectScope, policy: PilotReportVerificationPolicy) {
    assertExactRevisionRef(policy.policyRef);
    assertExactRevisionRef(policy.subjectRef);
    const { policyRef, ...policyBody } = policy;
    if (pilotContentHash(policyBody) !== policyRef.contentHash) throw invalid();
    if (
      !scopeMatches(scope, policy) ||
      !Number.isSafeInteger(policy.maximumAgeMs) ||
      policy.maximumAgeMs < 1 ||
      policy.maximumAgeMs > 30 * 24 * 60 * 60_000 ||
      !policy.deploymentProfiles.length ||
      fingerprintNames.some((key) => !digest.test(policy.fingerprints[key] ?? "")) ||
      Object.values(policy.fingerprints).some((value) => !digest.test(value)) ||
      !policy.keys.length ||
      policy.deploymentProfiles.some((value) => !["local", "integration", "pilot"].includes(value))
    )
      throw invalid();
    if (
      policy.deploymentProfiles.some((value) => value !== "local") &&
      !digest.test(policy.fingerprints.image ?? "")
    )
      throw invalid();
    const keys = new Set<string>();
    for (const key of policy.keys) {
      assertExactRevisionRef(key.keyRef);
      if (
        !key.executorId ||
        keys.has(`${key.keyRef.id}:${key.keyRef.version}`) ||
        key.publicKey.kty !== "OKP" ||
        key.publicKey.crv !== "Ed25519" ||
        key.publicKey.d ||
        pilotContentHash(key.publicKey) !== key.keyRef.contentHash
      )
        throw invalid();
      keys.add(`${key.keyRef.id}:${key.keyRef.version}`);
    }
  }
  private async checkDocument(
    scope: ProjectScope,
    document: PilotReportDocument,
    policy: PilotReportVerificationPolicy,
    signal: AbortSignal,
    budget: { bytes: number; artifacts: number; reports: number; validUntil: number },
    ancestors: Set<string>,
  ): Promise<Report> {
    document = structuredClone(document);
    freezePilotValue(document.reportRef);
    freezePilotValue(document.signature);
    assertExactRevisionRef(document.reportRef);
    if (
      ++budget.reports > 32 ||
      ancestors.size >= 8 ||
      ancestors.has(document.reportRef.contentHash)
    )
      throw invalid();
    this.consume(document.bytes, budget, 2_000_000);
    if (
      hashBytes(document.bytes) !== document.reportRef.contentHash ||
      !samePilotRef(document.signature.subjectRef, policy.subjectRef)
    )
      throw invalid();
    const key = policy.keys.find(
      (key) =>
        key.executorId === document.signature.executorId &&
        samePilotRef(key.keyRef, document.signature.keyRef),
    );
    if (!key || !/^[A-Za-z0-9_-]{86}$/u.test(document.signature.value)) throw invalid();
    const signature = Buffer.from(document.signature.value, "base64url");
    if (
      signature.length !== 64 ||
      signature.toString("base64url") !== document.signature.value ||
      !verifySignature(
        null,
        pilotReportSigningBytes(document),
        createPublicKey({ key: key.publicKey, format: "jwk" }),
        signature,
      )
    )
      throw invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(document.bytes);
    const report = designContractRegistry.validateById(
      pilotSchemaIds.gateReport,
      JSON.parse(text) as Report,
    );
    const started = instant(report.startedAt);
    const finished = instant(report.finishedAt);
    const now = this.clock();
    budget.validUntil = Math.min(budget.validUntil, finished + policy.maximumAgeMs);
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(finished) ||
      started > finished ||
      finished > now ||
      finished + policy.maximumAgeMs <= now ||
      report.executorIdentity !== key.executorId ||
      report.scope.workspaceId !== scope.workspaceId ||
      report.scope.projectIds.length !== 1 ||
      report.scope.projectIds[0] !== scope.projectId ||
      !policy.deploymentProfiles.includes(report.deploymentProfile) ||
      Object.entries(policy.fingerprints).some(
        ([key, value]) => report.fingerprints[key] !== value,
      ) ||
      new Set(report.checks.map((check) => check.id)).size !== report.checks.length ||
      report.checks.length > 256
    )
      throw invalid();
    const path = new Set(ancestors).add(document.reportRef.contentHash);
    for (const reference of [
      ...report.checks.flatMap((check) => check.evidence),
      ...(report.measurementsRef ? [report.measurementsRef] : []),
    ]) {
      this.reference(reference);
      if (++budget.artifacts > 256) throw invalid();
      const bytes = await this.bounded(
        this.store.evidence(scope, document.reportRef, reference, signal),
        signal,
      );
      this.consume(bytes, budget, 20_000_000);
      if (hashBytes(bytes) !== reference.sha256) throw invalid();
    }
    for (const reference of report.prerequisites) {
      this.reference(reference);
      const child = await this.bounded(
        this.store.prerequisite(scope, document.reportRef, reference, signal),
        signal,
      );
      if (child.reportRef.contentHash !== reference.sha256) throw invalid();
      const result = await this.checkDocument(scope, child, policy, signal, budget, path);
      if (report.status === "PASS" && result.status !== "PASS") throw invalid();
    }
    if (finished + policy.maximumAgeMs <= this.clock()) throw invalid();
    return report;
  }
  private reference(value: PilotReportReference) {
    if (
      !digest.test(value.sha256) ||
      !/^reports\/008-pilot-hardening-and-conformance\/[A-Za-z0-9._/-]+$/u.test(value.path) ||
      value.path.length > 1024 ||
      value.path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw invalid();
  }
  private consume(bytes: Uint8Array, budget: { bytes: number }, maximum: number) {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > maximum ||
      (budget.bytes += bytes.byteLength) > 40_000_000
    )
      throw invalid();
  }
  private async bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort!: () => void;
    try {
      signal.throwIfAborted();
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(invalid());
          signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  }
}

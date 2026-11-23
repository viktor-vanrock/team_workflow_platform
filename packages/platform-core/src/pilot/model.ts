import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { ExactRevisionRef, ProjectScope } from "../project-onboarding/primitives.ts";

export type PilotGateKind = "L0" | "C1" | "N2" | "P3";
export type PilotGateStatus = "PASS" | "FAIL" | "BLOCKED_INPUT" | "SKIPPED_GATED";
export type PilotGateAssessment = "CURRENT" | "STALE" | "EXPIRED" | "REVOKED";
export interface PilotGateExecution extends ProjectScope {
  readonly id: string;
  readonly version: 1;
  readonly key: string;
  readonly subjectRef: ExactRevisionRef;
  readonly reportRef: ExactRevisionRef;
  readonly status: PilotGateStatus;
  readonly assessment: PilotGateAssessment;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly checks: readonly Readonly<{ id: string; status: PilotGateStatus }>[];
}

/** The persisted 007 gate result remains the authority; executions are its evidence. */
export interface PilotOnboardingGateResult extends ProjectScope {
  readonly id: string;
  readonly version: 1;
  readonly gateKind: PilotGateKind;
  readonly subjectRef: ExactRevisionRef;
  readonly outcome: Exclude<PilotGateStatus, "SKIPPED_GATED">;
  readonly safeIssueCodes: readonly string[];
  readonly evidenceRefs: readonly ExactRevisionRef[];
  readonly evaluatedBy: string;
  readonly evaluatedAt: string;
  readonly validUntil: string | null;
  readonly contentHash: string;
}

export type PilotFenceMode =
  "DENY" | "SANDBOX_CONFORMANCE" | "SHADOW" | "COHORT_WRITES" | "RECOVERY";
export interface PilotEffectContext {
  readonly principalId: string;
  readonly purpose: "BUSINESS" | "SANDBOX_CONFORMANCE";
  readonly deploymentRef: ExactRevisionRef;
  readonly cohortRef: ExactRevisionRef;
  readonly fenceRef: ExactRevisionRef;
}
export interface PilotFenceSnapshot extends ProjectScope {
  readonly mode: PilotFenceMode;
  readonly fenceRef: ExactRevisionRef;
  readonly deploymentRef: ExactRevisionRef;
  readonly cohortRef: ExactRevisionRef;
  readonly projectIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly environment: "LOCAL" | "NON_PROD";
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly runtimeInstanceId: string;
}
export interface PilotFencePort {
  current(scope: ProjectScope): Promise<PilotFenceSnapshot | undefined>;
  /** Current identity/entitlement/permission evaluation, never a cached cohort grant. */
  authorize(scope: ProjectScope, context: PilotEffectContext): Promise<boolean>;
}

export type PilotRecordKind = "GATE_EXECUTION" | "COHORT" | "RECOVERY" | "DEPLOYMENT" | "FENCE";
export interface PilotRecord extends ProjectScope {
  readonly id: string;
  readonly version: number;
  readonly schemaVersion: 1;
  readonly kind: PilotRecordKind;
  readonly actorRef: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly body: Readonly<Record<string, JsonValue>>;
  readonly contentHash: string;
}
export function pilotContentHash(value: unknown): string {
  return sha256(value as JsonValue);
}
export function samePilotRef(
  left: ExactRevisionRef | undefined,
  right: ExactRevisionRef | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.id === right.id &&
    left.version === right.version &&
    left.contentHash === right.contentHash,
  );
}
export function freezePilotValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezePilotValue(child);
    Object.freeze(value);
  }
  return value;
}

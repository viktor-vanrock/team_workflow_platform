import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";
import type { QaSemanticRef } from "./qa-project-context.ts";
import type { QaRequestInputRevision } from "./qa-request-input-revision.ts";

export type QaReadinessState = "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER";
export type QaReadinessSyncState =
  "NOT_EVALUATED" | "NEEDS_INFO" | "READY_PENDING_SYNC" | "READY" | "SYNC_ERROR";

export interface QaReadinessBlocker {
  readonly code: string;
  readonly field: string;
  readonly pointer: string;
  readonly severity: "BLOCKING";
  readonly remediation: string;
  readonly waivable: boolean;
}

export interface QaReadinessAssessment {
  readonly schemaVersion: 1;
  readonly assessmentId: string;
  readonly version: number;
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly requestInputRevisionRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly extensionResourceVersion: number;
  readonly state: QaReadinessState;
  readonly inputFingerprint: QaContentHash;
  readonly contextRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly dorRuleSetRef: QaSemanticRef;
  readonly inputs: Readonly<{
    readonly acceptedRequest: unknown;
    readonly project: unknown;
    readonly requesterEntitlement: unknown;
    readonly mappingHealth: unknown;
    readonly responseChannel: Readonly<{
      state: "CONFIRMED" | "UNCONFIRMED";
      requesterPrincipal: QaHumanActor;
      [key: string]: unknown;
    }>;
  }>;
  readonly blockers: readonly QaReadinessBlocker[];
  readonly warnings: readonly string[];
  readonly acknowledgements: readonly string[];
  readonly waivedRuleCodes: readonly string[];
  readonly waiverRef?: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly evaluatedBy: QaHumanActor;
  readonly evaluatedAt: string;
  readonly contentHash: QaContentHash;
}

export function qaReadinessInputFingerprint(
  input: Readonly<{
    currentInput: QaRequestInputRevision;
    acceptedRequest: unknown;
    project: unknown;
    requesterEntitlement: unknown;
    mappingHealth: unknown;
    contextRef: unknown;
    dorRuleSetRef: unknown;
  }>,
): QaContentHash {
  // Public JSON omits absent optional facts. Normalizing here also keeps pure
  // callers from accidentally making `undefined` an authority-bearing value.
  return qaAggregateSnapshotHash(JSON.parse(JSON.stringify(input)) as never);
}

export function buildQaReadinessAssessment(
  input: Omit<QaReadinessAssessment, "schemaVersion" | "contentHash">,
): QaReadinessAssessment {
  if (
    input.version < 1 ||
    input.assessmentId.length === 0 ||
    Number.isNaN(Date.parse(input.evaluatedAt))
  )
    throw new QaDomainError("QA_READINESS_ASSESSMENT_INVALID");
  if (input.state === "NEEDS_INFO" && input.blockers.length === 0)
    throw new QaDomainError("QA_READINESS_BLOCKERS_REQUIRED");
  if (
    input.state === "READY" &&
    (input.blockers.length > 0 || input.waiverRef !== undefined || input.waivedRuleCodes.length > 0)
  )
    throw new QaDomainError("QA_READY_MUST_BE_BLOCKER_FREE");
  if (
    input.state === "READY_WITH_WAIVER" &&
    (input.waiverRef === undefined ||
      input.waivedRuleCodes.length !== 1 ||
      input.waivedRuleCodes[0] !== "PROJECT_REGISTRY_NEEDS_REVIEW")
  )
    throw new QaDomainError("QA_READINESS_WAIVER_INVALID");
  const body = Object.freeze({ schemaVersion: 1 as const, ...structuredClone(input) });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function qaReadinessAssessmentRef(assessment: QaReadinessAssessment) {
  return Object.freeze({
    id: assessment.assessmentId,
    version: assessment.version,
    contentHash: assessment.contentHash,
  });
}

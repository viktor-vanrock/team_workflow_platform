import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "./primitives.ts";
import type { QaVerdictValue } from "./verdict.ts";

export type QaCompletionCandidateState =
  | "CANDIDATE"
  | "AWAITING_APPROVAL"
  | "AUTHORIZED"
  | "DISPATCHED"
  | "CONFIRMED"
  | "REJECTED"
  | "INVALIDATED"
  | "FAILED";
export type QaCompletionPredispatchState = "CANDIDATE" | "AWAITING_APPROVAL" | "AUTHORIZED";

export interface QaCompletionOutcomeRef extends QaExactReference {
  readonly kind: "DEFECT_LINK" | "DISPOSITION";
}

export interface QaCompletionSummary {
  readonly schemaVersion: 1;
  readonly scope: Readonly<{ workspaceId: string; projectId: string; workItemId: string }>;
  readonly verdictRef: QaExactReference;
  readonly verdict: QaVerdictValue;
  readonly residualRisk: string;
  readonly evidenceManifestRefs: readonly QaExactReference[];
  readonly defectLinkOrDispositionRefs: readonly QaCompletionOutcomeRef[];
  readonly summary: string;
  readonly contentHash: QaContentHash;
}

function sortedRefs<T extends QaExactReference>(refs: readonly T[]): readonly T[] {
  const sorted = [...refs].sort(
    (left, right) => left.id.localeCompare(right.id) || left.version - right.version,
  );
  const seen = new Set<string>();
  for (const ref of sorted) {
    const key = `${ref.id}:${ref.version}:${ref.contentHash}`;
    if (!ref.id || ref.version < 1 || !ref.contentHash.startsWith("sha256:") || seen.has(key)) {
      throw new QaDomainError("QA_COMPLETION_SUMMARY_REF_INVALID");
    }
    seen.add(key);
  }
  return Object.freeze(structuredClone(sorted));
}

export function buildCompletionSummary(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    verdictRef: QaExactReference;
    verdict: QaVerdictValue;
    residualRisk: string;
    evidenceManifestRefs: readonly QaExactReference[];
    defectLinkOrDispositionRefs: readonly QaCompletionOutcomeRef[];
  }>,
): QaCompletionSummary {
  if (
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !input.residualRisk.trim() ||
    input.evidenceManifestRefs.length === 0
  ) {
    throw new QaDomainError("QA_COMPLETION_SUMMARY_INVALID");
  }
  const evidenceManifestRefs = sortedRefs(input.evidenceManifestRefs);
  const outcomeRefs = sortedRefs(input.defectLinkOrDispositionRefs);
  if (outcomeRefs.some(({ kind }) => kind !== "DEFECT_LINK" && kind !== "DISPOSITION")) {
    throw new QaDomainError("QA_COMPLETION_SUMMARY_OUTCOME_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: 1 as const,
    scope: Object.freeze({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
    }),
    verdictRef: Object.freeze(structuredClone(input.verdictRef)),
    verdict: input.verdict,
    residualRisk: input.residualRisk,
    evidenceManifestRefs,
    defectLinkOrDispositionRefs: outcomeRefs,
    summary: `QA ${input.verdict}: ${input.residualRisk}`,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export interface QaCompletionCandidateInput {
  readonly candidateId: string;
  readonly candidateNumber: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly readyToCloseDodRef: QaExactReference;
  readonly verdictRef: QaExactReference;
  readonly verdict: QaVerdictValue;
  readonly residualRisk: string;
  readonly evidenceManifestRefs: readonly QaExactReference[];
  readonly defectLinkOrDispositionRefs: readonly QaCompletionOutcomeRef[];
  readonly requiredSessionPlanRef: QaExactReference;
  readonly aggregateSnapshotHash: QaContentHash;
  readonly expectedExternalState: string;
  readonly expectedExternalVersion: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly initiatedBy: QaHumanActor;
  readonly createdAt: string;
}

export class QaCompletionCandidateAggregate {
  readonly candidateId: string;
  readonly candidateNumber: number;
  readonly version = 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly readyToCloseDodRef: QaExactReference;
  readonly verdictRef: QaExactReference;
  readonly requiredSessionPlanRef: QaExactReference;
  readonly aggregateSnapshotHash: QaContentHash;
  readonly expectedExternalState: string;
  readonly expectedExternalVersion: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly initiatedBy: QaHumanActor;
  readonly createdAt: string;
  readonly summary: QaCompletionSummary;
  readonly contentHash: QaContentHash;
  state: QaCompletionCandidateState = "CANDIDATE";
  resourceVersion = 1;
  approvalRef?: Readonly<{ id: string; subjectHash: QaContentHash }>;
  approvedBy?: string;
  approvedAuthorizationBasisHash?: QaContentHash;
  approvedAt?: string;
  commandRef?: Readonly<{ id: string }>;
  effectKeyHash?: QaContentHash;
  dispatchedAt?: string;
  terminalFromState?: QaCompletionPredispatchState | "AWAITING_APPROVAL" | "DISPATCHED";
  terminalReason?: string;
  failureCode?: string;
  confirmationRef?: QaExactReference;
  summaryReceipt?: Readonly<{ id: string; contentHash: QaContentHash }>;
  confirmedAt?: string;

  constructor(input: QaCompletionCandidateInput) {
    if (
      !input.candidateId ||
      input.candidateNumber < 1 ||
      !input.expectedExternalVersion ||
      input.profileRefs.length === 0 ||
      Number.isNaN(Date.parse(input.createdAt))
    ) {
      throw new QaDomainError("QA_COMPLETION_CANDIDATE_INVALID");
    }
    this.candidateId = input.candidateId;
    this.candidateNumber = input.candidateNumber;
    this.workspaceId = input.workspaceId;
    this.projectId = input.projectId;
    this.workItemId = input.workItemId;
    this.readyToCloseDodRef = Object.freeze(structuredClone(input.readyToCloseDodRef));
    this.verdictRef = Object.freeze(structuredClone(input.verdictRef));
    this.requiredSessionPlanRef = Object.freeze(structuredClone(input.requiredSessionPlanRef));
    this.aggregateSnapshotHash = input.aggregateSnapshotHash;
    this.expectedExternalState = input.expectedExternalState;
    this.expectedExternalVersion = input.expectedExternalVersion;
    this.bindingRef = Object.freeze(structuredClone(input.bindingRef));
    this.profileRefs = Object.freeze(structuredClone(input.profileRefs));
    this.initiatedBy = Object.freeze(structuredClone(input.initiatedBy));
    this.createdAt = input.createdAt;
    this.summary = buildCompletionSummary(input);
    this.contentHash = qaAggregateSnapshotHash({
      candidateId: this.candidateId,
      candidateNumber: this.candidateNumber,
      readyToCloseDodRef: this.readyToCloseDodRef,
      verdictRef: this.verdictRef,
      requiredSessionPlanRef: this.requiredSessionPlanRef,
      aggregateSnapshotHash: this.aggregateSnapshotHash,
      expectedExternalState: this.expectedExternalState,
      expectedExternalVersion: this.expectedExternalVersion,
      bindingRef: this.bindingRef,
      profileRefs: this.profileRefs,
      initiatedBy: this.initiatedBy,
      summary: this.summary,
    } as never);
  }

  get ref(): QaExactReference {
    return Object.freeze({
      id: this.candidateId,
      version: this.version,
      contentHash: this.contentHash,
    });
  }

  awaitApproval(
    input: Readonly<{ approvalId: string; subjectHash: QaContentHash; at: string }>,
  ): void {
    if (this.state !== "CANDIDATE") throw new QaDomainError("QA_COMPLETION_APPROVAL_STATE_INVALID");
    this.approvalRef = Object.freeze({ id: input.approvalId, subjectHash: input.subjectHash });
    this.transition("AWAITING_APPROVAL");
  }

  authorize(
    input: Readonly<{ approverId: string; authorizationBasisHash: QaContentHash; at: string }>,
  ): void {
    if (this.state !== "AWAITING_APPROVAL")
      throw new QaDomainError("QA_COMPLETION_AUTHORIZE_STATE_INVALID");
    if (input.approverId === this.initiatedBy.principalId)
      throw new QaDomainError("QA_COMPLETION_APPROVER_DISTINCT_REQUIRED");
    this.approvedBy = input.approverId;
    this.approvedAuthorizationBasisHash = input.authorizationBasisHash;
    this.approvedAt = input.at;
    this.transition("AUTHORIZED");
  }

  reject(input: Readonly<{ approverId: string; reason: string; at: string }>): void {
    if (this.state !== "AWAITING_APPROVAL" || !input.reason.trim())
      throw new QaDomainError("QA_COMPLETION_REJECT_STATE_INVALID");
    this.terminalFromState = "AWAITING_APPROVAL";
    this.terminalReason = input.reason;
    this.transition("REJECTED");
  }

  dispatch(input: Readonly<{ commandId: string; effectKeyHash: QaContentHash; at: string }>): void {
    if (this.state !== "AUTHORIZED" || !this.approvedBy || !this.approvalRef)
      throw new QaDomainError("QA_COMPLETION_DISPATCH_STATE_INVALID");
    this.commandRef = Object.freeze({ id: input.commandId });
    this.effectKeyHash = input.effectKeyHash;
    this.dispatchedAt = input.at;
    this.transition("DISPATCHED");
  }

  invalidate(reason: string): void {
    if (!(
      this.state === "CANDIDATE" ||
      this.state === "AWAITING_APPROVAL" ||
      this.state === "AUTHORIZED"
    )) {
      throw new QaDomainError("QA_COMPLETION_INVALIDATE_STATE_INVALID");
    }
    this.terminalFromState = this.state;
    this.terminalReason = reason;
    this.transition("INVALIDATED");
  }

  fail(input: Readonly<{ code: string; reason: string; at: string }>): void {
    if (this.state !== "DISPATCHED" || !input.reason.trim())
      throw new QaDomainError("QA_COMPLETION_FAILURE_STATE_INVALID");
    this.terminalFromState = "DISPATCHED";
    this.failureCode = input.code;
    this.terminalReason = input.reason;
    this.transition("FAILED");
  }

  confirm(
    input: Readonly<{
      confirmationRef: QaExactReference;
      summaryReceipt: Readonly<{ id: string; contentHash: QaContentHash }>;
      at: string;
    }>,
  ): void {
    if (
      this.state !== "DISPATCHED" ||
      input.summaryReceipt.contentHash !== this.summary.contentHash
    ) {
      throw new QaDomainError("QA_COMPLETION_CONFIRMATION_INVALID");
    }
    this.terminalFromState = "DISPATCHED";
    this.confirmationRef = Object.freeze(structuredClone(input.confirmationRef));
    this.summaryReceipt = Object.freeze(structuredClone(input.summaryReceipt));
    this.confirmedAt = input.at;
    this.transition("CONFIRMED");
  }

  private transition(state: QaCompletionCandidateState): void {
    this.state = state;
    this.resourceVersion += 1;
  }
}

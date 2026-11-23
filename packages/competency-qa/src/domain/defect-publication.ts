import type {
  QaFindingAggregate,
  QaFindingEvidenceRef,
  QaFindingReviewRevision,
  QaFindingSeverity,
} from "./finding.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export type QaDefectDraftState =
  | "DRAFT"
  | "READY_FOR_APPROVAL"
  | "AWAITING_APPROVAL"
  | "AUTHORIZED"
  | "DISPATCHED"
  | "LINKED"
  | "REJECTED"
  | "INVALIDATED"
  | "FAILED";

export interface QaDefectDraftPayload {
  readonly title: string;
  readonly description: string;
  readonly stepsToReproduce: readonly string[];
  readonly expectedOutcome: string;
  readonly actualOutcome: string;
  readonly severity: QaFindingSeverity;
  readonly target: Readonly<Record<string, unknown>>;
  readonly evidenceRefs: readonly QaFindingEvidenceRef[];
}

export interface QaDefectLink {
  readonly defectLinkId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly findingId: string;
  readonly frozenFindingReviewRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly defectDraftRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: string;
  readonly normalizedStatus: "NEW";
  readonly effectKeyHash: QaContentHash;
  readonly linkedAt: string;
  readonly contentHash: QaContentHash;
}

export class QaDefectDraftAggregate {
  readonly defectDraftId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly findingId: string;
  readonly frozenFindingReviewRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly payload: QaDefectDraftPayload;
  readonly title: string;
  readonly description: string;
  readonly stepsToReproduce: readonly string[];
  readonly expectedOutcome: string;
  readonly actualOutcome: string;
  readonly severity: QaFindingSeverity;
  readonly evidenceRefs: readonly QaFindingEvidenceRef[];
  readonly provenance: Readonly<{
    source:
      "DETERMINISTIC_TEMPLATE" | "MODEL_PROPOSAL_ACCEPTED" | "DETERMINISTIC_FALLBACK_ACCEPTED";
    templateVersion: "1.0.0";
    acceptedProposalRef?: Readonly<{ id: string; contentHash: string }>;
  }>;
  readonly contentHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly predecessorDraftRef:
    Readonly<{ id: string; version: number; contentHash: QaContentHash }> | undefined;
  #state: QaDefectDraftState = "DRAFT";
  #resourceVersion = 1;
  acceptedBy?: QaHumanActor;
  acceptedAt?: string;
  rejectionReason?: string;
  bindingRef?: Readonly<{ id: string; version: number }>;
  profileRefs?: readonly Readonly<{ id: string; version: number }>[];
  approvalRef?: Readonly<{ id: string; subjectHash: string }>;
  commandRef?: Readonly<{ id: string }>;
  effectKeyHash?: QaContentHash;
  defectLinkId?: string;
  terminalFromState:
    Exclude<QaDefectDraftState, "LINKED" | "REJECTED" | "INVALIDATED" | "FAILED"> | undefined;
  terminalReason?: string;
  failureCode?: string;
  invalidationReason?: string;

  constructor(
    input: Readonly<{
      defectDraftId: string;
      version: number;
      finding: QaFindingAggregate;
      frozenReview: QaFindingReviewRevision;
      payload: QaDefectDraftPayload;
      provenance: QaDefectDraftAggregate["provenance"];
      createdBy: QaHumanActor;
      at: string;
      predecessorDraftRef?: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
    }>,
  ) {
    if (!input.finding.canCreateDefectDraft() || input.frozenReview.stage !== "FROZEN")
      throw new QaDomainError("QA_DEFECT_DRAFT_PRODUCT_CREATE_DEFECT_REQUIRED");
    this.defectDraftId = input.defectDraftId;
    this.version = input.version;
    this.workspaceId = input.finding.workspaceId;
    this.projectId = input.finding.projectId;
    this.workItemId = input.finding.workItemId;
    this.sessionId = input.finding.sessionId;
    this.findingId = input.finding.findingId;
    this.frozenFindingReviewRef = Object.freeze({
      id: input.frozenReview.id,
      version: input.frozenReview.version,
      contentHash: input.frozenReview.contentHash,
    });
    this.payload = Object.freeze(structuredClone(input.payload));
    this.title = input.payload.title;
    this.description = input.payload.description;
    this.stepsToReproduce = Object.freeze([...input.payload.stepsToReproduce]);
    this.expectedOutcome = input.payload.expectedOutcome;
    this.actualOutcome = input.payload.actualOutcome;
    this.severity = input.payload.severity;
    this.evidenceRefs = Object.freeze([...input.payload.evidenceRefs]);
    this.provenance = Object.freeze(structuredClone(input.provenance));
    this.createdBy = structuredClone(input.createdBy);
    this.createdAt = input.at;
    this.predecessorDraftRef = input.predecessorDraftRef;
    this.contentHash = qaAggregateSnapshotHash({
      version: input.version,
      findingId: this.findingId,
      frozenFindingReviewRef: this.frozenFindingReviewRef,
      payload: this.payload,
      provenance: this.provenance,
      predecessorDraftRef: input.predecessorDraftRef ?? null,
    } as never);
  }

  get state(): QaDefectDraftState {
    return this.#state;
  }
  get resourceVersion(): number {
    return this.#resourceVersion;
  }

  accept(input: Readonly<{ actor: QaHumanActor; at: string }>): void {
    if (this.#state !== "DRAFT") throw new QaDomainError("QA_DEFECT_DRAFT_ACCEPT_STATE_INVALID");
    this.acceptedBy = structuredClone(input.actor);
    this.acceptedAt = input.at;
    this.#transition("READY_FOR_APPROVAL");
  }
  reject(input: Readonly<{ actor: QaHumanActor; reason: string; at: string }>): void {
    if (this.#state !== "DRAFT" && this.#state !== "READY_FOR_APPROVAL")
      throw new QaDomainError("QA_DEFECT_DRAFT_REJECT_STATE_INVALID");
    if (!input.reason.trim()) throw new QaDomainError("QA_DEFECT_DRAFT_REJECTION_REASON_REQUIRED");
    this.terminalFromState = this.#state;
    this.rejectionReason = input.reason;
    this.terminalReason = input.reason;
    this.#transition("REJECTED");
  }
  awaitApproval(
    input: Readonly<{
      bindingRef: Readonly<{ id: string; version: number }>;
      profileRefs: readonly Readonly<{ id: string; version: number }>[];
      approvalRef: Readonly<{ id: string; subjectHash: string }>;
      at: string;
    }>,
  ): void {
    if (this.#state !== "READY_FOR_APPROVAL" || !input.profileRefs.length)
      throw new QaDomainError("QA_DEFECT_DRAFT_APPROVAL_STATE_INVALID");
    this.bindingRef = structuredClone(input.bindingRef);
    this.profileRefs = Object.freeze(structuredClone(input.profileRefs));
    this.approvalRef = structuredClone(input.approvalRef);
    void input.at;
    this.#transition("AWAITING_APPROVAL");
  }
  authorize(at: string): void {
    if (this.#state !== "AWAITING_APPROVAL")
      throw new QaDomainError("QA_DEFECT_DRAFT_AUTHORIZE_STATE_INVALID");
    void at;
    this.#transition("AUTHORIZED");
  }
  dispatch(input: Readonly<{ commandId: string; effectKeyHash: string; at: string }>): void {
    if (this.#state !== "AUTHORIZED")
      throw new QaDomainError("QA_DEFECT_DRAFT_DISPATCH_STATE_INVALID");
    this.commandRef = Object.freeze({ id: input.commandId });
    this.effectKeyHash = input.effectKeyHash as QaContentHash;
    void input.at;
    this.#transition("DISPATCHED");
  }
  invalidate(code: string): void {
    if (!["DRAFT", "READY_FOR_APPROVAL", "AWAITING_APPROVAL", "AUTHORIZED"].includes(this.#state))
      throw new QaDomainError("QA_DEFECT_DRAFT_INVALIDATE_STATE_INVALID");
    this.terminalFromState = this.#state as QaDefectDraftAggregate["terminalFromState"];
    this.invalidationReason = code;
    this.#transition("INVALIDATED");
  }
  fail(code: string, reason: string): void {
    if (["LINKED", "REJECTED", "INVALIDATED", "FAILED"].includes(this.#state))
      throw new QaDomainError("QA_DEFECT_DRAFT_FAILURE_STATE_INVALID");
    this.terminalFromState = this.#state as QaDefectDraftAggregate["terminalFromState"];
    this.failureCode = code;
    this.terminalReason = reason;
    this.#transition("FAILED");
  }
  link(defectLinkId: string): void {
    if (this.#state !== "DISPATCHED") throw new QaDomainError("QA_DEFECT_DRAFT_LINK_STATE_INVALID");
    this.defectLinkId = defectLinkId;
    this.#transition("LINKED");
  }
  #transition(state: QaDefectDraftState): void {
    this.#state = state;
    this.#resourceVersion += 1;
  }
}

/** Closed, one-head projection for immutable draft revisions. */
export class QaDefectDraftChain {
  readonly findingId: string;
  readonly drafts: QaDefectDraftAggregate[] = [];
  constructor(findingId: string) {
    if (!findingId) throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_INVALID");
    this.findingId = findingId;
  }
  get head(): QaDefectDraftAggregate | undefined {
    return this.drafts.at(-1);
  }
  append(draft: QaDefectDraftAggregate): void {
    if (draft.findingId !== this.findingId)
      throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_SCOPE_MISMATCH");
    const head = this.head;
    if (!head) {
      if (draft.version !== 1 || draft.predecessorDraftRef)
        throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_GAP");
    } else {
      if (head.state === "LINKED" || head.state === "REJECTED" || head.defectLinkId)
        throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_FINAL");
      if (head.state !== "FAILED" && head.state !== "INVALIDATED")
        throw new QaDomainError("QA_DEFECT_DRAFT_ACTIVE_HEAD_EXISTS");
      const predecessor = draft.predecessorDraftRef;
      if (
        !predecessor ||
        draft.version !== head.version + 1 ||
        predecessor.id !== head.defectDraftId ||
        predecessor.version !== head.version ||
        predecessor.contentHash !== head.contentHash
      )
        throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_GAP");
    }
    this.drafts.push(draft);
  }
  currentProjection():
    | Readonly<{ draft: QaDefectDraftAggregate; defectLinkId?: string; resolved: boolean }>
    | undefined {
    const head = this.head;
    if (!head) return undefined;
    return Object.freeze({
      draft: head,
      ...(head.state === "LINKED" && head.defectLinkId ? { defectLinkId: head.defectLinkId } : {}),
      resolved: head.state === "LINKED" || head.state === "REJECTED",
    });
  }
}

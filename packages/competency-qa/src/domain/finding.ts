import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export type QaFindingState = "DRAFT" | "CLASSIFIED" | "DISPOSED" | "FROZEN";
export type QaFindingClassification =
  "PRODUCT" | "INFRA" | "INCONCLUSIVE" | "DUPLICATE" | "ACCEPTED_RISK";
export type QaFindingDispositionDecision =
  "CREATE_DEFECT" | "DUPLICATE" | "NOT_A_BUG" | "ACCEPTED_RISK" | "DEFERRED" | "WAIVED";
export type QaFindingSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface QaFindingExternalRef {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface QaFindingActionRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}

export interface QaFindingEvidenceRef {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface QaFindingObservationInput {
  readonly observationId: string;
  readonly sessionId: string;
  readonly kind: "NEGATIVE" | "AMBIGUOUS";
  readonly affectedTargetHash: string;
  readonly evidenceRefs: readonly QaFindingEvidenceRef[];
}

export interface QaFindingObservationMembership {
  readonly membershipId: string;
  readonly observationId: string;
  readonly state: "ACTIVE" | "RELEASED";
  readonly assignedBy: QaHumanActor;
  readonly assignedAt: string;
  readonly releasedBy?: QaHumanActor;
  readonly releasedAt?: string;
  readonly releaseReason?: string;
  readonly resourceVersion: number;
}

export interface QaFindingReviewRevision {
  readonly id: string;
  readonly version: number;
  readonly stage: "CLASSIFIED" | "DISPOSED" | "FROZEN";
  readonly previousRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly findingId: string;
  readonly classification: QaFindingClassification;
  readonly severity: QaFindingSeverity;
  readonly summary: string;
  readonly affectedTargetHash: string;
  readonly classificationActor: QaHumanActor;
  readonly classificationReason: string;
  readonly classificationAt: string;
  readonly dispositionDecision?: QaFindingDispositionDecision;
  readonly dispositionActor?: QaHumanActor;
  readonly dispositionReason?: string;
  readonly dispositionAt?: string;
  readonly duplicateDefectRef?: QaFindingExternalRef;
  readonly acceptedRiskActionRef?: QaFindingActionRef;
  readonly waiverActionRef?: QaFindingActionRef;
  readonly frozenAt?: string;
  readonly activeMembershipSetHash: QaContentHash;
  readonly observationMembershipIds: readonly string[];
  readonly evidenceRefHash: QaContentHash;
  readonly policyRef: Readonly<{ key: string; version: string }>;
  readonly contentHash: QaContentHash;
}

interface StoredObservation extends QaFindingObservationInput {
  readonly membershipId: string;
}

const requireHuman = (actor: QaHumanActor): void => {
  if (actor.kind !== "HUMAN" || !actor.principalId || !actor.issuer || !actor.subject) {
    throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  }
};

const requireText = (value: string, code: string, max = 2_000): void => {
  if (!value.trim() || value.length > max) throw new QaDomainError(code);
};

const revisionRef = (revision: QaFindingReviewRevision) =>
  Object.freeze({
    id: revision.id,
    version: revision.version,
    contentHash: revision.contentHash,
  });

const allowedDisposition: Readonly<
  Record<QaFindingClassification, readonly QaFindingDispositionDecision[]>
> = Object.freeze({
  PRODUCT: Object.freeze<QaFindingDispositionDecision[]>(["CREATE_DEFECT", "DEFERRED", "WAIVED"]),
  INFRA: Object.freeze<QaFindingDispositionDecision[]>(["NOT_A_BUG", "DEFERRED", "WAIVED"]),
  INCONCLUSIVE: Object.freeze<QaFindingDispositionDecision[]>(["DEFERRED", "WAIVED"]),
  DUPLICATE: Object.freeze<QaFindingDispositionDecision[]>(["DUPLICATE"]),
  ACCEPTED_RISK: Object.freeze<QaFindingDispositionDecision[]>(["ACCEPTED_RISK"]),
});

export class QaFindingAggregate {
  readonly findingId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly reviews: QaFindingReviewRevision[] = [];
  readonly memberships: QaFindingObservationMembership[] = [];
  readonly invalidatedActionIds: string[] = [];
  #observations = new Map<string, StoredObservation>();
  #pendingActionIds = new Set<string>();
  #state: QaFindingState = "DRAFT";
  #currentReview: QaFindingReviewRevision | undefined;
  #frozenMembershipSetHash: QaContentHash | undefined;
  #resourceVersion = 1;

  private constructor(
    input: Readonly<{
      findingId: string;
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      actor: QaHumanActor;
      at: string;
    }>,
  ) {
    this.findingId = input.findingId;
    this.workspaceId = input.workspaceId;
    this.projectId = input.projectId;
    this.workItemId = input.workItemId;
    this.sessionId = input.sessionId;
    this.createdBy = structuredClone(input.actor);
    this.createdAt = input.at;
  }

  static create(
    input: Readonly<{
      findingId: string;
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      observation: QaFindingObservationInput;
      membershipId: string;
      actor: QaHumanActor;
      at: string;
    }>,
  ): QaFindingAggregate {
    requireHuman(input.actor);
    if (!input.findingId || input.observation.sessionId !== input.sessionId)
      throw new QaDomainError("QA_FINDING_SCOPE_MISMATCH");
    const aggregate = new QaFindingAggregate(input);
    aggregate.assign({
      membershipId: input.membershipId,
      observation: input.observation,
      actor: input.actor,
      at: input.at,
    });
    aggregate.#resourceVersion = 1;
    return aggregate;
  }

  get state(): QaFindingState {
    return this.#state;
  }
  get resourceVersion(): number {
    return this.#resourceVersion;
  }
  get currentReview(): QaFindingReviewRevision | undefined {
    return this.#currentReview;
  }
  get frozenMembershipSetHash(): QaContentHash | undefined {
    return this.#frozenMembershipSetHash;
  }
  get activeMemberships(): readonly QaFindingObservationMembership[] {
    return this.memberships.filter(({ state }) => state === "ACTIVE");
  }
  get activeObservationIds(): readonly string[] {
    return this.activeMemberships.map(({ observationId }) => observationId).sort();
  }
  get evidenceRefs(): readonly QaFindingEvidenceRef[] {
    const refs = new Map<string, QaFindingEvidenceRef>();
    for (const membership of this.activeMemberships) {
      for (const ref of this.#observations.get(membership.observationId)?.evidenceRefs ?? [])
        refs.set(`${ref.id}:${ref.version}:${ref.contentHash}`, ref);
    }
    return Object.freeze([...refs.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  attachPendingAction(actionId: string): void {
    if (this.#state === "FROZEN" || !actionId) throw new QaDomainError("QA_FINDING_ACTION_INVALID");
    this.#pendingActionIds.add(actionId);
  }

  assign(
    input: Readonly<{
      membershipId: string;
      observation: QaFindingObservationInput;
      actor: QaHumanActor;
      at: string;
    }>,
  ): QaFindingObservationMembership {
    requireHuman(input.actor);
    if (this.#state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    if (input.observation.sessionId !== this.sessionId)
      throw new QaDomainError("QA_FINDING_SCOPE_MISMATCH");
    if (input.observation.kind !== "NEGATIVE" && input.observation.kind !== "AMBIGUOUS")
      throw new QaDomainError("QA_FINDING_OBSERVATION_KIND_INVALID");
    if (
      this.activeMemberships.some(
        ({ observationId }) => observationId === input.observation.observationId,
      )
    )
      throw new QaDomainError("QA_FINDING_OBSERVATION_ALREADY_ASSIGNED");
    this.#resetDecision("MEMBERSHIP_CHANGED");
    const membership = Object.freeze({
      membershipId: input.membershipId,
      observationId: input.observation.observationId,
      state: "ACTIVE" as const,
      assignedBy: structuredClone(input.actor),
      assignedAt: input.at,
      resourceVersion: 1,
    });
    this.memberships.push(membership);
    this.#observations.set(
      input.observation.observationId,
      Object.freeze({ ...structuredClone(input.observation), membershipId: input.membershipId }),
    );
    this.#resourceVersion += 1;
    return membership;
  }

  release(
    input: Readonly<{ membershipId: string; reason: string; actor: QaHumanActor; at: string }>,
  ): QaFindingObservationMembership {
    requireHuman(input.actor);
    requireText(input.reason, "QA_FINDING_RELEASE_REASON_INVALID");
    if (this.#state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    const index = this.memberships.findIndex(
      ({ membershipId }) => membershipId === input.membershipId,
    );
    const current = this.memberships[index];
    if (!current || current.state !== "ACTIVE")
      throw new QaDomainError("QA_FINDING_MEMBERSHIP_NOT_ACTIVE");
    this.#resetDecision("MEMBERSHIP_CHANGED");
    const released = Object.freeze({
      ...current,
      state: "RELEASED" as const,
      releasedBy: structuredClone(input.actor),
      releasedAt: input.at,
      releaseReason: input.reason,
      resourceVersion: current.resourceVersion + 1,
    });
    this.memberships[index] = released;
    this.#resourceVersion += 1;
    return released;
  }

  correctAssignedObservation(
    input: Readonly<{
      predecessorObservationId: string;
      successorMembershipId: string;
      successor: QaFindingObservationInput;
      reason: string;
      actor: QaHumanActor;
      at: string;
    }>,
  ): void {
    requireText(input.reason, "QA_OBSERVATION_CORRECTION_REASON_INVALID");
    const active = this.activeMemberships.find(
      ({ observationId }) => observationId === input.predecessorObservationId,
    );
    if (!active) throw new QaDomainError("QA_FINDING_MEMBERSHIP_NOT_ACTIVE");
    this.release({
      membershipId: active.membershipId,
      reason: `OBSERVATION_CORRECTED:${input.reason}`,
      actor: input.actor,
      at: input.at,
    });
    // A corrected leaf is deliberately not auto-assigned or auto-classified.
    void input.successorMembershipId;
    void input.successor;
  }

  classify(
    input: Readonly<{
      classification: QaFindingClassification;
      severity: QaFindingSeverity;
      summary: string;
      reason: string;
      policyRef: Readonly<{ key: string; version: string }>;
      actor: QaHumanActor;
      at: string;
    }>,
  ): QaFindingReviewRevision {
    requireHuman(input.actor);
    requireText(input.summary, "QA_FINDING_SUMMARY_INVALID");
    requireText(input.reason, "QA_FINDING_CLASSIFICATION_REASON_INVALID");
    if (this.#state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    if (!this.activeMemberships.length) throw new QaDomainError("QA_FINDING_MEMBERSHIP_REQUIRED");
    if (!input.policyRef.key || !input.policyRef.version)
      throw new QaDomainError("QA_FINDING_POLICY_REQUIRED");
    if (this.#state !== "DRAFT") this.#invalidateActions();
    const membershipIds = this.#activeMembershipIds();
    const affectedTargetHash = this.#singleTargetHash();
    const evidenceRefHash = qaAggregateSnapshotHash(this.evidenceRefs as never);
    const version = this.reviews.length + 1;
    const previous = this.reviews.at(-1);
    const body = {
      id: `${this.findingId}:review:${version}`,
      version,
      stage: "CLASSIFIED" as const,
      ...(previous ? { previousRevisionRef: revisionRef(previous) } : {}),
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      workItemId: this.workItemId,
      sessionId: this.sessionId,
      findingId: this.findingId,
      classification: input.classification,
      severity: input.severity,
      summary: input.summary,
      affectedTargetHash,
      classificationActor: structuredClone(input.actor),
      classificationReason: input.reason,
      classificationAt: input.at,
      activeMembershipSetHash: this.#membershipHash(),
      observationMembershipIds: membershipIds,
      evidenceRefHash,
      policyRef: structuredClone(input.policyRef),
    };
    const revision = Object.freeze({
      ...body,
      contentHash: qaAggregateSnapshotHash(body as never),
    });
    this.reviews.push(revision);
    this.#currentReview = revision;
    this.#state = "CLASSIFIED";
    this.#resourceVersion += 1;
    return revision;
  }

  dispose(
    input: Readonly<{
      decision: QaFindingDispositionDecision;
      reason: string;
      actor: QaHumanActor;
      at: string;
      duplicateDefectRef?: QaFindingExternalRef;
      acceptedRiskActionRef?: QaFindingActionRef;
      waiverActionRef?: QaFindingActionRef;
    }>,
  ): QaFindingReviewRevision {
    requireHuman(input.actor);
    if (!input.reason.trim() && input.decision === "DUPLICATE")
      throw new QaDomainError("QA_FINDING_DUPLICATE_REF_REQUIRED");
    requireText(input.reason, "QA_FINDING_DISPOSITION_REASON_INVALID");
    const current = this.#currentReview;
    if (this.#state !== "CLASSIFIED" || !current || current.stage !== "CLASSIFIED")
      throw new QaDomainError("QA_FINDING_CLASSIFICATION_REQUIRED");
    if (!allowedDisposition[current.classification].includes(input.decision))
      throw new QaDomainError("QA_FINDING_DISPOSITION_INVALID");
    if (input.decision === "DUPLICATE" && !input.duplicateDefectRef)
      throw new QaDomainError("QA_FINDING_DUPLICATE_REF_REQUIRED");
    if (input.decision !== "DUPLICATE" && input.duplicateDefectRef)
      throw new QaDomainError("QA_FINDING_DUPLICATE_REF_FORBIDDEN");
    if (input.decision === "ACCEPTED_RISK" && !input.acceptedRiskActionRef)
      throw new QaDomainError("QA_FINDING_ACCEPTED_RISK_APPROVAL_REQUIRED");
    if (input.decision === "WAIVED" && !input.waiverActionRef)
      throw new QaDomainError("QA_FINDING_WAIVER_APPROVAL_REQUIRED");
    const version = this.reviews.length + 1;
    const body = {
      ...current,
      id: `${this.findingId}:review:${version}`,
      version,
      stage: "DISPOSED" as const,
      previousRevisionRef: revisionRef(current),
      dispositionDecision: input.decision,
      dispositionActor: structuredClone(input.actor),
      dispositionReason: input.reason,
      dispositionAt: input.at,
      ...(input.duplicateDefectRef
        ? { duplicateDefectRef: structuredClone(input.duplicateDefectRef) }
        : {}),
      ...(input.acceptedRiskActionRef
        ? { acceptedRiskActionRef: structuredClone(input.acceptedRiskActionRef) }
        : {}),
      ...(input.waiverActionRef ? { waiverActionRef: structuredClone(input.waiverActionRef) } : {}),
    };
    const { contentHash: oldHash, ...hashBody } = body;
    void oldHash;
    const revision = Object.freeze({
      ...hashBody,
      contentHash: qaAggregateSnapshotHash(hashBody as never),
    });
    this.reviews.push(revision);
    this.#currentReview = revision;
    this.#state = "DISPOSED";
    this.#resourceVersion += 1;
    return revision;
  }

  freeze(at: string): QaFindingReviewRevision {
    const current = this.#currentReview;
    if (this.#state !== "DISPOSED" || !current || current.stage !== "DISPOSED")
      throw new QaDomainError("QA_FINDING_DISPOSITION_REQUIRED");
    if (
      current.activeMembershipSetHash !== this.#membershipHash() ||
      current.observationMembershipIds.join("\n") !== this.#activeMembershipIds().join("\n")
    )
      throw new QaDomainError("QA_FINDING_MEMBERSHIP_STALE");
    const version = this.reviews.length + 1;
    const body = {
      ...current,
      id: `${this.findingId}:review:${version}`,
      version,
      stage: "FROZEN" as const,
      previousRevisionRef: revisionRef(current),
      frozenAt: at,
    };
    const { contentHash: oldHash, ...hashBody } = body;
    void oldHash;
    const revision = Object.freeze({
      ...hashBody,
      contentHash: qaAggregateSnapshotHash(hashBody as never),
    });
    this.reviews.push(revision);
    this.#currentReview = revision;
    this.#state = "FROZEN";
    this.#frozenMembershipSetHash = revision.activeMembershipSetHash;
    this.#pendingActionIds.clear();
    this.#resourceVersion += 1;
    return revision;
  }

  canCreateDefectDraft(): boolean {
    return (
      this.#state === "FROZEN" &&
      this.#currentReview?.classification === "PRODUCT" &&
      this.#currentReview.dispositionDecision === "CREATE_DEFECT"
    );
  }

  #activeMembershipIds(): string[] {
    return this.activeMemberships.map(({ membershipId }) => membershipId).sort();
  }
  #membershipHash(): QaContentHash {
    return qaAggregateSnapshotHash(
      this.activeMemberships
        .map(({ membershipId, observationId }) => ({ membershipId, observationId }))
        .sort((a, b) => a.membershipId.localeCompare(b.membershipId)) as never,
    );
  }
  #singleTargetHash(): string {
    const hashes = new Set(
      this.activeMemberships.map(
        ({ observationId }) => this.#observations.get(observationId)!.affectedTargetHash,
      ),
    );
    if (hashes.size !== 1) throw new QaDomainError("QA_FINDING_TARGET_MISMATCH");
    return [...hashes][0]!;
  }
  #invalidateActions(): void {
    for (const id of this.#pendingActionIds)
      if (!this.invalidatedActionIds.includes(id)) this.invalidatedActionIds.push(id);
    this.#pendingActionIds.clear();
  }
  #resetDecision(_reason: "MEMBERSHIP_CHANGED" | "OBSERVATION_CORRECTED"): void {
    void _reason;
    if (this.#state === "CLASSIFIED" || this.#state === "DISPOSED") {
      this.#invalidateActions();
      this.#state = "DRAFT";
      this.#currentReview = undefined;
    }
  }
}

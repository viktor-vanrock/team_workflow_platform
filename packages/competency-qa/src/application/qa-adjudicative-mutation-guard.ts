import {
  QaDomainError,
  type QaExactReference,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import { assertQaExactReference } from "../domain/revisions.ts";
import type {
  QaAdjudicativeProjection,
  QaAdjudicativeProjectionPort,
  QaCompletionState,
} from "./platform-ports.ts";
import {
  noopQaAdjudicativeMutationInvalidator,
  type QaAdjudicativeMutationInvalidator,
} from "./qa-adjudicative-mutation-invalidator.ts";

export const qaMutationClasses = Object.freeze([
  "AGGREGATE_MUTATION",
  "COMPLETION_SELF_TRANSITION",
  "POST_CLOSE_CLERICAL_CORRECTION",
  "READ_ONLY",
] as const);
export type QaMutationClass = (typeof qaMutationClasses)[number];

export interface QaMutationRequest {
  readonly classification: QaMutationClass;
  readonly candidateRef?: QaExactReference;
  readonly fromState?: QaCompletionState;
  readonly toState?: QaCompletionState;
  readonly expectedAggregateSnapshotHash?: `sha256:${string}`;
  readonly changesAggregate?: boolean;
  readonly idempotentReplay?: boolean;
  readonly clericalAnnotations?: readonly Readonly<{
    field: string;
    reason: string;
  }>[];
}

const predispatchStates = new Set<QaCompletionState>([
  "CANDIDATE",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
]);

const legalSelfTransitions = new Set([
  "CANDIDATE:AWAITING_APPROVAL",
  "AWAITING_APPROVAL:AUTHORIZED",
  "AWAITING_APPROVAL:REJECTED",
  "AUTHORIZED:DISPATCHED",
  "DISPATCHED:CONFIRMED",
  "DISPATCHED:FAILED",
]);

export class QaAdjudicativeMutationGuard {
  constructor(
    private readonly projections: QaAdjudicativeProjectionPort,
    private readonly invalidator: QaAdjudicativeMutationInvalidator = noopQaAdjudicativeMutationInvalidator,
  ) {}

  async authorize(
    context: QaWorkspaceContext,
    workItemId: string,
    request: QaMutationRequest,
  ): Promise<Readonly<{ classification: QaMutationClass }>> {
    if (!qaMutationClasses.includes(request.classification)) {
      throw new QaDomainError("QA_MUTATION_CLASS_UNSUPPORTED");
    }
    const projection = await this.projections.current(context, workItemId);
    switch (request.classification) {
      case "READ_ONLY":
        return Object.freeze({ classification: request.classification });
      case "AGGREGATE_MUTATION":
        await this.#authorizeAggregateMutation(context, workItemId, request, projection);
        return Object.freeze({ classification: request.classification });
      case "COMPLETION_SELF_TRANSITION":
        this.#authorizeSelfTransition(request, projection);
        return Object.freeze({ classification: request.classification });
      case "POST_CLOSE_CLERICAL_CORRECTION":
        this.#authorizePostCloseClerical(request, projection);
        return Object.freeze({ classification: request.classification });
    }
  }

  async #authorizeAggregateMutation(
    context: QaWorkspaceContext,
    workItemId: string,
    request: QaMutationRequest,
    projection: QaAdjudicativeProjection,
  ): Promise<void> {
    if (request.changesAggregate !== true)
      throw new QaDomainError("QA_AGGREGATE_MUTATION_REQUIRED");
    if (projection.normalizedStatus === "DONE") throw new QaDomainError("QA_WORK_ITEM_DONE");
    if (projection.completionCandidate?.state === "DISPATCHED") {
      throw new QaDomainError("QA_COMPLETION_IN_FLIGHT");
    }
    if (
      projection.completionCandidate !== undefined &&
      predispatchStates.has(projection.completionCandidate.state)
    ) {
      await this.invalidator.invalidatePending(context, workItemId, "AGGREGATE_CHANGED");
    }
  }

  #authorizeSelfTransition(request: QaMutationRequest, projection: QaAdjudicativeProjection): void {
    if (request.changesAggregate === true) {
      throw new QaDomainError("QA_SELF_TRANSITION_AGGREGATE_MUTATION");
    }
    const current = projection.completionCandidate;
    if (current === undefined || request.candidateRef === undefined) {
      throw new QaDomainError("QA_COMPLETION_CANDIDATE_MISMATCH");
    }
    try {
      assertQaExactReference(current, request.candidateRef);
    } catch {
      throw new QaDomainError("QA_COMPLETION_CANDIDATE_MISMATCH");
    }
    if (
      request.expectedAggregateSnapshotHash !== projection.aggregateSnapshotHash ||
      request.fromState !== current.state ||
      request.toState === undefined
    ) {
      throw new QaDomainError("QA_COMPLETION_CANDIDATE_STALE");
    }
    const replay =
      request.idempotentReplay === true &&
      current.state === "CONFIRMED" &&
      request.fromState === "CONFIRMED" &&
      request.toState === "CONFIRMED";
    if (!replay && !legalSelfTransitions.has(`${request.fromState}:${request.toState}`)) {
      throw new QaDomainError("QA_COMPLETION_TRANSITION_INVALID");
    }
    if (projection.normalizedStatus === "DONE" && !replay) {
      throw new QaDomainError("QA_WORK_ITEM_DONE");
    }
  }

  #authorizePostCloseClerical(
    request: QaMutationRequest,
    projection: QaAdjudicativeProjection,
  ): void {
    const annotations = request.clericalAnnotations ?? [];
    if (
      projection.normalizedStatus !== "DONE" ||
      request.changesAggregate === true ||
      annotations.length === 0 ||
      annotations.length > 8 ||
      annotations.some(
        ({ field, reason }) => field.length === 0 || reason.length === 0 || reason.length > 2000,
      )
    ) {
      throw new QaDomainError("QA_POST_CLOSE_CHANGE_NOT_CLERICAL");
    }
  }
}

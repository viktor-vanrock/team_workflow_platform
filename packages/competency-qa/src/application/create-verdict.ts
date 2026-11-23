import { type QaContentHash, QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import { type QaResidualRisk, QaVerdictAggregate, type QaVerdictInput } from "../domain/verdict.ts";

export function createQaVerdict(input: QaVerdictInput): QaVerdictAggregate {
  return new QaVerdictAggregate(input);
}

export function supersedeQaVerdict(
  previous: QaVerdictAggregate,
  input: Readonly<{
    verdictId: string;
    aggregateSnapshotHash: QaContentHash;
    residualRisk: QaResidualRisk;
    revisionReason: string;
    actor: QaHumanActor;
    at: string;
  }>,
): QaVerdictAggregate {
  if (previous.state !== "SIGNED" || input.actor.kind !== "HUMAN") {
    throw new QaDomainError("QA_VERDICT_SUPERSESSION_INVALID");
  }
  const next = new QaVerdictAggregate({
    verdictId: input.verdictId,
    version: previous.version + 1,
    workspaceId: previous.workspaceId,
    projectId: previous.projectId,
    workItemId: previous.workItemId,
    verdict: previous.verdict,
    residualRisk: input.residualRisk,
    effectiveRisk: previous.effectiveRisk,
    requiredSessionPlanRef: previous.requiredSessionPlanRef,
    sessionReviewRefs: previous.sessionReviewRefs,
    evidenceManifestRefs: previous.evidenceManifestRefs,
    findingOutcomeRefs: previous.findingOutcomeRefs,
    dodRuleSetRef: previous.dodRuleSetRef,
    riskPolicyRef: previous.riskPolicyRef,
    aggregateSnapshotHash: input.aggregateSnapshotHash,
    createdBy: input.actor,
    createdAt: input.at,
    supersedesVerdictRef: previous.ref,
    revisionReason: input.revisionReason,
  });
  previous.markSuperseded({ successorRef: next.ref, reason: input.revisionReason, at: input.at });
  return next;
}

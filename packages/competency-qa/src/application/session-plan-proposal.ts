import {
  QaSessionPlanProposalAggregate,
  type QaSessionPlanProposalSnapshot,
} from "../domain/session-plan-proposal.ts";

export function createSessionPlanProposal(
  input: Parameters<typeof QaSessionPlanProposalAggregate.create>[0],
): QaSessionPlanProposalSnapshot {
  return QaSessionPlanProposalAggregate.create(input).snapshot();
}
export function acceptSessionPlanProposal(
  value: QaSessionPlanProposalSnapshot,
  input: Readonly<{
    actorKind: "HUMAN" | "SERVICE";
    actorId: string;
    acceptedPlanRef: string;
    currentFactSetHash: string;
    now: Date;
  }>,
) {
  return QaSessionPlanProposalAggregate.restore(value).accept(
    input.actorKind,
    input.acceptedPlanRef,
    input.actorId,
    input.now,
    input.currentFactSetHash,
  );
}

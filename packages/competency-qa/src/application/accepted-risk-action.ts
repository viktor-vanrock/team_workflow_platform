import type { QaFindingActionCandidate } from "./finding-action-contribution.ts";

export function prepareAcceptedRiskAction(
  input: Omit<QaFindingActionCandidate, "decision">,
): QaFindingActionCandidate {
  return Object.freeze({ ...structuredClone(input), decision: "ACCEPTED_RISK" as const });
}

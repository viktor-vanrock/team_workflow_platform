import type { QaFindingActionCandidate } from "./finding-action-contribution.ts";

export function prepareFindingWaiverAction(
  input: Omit<QaFindingActionCandidate, "decision">,
): QaFindingActionCandidate {
  return Object.freeze({ ...structuredClone(input), decision: "WAIVED" as const });
}

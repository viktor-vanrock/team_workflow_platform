import { lookupJiraEffect } from "./jira-effect-control.ts";

export function classifyDefectDuplicates(
  input: Readonly<{ exactMarkerMatches: readonly string[]; heuristicMatches: readonly string[] }>,
) {
  return Object.freeze({
    exactEffect: lookupJiraEffect(input.exactMarkerMatches, true),
    heuristicCandidates: Object.freeze([...new Set(input.heuristicMatches)]),
    automaticHeuristicSelection: false as const,
  });
}

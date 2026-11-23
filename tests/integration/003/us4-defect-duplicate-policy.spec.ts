import { describe, expect, it } from "vitest";

import { classifyDefectDuplicates } from "../../../packages/connector-jira/src/operational/defect-duplicate-search.ts";

describe("US4 duplicate policy", () => {
  it("auto-adopts only exact effect markers and exposes heuristics for humans", () => {
    expect(
      classifyDefectDuplicates({ exactMarkerMatches: ["1"], heuristicMatches: ["2", "3"] }),
    ).toEqual({
      exactEffect: { state: "FOUND", externalEntityId: "1" },
      heuristicCandidates: ["2", "3"],
      automaticHeuristicSelection: false,
    });
    expect(
      classifyDefectDuplicates({ exactMarkerMatches: [], heuristicMatches: ["2"] }).exactEffect
        .state,
    ).toBe("PROVEN_ABSENT");
  });
});

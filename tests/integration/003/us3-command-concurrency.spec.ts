import { describe, expect, it } from "vitest";

import { TargetExecutionLane } from "../../../packages/platform-core/src/commanding/target-execution-lane.ts";

describe("US3 target concurrency", () => {
  it("fences the second command and retains an ambiguous lane", () => {
    const lane = new TargetExecutionLane("c:1");
    const first = lane.claim("c1", "e1", new Date(0), 1000);
    lane.start("c1", first.fencingToken);
    lane.markAmbiguous("c1", first.fencingToken);
    expect(() => lane.claim("c2", "e2", new Date(2000), 1000)).toThrow("TARGET_LANE_OCCUPIED");
    expect(() => lane.release("c1", first.fencingToken)).toThrow(
      "AMBIGUOUS_LANE_REQUIRES_RESOLUTION",
    );
  });
});

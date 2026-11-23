import { describe, expect, it } from "vitest";

import { TargetExecutionLane } from "../../../packages/platform-core/src/index.ts";

describe("fenced target execution lane", () => {
  it("serializes different commands and permits only same-effect recovery", () => {
    const lane = new TargetExecutionLane("tenant:REQUEST:10001");
    const first = lane.claim("command-1", "effect-1", new Date("2026-01-01T00:00:00Z"), 1_000);
    expect(first.fencingToken).toBe(1);
    expect(() =>
      lane.claim("command-2", "effect-2", new Date("2026-01-01T00:00:02Z"), 1_000),
    ).toThrow("TARGET_LANE_OCCUPIED");
    const recovery = lane.claim("command-1", "effect-1", new Date("2026-01-01T00:00:02Z"), 1_000);
    expect(recovery.fencingToken).toBe(2);
    lane.markAmbiguous("command-1", recovery.fencingToken);
    expect(() => lane.release("command-1", recovery.fencingToken)).toThrow(
      "AMBIGUOUS_LANE_REQUIRES_RESOLUTION",
    );
  });
});

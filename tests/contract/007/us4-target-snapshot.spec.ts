import { describe, expect, it } from "vitest";

import { buildTargetSnapshotV2 } from "../../../packages/competency-qa/src/application/target-snapshot-builder-v2.ts";
import { evidenceTarget } from "../../support/007-evidence-fixture.ts";

describe("US4 Target Snapshot v2", () => {
  it("pins the full transitive chain and rejects aliases/secrets/production", () => {
    const target = evidenceTarget();
    expect(target.configurationPins).toHaveLength(3);
    expect(() =>
      buildTargetSnapshotV2({
        ...target,
        snapshotId: "alias:latest",
        capturedAt: target.capturedAt,
        contentHash: undefined as never,
      } as never),
    ).toThrow("TARGET_SNAPSHOT_UNSAFE_IDENTIFIER");
  });
});

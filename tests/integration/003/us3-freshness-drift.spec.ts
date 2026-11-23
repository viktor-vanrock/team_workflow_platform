import { describe, expect, it } from "vitest";

import { deriveProjectionFreshness } from "../../../packages/platform-core/src/work-management/operational-projection.ts";
import { profileAvailability } from "../../../packages/runtime-composition/src/jira/profile-validation.ts";

describe("US3 freshness and local drift", () => {
  it("derives freshness and quarantines only the affected profile", () => {
    expect(
      deriveProjectionFreshness(
        new Date("2026-08-31T00:00:00Z"),
        60,
        new Date("2026-08-31T00:00:30Z"),
      ),
    ).toBe("CURRENT");
    expect(
      deriveProjectionFreshness(
        new Date("2026-08-31T00:00:00Z"),
        60,
        new Date("2026-08-31T00:02:00Z"),
      ),
    ).toBe("STALE");
    expect(
      profileAvailability(
        [
          { profileId: "p1", status: "DRIFTED" },
          { profileId: "p2", status: "VALID" },
        ],
        "p2",
      ),
    ).toBe("AVAILABLE");
  });
});

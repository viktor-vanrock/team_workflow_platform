import { describe, expect, it } from "vitest";

import { buildQueueRoutingHints } from "../../../../packages/runtime-composition/src/index.ts";

describe("US4 routing boundary", () => {
  it("intersects authorization, capability, and availability without assigning or granting access", () => {
    const candidates = [
      {
        projectId: "A",
        workItemId: "ready",
        requiredCapabilities: ["browser"],
        available: true,
        claimedByPrincipalId: "other",
      },
      {
        projectId: "A",
        workItemId: "missing-capability",
        requiredCapabilities: ["mobile"],
        available: true,
      },
      { projectId: "A", workItemId: "busy", requiredCapabilities: ["browser"], available: false },
      {
        projectId: "C-forbidden",
        workItemId: "hidden",
        requiredCapabilities: ["browser"],
        available: true,
        claimedByPrincipalId: "viewer",
      },
    ] as const;
    const hints = buildQueueRoutingHints({
      authorizedProjectIds: ["A"],
      principalCapabilities: ["browser"],
      candidates,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      projectId: "A",
      workItemId: "ready",
      capabilityMatch: "EXACT",
      availability: "AVAILABLE",
    });
    expect(JSON.stringify(hints)).not.toMatch(/claimedBy|principal|assigned|C-forbidden|hidden/u);
  });

  it("does not treat a claim in a forbidden Project as authorization", () => {
    expect(
      buildQueueRoutingHints({
        authorizedProjectIds: ["A"],
        principalCapabilities: [],
        candidates: [
          {
            projectId: "C",
            workItemId: "claimed-by-viewer",
            requiredCapabilities: [],
            available: true,
            claimedByPrincipalId: "viewer",
          },
        ],
      }),
    ).toEqual([]);
  });
});

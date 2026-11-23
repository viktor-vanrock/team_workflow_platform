import { describe, expect, it } from "vitest";

import { bootstrapHistoricalProjects } from "../../../packages/runtime-composition/src/onboarding/composition.ts";
import { onboardingFixture } from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 historical bootstrap", () => {
  it("creates deterministic conservative projections without invented P3/signature facts", () => {
    const projects = [
      {
        workspaceId: onboardingFixture.workspaceId,
        projectId: onboardingFixture.projectB,
        key: "b",
        name: "B",
      },
      {
        workspaceId: onboardingFixture.workspaceId,
        projectId: onboardingFixture.projectA,
        key: "a",
        name: "A",
      },
    ];
    const first = bootstrapHistoricalProjects(projects, onboardingFixture.now);
    const restarted = bootstrapHistoricalProjects([...projects].reverse(), onboardingFixture.now);
    expect(first).toEqual(restarted);
    expect(first.map(({ projectId }) => projectId)).toEqual([
      onboardingFixture.projectA,
      onboardingFixture.projectB,
    ]);
    expect(
      first.every(
        ({ stage, qaCapabilityMode, operationalState, gateResultRefs }) =>
          stage === "DRAFT" &&
          qaCapabilityMode === "MANUAL_ONLY" &&
          operationalState === "ACTIVE" &&
          gateResultRefs.length === 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/P3|signature|SIGNED_V2/iu);
  });
});

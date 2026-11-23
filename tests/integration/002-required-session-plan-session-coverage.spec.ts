import { describe, expect, it } from "vitest";

import { QaUs2RetestLineageResolver } from "../../packages/competency-qa/src/application/qa-retest-lineage-resolver.ts";
import { assertRequirementCarryForward } from "../../packages/competency-qa/src/domain/required-session-plan.ts";

const hash = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
describe("plan requirement coverage and US2 retest boundary", () => {
  it("accepts only an exact immediate unchanged carry-forward", () => {
    const previous = {
      id: "r1",
      ordinal: 1,
      requirementKey: "primary",
      mode: "MANUAL" as const,
      purpose: "smoke",
      minimumSessionCount: 1,
      requiredCapabilities: ["manual"],
      targetPolicyRef: { kind: "p", id: "t", version: "1", contentHash: hash("t") },
      scopePolicyRef: { kind: "p", id: "s", version: "1", contentHash: hash("s") },
      checklistPolicyRefs: [{ kind: "p", id: "c", version: "1", contentHash: hash("c") }],
      resolution: "REQUIRED" as const,
      contentHash: hash("same"),
      carriedForwardFromRequirementRef: null,
    };
    const current = {
      ...previous,
      id: "r2",
      carriedForwardFromRequirementRef: { id: "r1", version: 1, contentHash: previous.contentHash },
    };
    expect(() => assertRequirementCarryForward(current, previous)).not.toThrow();
    expect(() =>
      assertRequirementCarryForward({ ...current, contentHash: hash("changed") }, previous),
    ).toThrow("QA_PLAN_CARRY_FORWARD_INVALID");
  });
  it("supports external history and keeps native QA_SESSION unavailable until US3", async () => {
    const resolver = new QaUs2RetestLineageResolver();
    await expect(
      resolver.resolve(
        { workspaceId: "w", projectId: "p" },
        {
          kind: "EXTERNAL_HISTORICAL",
          historicalSessionRef: { kind: "history", id: "h", version: "1", contentHash: hash("h") },
        },
      ),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      resolver.resolve(
        { workspaceId: "w", projectId: "p" },
        {
          kind: "QA_SESSION",
          sessionId: "s",
          sessionReviewRef: { id: "review", version: 1, contentHash: hash("review") },
        },
      ),
    ).resolves.toEqual({ valid: false, code: "QA_NATIVE_SESSION_LINEAGE_UNAVAILABLE" });
  });
});

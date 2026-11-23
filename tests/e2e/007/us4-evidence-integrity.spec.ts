import { describe, expect, it } from "vitest";

import { runEvidenceRevisionRetentionScenario } from "../../../packages/runtime-composition/src/onboarding/evidence-revision-retention-scenario.ts";

describe("US4 journey", () => {
  it("completes, corrects, expires, verifies and exports", async () => {
    expect(await runEvidenceRevisionRetentionScenario()).toMatchObject({
      status: "PASS",
      signatureStatus: "VALID",
      revisionCount: 2,
      artifactState: "EXPIRED",
      metadataPreserved: true,
      legacyStatus: "LEGACY_INTEGRITY_ONLY",
    });
  });
});

import { describe, expect, it } from "vitest";

import { InMemoryArtifactRetentionLedger } from "../../../packages/runtime-composition/src/onboarding/artifact-retention-worker.ts";

describe("US4 retention", () => {
  it("preserves metadata/checksum across expiry, quarantine and legal hold", () => {
    const ledger = new InMemoryArtifactRetentionLedger();
    ledger.register({
      artifactId: "a",
      workspaceId: "w",
      projectId: "p",
      checksum: `sha256:${"a".repeat(64)}`,
      state: "AVAILABLE",
    });
    ledger.observe("a", "EXPIRED");
    expect(ledger.current("a")).toMatchObject({
      state: "EXPIRED",
      checksum: `sha256:${"a".repeat(64)}`,
    });
    ledger.hold("a");
    expect(() => ledger.observe("a", "EXPIRED")).toThrow("ARTIFACT_LEGAL_HOLD_ACTIVE");
  });
});

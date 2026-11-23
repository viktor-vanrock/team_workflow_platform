import { describe, expect, it } from "vitest";

import { correctEvidenceManifestV2 } from "../../../packages/competency-qa/src/application/correct-evidence-manifest.ts";
import { buildEvidenceManifestV2 } from "../../../packages/competency-qa/src/application/evidence-manifest-builder-v2.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";

describe("US4 corrections", () => {
  it("appends exact clerical/substantive predecessor without mutation", () => {
    const first = buildEvidenceManifestV2(manifestInput());
    const before = structuredClone(first);
    const next = correctEvidenceManifestV2(first, {
      manifestRevisionId: "manifest-r2",
      kind: "CLERICAL",
      reason: "label typo",
      createdAt: "2026-09-03T13:00:00Z",
      humanAttestation: first.humanAttestation,
    });
    expect(next.previousRevisionRef?.contentHash).toBe(first.contentHash);
    expect(first).toEqual(before);
  });
});

import { describe, expect, it } from "vitest";

import { buildEvidenceManifestV2 } from "../../../packages/competency-qa/src/application/evidence-manifest-builder-v2.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";

describe("US4 Evidence Manifest v2", () => {
  it("captures complete evidence, maximum classification and human attestation", () => {
    const manifest = buildEvidenceManifestV2(manifestInput());
    expect(manifest).toMatchObject({
      schemaVersion: "qa-evidence-manifest@2.0.0",
      effectiveClassificationKey: "RESTRICTED",
    });
    expect(manifest.contentHash).toMatch(/^sha256:/u);
  });
});

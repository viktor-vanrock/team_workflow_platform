import { describe, expect, it } from "vitest";

import { evidenceIntegrityModeForSchema } from "../../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";

describe("US4 legacy", () => {
  it("keeps v1 integrity-only and excludes it from signatures", () => {
    expect(evidenceIntegrityModeForSchema("urn:awp:schemas:qa:evidence:v1")).toBe(
      "LEGACY_INTEGRITY_ONLY",
    );
  });
});

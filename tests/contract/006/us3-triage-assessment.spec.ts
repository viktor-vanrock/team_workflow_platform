import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateQaTriageAssessmentContent } from "../../../packages/competency-qa/src/index.ts";
import {
  designContractRegistry,
  schemaDocuments,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";
import { cloneJson, triageFixture } from "../../helpers/006/triage-fixture.ts";

describe("US3 TriageAssessment 1.1 contract", () => {
  it("keeps v1 bytes frozen and publishes the additive 1.1 schema", () => {
    const v1 = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../specs/004-mattermost-hermes-intake/contracts/schemas/triage-assessment.v1.schema.json",
        ),
        "utf8",
      ),
    );
    expect(sha256(v1)).toBe(
      "sha256:bf810901aa4b74821f776f20d251b444b3426075bff0b88988c1ab36a5330c32",
    );
    expect(
      schemaDocuments.find(({ id }) => id === "urn:awp:schemas:004:triage-assessment:v1.1"),
    ).toBeDefined();
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:004:triage-assessment:v1.1",
        triageFixture(),
      ),
    ).toBeDefined();
  });

  it("requires factor evidence, closes missing keys/fact families, and has no scalar score", () => {
    const value = triageFixture();
    expect(Object.keys(value.dimensionDetails)).toHaveLength(8);
    expect(value.missingInformation).toContainEqual(
      expect.objectContaining({ key: "BUSINESS_IMPACT_MISSING" }),
    );
    expect(JSON.stringify(value)).not.toMatch(/totalScore/u);
    const broken = cloneJson(value) as Record<string, unknown>;
    delete broken.dimensionDetails;
    expect(() => validateQaTriageAssessmentContent(broken)).toThrow();
  });
});

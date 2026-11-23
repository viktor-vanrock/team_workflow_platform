import { describe, expect, it } from "vitest";

import { qaCompetencyManifest } from "../../../packages/competency-qa/src/manifest.ts";
import {
  qaCompetencyManifestV11,
  qaValidationWorkTypeDefinitionV11,
} from "../../../packages/competency-qa/src/manifest-v1.1.ts";

describe("QA 1.1 additive compatibility", () => {
  it("keeps immutable 1.0 and adds required intake/notify plus optional callback roles", () => {
    expect(qaCompetencyManifest.metadata.version).toBe("1.0.0");
    expect(qaCompetencyManifestV11.metadata.version).toBe("1.1.0");
    expect(qaValidationWorkTypeDefinitionV11.definitionVersion).toBe("1.1.0");
    const requirements = qaValidationWorkTypeDefinitionV11.capabilityRequirements.map(
      ({ logicalRole, requirement }) => [logicalRole, requirement],
    );
    expect(requirements).toEqual(
      expect.arrayContaining([
        ["INTAKE_MESSAGING", "REQUIRED"],
        ["NOTIFICATION_MESSAGING", "REQUIRED"],
        ["INTERACTION_MESSAGING", "OPTIONAL"],
      ]),
    );
  });
});

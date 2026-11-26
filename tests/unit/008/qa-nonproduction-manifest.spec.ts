import { describe, expect, it } from "vitest";

import { qaValidationWorkTypeDefinitionV14 } from "../../../packages/competency-qa/src/manifest-v1.4.ts";
import {
  qaCompetencyManifestV15,
  qaValidationWorkTypeDefinitionV15,
} from "../../../packages/competency-qa/src/manifest-v1.5.ts";
import { evaluateCapabilityRequirements } from "../../../packages/platform-core/src/integration-registry/binding-lifecycle.ts";

describe("QA non-production manifest", () => {
  it("adds non-production to Jira and messaging requirements without changing previous versions", () => {
    const old = qaValidationWorkTypeDefinitionV14.capabilityRequirements;
    const next = qaValidationWorkTypeDefinitionV15.capabilityRequirements;
    expect(qaCompetencyManifestV15.metadata.version).toBe("1.5.0");
    expect(next).toHaveLength(old.length);
    for (const [index, requirement] of next.entries()) {
      const original = old[index]!;
      if (
        requirement.capabilityKey === "operational-work-item" ||
        requirement.capabilityKey.startsWith("messaging.")
      ) {
        expect(original.allowedEnvironmentScopes).toEqual(["LOCAL"]);
        expect(requirement.allowedEnvironmentScopes).toEqual(["LOCAL", "NON_PRODUCTION"]);
        expect({
          ...requirement,
          allowedEnvironmentScopes: original.allowedEnvironmentScopes,
        }).toEqual(original);
      } else expect(requirement).toEqual(original);
      expect(requirement.allowedEnvironmentScopes).not.toContain("PRODUCTION");
    }
  });

  it("matches the registry's NON_PROD scope while preserving the old LOCAL restriction", () => {
    const original = qaValidationWorkTypeDefinitionV14.capabilityRequirements.find(
      (item) => item.requirementKey === "qa-request-authority",
    )!;
    const next = qaValidationWorkTypeDefinitionV15.capabilityRequirements.find(
      (item) => item.requirementKey === "qa-request-authority",
    )!;
    const entry = {
      capabilityKey: next.capabilityKey,
      logicalRole: next.logicalRole,
      exactContractVersion: "1.0.0",
      environmentScope: "NON_PROD",
      operations: next.operations,
    };
    expect(evaluateCapabilityRequirements([original], [entry] as never).publishable).toBe(false);
    expect(evaluateCapabilityRequirements([next], [entry] as never).publishable).toBe(true);
    expect(
      evaluateCapabilityRequirements([next], [
        { ...entry, environmentScope: "PRODUCTION" },
      ] as never).publishable,
    ).toBe(false);
  });
});

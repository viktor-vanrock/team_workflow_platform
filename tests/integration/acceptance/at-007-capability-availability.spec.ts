import { describe, expect, it } from "vitest";

import { evaluateCapabilityRequirements } from "../../../packages/platform-core/src/integration-registry/binding-lifecycle.ts";

const requirements = [
  {
    requirementKey: "required-record",
    featureKey: "record.publish",
    capabilityKey: "sample.record",
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "PRIMARY",
    operations: ["record.publish"],
    requirement: "REQUIRED" as const,
    allowedEnvironmentScopes: ["LOCAL" as const],
    maxDataClassification: "RESTRICTED",
  },
  {
    requirementKey: "optional-notify",
    featureKey: "record.notify",
    capabilityKey: "sample.notify",
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "SECONDARY",
    operations: ["record.notify"],
    requirement: "OPTIONAL" as const,
    allowedEnvironmentScopes: ["LOCAL" as const],
    maxDataClassification: "INTERNAL",
  },
];

describe("AT-007 capability availability", () => {
  it("blocks publication when a required requirement is missing", () => {
    const result = evaluateCapabilityRequirements(requirements, []);
    expect(result.publishable).toBe(false);
    expect(result.availability).toContainEqual(
      expect.objectContaining({
        requirementKey: "required-record",
        status: "UNAVAILABLE",
        reasonCode: "CAPABILITY_BINDING_MISSING",
      }),
    );
  });

  it("keeps publication possible when only an optional requirement is missing", () => {
    const result = evaluateCapabilityRequirements(requirements, [
      {
        capabilityKey: "sample.record",
        exactContractVersion: "1.0.0",
        logicalRole: "PRIMARY",
        environmentScope: "LOCAL",
        operations: ["record.publish"],
      },
    ]);
    expect(result.publishable).toBe(true);
    expect(result.availability).toContainEqual(
      expect.objectContaining({
        requirementKey: "optional-notify",
        status: "UNAVAILABLE",
        reasonCode: "OPTIONAL_CAPABILITY_UNAVAILABLE",
      }),
    );
  });
});

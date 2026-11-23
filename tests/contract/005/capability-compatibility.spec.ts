import { describe, expect, it } from "vitest";

import {
  qaCompetencyManifest,
  qaCompetencyManifestV11,
  qaCompetencyManifestV12,
  qaValidationWorkTypeDefinitionV12,
} from "../../../packages/competency-qa/src/index.ts";
import {
  ciArtifactCapability,
  sourceContextCapability,
  testExecutorCapability,
} from "../../../packages/connector-sdk/src/index.ts";

describe("Feature 005 capability compatibility", () => {
  it("publishes only the exact provider-neutral operation vocabulary", () => {
    expect(sourceContextCapability).toEqual({
      key: "source-context.read",
      version: "1.0.0",
      operations: ["merge-request.read", "commit.read", "build.read"],
    });
    expect(testExecutorCapability).toEqual({
      key: "test-executor.trigger-status",
      version: "1.0.0",
      operations: ["pipeline.trigger", "pipeline.read", "pipeline.lookup"],
    });
    expect(ciArtifactCapability).toEqual({
      key: "artifact.ci-read",
      version: "1.0.0",
      operations: ["artifact.metadata", "artifact.stream"],
    });

    const serialized = JSON.stringify([
      sourceContextCapability,
      testExecutorCapability,
      ciArtifactCapability,
    ]);
    for (const alias of [
      "source-context",
      "ci-pipeline",
      "test-executor.trigger",
      "test-executor.status",
      "artifact-reference",
      "pipeline.retry",
      "pipeline.cancel",
      "execute",
    ])
      expect(serialized).not.toContain(`"${alias}"`);
  });

  it("adds immutable competency-qa and qa.validation 1.2 manifests alongside 1.0 and 1.1", () => {
    expect(qaCompetencyManifest.metadata.version).toBe("1.0.0");
    expect(qaCompetencyManifestV11.metadata.version).toBe("1.1.0");
    expect(qaCompetencyManifestV12.metadata.version).toBe("1.2.0");
    expect(qaValidationWorkTypeDefinitionV12.definitionVersion).toBe("1.2.0");

    const automation = qaValidationWorkTypeDefinitionV12.capabilityRequirements
      .filter(({ logicalRole }) =>
        ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"].includes(logicalRole),
      )
      .map(({ logicalRole, capabilityKey, operations, requirement }) => ({
        logicalRole,
        capabilityKey,
        operations,
        requirement,
      }));
    expect(automation).toEqual([
      {
        logicalRole: "SOURCE_CONTEXT",
        capabilityKey: "source-context.read",
        operations: ["merge-request.read", "commit.read", "build.read"],
        requirement: "OPTIONAL",
      },
      {
        logicalRole: "TEST_EXECUTION",
        capabilityKey: "test-executor.trigger-status",
        operations: ["pipeline.trigger", "pipeline.read", "pipeline.lookup"],
        requirement: "OPTIONAL",
      },
      {
        logicalRole: "ARTIFACT_SOURCE",
        capabilityKey: "artifact.ci-read",
        operations: ["artifact.metadata", "artifact.stream"],
        requirement: "OPTIONAL",
      },
    ]);
    expect(Object.isFrozen(qaCompetencyManifestV12)).toBe(true);
    expect(Object.isFrozen(qaValidationWorkTypeDefinitionV12.capabilityRequirements)).toBe(true);
  });
});

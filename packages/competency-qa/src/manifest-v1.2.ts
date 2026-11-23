import type {
  CapabilityRequirement,
  CompetencyPackManifest,
  EnvironmentScope,
  WorkTypeDefinition,
} from "@awp/competency-sdk";

import { qaCompetencyManifest } from "./manifest.ts";
import { qaValidationWorkTypeDefinitionV11 } from "./manifest-v1.1.ts";

const sourceContextCapability = Object.freeze({
  key: "source-context.read" as const,
  operations: Object.freeze(["merge-request.read", "commit.read", "build.read"] as const),
});
const testExecutorCapability = Object.freeze({
  key: "test-executor.trigger-status" as const,
  operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"] as const),
});
const ciArtifactCapability = Object.freeze({
  key: "artifact.ci-read" as const,
  operations: Object.freeze(["artifact.metadata", "artifact.stream"] as const),
});

const automationRequirements = Object.freeze([
  Object.freeze({
    requirementKey: "automation-source-context",
    capabilityKey: sourceContextCapability.key,
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "SOURCE_CONTEXT",
    operations: sourceContextCapability.operations,
    requirement: "OPTIONAL",
    featureKey: "qa.automation",
    allowedEnvironmentScopes: Object.freeze(["LOCAL", "NON_PRODUCTION"] as const),
    maxDataClassification: "INTERNAL",
  }),
  Object.freeze({
    requirementKey: "automation-test-execution",
    capabilityKey: testExecutorCapability.key,
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "TEST_EXECUTION",
    operations: testExecutorCapability.operations,
    requirement: "OPTIONAL",
    featureKey: "qa.automation",
    allowedEnvironmentScopes: Object.freeze(["LOCAL", "NON_PRODUCTION"] as const),
    maxDataClassification: "INTERNAL",
  }),
  Object.freeze({
    requirementKey: "automation-artifact-source",
    capabilityKey: ciArtifactCapability.key,
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "ARTIFACT_SOURCE",
    operations: ciArtifactCapability.operations,
    requirement: "OPTIONAL",
    featureKey: "qa.automation",
    allowedEnvironmentScopes: Object.freeze(["LOCAL", "NON_PRODUCTION"] as const),
    maxDataClassification: "INTERNAL",
  }),
] as const);

const legacyRequirements: readonly CapabilityRequirement[] =
  qaValidationWorkTypeDefinitionV11.capabilityRequirements.map((requirement) =>
    Object.freeze({
      ...requirement,
      requirement: requirement.capabilityKey.startsWith("messaging.")
        ? ("OPTIONAL" as const)
        : requirement.requirement,
      allowedEnvironmentScopes: Object.freeze(
        requirement.allowedEnvironmentScopes.map((scope): EnvironmentScope => {
          if (scope !== "LOCAL" && scope !== "NON_PRODUCTION")
            throw new TypeError(`QA_ENVIRONMENT_SCOPE_INVALID:${scope}`);
          return scope;
        }),
      ),
    }),
  );

export const qaValidationWorkTypeDefinitionV12 = Object.freeze({
  ...qaValidationWorkTypeDefinitionV11,
  definitionVersion: "1.2.0",
  capabilityRequirements: Object.freeze([...legacyRequirements, ...automationRequirements]),
} as const satisfies WorkTypeDefinition);

export const qaCompetencyManifestV12 = Object.freeze({
  ...qaCompetencyManifest,
  metadata: Object.freeze({
    ...qaCompetencyManifest.metadata,
    version: "1.2.0",
    displayName: "QA Competency Pack with optional automation",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinitionV12]),
} as const satisfies CompetencyPackManifest);

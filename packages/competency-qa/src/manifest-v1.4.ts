import type { CompetencyPackManifest, WorkTypeDefinition } from "@awp/competency-sdk";
import { sha256 } from "@awp/platform-contracts";

import { qaCompetencyManifestV13, qaValidationWorkTypeDefinitionV13 } from "./manifest-v1.3.ts";

export type QaCapabilityRequirementMode = "MANUAL" | "AUTOMATION" | "PILOT_MESSAGING";

export interface QaProjectCapabilityRequirement {
  readonly requirementKey: string;
  readonly mode: QaCapabilityRequirementMode;
  readonly connectorType: "JIRA" | "GITLAB" | "MATTERMOST";
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly exactContractVersion: "1.0.0";
  readonly operations: readonly string[];
}

const requirements = Object.freeze([
  Object.freeze({
    requirementKey: "jira-qa-request-authority",
    mode: "MANUAL",
    connectorType: "JIRA",
    logicalRole: "QA_REQUEST_AUTHORITY",
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["request.create", "request.transition"]),
  }),
  Object.freeze({
    requirementKey: "jira-source-context",
    mode: "MANUAL",
    connectorType: "JIRA",
    logicalRole: "SOURCE_CONTEXT",
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["request.read"]),
  }),
  Object.freeze({
    requirementKey: "jira-defect-destination",
    mode: "MANUAL",
    connectorType: "JIRA",
    logicalRole: "DEFECT_DESTINATION",
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["defect.create"]),
  }),
  Object.freeze({
    requirementKey: "gitlab-source-context",
    mode: "AUTOMATION",
    connectorType: "GITLAB",
    logicalRole: "SOURCE_CONTEXT",
    capabilityKey: "source-context.read",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["merge-request.read", "commit.read", "build.read"]),
  }),
  Object.freeze({
    requirementKey: "gitlab-test-execution",
    mode: "AUTOMATION",
    connectorType: "GITLAB",
    logicalRole: "TEST_EXECUTION",
    capabilityKey: "test-executor.trigger-status",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"]),
  }),
  Object.freeze({
    requirementKey: "gitlab-artifact-source",
    mode: "AUTOMATION",
    connectorType: "GITLAB",
    logicalRole: "ARTIFACT_SOURCE",
    capabilityKey: "artifact.ci-read",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["artifact.metadata", "artifact.stream"]),
  }),
  Object.freeze({
    requirementKey: "mattermost-pilot-messaging",
    mode: "PILOT_MESSAGING",
    connectorType: "MATTERMOST",
    logicalRole: "PILOT_MESSAGING",
    capabilityKey: "messaging.notification",
    exactContractVersion: "1.0.0",
    operations: Object.freeze(["notification.send"]),
  }),
] as const satisfies readonly QaProjectCapabilityRequirement[]);

const requirementSetBody = Object.freeze({
  id: "qa.validation-capability-requirements",
  version: 1,
  requirements,
});

export const qaValidationCapabilityRequirementSetV1 = Object.freeze({
  ...requirementSetBody,
  ref: Object.freeze({
    id: requirementSetBody.id,
    version: requirementSetBody.version,
    contentHash: sha256(requirementSetBody),
  }),
});

export const qaValidationWorkTypeDefinitionV14 = Object.freeze({
  ...qaValidationWorkTypeDefinitionV13,
  definitionVersion: "1.4.0",
} as const satisfies WorkTypeDefinition);

export const qaCompetencyManifestV14 = Object.freeze({
  ...qaCompetencyManifestV13,
  metadata: Object.freeze({
    ...qaCompetencyManifestV13.metadata,
    version: "1.4.0",
    displayName: "QA Competency Pack with Project capability requirements",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinitionV14]),
} as const satisfies CompetencyPackManifest);

import type { EntitySchema } from "typeorm";

import { qaCompetencyManifestV13 } from "@awp/competency-qa/node";
import {
  connectorGitLabPackage,
  gitLabCapabilitySurface,
  gitLabConnectorManifest,
} from "@awp/connector-gitlab";
import {
  connectorGitLabPersistenceTypeOrmPackage,
  gitLabEntities,
  gitLabMigrationRegistry,
} from "@awp/connector-gitlab-persistence-typeorm";
import type { StaticExtensionCandidate } from "@awp/platform-core";
import {
  migrationClasses,
  type OwnedMigration,
  validateMigrationRegistry,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalExtensionCandidates,
  qaJiraLocalMigrationRegistry,
} from "../qa/composition.ts";
import {
  definePollingOnlyWorkerContribution,
  defineWorkerContribution,
} from "../worker/contributions.ts";
import { gitLabAutomationWorkerCapabilityKeys } from "./automation-worker.ts";
import {
  ComposedGitLabProfileValidator,
  type GitLabDiscoveryTransportFactory,
} from "./profile-validation.ts";
import {
  qaAutomationSuiteValidationCapabilityKey,
  qaAutomationSuiteValidationOperation,
} from "./suite-validation.ts";

export {
  GitLabDispatchingObjectStorage,
  TypeOrmGitLabArtifactStorage,
} from "./artifact-storage.ts";
export { TypeOrmGitLabAutomationLaunchService } from "./automation-launch-service.ts";
export {
  createGitLabAutomationWorkerSteps,
  TypeOrmGitLabAutomationWorker,
} from "./automation-worker.ts";
export { createLocalGitLabAutomationWorkerAuthority } from "./automation-worker-authority.ts";
export { createLocalGitLabArtifactStorageAuthority } from "./local-artifact-storage-authority.ts";
export {
  gitLabAutomationMetricNamespace,
  GitLabAutomationObservability,
  gitLabAutomationOutcomes,
  gitLabAutomationPhases,
  gitLabAutomationReasonCodes,
  gitLabAutomationSafetyCounters,
  gitLabAutomationSloNames,
  populateDeterministicGitLabObservability,
  recordGitLabAutomationPhase,
  redactGitLabAutomationText,
} from "./observability.ts";
export { TypeOrmGitLabOperationalHealth } from "./operational-health.ts";
export {
  createGitLabReconciliationWorkerSteps,
  createLocalGitLabAuthoritativeReadHandler,
  TypeOrmGitLabAuthoritativeReadOutboxWorker,
  TypeOrmGitLabReconciliationPollScheduler,
  TypeOrmGitLabWebhookAuthorityLoader,
  TypeOrmGitLabWebhookIngressService,
} from "./reconciliation-worker.ts";
export {
  createFeature005AutomationEventWorkerStep,
  createTypeOrmGitLabAutomationResultSyncConsumer,
  feature005AutomationEventTypes,
  Feature005InProcessEventPublisher,
  GitLabAutomationResultSyncConsumer,
  TypeOrmFeature005AutomationEventOutboxWorker,
} from "./result-sync.ts";

export const gitLabCapabilityKeys = Object.freeze(
  gitLabCapabilitySurface.map(({ capabilityKey }) => capabilityKey),
);

export const gitLabExtensionContribution = Object.freeze({
  sourceComponentRef: "connector-gitlab.manifest",
  manifestSchemaId: "urn:awp:contracts:extensions:connector-manifest:v1",
  manifest: gitLabConnectorManifest,
  required: true,
} satisfies StaticExtensionCandidate);
export const qaAutomationExtensionContribution = Object.freeze({
  sourceComponentRef: "competency-qa.manifest-v1.3",
  manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
  manifest: qaCompetencyManifestV13,
  required: true,
} satisfies StaticExtensionCandidate);

export const gitLabFoundationWorkerContribution = defineWorkerContribution({
  key: "gitlab.automated-validation.foundation",
  capabilityKeys: Object.freeze(
    gitLabCapabilityKeys.filter(
      (key) => !(gitLabAutomationWorkerCapabilityKeys as readonly string[]).includes(key),
    ),
  ),
  recovery: Object.freeze({ markedEffectPolicy: "LOOKUP_ONLY" }),
  async handle(command) {
    const declaration = gitLabCapabilitySurface.find(
      ({ capabilityKey }) => capabilityKey === command.capability.key,
    );
    if (!declaration || !declaration.operations.includes(command.capability.operation as never)) {
      throw new Error(`GITLAB_COMMAND_OPERATION_FORBIDDEN:${command.capability.operation}`);
    }
    throw new Error(`GITLAB_STORY_HANDLER_NOT_COMPOSED:${command.capability.operation}`);
  },
});

export const gitLabAutomationWorkerContribution = definePollingOnlyWorkerContribution({
  key: "gitlab.automation-trigger",
  capabilityKey: gitLabAutomationWorkerCapabilityKeys[0],
  operation: "pipeline.trigger",
  recovery: Object.freeze({ markedEffectPolicy: "LOOKUP_ONLY" }),
});

export const gitLabSuiteValidationWorkerContribution = definePollingOnlyWorkerContribution({
  key: "gitlab.automation-suite-validation",
  capabilityKey: qaAutomationSuiteValidationCapabilityKey,
  operation: qaAutomationSuiteValidationOperation,
  recovery: Object.freeze({ markedEffectPolicy: "SAFE_RETRY" }),
});

export const gitLabWorkerContributions = Object.freeze([
  gitLabFoundationWorkerContribution,
  gitLabAutomationWorkerContribution,
  gitLabSuiteValidationWorkerContribution,
]);

export const gitLabReconciliationWorkerTopology = Object.freeze({
  key: "gitlab.webhook-reconciliation",
  inbox: "verified-webhook-receipt",
  outboxEventType: "gitlab.authoritative-read.requested.v1",
  cursorLane: "ACTIVE_PIPELINES",
  markedEffectPolicy: "LOOKUP_ONLY",
} as const);

export const qaJiraGitLabLocalMigrationRegistry = Object.freeze([
  ...qaJiraLocalMigrationRegistry,
  ...gitLabMigrationRegistry,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(qaJiraGitLabLocalMigrationRegistry);
export const qaJiraGitLabLocalMigrations = migrationClasses(qaJiraGitLabLocalMigrationRegistry);

export const qaJiraGitLabLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...qaJiraLocalEntities,
  ...gitLabEntities,
]);
export const qaJiraGitLabLocalExtensionCandidates = Object.freeze([
  ...qaJiraLocalExtensionCandidates,
  gitLabExtensionContribution,
]);

export const qaJiraGitLabLocalComposition = Object.freeze({
  key: "qa-jira-gitlab-local" as const,
  connectorGitLab: connectorGitLabPackage,
  gitlabPersistence: connectorGitLabPersistenceTypeOrmPackage,
  manifest: gitLabConnectorManifest,
  extensionCandidates: qaJiraGitLabLocalExtensionCandidates,
  migrationRegistry: qaJiraGitLabLocalMigrationRegistry,
  migrations: qaJiraGitLabLocalMigrations,
  entities: qaJiraGitLabLocalEntities,
  workerContributions: gitLabWorkerContributions,
  reconciliationWorker: gitLabReconciliationWorkerTopology,
  operationalHealth: "gitlab.operational-health",
});

export function createGitLabComposition(
  environment: Pick<RuntimeEnvironment, "environmentScope">,
  transports: GitLabDiscoveryTransportFactory,
) {
  if (
    environment.environmentScope === "PLATFORM_PROD" ||
    environment.environmentScope === "PREPROD"
  ) {
    throw new Error("GITLAB_PRODUCTION_FORBIDDEN");
  }
  return Object.freeze({
    ...qaJiraGitLabLocalComposition,
    profileValidation: new ComposedGitLabProfileValidator(transports),
    environmentScope: environment.environmentScope,
  });
}

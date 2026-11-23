import type { EntitySchema } from "typeorm";

import { qaEntities, qaMigrationContributions } from "@awp/competency-qa/node";
import { jiraEntities, jiraMigrationRegistry } from "@awp/connector-jira-persistence-typeorm";
import {
  migrationClasses,
  type OwnedMigration,
  validateMigrationRegistry,
} from "@awp/platform-persistence-typeorm";

import {
  type RuntimeCompositionKey,
  runtimeCompositionKeys,
  type RuntimeEnvironment,
} from "../config/environment.ts";
import { localExtensionCandidates } from "../extensions/composition.ts";
import { localMigrationRegistry } from "../migrations/composition.ts";
import { localEntities } from "../persistence/entity-composition.ts";
import {
  qaLocalExtensionContributions,
  qaLocalFoundationDeclarations,
  qaLocalHandlerContributions,
  qaLocalPolicyContributions,
} from "./contributions.ts";

export * from "./confirmation-hooks.ts";
export * from "./contributions.ts";
export * from "./external-command-lifecycle-hooks.ts";
export * from "./fake-qa-draft-assistant.ts";
export * from "./operational-composition.ts";
export * from "./operational-work-item.contract.ts";
export * from "./platform-adapters.ts";

export const qaLocalExtensionCandidates = Object.freeze([
  ...localExtensionCandidates,
  ...qaLocalExtensionContributions,
]);

export const qaLocalCompetencyManifestVersions = Object.freeze(
  qaLocalExtensionContributions
    .filter(({ sourceComponentRef }) => sourceComponentRef.startsWith("competency-qa.manifest"))
    .map(
      ({ manifest }) =>
        (manifest as Readonly<{ metadata: Readonly<{ version: string }> }>).metadata.version,
    ),
);

export const qaLocalMigrationRegistry = Object.freeze([
  ...localMigrationRegistry,
  ...qaMigrationContributions,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(qaLocalMigrationRegistry);
export const qaLocalMigrations = migrationClasses(qaLocalMigrationRegistry);

export const qaLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...localEntities,
  ...qaEntities,
]);

export const qaLocalComposition = Object.freeze({
  key: "qa-local" as const,
  extensionCandidates: qaLocalExtensionCandidates,
  migrationRegistry: qaLocalMigrationRegistry,
  migrations: qaLocalMigrations,
  entities: qaLocalEntities,
  handlerContributions: qaLocalHandlerContributions,
  policyContributions: qaLocalPolicyContributions,
  declarations: qaLocalFoundationDeclarations,
});

export const qaJiraLocalMigrationRegistry = Object.freeze([
  ...localMigrationRegistry,
  ...qaMigrationContributions,
  ...jiraMigrationRegistry,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(qaJiraLocalMigrationRegistry);
export const qaJiraLocalMigrations = migrationClasses(qaJiraLocalMigrationRegistry);
export const qaJiraLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...localEntities,
  ...qaEntities,
  ...jiraEntities,
]);
export const qaJiraLocalExtensionCandidates = qaLocalExtensionCandidates;
export const qaJiraLocalComposition = Object.freeze({
  key: "qa-jira-local" as const,
  extensionCandidates: qaLocalExtensionCandidates,
  migrationRegistry: qaJiraLocalMigrationRegistry,
  migrations: qaJiraLocalMigrations,
  entities: qaJiraLocalEntities,
  handlerContributions: qaLocalHandlerContributions,
  policyContributions: qaLocalPolicyContributions,
  declarations: qaLocalFoundationDeclarations,
});
export const qaJiraMattermostLocalComposition = Object.freeze({
  ...qaJiraLocalComposition,
  key: "qa-jira-mattermost-local" as const,
});
export const qaJiraMattermostLocalMigrationRegistry = qaJiraLocalMigrationRegistry;
export const qaJiraMattermostLocalMigrations = qaJiraLocalMigrations;
export const qaJiraMattermostLocalEntities = qaJiraLocalEntities;

export function selectRuntimeComposition(
  source: NodeJS.ProcessEnv,
  environment: RuntimeEnvironment,
): RuntimeCompositionKey {
  const selected = source.AWP_COMPOSITION?.trim() || "foundation";
  if (!(runtimeCompositionKeys as readonly string[]).includes(selected)) {
    throw new Error(`AWP_COMPOSITION_INVALID:${selected}`);
  }
  if (selected === "foundation") return selected;
  const nonLocal =
    selected === "qa-jira-nonprod" ||
    selected === "qa-jira-mattermost-nonprod" ||
    selected === "qa-jira-gitlab-development" ||
    selected === "qa-jira-gitlab-test" ||
    selected === "qa-jira-gitlab-mattermost-development" ||
    selected === "qa-jira-gitlab-mattermost-test";
  if (nonLocal) {
    if (
      environment.environmentScope !== "NON_PROD" ||
      environment.externalNetworkMode !== "allowlisted"
    )
      throw new Error("QA_JIRA_NONPROD_COMPOSITION_FORBIDDEN");
    return selected as RuntimeCompositionKey;
  }
  if (environment.profile !== "local" && environment.profile !== "test") {
    throw new Error("QA_LOCAL_COMPOSITION_PROFILE_FORBIDDEN");
  }
  if (environment.externalNetworkMode !== "deny") {
    throw new Error("QA_LOCAL_COMPOSITION_NETWORK_FORBIDDEN");
  }
  if (environment.mockHubUrl === undefined || environment.mockHubUrl.length === 0) {
    throw new Error("QA_LOCAL_COMPOSITION_MOCK_HUB_REQUIRED");
  }
  return selected as RuntimeCompositionKey;
}

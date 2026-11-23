import type { DataSource } from "typeorm";

import {
  createPlatformDataSource,
  type OwnedMigration,
  validateMigrationRegistry,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeCompositionKey, RuntimeEnvironment } from "../config/environment.ts";
import { qaJiraGitLabLocalComposition } from "../gitlab/composition.ts";
import { qaJiraGitLabMattermostLocalComposition } from "../mattermost/gitlab-composition.ts";
import { localMigrationRegistry } from "../migrations/composition.ts";
import { localEntities } from "../persistence/entity-composition.ts";
import {
  qaJiraLocalComposition,
  qaJiraMattermostLocalComposition,
  qaLocalComposition,
} from "../qa/composition.ts";
import {
  CorporateConnectorFactories,
  type CorporateConnectorFactoryOptions,
} from "./connector-factories.ts";
import { createPublishedDeploymentStartup } from "./published-deployment-references.ts";
import type { DeploymentStartupOptions } from "./startup.ts";

const nonLocalPersistence = new Map<
  RuntimeCompositionKey,
  Readonly<{
    entities: typeof qaJiraGitLabMattermostLocalComposition.entities;
    migrationRegistry: typeof qaJiraGitLabMattermostLocalComposition.migrationRegistry;
  }>
>([
  ["qa-jira-nonprod", qaJiraLocalComposition],
  ["qa-jira-mattermost-nonprod", qaJiraMattermostLocalComposition],
  ["qa-jira-gitlab-development", qaJiraGitLabLocalComposition],
  ["qa-jira-gitlab-test", qaJiraGitLabLocalComposition],
  ["qa-jira-gitlab-mattermost-development", qaJiraGitLabMattermostLocalComposition],
  ["qa-jira-gitlab-mattermost-test", qaJiraGitLabMattermostLocalComposition],
]);

/** One registry is shared by migrations, both processes and readiness. */
export function runtimePersistence(composition: RuntimeCompositionKey) {
  const selected =
    composition === "foundation"
      ? { entities: localEntities, migrationRegistry: localMigrationRegistry }
      : composition === "qa-local"
        ? qaLocalComposition
        : composition === "qa-jira-local"
          ? qaJiraLocalComposition
          : composition === "qa-jira-mattermost-local"
            ? qaJiraMattermostLocalComposition
            : composition === "qa-jira-gitlab-local"
              ? qaJiraGitLabLocalComposition
              : composition === "qa-jira-gitlab-mattermost-local"
                ? qaJiraGitLabMattermostLocalComposition
                : nonLocalPersistence.get(composition);
  if (!selected) throw new Error("CORPORATE_COMPOSITION_REQUIRED");
  validateMigrationRegistry(selected.migrationRegistry);
  return Object.freeze({
    entities: selected.entities,
    migrations: selected.migrationRegistry.map((value) => value.migration),
    expectedVersions: schemaVersions(selected.migrationRegistry),
  });
}

export function schemaVersions(
  registry: readonly OwnedMigration[],
): Readonly<Record<string, number>> {
  validateMigrationRegistry(registry);
  return Object.freeze(Object.fromEntries(registry.map((value) => [value.owner, value.order])));
}

export function createRuntimeDataSource(environment: RuntimeEnvironment) {
  const persistence = runtimePersistence(environment.composition);
  return createPlatformDataSource({
    url: environment.databaseUrl,
    entities: persistence.entities,
    migrations: persistence.migrations,
  });
}

export const pilotDevelopmentWorkerKeys = Object.freeze([
  "qa-jira",
  "mattermost",
  "queue.foundation",
  "artifact-retention",
  "project-onboarding-events",
  "project-onboarding-probes",
  "project-suspension-recovery",
  "gitlab.automation-trigger",
  "gitlab.webhook-reconciliation",
  "gitlab.automation-events",
]);
export const pilotNonLocalWorkerKeys = Object.freeze([
  "qa-jira",
  "mattermost",
  "queue.foundation",
  "artifact-retention",
  "project-onboarding-events",
  "project-onboarding-probes",
  "project-suspension-recovery",
  "gitlab.automation-trigger",
  "gitlab.webhook-reconciliation",
  "gitlab.automation-events",
]);

export interface PilotNonLocalCompositionOptions {
  readonly component: "api" | "worker";
  readonly startup: Omit<DeploymentStartupOptions, "policy" | "component" | "references">;
  readonly connectorFactories: CorporateConnectorFactoryOptions;
}

/** Complete non-local assembly boundary. Every external adapter and startup input is explicit.
 * The persistence model is shared with the local contour, while personas, fixture routes,
 * fixture credentials and implicit network transports are deliberately absent. */
export function createPilotNonLocalComposition(
  environment: RuntimeEnvironment,
  source: DataSource,
  options: PilotNonLocalCompositionOptions,
) {
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    environment.externalNetworkMode !== "allowlisted" ||
    !environment.deployment ||
    environment.deployment.compositionKey !== environment.composition ||
    !source.isInitialized
  )
    throw new Error("PILOT_NON_LOCAL_COMPOSITION_REQUIRED");
  if (
    !["qa-jira-gitlab-mattermost-development", "qa-jira-gitlab-mattermost-test"].includes(
      environment.composition,
    )
  )
    throw new Error("PILOT_NON_LOCAL_FULL_COMPOSITION_REQUIRED");
  if (
    options.connectorFactories.network !== options.startup.network ||
    options.connectorFactories.bindings.length !== environment.deployment.projectIds.length * 3
  )
    throw new Error("PILOT_NON_LOCAL_ADAPTER_BINDING_INVALID");
  const required = new Set(
    environment.deployment.projectIds.flatMap((projectId) => [
      `${projectId}:JIRA`,
      `${projectId}:GITLAB`,
      `${projectId}:MATTERMOST`,
    ]),
  );
  for (const { binding } of options.connectorFactories.bindings) {
    const key = `${binding.projectId}:${binding.provider}`;
    if (
      binding.workspaceId !== environment.deployment.workspaceId ||
      binding.mode !== "CORPORATE" ||
      !required.delete(key) ||
      !environment.deployment.projectIds.includes(binding.projectId) ||
      environment.deployment.endpoints.find(
        (endpoint) => endpoint.purpose === binding.provider.toLowerCase(),
      )?.url !== binding.endpoint
    )
      throw new Error("PILOT_NON_LOCAL_ADAPTER_BINDING_INVALID");
  }
  if (required.size) throw new Error("PILOT_NON_LOCAL_ADAPTER_BINDING_INVALID");
  const connectors = new CorporateConnectorFactories(options.connectorFactories);
  const deployment = createPublishedDeploymentStartup(source, {
    ...options.startup,
    policy: environment.deployment,
    component: options.component,
  });
  return Object.freeze({
    key: environment.composition,
    mode: "CORPORATE" as const,
    ...runtimePersistence(environment.composition),
    workerKeys: pilotNonLocalWorkerKeys,
    externalAdapters: Object.freeze({
      identity: "corporate-oidc",
      jira: "corporate-scoped",
      gitlab: "corporate-scoped",
      mattermost: "corporate-scoped",
      secrets: "vault-scoped-leases",
      signer: "remote-versioned",
      storage: "gitlab",
      model: "published-policy",
    }),
    connectors,
    deployment,
  });
}

/** Explicit developer contour. Corporate endpoints/credentials never enable this adapter bundle. */
export function createPilotDevelopmentComposition(environment: RuntimeEnvironment) {
  if (
    environment.profile !== "local" ||
    environment.environmentScope !== "LOCAL" ||
    environment.externalNetworkMode !== "deny" ||
    environment.composition !== "qa-jira-gitlab-mattermost-local" ||
    !environment.mockHubUrl
  )
    throw new Error("PILOT_DEVELOPMENT_CONTOUR_REQUIRED");
  const url = new URL(environment.mockHubUrl);
  if (
    url.username ||
    url.password ||
    !["localhost", "127.0.0.1", "mock-hub"].includes(url.hostname) ||
    url.protocol !== "http:"
  )
    throw new Error("PILOT_DEVELOPMENT_MOCK_ENDPOINT_REQUIRED");
  return Object.freeze({
    key: environment.composition,
    mode: "DEVELOPMENT_MOCKS" as const,
    ...runtimePersistence(environment.composition),
    workerKeys: pilotDevelopmentWorkerKeys,
    externalAdapters: Object.freeze({
      identity: "fake-idp",
      jira: "mock-hub",
      gitlab: "mock-hub",
      mattermost: "mock-hub",
      secrets: "local-scoped-resolver",
      signer: "local-ed25519",
      storage: "gitlab",
      model: "deterministic-fake",
    }),
  });
}

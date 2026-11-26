import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bindingRevision,
  configurationFacts,
} from "../../../apps/api/src/extensions/onboarding/binding-facts.ts";
import { createLocalQaIntakeConfiguration } from "../../../apps/api/src/local/local-qa-intake-configuration.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { resolveQaJiraRequestCreateConfiguration } from "../../../packages/runtime-composition/src/jira/qa-command-materializer.ts";
import { resolveLocalQaProjectConfiguration } from "../../../packages/runtime-composition/src/jira/qa-local-project-configuration.ts";
import { integrationConfigurationHash } from "../../../packages/runtime-composition/src/onboarding/configuration-hash.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { localSeedIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaJiraLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-jira-local-seed.ts";
import { bootstrapQaJiraProject } from "../../../packages/runtime-composition/src/seed/qa-jira-project-bootstrap.ts";
import { qaLocalSeedIds } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";

describe("Jira project bootstrap", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: qaJiraLocalEntities,
      migrations: qaJiraLocalMigrations,
    });
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    const environment = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    });
    await runQaJiraLocalSeed(source, environment);
  }, 120_000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    await postgres?.stop();
    vi.unstubAllEnvs();
  });

  it("creates a scoped published chain once, resolving exact references through onboarding", async () => {
    vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
    const projectId = randomUUID(),
      workspaceId = localSeedIds.workspaceFunctional;
    await source.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,$3,'bootstrap','ACTIVE','INTERNAL')",
      [projectId, workspaceId, `j-${projectId}`],
    );
    await source.query(
      "INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,created_at,updated_at) VALUES($1,$2,$1,1,'DRAFT','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',clock_timestamp(),clock_timestamp())",
      [projectId, workspaceId],
    );
    const input = {
      workspaceId,
      projectId,
      projectDiscriminator: "NEWPROJECT",
      authorityScopeKey: "qa.newproject",
    };
    const first = await bootstrapQaJiraProject(source, input);
    expect(await bootstrapQaJiraProject(source, input)).toEqual(first);
    const selection = await resolveLocalQaProjectConfiguration(source, input);
    expect(selection).toMatchObject({
      bindingRef: { id: first.binding.id, version: 1 },
      profileRef: { id: first.profile.id, version: 1 },
      authorityScopeKey: "qa.newproject",
    });
    const [context] = await source.query(
      "SELECT v.content FROM qa_project_contexts h JOIN qa_project_context_versions v ON v.id=h.current_published_version_id WHERE h.id=$1 AND h.workspace_id=$2 AND h.project_id=$3",
      [selection.projectContextId, workspaceId, projectId],
    );
    expect(context.content).toMatchObject({
      workspaceId,
      projectId,
      requestAuthorityRequirementKey: "qa-request-authority",
    });
    expect(
      await resolveLocalQaProjectConfiguration(source, {
        workspaceId,
        projectId: localSeedIds.alpha,
      }),
    ).toMatchObject({ projectContextId: qaLocalSeedIds.context });
    await expect(
      resolveLocalQaProjectConfiguration(source, { workspaceId, projectId: randomUUID() }),
    ).rejects.toThrow("QA_PROJECT_JIRA_BINDING_NOT_CONFIGURED");
    vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
    vi.stubEnv("AWP_COMPOSITION", "qa-jira-local");
    vi.stubEnv("AWP_MOCK_HUB_URL", "http://mock-hub:4010");
    const config = createLocalQaIntakeConfiguration(source, "DURABLE_WORKER");
    const selected = await config.load(input);
    expect(selected).toMatchObject({
      bindingRef: selection.bindingRef,
      profileRef: selection.profileRef,
      projectContextId: selection.projectContextId,
      authorityScopeKey: "qa.newproject",
    });
    await expect(
      selected.commandIdentity({ sourceId: randomUUID(), confirmationVersion: 1 }),
    ).resolves.toHaveProperty("commandId");
    expect(await config.load({ workspaceId, projectId: localSeedIds.alpha })).toMatchObject({
      projectContextId: qaLocalSeedIds.context,
    });
    const environment = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    });
    const resolved = await resolveQaJiraRequestCreateConfiguration(source, {
      workspaceId,
      projectId,
      bindingRef: first.binding,
      profileRef: first.profile,
      environment,
    });
    expect(resolved.mappingContent).toMatchObject({
      projectDiscriminator: "NEWPROJECT",
      authorityScopeKey: "qa.newproject",
    });
    expect(resolved.connectionContent).toMatchObject({
      projectId: "100",
      issueTypeId: "10001",
      adapterFamily: "jira-cloud-v3",
    });
    expect(resolved.entries.map(({ pin }) => pin.logicalRole)).toEqual([
      "QA_REQUEST_AUTHORITY",
      "SOURCE_CONTEXT",
    ]);
    vi.stubEnv("AWP_RUNTIME_PROFILE", "non-local");
    vi.stubEnv("AWP_SUPERADMIN_ENVIRONMENT", "dev");
    expect(await bootstrapQaJiraProject(source, input)).toEqual(first);
    const binding = await source.transaction((manager) =>
      bindingRevision(manager, input, first.binding as never),
    );
    expect(
      (binding.content.entries as { logicalRole: string }[])
        .map((entry) => entry.logicalRole)
        .sort(),
    ).toEqual(["DEFECT_DESTINATION", "QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT"]);
    const refs = await source.transaction((manager) => configurationFacts(manager, input, binding));
    for (const kind of [
      "connection",
      "mapping",
      "profile",
      "sourceMapping",
      "sourceProfile",
    ] as const)
      expect(refs).toContainEqual(first[kind]);
    expect(integrationConfigurationHash("project_integration_binding", binding.content)).toBe(
      first.binding.contentHash,
    );
    await expect(
      source.transaction((manager) =>
        configurationFacts(manager, input, {
          ...binding,
          content: {
            ...binding.content,
            entries: [
              {
                ...(binding.content.entries as object[])[0],
                profileRef: { id: first.profile.id, version: 999 },
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await source.query(
        "SELECT count(*)::int AS n FROM project_integration_binding_revisions WHERE header_id=$1",
        [first.binding.id],
      ),
    ).toEqual([{ n: 1 }]);
    await expect(
      bootstrapQaJiraProject(source, { ...input, projectDiscriminator: "CHANGED" }),
    ).rejects.toThrow("JIRA_PROJECT_BOOTSTRAP_EXISTING_CONFLICT");
  });
  it("refuses operation outside local and dev", async () => {
    vi.stubEnv("AWP_RUNTIME_PROFILE", "non-local");
    vi.stubEnv("AWP_SUPERADMIN_ENVIRONMENT", "prod");
    const input = {
      workspaceId: localSeedIds.workspaceFunctional,
      projectId: randomUUID(),
      projectDiscriminator: "NEW",
      authorityScopeKey: "qa.new",
    };
    await expect(bootstrapQaJiraProject(source, input)).rejects.toThrow(
      "JIRA_PROJECT_BOOTSTRAP_DEVELOPMENT_ONLY",
    );
    vi.stubEnv("AWP_SUPERADMIN_ENVIRONMENT", "");
    await expect(bootstrapQaJiraProject(source, input)).rejects.toThrow(
      "JIRA_PROJECT_BOOTSTRAP_DEVELOPMENT_ONLY",
    );
  });
});

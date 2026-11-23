import "../../apps/mock-hub/node_modules/reflect-metadata/Reflect.js";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { QaAutomationAttemptsController } from "../../apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts";
import { NestFactory } from "../../apps/mock-hub/node_modules/@nestjs/core/index.js";
import {
  GitLabControlController,
  GitLabMockControlPolicy,
} from "../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts";
import {
  gitLabMockMigrations,
  GitLabModule,
  gitLabScenarioCatalog,
  gitLabUs2ScenarioIds,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
} from "../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import {
  loadEnvironment,
  type RuntimeEnvironment,
} from "../../packages/runtime-composition/src/config/environment.ts";
import {
  createLocalGitLabAutomationWorkerAuthority,
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
  TypeOrmGitLabAutomationAttemptQuery,
  TypeOrmGitLabAutomationWorker,
} from "../../packages/runtime-composition/src/index.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaJiraGitLabLocalSeed } from "../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  type Us3DatabaseFixture,
} from "../support/002-us3-database.ts";
import {
  type PreparedUs2AutomationSession,
  prepareUs2AutomationSession,
  type Us2AutomationAuthorityPins,
  us2AutomationSessionId,
} from "../support/005-us2-automation.ts";
import { localQaTestRequest } from "../support/008-qa-request.ts";

interface ResponseCapture {
  statusCode: number;
  readonly headers: Map<string, string>;
  status(code: number): ResponseCapture;
  setHeader(name: string, value: string): void;
}

function response(): ResponseCapture {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(name, value);
    },
  };
}

let fixture: Us3DatabaseFixture | undefined;
let mockSource: ReturnType<typeof createMockHubDataSource> | undefined;
let mockApp: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let environment: RuntimeEnvironment;
let prepared: PreparedUs2AutomationSession;
let mockControl: GitLabControlController;

async function authorityPins(): Promise<Us2AutomationAuthorityPins> {
  const [row] = (await fixture!.source.query(
    `
SELECT binding.header_id AS binding_id,binding.version AS binding_version,binding.content_hash AS binding_hash,
       profile.header_id AS profile_id,profile.version AS profile_version,profile.content_hash AS profile_hash,
       connection.header_id AS connection_id,connection.version AS connection_version,connection.content_hash AS connection_hash
FROM project_integration_binding_revisions binding
CROSS JOIN LATERAL jsonb_array_elements(binding.content->'entries') entry
JOIN connector_profile_revisions profile ON profile.workspace_id=binding.workspace_id
  AND profile.header_id::text=entry->'profileRef'->>'id' AND profile.version=(entry->'profileRef'->>'version')::int
  AND profile.content_hash=entry->'profileRef'->>'contentHash' AND profile.status='PUBLISHED'
JOIN connection_revisions connection ON connection.workspace_id=binding.workspace_id
  AND connection.header_id::text=entry->'connectionRef'->>'id' AND connection.version=(entry->'connectionRef'->>'version')::int
  AND connection.content_hash=entry->'connectionRef'->>'contentHash' AND connection.status='PUBLISHED'
WHERE binding.workspace_id=$1 AND binding.project_id=$2 AND binding.status='PUBLISHED'
  AND binding.content->>'schemaVersion'='gitlab-project-binding@1.0.0'
  AND entry->>'logicalRole'='TEST_EXECUTION'
ORDER BY binding.version DESC,profile.version DESC,connection.version DESC LIMIT 1`,
    [fixture!.workspaceId, fixture!.projectId],
  )) as readonly Readonly<Record<string, unknown>>[];
  if (!row) throw new Error("US2_E2E_GITLAB_AUTHORITY_MISSING");
  return Object.freeze({
    bindingRef: Object.freeze({
      id: String(row.binding_id),
      version: Number(row.binding_version),
      contentHash: String(row.binding_hash) as `sha256:${string}`,
    }),
    profileRef: Object.freeze({
      id: String(row.profile_id),
      version: Number(row.profile_version),
      contentHash: String(row.profile_hash) as `sha256:${string}`,
    }),
    connectionRef: Object.freeze({
      id: String(row.connection_id),
      version: Number(row.connection_version),
      contentHash: String(row.connection_hash) as `sha256:${string}`,
    }),
  });
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture({
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  mockSource = createMockHubDataSource(fixture.postgres.url, gitLabMockMigrations);
  await mockSource.initialize();
  await mockSource.runMigrations({ transaction: "all" });
  await seedGitLabRepository(mockSource);
  mockApp = await NestFactory.create(GitLabModule.configured(mockSource), { logger: false });
  await mockApp.listen(0, "127.0.0.1");
  const server = mockApp.getHttpServer() as Readonly<{ address(): Readonly<{ port: number }> }>;
  const address = server.address();
  environment = loadEnvironment({
    AWP_ENVIRONMENT: "LOCAL",
    AWP_COMPOSITION: "qa-jira-gitlab-local",
    AWP_EXTERNAL_NETWORK_MODE: "deny",
    AWP_DATABASE_URL: fixture.postgres.url,
    AWP_MOCK_HUB_URL: `http://127.0.0.1:${address.port}`,
    AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
  });
  await runQaJiraGitLabLocalSeed(fixture.source, environment);
  prepared = await prepareUs2AutomationSession(fixture, await authorityPins());
  mockControl = new GitLabControlController(
    new TypeOrmGitLabRepository(mockSource),
    new GitLabMockControlPolicy("local-gitlab-control", [5001]),
  );
  await mockControl.scenario("local-gitlab-control", {
    projectId: 5001,
    scenarioId: "us2-timeout-after-trigger",
  });
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await mockApp?.close();
  if (mockSource?.isInitialized) await mockSource.destroy();
  await stopUs3DatabaseFixture(fixture);
}, 180_000);

describe("Feature 005 US2 full API/worker/Mock Hub journey", () => {
  it("replays one API launch key and resolves a timeout-after-effect by lookup without a second POST", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T08:00:03.000Z"));
    const query = new TypeOrmGitLabAutomationAttemptQuery(fixture!.source, {
      executingService: Object.freeze({
        kind: "SERVICE",
        principalId: localPersonaIds["worker.local"],
        serviceKey: "gitlab-automation",
      }),
      async authorize() {},
    });
    const controller = new QaAutomationAttemptsController(fixture!.source, query);
    const actorRequest = await localQaTestRequest(fixture!.source, "executor.alpha");
    const confirmationResponse = response();
    const confirmation = await controller.launchConfirmation(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      confirmationResponse,
    );
    expect(confirmationResponse.headers.get("ETag")).toBe('W/"1"');

    const createdResponse = response();
    const created = await controller.launch(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      "us2-e2e-same-key-replay",
      'W/"1"',
      Object.freeze({ confirmation }),
      createdResponse,
    );
    const replayResponse = response();
    const replay = await controller.launch(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      "us2-e2e-same-key-replay",
      'W/"1"',
      Object.freeze({ confirmation }),
      replayResponse,
    );
    expect(createdResponse.statusCode).toBe(201);
    expect(replayResponse.statusCode).toBe(200);
    expect(replay).toEqual(created);

    vi.setSystemTime(new Date("2026-09-01T08:00:06.000Z"));
    const worker = new TypeOrmGitLabAutomationWorker(
      fixture!.source,
      createLocalGitLabAutomationWorkerAuthority(fixture!.source, environment),
    );
    expect(await worker.dispatch(new Date("2026-09-01T08:00:04.000Z"))).toBe(1);
    expect(await worker.work(new Date("2026-09-01T08:00:06.000Z"))).toBe("CONFIRMED");

    const [command] = (await fixture!.source.query(
      "SELECT id FROM connector_commands WHERE operation='pipeline.trigger'",
    )) as readonly Readonly<{ id: string }>[];
    expect(command).toBeDefined();
    const restartedWorker = new TypeOrmGitLabAutomationWorker(
      fixture!.source,
      createLocalGitLabAutomationWorkerAuthority(fixture!.source, environment),
    );
    expect(
      await restartedWorker.execute(
        Object.freeze({
          workspaceId: fixture!.workspaceId,
          projectId: fixture!.projectId,
          commandId: command!.id,
        }),
        new Date("2026-09-01T08:00:07.000Z"),
      ),
    ).toBe("CONFIRMED");

    const mock = await new TypeOrmGitLabRepository(mockSource!).snapshot(5001);
    const calls = mock.calls as readonly Readonly<{ operation: string; method: string }>[];
    const pipelines = mock.pipelines as readonly Readonly<{
      source: string;
      marker_hash: string | null;
    }>[];
    expect(
      calls.filter(
        ({ operation, method }) => operation === "PIPELINE_TRIGGER" && method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      pipelines.filter(({ source, marker_hash }) => source === "trigger" && marker_hash !== null),
    ).toHaveLength(1);

    const [counts] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_launch_requests WHERE session_id=$1) AS claims,
      (SELECT count(*)::int FROM qa_automation_attempts WHERE session_id=$1) AS attempts,
      (SELECT count(*)::int FROM connector_commands WHERE operation='pipeline.trigger') AS commands,
      (SELECT count(*)::int FROM gitlab_effect_reconciliations) AS effects`,
      [us2AutomationSessionId],
    )) as readonly Readonly<Record<string, number>>[];
    expect(counts).toEqual({ claims: 1, attempts: 1, commands: 1, effects: 1 });
    const [effect] = (await fixture!.source.query(
      "SELECT state,match_count FROM gitlab_effect_reconciliations",
    )) as readonly Readonly<Record<string, unknown>>[];
    expect(effect).toEqual(expect.objectContaining({ state: "CONFIRMED", match_count: 1 }));

    const listed = await controller.list(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
    );
    expect(listed).toEqual([
      expect.objectContaining({
        automationAttemptId: created.automationAttemptId,
        currentStatus: "RUNNING",
        execution: { state: "CONFIRMED" },
      }),
    ]);
    const history = await controller.statusHistory(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      created.automationAttemptId,
    );
    expect(history).toHaveLength(3);
    expect(prepared.testExecutionPin.profileRef.id).toBe((await authorityPins()).profileRef.id);
  }, 180_000);

  it.each(gitLabUs2ScenarioIds)(
    "applies and persists documented Mock Hub scenario %s",
    async (scenarioId) => {
      const expected = gitLabScenarioCatalog[scenarioId];
      await mockControl.scenario("local-gitlab-control", { projectId: 5001, scenarioId });
      const snapshot = await new TypeOrmGitLabRepository(mockSource!).snapshot(5001);
      expect(snapshot.project).toEqual(
        expect.objectContaining({
          capabilities: expect.objectContaining({ [`scenario:${scenarioId}`]: true }),
        }),
      );
      const faults = snapshot.faults as readonly Readonly<{ operation: string; fault: string }>[];
      expect(
        faults.find(({ operation }) => operation === "PIPELINE_TRIGGER")?.fault ?? "NORMAL",
      ).toBe(expected.triggerFault);
      expect(faults.find(({ operation }) => operation === "PIPELINE_READ")?.fault ?? "NORMAL").toBe(
        expected.lookupFault,
      );
      expect(snapshot.calls).toEqual([]);
    },
    180_000,
  );
});

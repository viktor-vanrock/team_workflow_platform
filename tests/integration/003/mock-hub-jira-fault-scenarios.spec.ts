import { afterEach, describe, expect, it } from "vitest";

import { JiraController } from "../../../apps/mock-hub/src/jira/jira.controller.ts";
import {
  JiraMockService,
  TypeOrmJiraRepository,
} from "../../../apps/mock-hub/src/jira/jira.repository.ts";
import {
  type JiraScenario,
  JiraScenarioController,
  TypeOrmJiraScenarioRepository,
} from "../../../apps/mock-hub/src/jira/jira-scenarios.ts";
import { createMockHubDataSource } from "../../../apps/mock-hub/src/persistence/data-source.ts";
import { migrateMockHub } from "../../../apps/mock-hub/src/persistence/migration-runner.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";

type MockHubSource = ReturnType<typeof createMockHubDataSource>;

interface RunningMockHub {
  readonly controller: JiraController;
  readonly source: MockHubSource;
}

const postgresInstances: RunningPostgres[] = [];
const runtimes: RunningMockHub[] = [];

afterEach(async () => {
  await Promise.all(
    runtimes.splice(0).map(async ({ source }) => {
      if (source.isInitialized) await source.destroy();
    }),
  );
  await Promise.all(postgresInstances.splice(0).map(async (postgres) => await postgres.stop()));
});

async function startRuntime(databaseUrl: string): Promise<RunningMockHub> {
  const source = createMockHubDataSource(databaseUrl);
  await migrateMockHub(source);
  const controller = new JiraController(
    new JiraMockService(new TypeOrmJiraRepository(source)),
    new JiraScenarioController(new TypeOrmJiraScenarioRepository(source)),
  );
  const running = { controller, source };
  runtimes.push(running);
  return running;
}

async function stopRuntime(runtime: RunningMockHub): Promise<void> {
  const index = runtimes.indexOf(runtime);
  if (index >= 0) runtimes.splice(index, 1);
  if (runtime.source.isInitialized) await runtime.source.destroy();
}

async function setScenario(controller: JiraController, scenario: JiraScenario): Promise<void> {
  await controller.scenario({ scenario });
}

interface Captured<T> {
  readonly status: number;
  readonly body?: T;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("getStatus" in error)) return undefined;
  const getStatus = (error as { readonly getStatus: unknown }).getStatus;
  return typeof getStatus === "function" ? Number(getStatus.call(error)) : undefined;
}

async function createIssue(
  controller: JiraController,
  marker: string,
): Promise<Captured<Awaited<ReturnType<JiraController["create"]>>>> {
  try {
    const body = await controller.create({
      fields: {
        project: { id: "100" },
        issuetype: { id: "10001" },
        summary: marker,
        customfield_10011: marker,
      },
    });
    return { status: 201, body };
  } catch (error) {
    const status = httpStatus(error);
    if (status === undefined) throw error;
    return { status };
  }
}

async function searchByMarker(
  controller: JiraController,
  marker: string,
): Promise<Readonly<Record<string, unknown>>> {
  return await controller.search(undefined, `customfield_10011 = "${marker}"`);
}

async function readIssue(
  controller: JiraController,
  id: string,
): Promise<Captured<Awaited<ReturnType<JiraController["issue"]>>>> {
  try {
    return { status: 200, body: await controller.issue(id) };
  } catch (error) {
    const status = httpStatus(error);
    if (status === undefined) throw error;
    return { status };
  }
}

async function linkIssues(
  controller: JiraController,
  outwardIssueId: string,
  inwardIssueId: string,
): Promise<Captured<void>> {
  try {
    await controller.link({
      type: { id: "10000" },
      outwardIssue: { id: outwardIssueId },
      inwardIssue: { id: inwardIssueId },
    });
    return { status: 201 };
  } catch (error) {
    const status = httpStatus(error);
    if (status === undefined) throw error;
    return { status };
  }
}

describe("Feature 003 persistent Mock Hub Jira fault scenarios", () => {
  it("persists a one-shot scenario across restart and distinguishes timeout before/after the effect", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    let runtime = await startRuntime(postgres.url);

    await setScenario(runtime.controller, "TIMEOUT_BEFORE_EFFECT");
    await stopRuntime(runtime);
    runtime = await startRuntime(postgres.url);

    expect((await createIssue(runtime.controller, "effect:before")).status).toBe(408);
    expect(
      await runtime.source.query(
        "SELECT count(*)::int AS count FROM jira_mock_issues WHERE marker=$1",
        ["effect:before"],
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      await runtime.source.query("SELECT scenario FROM jira_mock_scenario WHERE singleton=1"),
    ).toEqual([{ scenario: "NORMAL" }]);

    await setScenario(runtime.controller, "TIMEOUT_AFTER_EFFECT");
    expect((await createIssue(runtime.controller, "effect:after")).status).toBe(408);
    expect(
      await runtime.source.query(
        "SELECT count(*)::int AS count FROM jira_mock_issues WHERE marker=$1",
        ["effect:after"],
      ),
    ).toEqual([{ count: 1 }]);

    const afterRecovery = await searchByMarker(runtime.controller, "effect:after");
    expect(afterRecovery.total).toBe(1);
    expect(
      await runtime.source.query("SELECT scenario FROM jira_mock_scenario WHERE singleton=1"),
    ).toEqual([{ scenario: "NORMAL" }]);
  }, 120_000);

  it("consumes eventual-search and read faults exactly once and permits real duplicate marker candidates", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    const runtime = await startRuntime(postgres.url);

    expect((await createIssue(runtime.controller, "effect:eventual")).status).toBe(201);
    await setScenario(runtime.controller, "EVENTUAL_SEARCH_ZERO");
    const concurrent = await Promise.all([
      searchByMarker(runtime.controller, "effect:eventual"),
      searchByMarker(runtime.controller, "effect:eventual"),
    ]);
    expect(
      concurrent
        .map((result) => result.total ?? null)
        .sort((left, right) => Number(left ?? -1) - Number(right ?? -1)),
    ).toEqual([null, 1]);
    expect(concurrent.find((result) => result.total === undefined)).toEqual({ issues: [] });

    const created = await createIssue(runtime.controller, "effect:read-fault");
    expect(created.status).toBe(201);
    const createdBody = created.body as { readonly id: string };
    await setScenario(runtime.controller, "SERVER_500");
    expect((await readIssue(runtime.controller, createdBody.id)).status).toBe(500);
    expect((await readIssue(runtime.controller, createdBody.id)).status).toBe(200);

    expect((await createIssue(runtime.controller, "effect:multiple")).status).toBe(201);
    expect((await createIssue(runtime.controller, "effect:multiple")).status).toBe(201);
    const duplicates = await searchByMarker(runtime.controller, "effect:multiple");
    expect(duplicates.total).toBe(2);
    expect(duplicates.issues).toEqual([
      expect.objectContaining({ marker: "effect:multiple" }),
      expect.objectContaining({ marker: "effect:multiple" }),
    ]);
  }, 120_000);

  it("durably audits each official issue-link POST independently from idempotent link state", async () => {
    const postgres = await startPostgres();
    postgresInstances.push(postgres);
    let runtime = await startRuntime(postgres.url);
    const outward = (await createIssue(runtime.controller, "effect:audit-outward")).body as {
      readonly id: string;
    };
    const inward = (await createIssue(runtime.controller, "effect:audit-inward")).body as {
      readonly id: string;
    };

    await setScenario(runtime.controller, "TIMEOUT_AFTER_EFFECT");
    expect((await linkIssues(runtime.controller, outward.id, inward.id)).status).toBe(408);
    await stopRuntime(runtime);
    runtime = await startRuntime(postgres.url);

    expect(
      await runtime.source.query(
        "SELECT operation,request_body AS \"requestBody\" FROM jira_mock_effect_calls WHERE operation='LINK' ORDER BY id",
      ),
    ).toEqual([
      {
        operation: "LINK",
        requestBody: {
          type: { id: "10000" },
          outwardIssue: { id: outward.id },
          inwardIssue: { id: inward.id },
        },
      },
    ]);
    expect(
      await runtime.source.query(
        'SELECT issue_id AS "issueId",other_issue_id AS "otherIssueId",direction FROM jira_mock_links ORDER BY issue_id',
      ),
    ).toEqual([
      { issueId: outward.id, otherIssueId: inward.id, direction: "OUTWARD" },
      { issueId: inward.id, otherIssueId: outward.id, direction: "INWARD" },
    ]);

    expect((await linkIssues(runtime.controller, outward.id, inward.id)).status).toBe(201);
    expect(
      await runtime.source.query(
        "SELECT count(*)::int AS count FROM jira_mock_effect_calls WHERE operation='LINK'",
      ),
    ).toEqual([{ count: 2 }]);
    expect(
      await runtime.source.query("SELECT count(*)::int AS count FROM jira_mock_links"),
    ).toEqual([{ count: 2 }]);
  }, 120_000);
});

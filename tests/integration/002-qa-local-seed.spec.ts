import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import { localSeedIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaLocalSeedIds,
  runQaLocalSeed,
} from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;

beforeAll(async () => {
  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
});

describe("qa-local US1 seed", () => {
  it("is idempotent, enables QA only in the intended Workspace, and creates no accepted QA Work Item", async () => {
    await expect(runQaLocalSeed(source!)).resolves.toBe("applied");
    await expect(runQaLocalSeed(source!)).resolves.toBe("unchanged");

    const enablement = (await source!.query(`
      SELECT e.workspace_id,d.work_type_key,d.definition_version,e.intake_state
      FROM workspace_work_types e
      JOIN work_type_definitions d ON d.id=e.active_definition_id
      WHERE d.work_type_key='qa.validation'
    `)) as readonly Record<string, unknown>[];
    expect(enablement).toEqual([
      {
        workspace_id: localSeedIds.workspaceFunctional,
        work_type_key: "qa.validation",
        definition_version: "1.0.0",
        intake_state: "ENABLED",
      },
    ]);
    expect(
      enablement.some(({ workspace_id }) => workspace_id === localSeedIds.workspaceIsolated),
    ).toBe(false);

    const qaWorkItems = (await source!.query(`
      SELECT count(*)::int AS count
      FROM work_items w
      JOIN work_type_definitions d ON d.id=w.work_type_definition_id
      WHERE d.work_type_key='qa.validation'
    `)) as readonly { count: number }[];
    expect(qaWorkItems).toEqual([{ count: 0 }]);

    const personas = (await source!.query(
      "SELECT subject,kind FROM identities WHERE subject = ANY($1) ORDER BY subject",
      [["requester.alpha", "executor.alpha", "lead.alpha", "viewer.beta", "worker.local"]],
    )) as readonly Record<string, unknown>[];
    expect(personas).toHaveLength(5);
    expect(personas.find(({ subject }) => subject === "worker.local")?.kind).toBe("SERVICE");
    expect(
      personas
        .filter(({ subject }) => subject !== "worker.local")
        .every(({ kind }) => kind === "HUMAN"),
    ).toBe(true);

    const configuration = (await source!.query(
      `
      SELECT
        (SELECT count(*)::int FROM connector_profile_revisions WHERE header_id=$1 AND status='PUBLISHED') AS profiles,
        (SELECT count(*)::int FROM project_integration_binding_revisions WHERE header_id=$2 AND status='PUBLISHED') AS bindings,
        (SELECT count(*)::int FROM qa_project_context_versions WHERE header_id=$3) AS contexts,
        (SELECT count(*)::int FROM qa_risk_review_policy_versions WHERE header_id=$4) AS policies
    `,
      [
        qaLocalSeedIds.profile,
        qaLocalSeedIds.alphaBinding,
        qaLocalSeedIds.context,
        qaLocalSeedIds.riskPolicy,
      ],
    )) as readonly Record<string, unknown>[];
    expect(configuration).toEqual([{ profiles: 4, bindings: 1, contexts: 1, policies: 1 }]);
    const bindings = await source!.query(
      "SELECT version,status FROM project_integration_binding_revisions WHERE header_id=$1 ORDER BY version",
      [qaLocalSeedIds.alphaBinding],
    );
    expect(bindings).toEqual([
      { version: 1, status: "RETIRED" },
      { version: 2, status: "RETIRED" },
      { version: 3, status: "RETIRED" },
      { version: 4, status: "PUBLISHED" },
    ]);
  });
});

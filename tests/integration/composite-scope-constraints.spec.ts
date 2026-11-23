import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";

type ScopeConstraintRow = Readonly<{ table_name: string; definitions: string[] }>;

describe("composite Workspace/Project scope constraints", () => {
  let postgres: RunningPostgres;
  let dataSource: ReturnType<typeof createPlatformDataSource>;

  beforeAll(async () => {
    postgres = await startPostgres();
    dataSource = createPlatformDataSource({
      url: postgres.url,
      entities: [],
      migrations: migrationClasses(coreMigrationRegistry),
    });
    await new OneShotMigrationRunner(
      dataSource,
      "core",
      Math.max(...coreMigrationRegistry.map(({ order }) => order)),
    ).run();
    await dataSource.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES('00000000-0000-4000-8000-000000000010','workspace-a','A','ACTIVE')",
    );
    await dataSource.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','alpha','Alpha','ACTIVE','INTERNAL'),('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000010','beta','Beta','ACTIVE','INTERNAL')",
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (postgres) await postgres.stop();
  });

  it("gives every project-scoped base table a composite scope FK", async () => {
    const rows = (await dataSource.query(`SELECT relation.relname table_name,
      COALESCE(array_agg(pg_get_constraintdef(constraint_row.oid)) FILTER (WHERE constraint_row.oid IS NOT NULL), '{}') definitions
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='public'
      JOIN pg_attribute workspace_column ON workspace_column.attrelid=relation.oid AND workspace_column.attname='workspace_id' AND NOT workspace_column.attisdropped
      JOIN pg_attribute project_column ON project_column.attrelid=relation.oid AND project_column.attname='project_id' AND NOT project_column.attisdropped
      LEFT JOIN pg_constraint constraint_row ON constraint_row.conrelid=relation.oid AND constraint_row.contype='f'
      WHERE relation.relkind IN ('r','p') AND NOT relation.relispartition
      GROUP BY relation.relname ORDER BY relation.relname`)) as ScopeConstraintRow[];

    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(
        row.definitions.some((definition) =>
          /FOREIGN KEY \(workspace_id, project_id(?:, [^)]+)?\)/u.test(definition),
        ),
        `${row.table_name} must enforce Workspace+Project together`,
      ).toBe(true);
    }
  });

  it("rejects a Binding revision whose Project differs from its header", async () => {
    await dataSource.query(
      "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,row_version) VALUES('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','binding',1)",
    );
    await expect(
      dataSource.query(`INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at)
      VALUES('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000030',1,'DRAFT','{}','sha256:test',clock_timestamp())`),
    ).rejects.toThrow();
  });
});

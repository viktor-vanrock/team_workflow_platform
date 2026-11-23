import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

interface QueryExecutor {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

interface QaScope {
  readonly workspaceId: string;
  readonly projectId: string;
}

interface ScopeForeignKeyOptions {
  readonly constraintName: string;
  readonly localColumns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
}

interface OptimisticCasOptions {
  readonly tableName: string;
  readonly scope: QaScope;
  readonly id: string;
  readonly expectedVersion: number;
  readonly changes: Readonly<Record<string, unknown>>;
}

interface QaFoundationExports {
  readonly qaScopedColumnsSql?: () => string;
  readonly qaCompositeForeignKeySql?: (options: ScopeForeignKeyOptions) => string;
  readonly qaAppendOnlyGuardSql?: (tableName: string) => string;
  readonly qaOptimisticCasUpdate?: (
    executor: QueryExecutor,
    options: OptimisticCasOptions,
  ) => Promise<Readonly<{ resourceVersion: number }>>;
}

const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const projectA = "00000000-0000-4000-8000-000000000011";
const projectB = "00000000-0000-4000-8000-000000000012";
const parentId = "00000000-0000-4000-8000-000000000021";
const childId = "00000000-0000-4000-8000-000000000022";

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let qa: Required<QaFoundationExports>;

beforeAll(async () => {
  const exports =
    (await import("../../../packages/competency-qa/src/node.ts")) as QaFoundationExports;
  for (const name of [
    "qaScopedColumnsSql",
    "qaCompositeForeignKeySql",
    "qaAppendOnlyGuardSql",
    "qaOptimisticCasUpdate",
  ] as const) {
    expect(exports[name], `${name} must be exported by the QA foundation`).toBeTypeOf("function");
  }
  qa = exports as Required<QaFoundationExports>;

  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
  await source.initialize();
  await source.query(`
    CREATE TABLE qa_scope_parent(
      ${qa.qaScopedColumnsSql()},
      id uuid NOT NULL,
      resource_version integer NOT NULL DEFAULT 1,
      value text NOT NULL,
      PRIMARY KEY(workspace_id, project_id, id)
    );
    CREATE TABLE qa_scope_child(
      ${qa.qaScopedColumnsSql()},
      id uuid NOT NULL,
      parent_id uuid NOT NULL,
      PRIMARY KEY(workspace_id, project_id, id),
      ${qa.qaCompositeForeignKeySql({
        constraintName: "fk_qa_scope_child_parent",
        localColumns: ["workspace_id", "project_id", "parent_id"],
        referencedTable: "qa_scope_parent",
        referencedColumns: ["workspace_id", "project_id", "id"],
      })}
    );
    CREATE TABLE qa_append_only_probe(
      ${qa.qaScopedColumnsSql()},
      id uuid NOT NULL,
      value text NOT NULL,
      PRIMARY KEY(workspace_id, project_id, id)
    );
    CREATE TABLE qa_cas_probe(
      ${qa.qaScopedColumnsSql()},
      id uuid NOT NULL,
      resource_version integer NOT NULL DEFAULT 1,
      value text NOT NULL,
      PRIMARY KEY(workspace_id, project_id, id)
    );
    ${qa.qaAppendOnlyGuardSql("qa_append_only_probe")}
  `);
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
});

describe("QA shared PostgreSQL scope and immutability helpers", () => {
  it("rejects a child that mixes Workspace or Project scope", async () => {
    await source!.query(
      "INSERT INTO qa_scope_parent(workspace_id,project_id,id,value) VALUES($1,$2,$3,'parent')",
      [workspaceA, projectA, parentId],
    );
    await expect(
      source!.query(
        "INSERT INTO qa_scope_child(workspace_id,project_id,id,parent_id) VALUES($1,$2,$3,$4)",
        [workspaceA, projectB, childId, parentId],
      ),
    ).rejects.toThrow(/foreign key/iu);
    await expect(
      source!.query(
        "INSERT INTO qa_scope_child(workspace_id,project_id,id,parent_id) VALUES($1,$2,$3,$4)",
        [workspaceB, projectA, childId, parentId],
      ),
    ).rejects.toThrow(/foreign key/iu);
    await expect(
      source!.query(
        "INSERT INTO qa_scope_child(workspace_id,project_id,id,parent_id) VALUES($1,$2,$3,$4)",
        [workspaceA, projectA, childId, parentId],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects UPDATE and DELETE on an append-only relation", async () => {
    await source!.query(
      "INSERT INTO qa_append_only_probe(workspace_id,project_id,id,value) VALUES($1,$2,$3,'original')",
      [workspaceA, projectA, childId],
    );
    await expect(
      source!.query(
        "UPDATE qa_append_only_probe SET value='tampered' WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceA, projectA, childId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
    await expect(
      source!.query(
        "DELETE FROM qa_append_only_probe WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceA, projectA, childId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
  });

  it("advances exact-scope CAS once and rejects stale or cross-scope versions", async () => {
    await source!.query(
      "INSERT INTO qa_cas_probe(workspace_id,project_id,id,value) VALUES($1,$2,$3,'initial')",
      [workspaceA, projectA, childId],
    );
    const options: OptimisticCasOptions = {
      tableName: "qa_cas_probe",
      scope: { workspaceId: workspaceA, projectId: projectA },
      id: childId,
      expectedVersion: 1,
      changes: { value: "next" },
    };
    await expect(qa.qaOptimisticCasUpdate(source!, options)).resolves.toEqual({
      resourceVersion: 2,
    });
    await expect(qa.qaOptimisticCasUpdate(source!, options)).rejects.toThrow(
      "OPTIMISTIC_CONCURRENCY_CONFLICT",
    );
    await expect(
      qa.qaOptimisticCasUpdate(source!, {
        ...options,
        scope: { workspaceId: workspaceB, projectId: projectA },
        expectedVersion: 2,
      }),
    ).rejects.toThrow("OPTIMISTIC_CONCURRENCY_CONFLICT");
    expect(
      await source!.query(
        'SELECT value,resource_version AS "resourceVersion" FROM qa_cas_probe WHERE workspace_id=$1 AND project_id=$2 AND id=$3',
        [workspaceA, projectA, childId],
      ),
    ).toEqual([{ value: "next", resourceVersion: 2 }]);
  });
});

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")("0190 project scope upgrade", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "rejects historical orphans atomically and preserves portfolio scopes on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      const before = createPlatformDataSource({
        url: postgres.url,
        entities: [],
        migrations: migrationClasses(coreMigrationRegistry.filter((value) => value.order <= 185)),
      });
      const after = createPlatformDataSource({
        url: postgres.url,
        entities: [],
        migrations: migrationClasses(coreMigrationRegistry.filter((value) => value.order <= 190)),
      });
      const workspaceA = randomUUID(),
        workspaceB = randomUUID(),
        project = randomUUID(),
        orphan = randomUUID();
      try {
        await before.initialize();
        await before.runMigrations({ transaction: "all" });
        await before.query(
          "INSERT INTO workspaces(id,key,name,state) VALUES($1,'migration-a','A','ACTIVE'),($2,'migration-b','B','ACTIVE')",
          [workspaceA, workspaceB],
        );
        await before.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'project-a','A','ACTIVE','INTERNAL')",
          [project, workspaceA],
        );
        const insert =
          "INSERT INTO queue_order_scope_heads(order_scope_id,workspace_id,scope_kind,project_id,authorized_project_set_hash,base_visible_set_hash,created_at,updated_at) VALUES($1,$2,$3,$4,'projects','visible',now(),now())";
        await before.query(insert, [orphan, workspaceB, "PROJECT", project]);
        await before.query(insert, [randomUUID(), workspaceB, "AUTHORIZED_PORTFOLIO", null]);
        await before.destroy();
        await after.initialize();
        await expect(after.runMigrations({ transaction: "all" })).rejects.toMatchObject({
          code: "23503",
        });
        expect(
          await after.query("SELECT version FROM platform_schema_versions WHERE namespace='core'"),
        ).toEqual([{ version: 185 }]);
        expect(
          await after.query("SELECT count(*)::int AS count FROM queue_order_scope_heads"),
        ).toEqual([{ count: 2 }]);
        expect(
          await after.query(
            "SELECT count(*)::int AS count FROM pg_constraint WHERE conname='action_provenance_records_project_scope_fk'",
          ),
        ).toEqual([{ count: 0 }]);
        // Only disposable fixture data is repaired here; a real orphan requires its data owner's decision.
        await after.query("DELETE FROM queue_order_scope_heads WHERE order_scope_id=$1", [orphan]);
        expect(await after.runMigrations({ transaction: "all" })).toHaveLength(1);
        await expect(
          after.query(insert, [randomUUID(), workspaceB, "PROJECT", project]),
        ).rejects.toMatchObject({ code: "23503" });
        await after.query(insert, [randomUUID(), workspaceA, "PROJECT", project]);
        expect(
          await after.query("SELECT count(*)::int AS count FROM queue_order_scope_heads"),
        ).toEqual([{ count: 2 }]);
        await after.undoLastMigration({ transaction: "all" });
        expect(
          await after.query("SELECT version FROM platform_schema_versions WHERE namespace='core'"),
        ).toEqual([{ version: 185 }]);
        expect(await after.runMigrations({ transaction: "all" })).toHaveLength(1);
        expect(await after.runMigrations({ transaction: "all" })).toEqual([]);
      } finally {
        if (before.isInitialized) await before.destroy();
        if (after.isInitialized) await after.destroy();
        await postgres.stop();
      }
    },
    180_000,
  );
});

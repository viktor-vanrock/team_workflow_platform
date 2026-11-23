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

describe("foundation PostgreSQL constraints", () => {
  let postgres: RunningPostgres;
  let dataSource: ReturnType<typeof createPlatformDataSource>;
  beforeAll(async () => {
    postgres = await startPostgres();
    dataSource = createPlatformDataSource({
      url: postgres.url,
      entities: [],
      migrations: migrationClasses(coreMigrationRegistry.slice(0, 5)),
    });
    await new OneShotMigrationRunner(dataSource, "core", 40).run();
    await dataSource.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES('00000000-0000-4000-8000-000000000001','issuer','subject','HUMAN','User')",
    );
    await dataSource.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES('00000000-0000-4000-8000-000000000010','workspace-a','A','ACTIVE'),('00000000-0000-4000-8000-000000000011','workspace-b','B','ACTIVE')",
    );
    await dataSource.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','alpha','Alpha','ACTIVE','INTERNAL'),('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','delta','Delta','ACTIVE','INTERNAL')",
    );
  }, 120_000);
  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (postgres) await postgres.stop();
  });

  it("rejects cross-workspace project entitlement through a composite FK", async () => {
    await expect(
      dataSource.query(`INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from)
      VALUES('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','ALLOW','INTERNAL','[]',clock_timestamp())`),
    ).rejects.toThrow();
  });
  it("enforces unique verified issuer + subject", async () => {
    await expect(
      dataSource.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES('00000000-0000-4000-8000-000000000002','issuer','subject','HUMAN','Duplicate')",
      ),
    ).rejects.toThrow();
  });
  it("keeps classification identity key/rank immutable", async () => {
    await expect(
      dataSource.query("UPDATE classification_catalog SET rank=11 WHERE key='INTERNAL'"),
    ).rejects.toThrow(/immutable/u);
  });
});

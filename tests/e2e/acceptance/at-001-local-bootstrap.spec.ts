import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import { bootstrapLocalDatabase } from "../../../packages/runtime-composition/src/bootstrap/local-bootstrap.ts";
import { localMigrations } from "../../../packages/runtime-composition/src/migrations/composition.ts";
import { localEntities } from "../../../packages/runtime-composition/src/persistence/entity-composition.ts";
import {
  LOCAL_SEED_KEY,
  LOCAL_SEED_VERSION,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";

describe("AT-001 clean local bootstrap", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: localEntities,
      migrations: localMigrations,
    });
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  it("migrates, seeds, reseeds idempotently and reports the exact local profile", async () => {
    const first = await bootstrapLocalDatabase(source, { profile: "local" });
    const second = await bootstrapLocalDatabase(source, { profile: "local" });

    expect(first).toMatchObject({ profile: "local", schema: "ready", seed: "applied" });
    expect(second).toMatchObject({ profile: "local", schema: "ready", seed: "unchanged" });
    await expect(
      source.query("SELECT key, version FROM local_seed_markers ORDER BY key"),
    ).resolves.toEqual([{ key: LOCAL_SEED_KEY, version: LOCAL_SEED_VERSION }]);
    await expect(
      source.query("SELECT key FROM workspaces WHERE key='local-functional'"),
    ).resolves.toEqual([{ key: "local-functional" }]);
  });
});

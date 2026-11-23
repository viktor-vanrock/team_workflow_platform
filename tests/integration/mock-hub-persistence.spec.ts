import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MockHubService } from "../../apps/mock-hub/src/mock-hub.controller.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import { migrateMockHub } from "../../apps/mock-hub/src/persistence/migration-runner.ts";
import { TypeOrmMockStateRepository } from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { type RunningPostgres, startPostgres } from "../../packages/platform-testkit/src/index.ts";

describe("T076 app-owned Mock Hub persistence", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createMockHubDataSource>;
  beforeAll(async () => {
    postgres = await startPostgres();
    source = createMockHubDataSource(postgres.url);
    await migrateMockHub(source);
  }, 120_000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });
  it("owns an independent schema and persists an idempotent effect ledger", async () => {
    const repository = new TypeOrmMockStateRepository(source);
    const hub = new MockHubService(repository);
    await hub.seed(42);
    const request = {
      effectIdempotencyKey: "db-effect-1",
      correlationId: "c",
      target: { id: "phase1-record" },
      payload: { message: "hi" },
      expectedExternalState: { mode: "MUST_NOT_EXIST" as const },
    };
    await hub.publish(request);
    await hub.publish(request);
    expect((await repository.effects())[0]?.effectCount).toBe(1);
    expect(await source.query("SELECT to_regclass('public.workspaces') AS core")).toEqual([
      { core: null },
    ]);
  });
});

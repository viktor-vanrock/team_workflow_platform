import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import {
  createPlatformDataSource,
  TypeOrmScopedAccessRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";

let postgres: RunningPostgres, source: ReturnType<typeof createPlatformDataSource>;
const workspace = localSeedIds.workspaceFunctional,
  principal = localPersonaIds["requester.alpha"];
beforeAll(async () => {
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", "https://fake-idp:4443/oidc");
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations.filter(
      (m) => m.name !== "M0220CustomerProjectDialogues1700000000220",
    ),
  });
  await source.initialize();
  await source.runMigrations();
  await runQaLocalSeed(source);
}, 120000);
afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
  vi.unstubAllEnvs();
});
it("upgrades an existing broad requester without deleting tasks, retains owned projects and prevents broad grants returning", async () => {
  await source.query(
    "DELETE FROM role_assignments WHERE principal_id=$1 AND project_id IS NULL AND role_key='requester'",
    [principal],
  );
  await source.query(
    "UPDATE role_assignments SET project_id=NULL,project_access_scope='ALL_PROJECTS',permissions=permissions-'project.request.create' WHERE principal_id=$1 AND role_key='requester'",
    [principal],
  );
  await source.query(
    "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,permissions,classification_ceiling_key,valid_from) VALUES($1,$2,$3,$4,'ALLOW',$5,'RESTRICTED',clock_timestamp())",
    [
      randomUUID(),
      workspace,
      localSeedIds.beta,
      principal,
      JSON.stringify(["work-item.read", "project.catalog.read"]),
    ],
  );
  const request = { headers: {}, localPersonaKey: "requester.alpha" };
  await expect(
    authorizeLocalQaApi(source, request, workspace, localSeedIds.beta, "work-item.read"),
  ).resolves.toBeDefined();
  const before = await source.query("SELECT id,created_by,project_id FROM work_items ORDER BY id");
  await source.destroy();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  expect((await source.runMigrations()).map((m) => m.name)).toEqual([
    "M0220CustomerProjectDialogues1700000000220",
  ]);
  expect(await source.query("SELECT id,created_by,project_id FROM work_items ORDER BY id")).toEqual(
    before,
  );
  await expect(
    authorizeLocalQaApi(source, request, workspace, localSeedIds.alpha, "work-item.read"),
  ).resolves.toBeDefined();
  await expect(
    authorizeLocalQaApi(source, request, workspace, localSeedIds.beta, "work-item.read"),
  ).rejects.toThrow();
  expect(
    (
      await new TypeOrmScopedAccessRepository(source).listVisibleProjects(
        workspace,
        principal,
        new Date(),
      )
    ).map((p) => p.id),
  ).toEqual([localSeedIds.alpha]);
  expect(
    await source.query("SELECT assignment_id FROM customer_scope_migration_records"),
  ).toHaveLength(1);
  await expect(
    source.query(
      "UPDATE role_assignments SET permissions='[\"work-item.read\"]' WHERE principal_id=$1 AND role_key='requester' AND project_id IS NULL",
      [principal],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  expect(await source.runMigrations()).toEqual([]);
});

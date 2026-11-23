import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { LocalPersonaSessionService } from "../../../apps/api/src/local/local-persona.controller.ts";
import {
  createPlatformDataSource,
  M0230FirstLocalAdministrator1700000000230,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";
import {
  localPersonaIds,
  localSeedIds,
  runLocalSeed,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runPlatformAccessLocalSeed } from "../../../packages/runtime-composition/src/seed/platform-access-seed.ts";
import { runQaLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { runTechWritingLocalSeed } from "../../../packages/runtime-composition/src/seed/tech-writing-local-seed.ts";

let postgres: RunningPostgres,
  source: ReturnType<typeof createPlatformDataSource>,
  control: ReturnType<typeof createPlatformDataSource>;
let url: string;
const issuer = "https://fake-idp:4443/oidc";
const connect = (databaseUrl: string, latest = true) =>
  createPlatformDataSource({
    url: databaseUrl,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations.filter(
      (m) => latest || m !== M0230FirstLocalAdministrator1700000000230,
    ),
  });
const token = {
  access_token: "trusted-local-token-fixture",
  token_type: "Bearer",
  expires_in: 300,
};
const sessions = (issue = async () => token) =>
  new LocalPersonaSessionService(source, { issue, stepUp: async () => token } as never);
beforeAll(async () => {
  postgres = await startPostgres();
  control = connect(postgres.url);
  await control.initialize();
}, 120_000);
beforeEach(async () => {
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", issuer);
  const name = `local_admin_${randomUUID().replaceAll("-", "")}`;
  await control.query(`CREATE DATABASE ${name}`);
  const target = new URL(postgres.url);
  target.pathname = `/${name}`;
  url = target.href;
  source = connect(url, false);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runLocalSeed(source);
  await runQaLocalSeed(source);
  await runTechWritingLocalSeed(source);
  await runPlatformAccessLocalSeed(source, issuer);
});
afterEach(async () => {
  await source?.destroy();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await control?.destroy();
  await postgres?.stop();
});
async function upgrade() {
  await source.destroy();
  source = connect(url);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
}

it("seed does not assign administration; the first successful selected human gets the single role and all-area registration", async () => {
  await upgrade();
  await runPlatformAccessLocalSeed(source, issuer);
  expect(sessions().options()).toHaveLength(9);
  expect(await source.query("SELECT * FROM platform_role_assignments")).toHaveLength(0);
  await expect(
    sessions(async () => {
      throw new Error("IDP_DOWN");
    }).exchange("owner.local"),
  ).rejects.toThrow("IDP_DOWN");
  await expect(sessions().exchange("worker.local")).rejects.toThrow();
  await expect(
    sessions().exchange("owner.local", localSeedIds.workspaceIsolated),
  ).rejects.toThrow();
  expect(await source.query("SELECT * FROM local_administrator_bootstrap")).toHaveLength(0);
  const first = await sessions().exchange("executor.alpha");
  expect(first.platformPermissions).toContain("platform.workspace-roles.manage");
  expect(first.workspaces.filter((w) => w.permissions.includes("project.register"))).toHaveLength(
    3,
  );
  expect(first.grants.roles).toContain("qa-executor");
  expect((await sessions().exchange("owner.local")).platformPermissions).toEqual([]);
  expect(await source.query("SELECT principal_id,source FROM platform_role_assignments")).toEqual([
    { principal_id: localPersonaIds["executor.alpha"], source: "LOCAL_FIRST_LOGIN" },
  ]);
});

it("elects only one global administrator when two local logins finish concurrently", async () => {
  await upgrade();
  const results = await Promise.all([
    sessions().exchange("owner.local"),
    sessions().exchange("executor.alpha"),
  ]);
  expect(results.filter((s) => s.platformPermissions.includes("platform.users.read"))).toHaveLength(
    1,
  );
  expect(await source.query("SELECT * FROM local_administrator_bootstrap")).toHaveLength(1);
  expect(
    await source.query("SELECT * FROM platform_role_assignments WHERE source='LOCAL_FIRST_LOGIN'"),
  ).toHaveLength(1);
});

it("allows the first local login before a retained domain role is enabled in the area's catalog", async () => {
  await upgrade();
  await source.query("DELETE FROM workspace_work_types WHERE workspace_id=$1", [
    localSeedIds.workspaceFunctional,
  ]);
  const before = await source.query(
    "SELECT * FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 ORDER BY id",
    [localSeedIds.workspaceFunctional, localPersonaIds["executor.alpha"]],
  );
  const first = await sessions().exchange("executor.alpha");
  expect(first.platformPermissions).toContain("platform.users.read");
  expect(first.grants.roles).toContain("qa-executor");
  expect(
    await source.query(
      "SELECT * FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 ORDER BY id",
      [localSeedIds.workspaceFunctional, localPersonaIds["executor.alpha"]],
    ),
  ).toEqual(before);
});

it("keeps the chosen user across restart and seed, and never restores or replaces a revoked role", async () => {
  await upgrade();
  await sessions().exchange("owner.local");
  const before = await source.query("SELECT * FROM local_administrator_bootstrap");
  await source.destroy();
  source = connect(url);
  await source.initialize();
  await runPlatformAccessLocalSeed(source, issuer);
  expect((await sessions().exchange("owner.local")).platformPermissions).toContain(
    "platform.users.read",
  );
  await source.query(
    "UPDATE platform_role_assignments SET revoked_at=clock_timestamp() WHERE source='LOCAL_FIRST_LOGIN'",
  );
  await runPlatformAccessLocalSeed(source, issuer);
  expect((await sessions().exchange("owner.local")).platformPermissions).toEqual([]);
  expect((await sessions().exchange("executor.alpha")).platformPermissions).toEqual([]);
  expect(await source.query("SELECT * FROM local_administrator_bootstrap")).toEqual(before);
  await expect(source.query("DELETE FROM local_administrator_bootstrap")).rejects.toThrow();
});

it.each([false, true])(
  "archives the former seeded assignment and opens local first login on upgrade (revoked=%s)",
  async (revoked) => {
    await source.query(
      "INSERT INTO platform_role_assignments(principal_id,role_key,source,revoked_at) VALUES($1,'access-administrator','LOCAL_BOOTSTRAP',$2)",
      [localPersonaIds["owner.local"], revoked ? new Date() : null],
    );
    const [previous] = await source.query(
      "SELECT principal_id,role_key,source,revoked_at,created_at FROM platform_role_assignments",
    );
    const identities = await source.query("SELECT * FROM identities ORDER BY id");
    await upgrade();
    expect(
      await source.query(
        "SELECT principal_id,role_key,source,revoked_at,created_at FROM local_administrator_seed_history",
      ),
    ).toEqual([previous]);
    expect(await source.query("SELECT * FROM identities ORDER BY id")).toEqual(identities);
    expect(await source.query("SELECT * FROM platform_role_assignments")).toHaveLength(0);
    const first = await sessions().exchange("owner.local");
    expect(first.platformPermissions).toContain("platform.users.read");
    await expect(source.query("DELETE FROM local_administrator_seed_history")).rejects.toThrow();
  },
);

it("project switching, step-up, service identities and non-local runtime cannot claim the role", async () => {
  await upgrade();
  await sessions().stepUp("owner.local");
  await sessions().selectProject("owner.local", localSeedIds.alpha);
  expect(await source.query("SELECT * FROM local_administrator_bootstrap")).toHaveLength(0);
  const access = new PlatformAccessService(source);
  await expect(
    access.claimLocalAdministrator(localPersonaIds["worker.local"], issuer),
  ).rejects.toThrow();
  vi.stubEnv("AWP_RUNTIME_PROFILE", "non-local");
  await expect(
    access.claimLocalAdministrator(localPersonaIds["owner.local"], issuer),
  ).rejects.toThrow("LOCAL_ADMINISTRATOR_BOOTSTRAP_FORBIDDEN");
  expect(await source.query("SELECT * FROM local_administrator_bootstrap")).toHaveLength(0);
});

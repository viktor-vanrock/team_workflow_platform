import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import {
  createPlatformDataSource,
  M0225FirstCorporateAdministrator1700000000225,
  M0230FirstLocalAdministrator1700000000230,
  TypeOrmIdentityRepository,
  TypeOrmIdentityRevocations,
  TypeOrmScopedAccessRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import type { VerifiedOidcIdentity } from "../../../packages/platform-runtime-nest/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { CorporateIdentityService } from "../../../packages/runtime-composition/src/security/corporate-identity.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";

let postgres: RunningPostgres;
let control: ReturnType<typeof createPlatformDataSource>;
let source: ReturnType<typeof createPlatformDataSource>;
let databaseUrl: string;
const issuer = "https://corporate.example/realm";
const evidence = (subject: string): VerifiedOidcIdentity => ({
  issuer,
  subject,
  tokenId: randomUUID(),
  clientId: "browser",
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  groups: [],
  amr: [],
});
const connect = (url: string, upgrade = true) =>
  createPlatformDataSource({
    url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations.filter(
      (migration) =>
        upgrade ||
        (migration !== M0225FirstCorporateAdministrator1700000000225 &&
          migration !== M0230FirstLocalAdministrator1700000000230),
    ),
  });
const identityService = (connection = source) => {
  const access = new PlatformAccessService(connection);
  return new CorporateIdentityService(
    {
      issuer,
      ref: { id: "first-login", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
      mappings: [],
    },
    new TypeOrmIdentityRepository(connection),
    new TypeOrmScopedAccessRepository(connection),
    new TypeOrmIdentityRevocations(connection),
    Date.now,
    {
      registerVerified: (e) => access.registerVerified(e),
      authorize: (p, r) => access.authorize(p, r),
    },
  );
};
beforeAll(async () => {
  postgres = await startPostgres();
  control = connect(postgres.url);
  await control.initialize();
}, 120_000);
beforeEach(async () => {
  const name = `bootstrap_${randomUUID().replaceAll("-", "")}`;
  await control.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgres.url);
  url.pathname = `/${name}`;
  databaseUrl = url.href;
  source = connect(databaseUrl, false);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
});
afterEach(async () => {
  await source?.destroy();
});
afterAll(async () => {
  await control?.destroy();
  await postgres?.stop();
});
async function upgrade() {
  await source.destroy();
  source = connect(databaseUrl);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
}

it("elects exactly one administrator across simultaneous requests on separate API connections", async () => {
  await upgrade();
  const replica = connect(databaseUrl);
  await replica.initialize();
  try {
    await Promise.all([
      identityService().completeVerifiedLogin(evidence("alice")),
      identityService(replica).completeVerifiedLogin(evidence("bob")),
    ]);
    const rows = await source.query(
      "SELECT i.subject,a.source FROM platform_role_assignments a JOIN identities i ON i.id=a.principal_id",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "CORPORATE_FIRST_LOGIN" });
    expect(await source.query("SELECT * FROM platform_user_profiles")).toHaveLength(2);
    const decisions = await Promise.allSettled(
      ["alice", "bob"].map((s) =>
        identityService(replica).authorizePlatform(evidence(s), "platform.workspace-roles.manage"),
      ),
    );
    expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
  } finally {
    await replica.destroy();
  }
});

it("keeps the owner through repeated login, restart and revocation without reopening bootstrap", async () => {
  await upgrade();
  await identityService().completeVerifiedLogin(evidence("owner"));
  const before = await source.query("SELECT * FROM platform_administrator_bootstrap");
  await source.destroy();
  source = connect(databaseUrl);
  await source.initialize();
  await identityService().completeVerifiedLogin(evidence("owner"));
  await expect(
    identityService().authorizePlatform(evidence("owner"), "platform.users.read"),
  ).resolves.toBeDefined();
  await source.query("UPDATE platform_role_assignments SET revoked_at=clock_timestamp()");
  await identityService().completeVerifiedLogin(evidence("owner"));
  await identityService().completeVerifiedLogin(evidence("next"));
  await expect(
    identityService().authorizePlatform(evidence("owner"), "platform.users.read"),
  ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  await expect(
    identityService().authorizePlatform(evidence("next"), "platform.users.read"),
  ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toEqual(before);
  expect(await source.query("SELECT * FROM platform_role_assignments")).toHaveLength(1);
  await expect(source.query("DELETE FROM platform_administrator_bootstrap")).rejects.toThrow();
});

it.each([false, true])(
  "preserves a historical corporate administrator on upgrade (revoked=%s)",
  async (revoked) => {
    const id = randomUUID();
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'existing','HUMAN','Existing')",
      [id, issuer],
    );
    await source.query(
      "INSERT INTO platform_role_assignments(principal_id,role_key,source,revoked_at) VALUES($1,'access-administrator','CORPORATE_GROUP',$2)",
      [id, revoked ? new Date() : null],
    );
    const before = await source.query("SELECT * FROM platform_role_assignments");
    await upgrade();
    await identityService().completeVerifiedLogin(evidence("newcomer"));
    await identityService().completeVerifiedLogin(evidence("existing"));
    expect(await source.query("SELECT * FROM platform_role_assignments")).toEqual(before);
    expect(
      await source.query("SELECT principal_id,source FROM platform_administrator_bootstrap"),
    ).toEqual([{ principal_id: id, source: "CORPORATE_GROUP" }]);
    await expect(
      identityService().authorizePlatform(evidence("newcomer"), "platform.users.read"),
    ).rejects.toThrow();
    const result = identityService().authorizePlatform(evidence("existing"), "platform.users.read");
    if (revoked) await expect(result).rejects.toThrow();
    else await expect(result).resolves.toMatchObject({ principalId: id });
  },
);

it("does not let a local seed consume corporate bootstrap or authorize corporate administration", async () => {
  const id = randomUUID();
  await source.query(
    "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'local','HUMAN','Local')",
    [id, issuer],
  );
  await source.query(
    "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','LOCAL_BOOTSTRAP')",
    [id],
  );
  await upgrade();
  await identityService().completeVerifiedLogin(evidence("corporate"));
  await expect(
    identityService().authorizePlatform(evidence("local"), "platform.users.read"),
  ).rejects.toThrow();
  await expect(
    identityService().authorizePlatform(evidence("corporate"), "platform.users.read"),
  ).resolves.toMatchObject({ assignmentSource: "CORPORATE_FIRST_LOGIN" });
});

it("rejects foreign, expired and service identities without consuming bootstrap", async () => {
  await upgrade();
  await expect(
    identityService().completeVerifiedLogin({
      ...evidence("foreign"),
      issuer: "https://other.example",
    }),
  ).rejects.toThrow();
  await expect(
    identityService().completeVerifiedLogin({ ...evidence("expired"), expiresAt: 1 }),
  ).rejects.toThrow();
  await source.query(
    "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'service','SERVICE','Service')",
    [randomUUID(), issuer],
  );
  await expect(identityService().completeVerifiedLogin(evidence("service"))).rejects.toThrow();
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(0);
  await identityService().completeVerifiedLogin(evidence("human"));
  await expect(
    identityService().authorizePlatform(evidence("human"), "platform.users.read"),
  ).resolves.toBeDefined();
});

it("keeps the elected local administrator separate from corporate administration", async () => {
  await upgrade();
  const id = randomUUID();
  await source.query(
    "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'local-first','HUMAN','Local first')",
    [id, issuer],
  );
  await source.query(
    "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','LOCAL_FIRST_LOGIN')",
    [id],
  );
  await expect(
    identityService().authorizePlatform(evidence("local-first"), "platform.users.read"),
  ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  await identityService().completeVerifiedLogin(evidence("corporate-first"));
  await expect(
    identityService().authorizePlatform(evidence("corporate-first"), "platform.users.read"),
  ).resolves.toMatchObject({ assignmentSource: "CORPORATE_FIRST_LOGIN" });
});

it("rolls the claim and profile back if persisting the administrator fails", async () => {
  await upgrade();
  await source.query(
    "ALTER TABLE platform_role_assignments ADD CONSTRAINT reject_test_admin CHECK(source<>'CORPORATE_FIRST_LOGIN')",
  );
  await expect(identityService().completeVerifiedLogin(evidence("failed"))).rejects.toThrow();
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(0);
  expect(await source.query("SELECT * FROM platform_user_profiles")).toHaveLength(0);
  await source.query("ALTER TABLE platform_role_assignments DROP CONSTRAINT reject_test_admin");
  await identityService().completeVerifiedLogin(evidence("success"));
  await expect(
    identityService().authorizePlatform(evidence("success"), "platform.users.read"),
  ).resolves.toBeDefined();
});

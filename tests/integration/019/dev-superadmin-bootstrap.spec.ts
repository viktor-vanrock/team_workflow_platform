import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createProjectEntitlementRevision } from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  ProjectEntitlementRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { M0240DevBootstrapSource1700000000240 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0240-dev-bootstrap-source.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { bootstrapDevSuperadmins } from "../../../packages/runtime-composition/src/bootstrap/dev-superadmin.ts";
import { runtimePersistence } from "../../../packages/runtime-composition/src/pilot/composition.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";

let postgres: RunningPostgres;
let source: ReturnType<typeof createPlatformDataSource>;
const issuer = "https://example.test/issuer";
beforeAll(async () => {
  vi.stubEnv("AWP_SUPERADMIN_ENVIRONMENT", "dev");
  postgres = await startPostgres();
  const registry = runtimePersistence("qa-jira-gitlab-mattermost-test");
  source = createPlatformDataSource({
    url: postgres.url,
    entities: registry.entities,
    migrations: registry.migrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
}, 120_000);
afterAll(async () => {
  await source?.destroy();
  await postgres?.stop();
  vi.unstubAllEnvs();
});

it("migration preserves existing assignments, adds the source and refuses unsafe rollback", async () => {
  const runner = source.createQueryRunner();
  const principal = randomUUID();
  await source.query(
    "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN','test')",
    [principal, issuer, principal],
  );
  await source.query(
    "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','CORPORATE_GROUP')",
    [principal],
  );
  const migration = new M0240DevBootstrapSource1700000000240();
  await migration.down(runner);
  expect(
    (
      await source.query("SELECT source FROM platform_role_assignments WHERE principal_id=$1", [
        principal,
      ])
    )[0].source,
  ).toBe("CORPORATE_GROUP");
  await migration.up(runner);
  await source.query(
    "UPDATE platform_role_assignments SET source='DEV_BOOTSTRAP' WHERE principal_id=$1",
    [principal],
  );
  await expect(migration.down(runner)).rejects.toThrow(
    "DEV_BOOTSTRAP_ROLLBACK_REQUIRES_EXPLICIT_ROLE_HANDLING",
  );
  await source.query("DELETE FROM platform_role_assignments WHERE principal_id=$1", [principal]);
});

it("grants both roles for multiple users once and does not restore revocations", async () => {
  const workspace = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await source.query("INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'test','ACTIVE')", [
    workspace,
    `w-${workspace}`,
  ]);
  for (const [id, subject] of [
    [a, "a"],
    [b, "b"],
  ])
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$3)",
      [id, issuer, subject],
    );
  expect(await bootstrapDevSuperadmins(source, issuer, ["a", "b", "missing"])).toBe(1);
  expect(
    (
      await source.query(
        "SELECT classification_ceiling_key FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator'",
        [workspace, a],
      )
    )[0].classification_ceiling_key,
  ).toBe("CONFIDENTIAL");
  await bootstrapDevSuperadmins(source, issuer, ["a", "b"]);
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='dev-superadmin.bootstrap'",
        [workspace],
      )
    )[0].n,
  ).toBe(2);
  await source.query(
    "UPDATE role_assignments SET classification_ceiling_key='RESTRICTED' WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator'",
    [workspace, a],
  );
  await bootstrapDevSuperadmins(source, issuer, ["a"]);
  expect(
    (
      await source.query(
        "SELECT classification_ceiling_key FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator'",
        [workspace, a],
      )
    )[0].classification_ceiling_key,
  ).toBe("CONFIDENTIAL");
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='superadmin.ceiling.upgrade'",
        [workspace],
      )
    )[0].n,
  ).toBe(1);
  await bootstrapDevSuperadmins(source, issuer, ["a"]);
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='superadmin.ceiling.upgrade'",
        [workspace],
      )
    )[0].n,
  ).toBe(1);
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM platform_role_assignments WHERE principal_id=ANY($1) AND source='DEV_BOOTSTRAP'",
        [[a, b]],
      )
    )[0].n,
  ).toBe(2);
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM role_assignments WHERE workspace_id=$1 AND principal_id=ANY($2) AND role_key='super-administrator'",
        [workspace, [a, b]],
      )
    )[0].n,
  ).toBe(2);
  await source.query(
    "UPDATE platform_role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [a],
  );
  await source.query(
    "UPDATE role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND workspace_id=$2",
    [a, workspace],
  );
  await bootstrapDevSuperadmins(source, issuer, ["a"]);
  expect(
    (
      await source.query("SELECT revoked_at FROM platform_role_assignments WHERE principal_id=$1", [
        a,
      ])
    )[0].revoked_at,
  ).not.toBeNull();
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM role_assignments WHERE principal_id=$1 AND workspace_id=$2 AND role_key='super-administrator'",
        [a, workspace],
      )
    )[0].n,
  ).toBe(1);
});

it("upgrades existing versioned project grants only for an active superadministrator", async () => {
  const workspace = randomUUID(),
    project = randomUUID(),
    admin = randomUUID(),
    other = randomUUID();
  await source.query("INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'test','ACTIVE')", [
    workspace,
    `w-${workspace}`,
  ]);
  await source.query(
    "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'test','test','ACTIVE','INTERNAL')",
    [project, workspace],
  );
  for (const [id, subject] of [
    [admin, `admin-${admin}`],
    [other, `other-${other}`],
  ])
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$3)",
      [id, issuer, subject],
    );
  await bootstrapDevSuperadmins(source, issuer, [`admin-${admin}`]);
  const repository = new ProjectEntitlementRepository(source),
    grantId = randomUUID(),
    otherId = randomUUID(),
    revokedId = randomUUID();
  for (const [id, principalId, revoked] of [
    [grantId, admin, false],
    [otherId, other, false],
    [revokedId, admin, true],
  ] as const) {
    const now = new Date().toISOString();
    await repository.append(
      createProjectEntitlementRevision({
        workspaceId: workspace,
        projectId: project,
        principalId,
        entitlementId: id,
        revisionId: randomUUID(),
        version: 1,
        operation: revoked ? "REVOKE" : "GRANT",
        effect: "ALLOW",
        permissions: ["work-item.read"],
        classificationCeilingKey: "RESTRICTED",
        validFrom: now,
        ...(revoked ? { revokedAt: now } : {}),
        actor: { kind: "SERVICE", principalId: "test", serviceKey: "test" },
        reason: "test",
        correlationId: randomUUID(),
        createdAt: now,
      }),
    );
  }
  await bootstrapDevSuperadmins(source, issuer, [`admin-${admin}`]);
  await bootstrapDevSuperadmins(source, issuer, [`admin-${admin}`]);
  const rows = (await source.query(
    "SELECT id,classification_ceiling_key,revoked_at,current_version FROM project_entitlements WHERE id=ANY($1)",
    [[grantId, otherId, revokedId]],
  )) as {
    id: string;
    classification_ceiling_key: string;
    revoked_at: Date | null;
    current_version: number;
  }[];
  expect(rows.find((row) => row.id === grantId)).toMatchObject({
    classification_ceiling_key: "CONFIDENTIAL",
    current_version: 2,
  });
  expect(rows.find((row) => row.id === otherId)).toMatchObject({
    classification_ceiling_key: "RESTRICTED",
    current_version: 1,
  });
  expect(rows.find((row) => row.id === revokedId)).toMatchObject({
    classification_ceiling_key: "RESTRICTED",
    current_version: 1,
    revoked_at: expect.any(Date),
  });
  expect(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE action='PROJECT_ENTITLEMENT_CHANGED' AND attributes->>'entitlementId'=$1 AND actor->>'kind'='SERVICE'",
        [grantId],
      )
    )[0].n,
  ).toBe(2);
});

it.each(["same", "other"])(
  "preserves first corporate login election when %s principal enters",
  async (which) => {
    const a = randomUUID(),
      b = randomUUID(),
      subject = `subject-${randomUUID()}`;
    await source.query("TRUNCATE platform_administrator_bootstrap");
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN','a')",
      [a, issuer, subject],
    );
    await source.query(
      "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','DEV_BOOTSTRAP')",
      [a],
    );
    const login = which === "same" ? subject : `other-${b}`;
    await new PlatformAccessService(source).registerVerified({
      issuer,
      subject: login,
      tokenId: "x",
      clientId: "x",
      issuedAt: 1,
      expiresAt: 2,
      groups: [],
      amr: [],
    });
    await expect(
      new PlatformAccessService(source).authorize(a, "platform.users.read"),
    ).resolves.toMatchObject({ assignmentSource: "DEV_BOOTSTRAP" });
    await expect(
      new PlatformAccessService(source).authorizeLocal(a, "platform.users.read"),
    ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect(
      (await source.query("SELECT principal_id FROM platform_administrator_bootstrap"))[0]
        .principal_id,
    ).toBe(
      which === "same"
        ? a
        : (
            await source.query("SELECT id FROM identities WHERE issuer=$1 AND subject=$2", [
              issuer,
              login,
            ])
          )[0].id,
    );
  },
);

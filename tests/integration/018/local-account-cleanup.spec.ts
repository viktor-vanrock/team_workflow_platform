import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LocalPersonaSessionService } from "../../../apps/api/src/local/local-persona.controller.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { createProjectEntitlementRevision } from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  ProjectEntitlementRepository,
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
  LOCAL_SEED_KEY,
  LOCAL_SEED_VERSION,
  localPersonaIds,
  localSeedIds,
  runLocalSeed,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runTechWritingLocalSeed } from "../../../packages/runtime-composition/src/seed/tech-writing-local-seed.ts";

let postgres: RunningPostgres;
let source: ReturnType<typeof createPlatformDataSource>;
let sessions: LocalPersonaSessionService;
const issuer = "https://fake-idp:4443/oidc";
const retiredIds = [localPersonaIds["limited.alpha"], localPersonaIds["outsider.delta"]];
beforeAll(async () => {
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", issuer);
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runLocalSeed(source);
  await runTechWritingLocalSeed(source);
  sessions = new LocalPersonaSessionService(source, {
    issue: async (key: string) => ({ access_token: key, token_type: "Bearer", expires_in: 900 }),
  } as never);
}, 120_000);
afterAll(async () => {
  await source?.destroy();
  await postgres?.stop();
  vi.unstubAllEnvs();
});

const snapshot = async () => ({
  docs: await source.query("SELECT * FROM tech_writing_documents ORDER BY id"),
  work: await source.query("SELECT * FROM work_items ORDER BY id"),
  audit: (await source.query("SELECT * FROM audit_events ORDER BY id")) as {
    id: string;
    reason_code: string;
  }[],
});

describe("018 local seed cleanup", () => {
  it("seeds nine humans and one service without diagnostic identities", async () => {
    expect(LOCAL_SEED_VERSION).toBe(5);
    expect(await source.query("SELECT id FROM identities WHERE id=ANY($1)", [retiredIds])).toEqual(
      [],
    );
    expect(
      await source.query(
        "SELECT kind,count(*)::int AS count FROM identities GROUP BY kind ORDER BY kind",
      ),
    ).toEqual([
      { kind: "HUMAN", count: 9 },
      { kind: "SERVICE", count: 1 },
    ]);
    for (const { key } of sessions.options())
      expect((await sessions.exchange(key)).persona.kind).toBe("HUMAN");
    const worker = await source.query(
      "SELECT i.kind,r.permissions FROM identities i JOIN role_assignments r ON r.principal_id=i.id WHERE i.id=$1",
      [localPersonaIds["worker.local"]],
    );
    expect(worker).toEqual([
      { kind: "SERVICE", permissions: ["command.execute", "work-item.read"] },
    ]);
  });

  it("retires old memberships and versioned/unversioned grants without changing history or other people", async () => {
    const grantIds: string[] = [];
    for (const [key, workspaceId, projectId, role] of [
      ["limited.alpha", localSeedIds.workspaceFunctional, localSeedIds.alpha, "reader"],
      ["outsider.delta", localSeedIds.workspaceIsolated, localSeedIds.delta, "requester"],
    ] as const) {
      const principalId = localPersonaIds[key],
        entitlementId = randomUUID();
      grantIds.push(entitlementId);
      await source.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$3)",
        [principalId, issuer, key],
      );
      await source.query(
        "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES(gen_random_uuid(),$1,$2,'ACTIVE','2026-01-01')",
        [workspaceId, principalId],
      );
      await source.query(
        "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,project_id,effect,permissions,valid_from) VALUES(gen_random_uuid(),$1,$2,$3,$4,'ALLOW','[\"work-item.read\"]','2026-01-01')",
        [workspaceId, principalId, role, role === "requester" ? projectId : null],
      );
      if (key === "limited.alpha") {
        const ref = {
          id: randomUUID(),
          version: 1,
          contentHash: `sha256:${"a".repeat(64)}` as const,
        };
        await new ProjectEntitlementRepository(source).append(
          createProjectEntitlementRevision({
            revisionId: randomUUID(),
            entitlementId,
            workspaceId,
            projectId,
            principalId,
            version: 1,
            operation: "GRANT",
            effect: "ALLOW",
            permissions: ["work-item.read"],
            classificationCeilingKey: "INTERNAL",
            validFrom: "2026-01-01T00:00:00Z",
            validUntil: "2027-01-01T00:00:00Z",
            actor: {
              kind: "HUMAN",
              principalId: localPersonaIds["owner.local"],
              roleKey: "system-administrator",
              authenticationContextRef: ref,
              authorizationBasisRef: ref,
            },
            reason: "Historical fixture",
            correlationId: randomUUID(),
            createdAt: "2026-01-01T00:00:00Z",
          }),
        );
      } else {
        await source.query(
          "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,permissions,classification_ceiling_key,valid_from) VALUES($1,$2,$3,$4,'ALLOW','[\"work-item.read\"]','INTERNAL','2026-01-01')",
          [entitlementId, workspaceId, projectId, principalId],
        );
      }
    }
    await source.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) SELECT gen_random_uuid(),workspace_id,project_id,occurred_at,$1::jsonb,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes FROM audit_events WHERE id='85000000-0000-4000-8000-000000000001'",
      [JSON.stringify({ kind: "HUMAN", principalId: retiredIds[0] })],
    );
    const before = await snapshot();
    const retainedGrants = await source.query(
      "SELECT * FROM project_entitlements WHERE principal_id <> ALL($1) ORDER BY id",
      [retiredIds],
    );
    const historicalRevision = await source.query(
      "SELECT * FROM project_entitlement_revisions WHERE entitlement_id=$1",
      [grantIds[0]],
    );
    await source.query("UPDATE local_seed_markers SET version=4 WHERE key=$1", [LOCAL_SEED_KEY]);
    expect(await runLocalSeed(source)).toBe("applied");
    for (const table of ["workspace_memberships", "role_assignments"])
      expect(
        await source.query(`SELECT id FROM ${table} WHERE principal_id=ANY($1)`, [retiredIds]),
      ).toEqual([]);
    expect(
      await source.query(
        "SELECT id FROM project_entitlements WHERE principal_id=ANY($1) AND revoked_at IS NULL",
        [retiredIds],
      ),
    ).toEqual([]);
    expect(
      await source.query("SELECT id FROM identities WHERE id=ANY($1)", [retiredIds]),
    ).toHaveLength(2);
    expect(
      await source.query(
        "SELECT * FROM project_entitlement_revisions WHERE entitlement_id=$1 AND version=1",
        [grantIds[0]],
      ),
    ).toEqual(historicalRevision);
    expect(
      await source.query(
        "SELECT operation,version,valid_until FROM project_entitlement_revisions WHERE entitlement_id=$1 ORDER BY version",
        [grantIds[0]],
      ),
    ).toEqual([
      { operation: "GRANT", version: 1, valid_until: new Date("2027-01-01T00:00:00Z") },
      { operation: "REVOKE", version: 2, valid_until: new Date("2027-01-01T00:00:00Z") },
    ]);
    const after = await snapshot();
    expect(after.docs).toEqual(before.docs);
    expect(after.work).toEqual(before.work);
    const historicalIds = new Set(before.audit.map((row: { id: string }) => row.id));
    expect(after.audit.filter((row: { id: string }) => historicalIds.has(row.id))).toEqual(
      before.audit,
    );
    expect(
      after.audit
        .filter((row: { id: string }) => !historicalIds.has(row.id))
        .map((row: { reason_code: string }) => row.reason_code),
    ).toEqual(["REVOKE", "REVOKE"]);
    expect(
      await source.query(
        "SELECT * FROM project_entitlements WHERE principal_id <> ALL($1) ORDER BY id",
        [retiredIds],
      ),
    ).toEqual(retainedGrants);
    const grants = await source.query("SELECT * FROM project_entitlements ORDER BY id");
    expect(await runLocalSeed(source)).toBe("unchanged");
    expect(await runTechWritingLocalSeed(source)).toBe("unchanged");
    expect(await snapshot()).toEqual(after);
    expect(await source.query("SELECT * FROM project_entitlements ORDER BY id")).toEqual(grants);
    for (const key of [
      "executor.alpha",
      "executor.qa2",
      "viewer.beta",
      "requester.alpha",
      "owner.local",
      "integration-admin.alpha",
    ])
      expect((await sessions.exchange(key)).projects.map(({ projectKey }) => projectKey)).toEqual(
        key === "requester.alpha" ? ["ALPHA"] : ["ALPHA", "BETA"],
      );
    expect(
      await source.query("SELECT id FROM role_assignments WHERE principal_id=$1", [
        localPersonaIds["worker.local"],
      ]),
    ).toHaveLength(1);
  });

  it("does not give a workspace administrator powers in another workspace", async () => {
    await expect(
      authorizeLocalQaApi(
        source,
        { headers: {}, localPersonaKey: "owner.local" },
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        "project.admin",
      ),
    ).resolves.toBeDefined();
    await expect(
      authorizeLocalQaApi(
        source,
        { headers: {}, localPersonaKey: "owner.local" },
        localSeedIds.workspaceIsolated,
        localSeedIds.delta,
        "project.admin",
      ),
    ).rejects.toThrow();
  });
});

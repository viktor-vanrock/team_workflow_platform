import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HttpsFakeIdpTokenClient,
  LocalPersonaSessionService,
} from "../../../apps/api/src/local/local-persona.controller.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { FakeOidcService } from "../../../apps/fake-idp/src/oidc.controller.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";
import {
  localPersonaIds,
  localSeedIds,
  runLocalSeed,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let postgres: RunningPostgres;
let source: ReturnType<typeof createPlatformDataSource>;
let sessions: LocalPersonaSessionService;
const saved = { profile: process.env.AWP_RUNTIME_PROFILE, issuer: process.env.AWP_IDENTITY_ISSUER };
const issuer = "https://fake-idp:4443/oidc";
beforeAll(async () => {
  process.env.AWP_RUNTIME_PROFILE = "local";
  process.env.AWP_IDENTITY_ISSUER = issuer;
  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runLocalSeed(source);
  const tokens = Object.assign(new HttpsFakeIdpTokenClient(issuer), {
    issue: async (key: string) => ({
      access_token: `token:${key}`,
      token_type: "Bearer",
      expires_in: 900,
    }),
    stepUp: async (key: string) => ({
      access_token: `step:${key}`,
      token_type: "Bearer",
      expires_in: 900,
    }),
  });
  sessions = new LocalPersonaSessionService(source, tokens);
  // This suite covers ordinary QA participants after the administrator's first login.
  await sessions.exchange("owner.local");
}, 120_000);
afterAll(async () => {
  await source?.destroy();
  await postgres?.stop();
  if (saved.profile === undefined) delete process.env.AWP_RUNTIME_PROFILE;
  else process.env.AWP_RUNTIME_PROFILE = saved.profile;
  if (saved.issuer === undefined) delete process.env.AWP_IDENTITY_ISSUER;
  else process.env.AWP_IDENTITY_ISSUER = saved.issuer;
});
const authorize = (personaKey: string, projectId: string, permission = "qa.session.execute") =>
  authorizeLocalQaApi(
    source,
    { headers: {}, localPersonaKey: personaKey },
    localSeedIds.workspaceFunctional,
    projectId,
    permission,
  );

describe("016 shared workspace team", () => {
  it("gives two people one workspace role and real QA rights in ALPHA/BETA", async () => {
    for (const key of ["executor.alpha", "executor.qa2"] as const) {
      const first = await sessions.exchange(key);
      expect(first.persona.principalId).toBe(localPersonaIds[key]);
      expect(first.grants.roles).toEqual(["qa-executor"]);
      expect(first.projects.map((project) => project.projectKey)).toEqual(["ALPHA", "BETA"]);
      for (const projectId of [localSeedIds.alpha, localSeedIds.beta]) {
        expect((await sessions.selectProject(key, projectId)).context.projectId).toBe(projectId);
        expect((await authorize(key, projectId)).actor.principalId).toBe(localPersonaIds[key]);
      }
      expect((await sessions.stepUp(key, localSeedIds.beta)).context.projectId).toBe(
        localSeedIds.beta,
      );
      expect(
        await source.query(
          "SELECT project_id,project_access_scope FROM role_assignments WHERE principal_id=$1",
          [localPersonaIds[key]],
        ),
      ).toEqual([{ project_id: null, project_access_scope: "ALL_PROJECTS" }]);
    }
    expect(localPersonaCatalog.resolve("executor.alpha").permissions).toEqual(
      localPersonaCatalog.resolve("executor.qa2").permissions,
    );
  });
  it("rejects foreign, suspended and administrative access, live DENY and revoked membership", async () => {
    await expect(sessions.selectProject("executor.alpha", localSeedIds.delta)).rejects.toThrow(
      "LOCAL_PROJECT_NOT_AVAILABLE",
    );
    await expect(sessions.selectProject("executor.alpha", localSeedIds.gamma)).rejects.toThrow(
      "LOCAL_PROJECT_NOT_AVAILABLE",
    );
    await expect(
      authorize("executor.alpha", localSeedIds.alpha, "project.entitlement.grant"),
    ).rejects.toThrow();
    await source.query(
      "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES(gen_random_uuid(),$1,$2,$3,'explicit-deny','DENY','[\"qa.session.execute\"]','2026-01-01')",
      [localSeedIds.workspaceFunctional, localSeedIds.beta, localPersonaIds["executor.alpha"]],
    );
    await expect(authorize("executor.alpha", localSeedIds.beta)).rejects.toThrow();
    expect(
      (await sessions.selectProject("executor.alpha", localSeedIds.beta)).grants.permissions,
    ).not.toContain("qa.session.execute");
    await source.query("DELETE FROM role_assignments WHERE role_key='explicit-deny'");
    await source.query("UPDATE workspace_memberships SET state='REVOKED' WHERE principal_id=$1", [
      localPersonaIds["executor.qa2"],
    ]);
    const pending = await sessions.exchange("executor.qa2");
    expect(pending.projects).toEqual([]);
    expect(pending.grants.permissions).toEqual([]);
    await expect(authorize("executor.qa2", localSeedIds.alpha)).rejects.toThrow();
    await source.query("UPDATE workspace_memberships SET state='ACTIVE' WHERE principal_id=$1", [
      localPersonaIds["executor.qa2"],
    ]);
  });
  it("upgrades the old auditor and preserves stable assignments/history on repeated seeding", async () => {
    const auditor = "30000000-0000-4000-8000-000000000007";
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,'auditor.local','HUMAN','Auditor')",
      [auditor, issuer],
    );
    await source.query(
      "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES(gen_random_uuid(),$1,$2,'ACTIVE','2026-01-01')",
      [localSeedIds.workspaceFunctional, auditor],
    );
    await source.query(
      "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES(gen_random_uuid(),$1,$2,'auditor','ALLOW','[\"audit.read\"]','2026-01-01')",
      [localSeedIds.workspaceFunctional, auditor],
    );
    await source.query(
      "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,permissions,classification_ceiling_key,valid_from) VALUES(gen_random_uuid(),$1,$2,$3,'ALLOW','[\"audit.read\"]','RESTRICTED','2026-01-01')",
      [localSeedIds.workspaceFunctional, localSeedIds.alpha, auditor],
    );
    await source.query(
      "UPDATE local_seed_markers SET version=2 WHERE key='001-local-walking-skeleton'",
    );
    expect(await runLocalSeed(source)).toBe("applied");
    expect(await runLocalSeed(source)).toBe("unchanged");
    expect(
      await source.query("SELECT id FROM role_assignments WHERE principal_id=$1", [auditor]),
    ).toEqual([]);
    expect(
      await source.query("SELECT id FROM workspace_memberships WHERE principal_id=$1", [auditor]),
    ).toEqual([]);
    expect(
      await source.query(
        "SELECT id FROM project_entitlements WHERE principal_id=$1 AND revoked_at IS NULL",
        [auditor],
      ),
    ).toEqual([]);
    expect(
      await source.query(
        "SELECT id FROM audit_events WHERE id='85000000-0000-4000-8000-000000000001'",
      ),
    ).toHaveLength(1);
    expect(
      await source.query(
        "SELECT principal_id FROM role_assignments WHERE id='50000000-0000-4000-8000-000000000009'",
      ),
    ).toEqual([{ principal_id: localPersonaIds["worker.local"] }]);
    expect(
      localPersonaCatalog.publicOptions().some((option) => option.key === "auditor.local"),
    ).toBe(false);
    await expect(sessions.exchange("auditor.local")).rejects.toThrow("LOCAL_PERSONA_NOT_AVAILABLE");
    expect(() => new FakeOidcService().issue("auditor.local")).toThrow("FAKE_IDP_SUBJECT_UNKNOWN");
  });
});

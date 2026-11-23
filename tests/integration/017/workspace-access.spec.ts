import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HttpsFakeIdpTokenClient,
  LocalPersonaSessionService,
} from "../../../apps/api/src/local/local-persona.controller.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { WorkspaceSubjectsController } from "../../../apps/api/src/local/workspace-subjects.controller.ts";
import {
  createProjectEntitlementRevision,
  type ProjectEntitlementRevision,
} from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  ProjectEntitlementRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { M0210UnifiedSystemRoles1700000000210 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0210-unified-system-roles.ts";
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
  await runQaLocalSeed(source);
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

// Disposable fixture: change the retained reader's actual entitlement revisions,
// so classification coverage does not require a diagnostic login in the product.
async function setReaderCeiling(classificationCeilingKey: string) {
  const revisions = (await source.query(
    "SELECT r.semantic_body FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version WHERE h.principal_id=$1 AND h.revoked_at IS NULL",
    [localPersonaIds["viewer.beta"]],
  )) as { semantic_body: ProjectEntitlementRevision }[];
  for (const { semantic_body: previous } of revisions) {
    const { contentHash, ...body } = previous;
    await new ProjectEntitlementRepository(source).append(
      createProjectEntitlementRevision({
        ...body,
        classificationCeilingKey,
        operation: "REPLACE",
        revisionId: randomUUID(),
        version: previous.version + 1,
        previousRevisionRef: { id: previous.revisionId, version: previous.version, contentHash },
        reason: "Disposable classification regression fixture",
        createdAt: new Date().toISOString(),
        correlationId: randomUUID(),
      }),
    );
  }
}

describe("017 workspace subjects and unified roles", () => {
  it("merges administrator functions, preserves identities and reader ceilings", async () => {
    const owner = await sessions.exchange("owner.local"),
      admin = await sessions.exchange("integration-admin.alpha");
    expect(owner.grants.roles).toEqual(["system-administrator"]);
    expect(admin.grants.roles).toEqual(owner.grants.roles);
    expect(admin.grants.permissions).toEqual(owner.grants.permissions);
    expect(admin.persona.principalId).not.toBe(owner.persona.principalId);
    expect(admin.grants.permissions).toContain("project.register");
    expect(owner.grants.permissions).toContain("integration.validate");
    expect((await sessions.exchange("viewer.beta")).grants.roles).toEqual(["reader"]);
    try {
      await setReaderCeiling("INTERNAL");
      expect((await sessions.exchange("viewer.beta")).projects.map((p) => p.projectKey)).toEqual([
        "ALPHA",
      ]);
    } finally {
      await setReaderCeiling("RESTRICTED");
    }
    expect((await sessions.exchange("viewer.beta")).projects.map((p) => p.projectKey)).toEqual([
      "ALPHA",
      "BETA",
    ]);
  });
  it("supplies exact project permissions and excludes live DENY", async () => {
    await source.query(
      "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES(gen_random_uuid(),$1,$2,$3,'test-deny','DENY','[\"qa.session.execute\"]','2026-01-01')",
      [localSeedIds.workspaceFunctional, localSeedIds.beta, localPersonaIds["executor.alpha"]],
    );
    const session = await sessions.exchange("executor.alpha");
    expect(session.grants.permissions).toContain("qa.session.execute");
    expect(session.projects.find((p) => p.projectId === localSeedIds.alpha)?.permissions).toContain(
      "qa.session.execute",
    );
    expect(
      session.projects.find((p) => p.projectId === localSeedIds.beta)?.permissions,
    ).not.toContain("qa.session.execute");
    await expect(authorize("executor.alpha", localSeedIds.beta)).rejects.toThrow();
    await source.query("DELETE FROM role_assignments WHERE role_key='test-deny'");
  });
  it("lists named drafts across projects for both QA people, without foreign or classified rows", async () => {
    for (const [projectId, title, classification] of [
      [localSeedIds.alpha, "Alpha visible", "INTERNAL"],
      [localSeedIds.beta, "Beta visible", "RESTRICTED"],
      [localSeedIds.alpha, "Secret hidden", "CONFIDENTIAL"],
    ]) {
      await source.query(
        "INSERT INTO intake_drafts(id,workspace_id,project_id,work_type_definition_id,created_by,state,intake_payload,intake_schema_ref,created_at) SELECT gen_random_uuid(),$1,$2,id,$3,'DRAFT',$4::jsonb,'{}',clock_timestamp() FROM work_type_definitions WHERE work_type_key='qa.validation'",
        [
          localSeedIds.workspaceFunctional,
          projectId,
          localPersonaIds["requester.alpha"],
          JSON.stringify({ title, requestedClassificationKey: classification }),
        ],
      );
    }
    const catalog = new WorkspaceSubjectsController(source);
    for (const key of ["executor.alpha", "executor.qa2"]) {
      const result = await catalog.list(
        { headers: {}, localPersonaKey: key },
        localSeedIds.workspaceFunctional,
      );
      expect(result.items.map((i) => i.title)).toEqual(["Alpha visible", "Beta visible"]);
      expect(result.items.map((i) => i.projectKey)).toEqual(["ALPHA", "BETA"]);
    }
    try {
      await setReaderCeiling("INTERNAL");
      expect(
        (
          await catalog.list(
            { headers: {}, localPersonaKey: "viewer.beta" },
            localSeedIds.workspaceFunctional,
          )
        ).items.map((i) => i.title),
      ).toEqual(["Alpha visible"]);
    } finally {
      await setReaderCeiling("RESTRICTED");
    }
    expect(
      (
        await catalog.list(
          { headers: {}, localPersonaKey: "worker.local" },
          localSeedIds.workspaceFunctional,
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await catalog.list(
          { headers: {}, localPersonaKey: "executor.alpha" },
          localSeedIds.workspaceIsolated,
        )
      ).items,
    ).toEqual([]);
  });
  it("migrates historical role keys while preserving scope, DENY and entitlement limits", async () => {
    await source.query(
      "UPDATE role_assignments SET role_key='WORKSPACE_OWNER' WHERE principal_id=$1",
      [localPersonaIds["owner.local"]],
    );
    const before = await source.query(
      "SELECT id,permissions,project_id,project_access_scope,classification_ceiling_key,row_version FROM role_assignments WHERE principal_id=$1 ORDER BY id",
      [localPersonaIds["owner.local"]],
    );
    const entitlements = await source.query("SELECT * FROM project_entitlements ORDER BY id");
    await source.query("DROP TABLE role_merge_0210_snapshot");
    const runner = source.createQueryRunner();
    await new M0210UnifiedSystemRoles1700000000210().up(runner);
    await runner.release();
    const after = await source.query(
      "SELECT id,permissions,project_id,project_access_scope,classification_ceiling_key,row_version,role_key FROM role_assignments WHERE principal_id=$1 ORDER BY id",
      [localPersonaIds["owner.local"]],
    );
    expect(after).toEqual(
      (before as Record<string, unknown>[]).map((row: Record<string, unknown>) => ({
        ...row,
        row_version: Number(row.row_version) + 1,
        role_key: "system-administrator",
      })),
    );
    expect(await source.query("SELECT * FROM project_entitlements ORDER BY id")).toEqual(
      entitlements,
    );
  });
});

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { currentAuthority } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  LocalPersonaController,
  LocalPersonaSessionService,
} from "../../../apps/api/src/local/local-persona.controller.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runOwnerProjectRegistrarLocalSeed } from "../../../packages/runtime-composition/src/seed/owner-project-registrar-seed.ts";
import { runPlatformAccessLocalSeed } from "../../../packages/runtime-composition/src/seed/platform-access-seed.ts";
import { runTechWritingLocalSeed } from "../../../packages/runtime-composition/src/seed/tech-writing-local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let f: Awaited<ReturnType<typeof startBindingHttpFixture>>;
const issuer = "https://fake-idp:4443/oidc",
  owner = localPersonaIds["owner.local"];
beforeEach(() => {
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", issuer);
});
beforeAll(async () => {
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
  await runTechWritingLocalSeed(f.source);
  await runPlatformAccessLocalSeed(f.source, issuer);
}, 120_000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
it("enrolls only admin1 and creates projects through current authority in all three workspaces", async () => {
  await runOwnerProjectRegistrarLocalSeed(f.source, issuer);
  const workspaces = (await f.source.query(
    "SELECT id FROM workspaces WHERE state='ACTIVE' ORDER BY id",
  )) as { id: string }[];
  expect(workspaces).toHaveLength(3);
  const local = new LocalPersonaSessionService(f.source, {
    issue: async () => ({ access_token: "fixture", token_type: "Bearer", expires_in: 300 }),
  } as never);
  const session = await local.exchange("owner.local");
  expect(session.workspaces.filter((w) => w.permissions.includes("project.register"))).toHaveLength(
    3,
  );
  expect((await local.exchange("integration-admin.alpha")).workspaces).toHaveLength(1);
  for (const [index, workspace] of workspaces.entries()) {
    expect(
      (
        await f.apiRequest(
          "/registration-options",
          "GET",
          undefined,
          "owner",
          undefined,
          undefined,
          workspace.id,
        )
      ).status,
    ).toBe(200);
    const body = {
      key: `ALLWS${index}`,
      name: "Общая администрация",
      ownerIds: Object.fromEntries(
        ["business", "technical", "qa", "security", "escalation"].map((k) => [k, owner]),
      ),
      criticalityKey: "STANDARD",
      dataClassificationKey: "INTERNAL",
      reason: "Проверка регистрации во всех областях",
    };
    const key = randomUUID();
    const created = await f.apiRequest("", "POST", body, "owner", key, undefined, workspace.id);
    expect(created, f.errors.join("; ")).toMatchObject({
      status: 201,
      body: { projectId: expect.any(String) },
    });
    expect(
      await f.apiRequest("", "POST", body, "owner", key, undefined, workspace.id),
    ).toMatchObject({
      status: created.status,
      body: created.body,
      headers: {
        etag: created.headers.etag,
        "awp-resource-ref": created.headers["awp-resource-ref"],
      },
    });
    if (workspace.id !== f.scope.workspaceId) {
      const scopedSession = await local.exchange("owner.local", workspace.id);
      expect(new Set(scopedSession.grants.permissions)).toEqual(
        new Set([
          "project.register",
          "project.catalog.read",
          "project.onboarding.read",
          "project.metadata.update",
        ]),
      );
      expect(scopedSession.grants.roles).not.toContain("system-administrator");
      const projectId = String(created.body.projectId);
      expect(
        (
          await f.apiRequest(
            `/${projectId}/onboarding`,
            "GET",
            undefined,
            "owner",
            undefined,
            undefined,
            workspace.id,
          )
        ).status,
      ).toBe(200);
      for (const permission of [
        "integration.publish",
        "project.entitlement.grant",
        "project.entitlement.revoke",
        "work-item.read",
        "docs.read",
      ]) {
        await expect(
          f.source.transaction((manager) =>
            currentAuthority(
              manager,
              { kind: "PROJECT", workspaceId: workspace.id, projectId },
              owner,
              permission,
            ),
          ),
        ).rejects.toMatchObject({
          status: 403,
          response: { code: "CURRENT_AUTHORIZATION_REQUIRED" },
        });
      }
      expect(
        (
          await f.apiRequest(
            "/registration-options",
            "GET",
            undefined,
            "admin",
            undefined,
            undefined,
            workspace.id,
          )
        ).status,
      ).toBe(404);
    }
  }
});
it("replay adds nothing and enrolls a newly introduced empty workspace", async () => {
  const before = await f.source.query("SELECT * FROM platform_access_changes ORDER BY id");
  await runOwnerProjectRegistrarLocalSeed(f.source, issuer);
  expect(await f.source.query("SELECT * FROM platform_access_changes ORDER BY id")).toEqual(before);
  const id = randomUUID();
  await f.source.query(
    "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'Новая область','ACTIVE')",
    [id, `new-${id}`],
  );
  await runOwnerProjectRegistrarLocalSeed(f.source, issuer);
  const local = new LocalPersonaSessionService(f.source, {
    issue: async () => ({ access_token: "fixture", token_type: "Bearer", expires_in: 300 }),
  } as never);
  const session = await local.exchange("owner.local", id);
  expect(session.projects).toEqual([]);
  expect(session.grants.permissions).toContain("project.register");
  expect(
    (
      await f.apiRequest(
        "/registration-options",
        "GET",
        undefined,
        "owner",
        undefined,
        undefined,
        id,
      )
    ).status,
  ).toBe(200);
});
it("does not resurrect explicit revocation even if crash left no bootstrap marker", async () => {
  const workspace = "15000000-0000-4000-8000-000000000001";
  const service = new PlatformAccessService(f.source);
  const actor = {
    principalId: owner,
    permission: "platform.workspace-roles.manage" as const,
    assignmentSource: "LOCAL_FIRST_LOGIN" as const,
  };
  const current = (await service.detail(actor, owner)).memberships.find(
    (m) => m.workspaceId === workspace,
  )!;
  await service.replace(actor, owner, workspace, {
    roleKeys: [],
    classificationCeiling: current.classificationCeiling,
    expectedVersion: current.version,
    requestKey: randomUUID(),
    reason: "Явный отзыв",
  });
  await f.source.query("DELETE FROM local_seed_markers WHERE key=$1", [
    `0230-local-administrator-project-registrar:${owner}:${workspace}`,
  ]);
  await runOwnerProjectRegistrarLocalSeed(f.source, issuer);
  expect(
    (
      await f.apiRequest(
        "/registration-options",
        "GET",
        undefined,
        "owner",
        undefined,
        undefined,
        workspace,
      )
    ).status,
  ).toBe(404);
});
it("HTTP workspace selector checks current membership and rejects authoritative fields", async () => {
  const local = new LocalPersonaSessionService(f.source, {
    issue: async () => ({ access_token: "fixture", token_type: "Bearer", expires_in: 300 }),
  } as never);
  class ExchangeTestModule {}
  const app = await NestFactory.create(
    {
      module: ExchangeTestModule,
      controllers: [LocalPersonaController],
      providers: [{ provide: LocalPersonaSessionService, useValue: local }],
    },
    { logger: false, abortOnError: false },
  );
  try {
    await app.listen(0, "127.0.0.1");
    const url = `${await app.getUrl()}/local/persona/exchange`;
    const post = (body: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const workspaceId = "10000000-0000-4000-8000-000000000002";
    const allowed = await post({ personaKey: "owner.local", workspaceId });
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toMatchObject({ context: { workspaceId } });
    expect((await post({ personaKey: "integration-admin.alpha", workspaceId })).status).toBe(403);
    expect((await post({ personaKey: "owner.local", workspaceId: "not-an-id" })).status).toBe(400);
    for (const field of ["roles", "principalId", "actor", "entitlements", "projectId"])
      expect(
        (await post({ personaKey: "owner.local", workspaceId, [field]: "client-authority" }))
          .status,
      ).toBe(400);
  } finally {
    await app.close();
  }
});

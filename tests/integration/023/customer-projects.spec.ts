import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { WorkspaceSubjectsController } from "../../../apps/api/src/local/workspace-subjects.controller.ts";
import { TypeOrmScopedAccessRepository } from "../../../packages/platform-persistence-typeorm/src/identity-access.repository.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runPlatformAccessLocalSeed } from "../../../packages/runtime-composition/src/seed/platform-access-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let f: Awaited<ReturnType<typeof startBindingHttpFixture>>;
let access: PlatformAccessService;
const actor = {
  principalId: localPersonaIds["owner.local"],
  permission: "platform.workspace-roles.manage" as const,
  assignmentSource: "LOCAL_FIRST_LOGIN" as const,
};
const other = localPersonaIds["viewer.beta"];
beforeAll(async () => {
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", "https://fake-idp:4443/oidc");
  await runPlatformAccessLocalSeed(f.source, "https://fake-idp:4443/oidc");
  access = new PlatformAccessService(f.source);
  await access.claimLocalAdministrator(actor.principalId, "https://fake-idp:4443/oidc");
  await access.replace(actor, localPersonaIds["executor.qa2"], f.scope.workspaceId, {
    roleKeys: ["super-administrator"],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Проверка потолка суперадминистратора",
  });
  await access.replace(actor, other, f.scope.workspaceId, {
    roleKeys: ["requester"],
    requesterProjectIds: [localSeedIds.beta],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Отдельный заказчик проекта Beta",
  });
}, 120000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

it("isolates two customers in catalogs, task lists and direct project reads", async () => {
  const alpha = await f.request("", "GET", undefined, "requester");
  const beta = await f.request("", "GET", undefined, "other-requester");
  expect(alpha.status).toBe(200);
  expect(beta.status).toBe(200);
  expect((alpha.body.items as { id: string }[]).map((p) => p.id)).toEqual([localSeedIds.alpha]);
  expect((beta.body.items as { id: string }[]).map((p) => p.id)).toEqual([localSeedIds.beta]);
  for (const [persona, own, foreign] of [
    ["requester.alpha", localSeedIds.alpha, localSeedIds.beta],
    ["viewer.beta", localSeedIds.beta, localSeedIds.alpha],
  ] as const) {
    await expect(
      authorizeLocalQaApi(
        f.source,
        { localPersonaKey: persona, headers: {} },
        f.scope.workspaceId,
        own,
        "work-item.read",
      ),
    ).resolves.toBeDefined();
    await expect(
      authorizeLocalQaApi(
        f.source,
        { localPersonaKey: persona, headers: {} },
        f.scope.workspaceId,
        foreign,
        "work-item.read",
      ),
    ).rejects.toThrow();
    expect(
      (
        await new TypeOrmScopedAccessRepository(f.source).listVisibleProjects(
          f.scope.workspaceId,
          localPersonaIds[persona],
          new Date(),
        )
      ).map((p) => p.id),
    ).toEqual([own]);
    const subjects = await new WorkspaceSubjectsController(f.source).list(
      { localPersonaKey: persona, headers: {} },
      f.scope.workspaceId,
    );
    expect(subjects.items.every((item) => item.projectId === own)).toBe(true);
  }
});

it("creates a private customer project from dialogue, persists it, and replays confirmation once", async () => {
  const expiry = new Date(Date.now() + 3_600_000).toISOString();
  await f.source.query(
    "UPDATE role_assignments SET valid_until=$2 WHERE principal_id=$1 AND role_key='requester' AND project_id IS NULL",
    [localPersonaIds["requester.alpha"], expiry],
  );
  const id = randomUUID();
  const start = await f.dialogueRequest("", { id });
  expect(start).toMatchObject({ status: 201, body: { id, state: "COLLECTING", version: 1 } });
  expect((await f.dialogueRequest("", { id }, "other-requester")).status).toBe(404);
  const message = {
    expectedVersion: 1,
    requestKey: randomUUID(),
    message: "Создай проект «Платёжный кабинет» для проверки заказов",
  };
  const ready = await f.dialogueRequest(`/${id}/messages`, message);
  expect(ready).toMatchObject({ status: 201, body: { state: "READY", version: 2 } });
  expect(await f.dialogueRequest(`/${id}/messages`, message)).toEqual(ready);
  expect(
    (await f.dialogueRequest(`/${id}/messages`, { ...message, message: "Другое" })).status,
  ).toBe(409);
  expect(
    (await f.dialogueRequest(`/${id}/confirm`, { expectedVersion: 1, requestKey: randomUUID() }))
      .status,
  ).toBe(409);
  const confirmation = { expectedVersion: 2, requestKey: randomUUID() };
  expect(
    (await f.dialogueRequest(`/${id}/confirm`, confirmation, "requester-no-mfa")).body.code,
  ).toBe("STEP_UP_REQUIRED");
  const created = await f.dialogueRequest(`/${id}/confirm`, confirmation);
  expect(created).toMatchObject({
    status: 201,
    body: { state: "CREATED", version: 3, projectId: expect.any(String) },
  });
  expect(await f.dialogueRequest(`/${id}/confirm`, confirmation)).toEqual(created);
  const projectId = String(created.body.projectId);
  expect(
    await f.source.query(
      "SELECT classification_ceiling_key FROM project_entitlements WHERE project_id=$1 AND principal_id=$2 AND effect='ALLOW' AND revoked_at IS NULL",
      [projectId, localPersonaIds["executor.qa2"]],
    ),
  ).toEqual([{ classification_ceiling_key: "CONFIDENTIAL" }]);
  const [customerRole] = (await f.source.query(
    "SELECT valid_until FROM role_assignments WHERE project_id=$1 AND principal_id=$2 AND role_key='requester'",
    [projectId, localPersonaIds["requester.alpha"]],
  )) as { valid_until: Date }[];
  expect(customerRole?.valid_until.toISOString()).toBe(expiry);
  expect(await f.source.query("SELECT id FROM projects WHERE id=$1", [projectId])).toHaveLength(1);
  for (const persona of ["requester.alpha", "executor.alpha", "executor.qa2"])
    await expect(
      authorizeLocalQaApi(
        f.source,
        { localPersonaKey: persona, headers: {} },
        f.scope.workspaceId,
        projectId,
        "work-item.read",
      ),
    ).resolves.toBeDefined();
  await expect(
    authorizeLocalQaApi(
      f.source,
      { localPersonaKey: "viewer.beta", headers: {} },
      f.scope.workspaceId,
      projectId,
      "work-item.read",
    ),
  ).rejects.toThrow();
  await f.restart();
  expect((await f.dialogueRequest("")).body.items).toEqual([created.body]);
  expect((await f.dialogueRequest("", undefined, "other-requester")).body.items).toEqual([]);
});

it("does not grant new team projects to customers and revokes removed assignments immediately", async () => {
  const detail = await access.detail(actor, other);
  expect(detail.memberships[0]?.requesterProjectIds).toEqual([localSeedIds.beta]);
  await expect(
    access.replace(actor, other, f.scope.workspaceId, {
      roleKeys: ["requester"],
      requesterProjectIds: [localSeedIds.delta],
      classificationCeiling: "RESTRICTED",
      expectedVersion: 1,
      requestKey: randomUUID(),
      reason: "Чужая область",
    }),
  ).rejects.toThrow("ACCESS_PROJECT_INVALID");
  await access.replace(actor, other, f.scope.workspaceId, {
    roleKeys: ["requester"],
    requesterProjectIds: [],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 1,
    requestKey: randomUUID(),
    reason: "Отозвать проект",
  });
  await expect(
    authorizeLocalQaApi(
      f.source,
      { localPersonaKey: "viewer.beta", headers: {} },
      f.scope.workspaceId,
      localSeedIds.beta,
      "work-item.read",
    ),
  ).rejects.toThrow();
  expect((await f.request("", "GET", undefined, "other-requester")).body.items).toEqual([]);
  expect((await f.dialogueRequest("", { id: randomUUID() }, "executor")).status).toBe(403);
});

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
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

let postgres: RunningPostgres;
let source: ReturnType<typeof createPlatformDataSource>;
let service: PlatformAccessService;
const issuer = "https://fake-idp:4443/oidc",
  owner = localPersonaIds["owner.local"],
  target = localPersonaIds["viewer.beta"],
  workspace = localSeedIds.workspaceFunctional;
const actor = {
  principalId: owner,
  permission: "platform.workspace-roles.manage" as const,
  assignmentSource: "LOCAL_FIRST_LOGIN" as const,
};
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
  await runQaLocalSeed(source);
  await runTechWritingLocalSeed(source);
  await runPlatformAccessLocalSeed(source, issuer);
  service = new PlatformAccessService(source);
  await service.claimLocalAdministrator(owner, issuer);
}, 120_000);
afterAll(async () => {
  await source?.destroy();
  await postgres?.stop();
  vi.unstubAllEnvs();
});
it("only the explicit platform administrator can manage the human directory", async () => {
  expect((await service.users(actor)).items).toHaveLength(9);
  await expect(
    service.users({ ...actor, principalId: localPersonaIds["integration-admin.alpha"] }),
  ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  await source.query(
    "UPDATE platform_role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [owner],
  );
  await runPlatformAccessLocalSeed(source, issuer);
  await expect(service.users(actor)).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  await source.query("UPDATE platform_role_assignments SET revoked_at=NULL WHERE principal_id=$1", [
    owner,
  ]);
});
it("combines team access with selected customer projects, replays and revokes live", async () => {
  const input = {
    roleKeys: ["requester", "qa-executor"],
    requesterProjectIds: [localSeedIds.alpha],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Проверка нескольких ролей",
  };
  const saved = await service.replace(actor, target, workspace, input);
  expect(saved.roleKeys).toEqual(["qa-executor", "requester"]);
  expect(await service.replace(actor, target, workspace, input)).toEqual(saved);
  await expect(
    service.replace(actor, target, workspace, { ...input, roleKeys: ["reader"] }),
  ).rejects.toThrow("ACCESS_REQUEST_CONFLICT");
  await expect(
    service.replace(actor, target, workspace, { ...input, requestKey: randomUUID() }),
  ).rejects.toThrow("ACCESS_VERSION_CONFLICT");
  const request = { localPersonaKey: "viewer.beta", headers: {} };
  for (const project of [localSeedIds.alpha, localSeedIds.beta])
    await expect(
      authorizeLocalQaApi(source, request, workspace, project, "qa.session.execute"),
    ).resolves.toBeDefined();
  await service.replace(actor, target, workspace, {
    ...input,
    roleKeys: ["requester"],
    expectedVersion: 1,
    requestKey: randomUUID(),
  });
  await expect(
    authorizeLocalQaApi(source, request, workspace, localSeedIds.alpha, "qa.session.execute"),
  ).rejects.toThrow();
  await expect(
    authorizeLocalQaApi(source, request, workspace, localSeedIds.alpha, "qa.request.create"),
  ).resolves.toBeDefined();
  expect((await service.detail(actor, target)).history).toHaveLength(2);
});
it("keeps domain roles separate and can revoke a membership", async () => {
  const docs = "15000000-0000-4000-8000-000000000001";
  const input = {
    roleKeys: ["technical-writer"],
    classificationCeiling: "INTERNAL",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Работа с документацией",
  };
  await expect(service.replace(actor, target, workspace, input)).rejects.toThrow(
    "ACCESS_ROLE_INVALID",
  );
  await service.replace(actor, target, docs, input);
  expect(
    (await service.detail(actor, target)).memberships.filter((m) => m.state === "ACTIVE"),
  ).toHaveLength(2);
  await service.replace(actor, target, docs, {
    ...input,
    roleKeys: [],
    expectedVersion: 1,
    requestKey: randomUUID(),
  });
  expect(
    (await service.detail(actor, target)).memberships.find((m) => m.workspaceId === docs)?.state,
  ).toBe("REVOKED");
});

it("serializes competing editors and preserves DENY and external assignments", async () => {
  const principalId = localPersonaIds["executor.qa2"];
  const denyId = randomUUID(),
    externalId = randomUUID();
  await source.query(
    "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,'explicit-denial','DENY',$4,clock_timestamp()),($5,$2,$3,'external-reviewer','ALLOW',$6,clock_timestamp())",
    [
      denyId,
      workspace,
      principalId,
      JSON.stringify(["qa.session.execute"]),
      externalId,
      JSON.stringify(["external.review"]),
    ],
  );
  const before = await source.query("SELECT * FROM role_assignments WHERE id=ANY($1) ORDER BY id", [
    [denyId, externalId],
  ]);
  const input = {
    roleKeys: ["requester", "qa-executor"],
    classificationCeiling: "INTERNAL",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Конкурирующие изменения",
  };
  const results = await Promise.allSettled([
    service.replace(actor, principalId, workspace, input),
    service.replace(actor, principalId, workspace, { ...input, requestKey: randomUUID() }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    results.filter((r) => r.status === "rejected").map((r) => (r.reason as Error).message),
  ).toEqual(["ACCESS_VERSION_CONFLICT"]);
  expect(
    await source.query("SELECT * FROM role_assignments WHERE id=ANY($1) ORDER BY id", [
      [denyId, externalId],
    ]),
  ).toEqual(before);
  await expect(
    authorizeLocalQaApi(
      source,
      { localPersonaKey: "executor.qa2", headers: {} },
      workspace,
      localSeedIds.alpha,
      "qa.session.execute",
    ),
  ).rejects.toThrow();
  await expect(
    authorizeLocalQaApi(
      source,
      { localPersonaKey: "executor.qa2", headers: {} },
      workspace,
      localSeedIds.beta,
      "qa.request.create",
    ),
  ).rejects.toThrow();
  const again = { ...input, expectedVersion: 1, requestKey: randomUUID() };
  const replay = await Promise.all([
    service.replace(actor, principalId, workspace, again),
    service.replace(actor, principalId, workspace, again),
  ]);
  expect(replay[0]).toEqual(replay[1]);
  expect((await service.detail(actor, principalId)).history).toHaveLength(2);
});

it("multiple roles cannot self-approve a legacy command", async () => {
  const { LocalWalkingSkeletonController } =
    await import("../../../apps/api/src/local/local-walking-skeleton.controller.ts");
  await service.replace(actor, target, workspace, {
    roleKeys: ["qa-executor", "qa-lead"],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 2,
    requestKey: randomUUID(),
    reason: "Проверка разделения личностей",
  });
  const controller = new LocalWalkingSkeletonController(source),
    request = { localPersonaKey: "viewer.beta", headers: {} };
  const command = await controller.command(request, {
    recordKey: "019-self-review",
    message: "Self review test",
    clientRequestKey: randomUUID(),
    approvalRequired: true,
  });
  const [approval] = (await source.query("SELECT id FROM approvals WHERE action_id=$1", [
    command.id,
  ])) as { id: string }[];
  await expect(controller.approve(request, approval!.id)).rejects.toThrow(
    "APPROVAL_SELF_APPROVAL_FORBIDDEN",
  );
  const [stored] = (await source.query("SELECT decision_state FROM approvals WHERE id=$1", [
    approval!.id,
  ])) as { decision_state: string }[];
  expect(stored?.decision_state).toBe("PENDING");
});

it("forces concurrent project registration to refresh its team-role snapshot", async () => {
  const registration = source.createQueryRunner();
  await registration.connect();
  await registration.startTransaction("SERIALIZABLE");
  try {
    await registration.query("SELECT row_version FROM workspaces WHERE id=$1", [workspace]);
    await service.replace(actor, localPersonaIds["requester.alpha"], workspace, {
      roleKeys: ["requester", "qa-executor"],
      classificationCeiling: "RESTRICTED",
      expectedVersion: 0,
      requestKey: randomUUID(),
      reason: "Обновление команды при регистрации проекта",
    });
    await expect(
      registration.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspace]),
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await registration.rollbackTransaction();
    await registration.release();
  }
});

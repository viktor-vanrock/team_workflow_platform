import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { digest, validHash } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { ensureLocalSeedProjectOnboarding } from "../../../packages/runtime-composition/src/pilot/development-seed.ts";
import { PlatformAccessService } from "../../../packages/runtime-composition/src/security/platform-access.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runOwnerProjectRegistrarLocalSeed } from "../../../packages/runtime-composition/src/seed/owner-project-registrar-seed.ts";
import { runPlatformAccessLocalSeed } from "../../../packages/runtime-composition/src/seed/platform-access-seed.ts";
import { runProjectMetadataLocalSeed } from "../../../packages/runtime-composition/src/seed/project-metadata-seed.ts";
import { runTechWritingLocalSeed } from "../../../packages/runtime-composition/src/seed/tech-writing-local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let f: Awaited<ReturnType<typeof startBindingHttpFixture>>;
const owner = localPersonaIds["owner.local"];
beforeAll(async () => {
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", "https://fake-idp:4443/oidc");
  await runTechWritingLocalSeed(f.source);
  await runPlatformAccessLocalSeed(f.source, "https://fake-idp:4443/oidc");
  await new PlatformAccessService(f.source).claimLocalAdministrator(
    owner,
    "https://fake-idp:4443/oidc",
  );
  await runOwnerProjectRegistrarLocalSeed(f.source, "https://fake-idp:4443/oidc");
  await runProjectMetadataLocalSeed(f.source, "https://fake-idp:4443/oidc");
  await ensureLocalSeedProjectOnboarding(f.source, {
    ...loadEnvironment(),
    profile: "local",
    environmentScope: "LOCAL",
    externalNetworkMode: "deny",
  });
}, 120_000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
it("edits projects in each workspace with immutable history and idempotent replay", async () => {
  const projects = (await f.source.query(
    "SELECT DISTINCT ON(workspace_id) id,workspace_id FROM projects WHERE state='ACTIVE' ORDER BY workspace_id,id",
  )) as { id: string; workspace_id: string }[];
  expect(projects).toHaveLength(3);
  for (const p of projects) {
    const path = `/${p.id}/metadata`;
    const read = await f.apiRequest(
      path,
      "GET",
      undefined,
      "owner",
      undefined,
      undefined,
      p.workspace_id,
    );
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const project = read.body.project as { version: number; name: string };
    const before = await f.source.query(
      "SELECT revision_id,content_hash,semantic_body FROM project_registry_revisions WHERE project_id=$1 ORDER BY version",
      [p.id],
    );
    const key = randomUUID(),
      body = { name: project.name + " обновлён", ownerIds: [owner], reason: "Уточнение карточки" };
    const result = await f.apiRequest(
      path,
      "PUT",
      body,
      "owner",
      key,
      `"${project.version}"`,
      p.workspace_id,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const replay = await f.apiRequest(
      path,
      "PUT",
      body,
      "owner",
      key,
      `"${project.version}"`,
      p.workspace_id,
    );
    expect(replay.body).toEqual(result.body);
    const after = (await f.source.query(
      "SELECT revision_id,content_hash,semantic_body FROM project_registry_revisions WHERE project_id=$1 ORDER BY version",
      [p.id],
    )) as { semantic_body: { contentHash: string; ownerIds: string[] } }[];
    expect(after.slice(0, -1)).toEqual(before);
    expect(validHash(after.at(-1)!.semantic_body)).toBe(true);
    expect(after.at(-1)!.semantic_body.ownerIds).toEqual([owner]);
    expect(
      (await f.apiRequest(path, "GET", undefined, "owner", undefined, undefined, p.workspace_id))
        .body,
    ).toMatchObject({
      project: { name: body.name, version: project.version + 1 },
      history: expect.arrayContaining([
        expect.objectContaining({ reason: body.reason, actorName: expect.any(String) }),
        expect.anything(),
      ]),
    });
    expect(
      (
        await f.source.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE project_id=$1 AND action='PROJECT_METADATA_UPDATED'",
          [p.id],
        )
      )[0].n,
    ).toBe(1);
    expect(
      (
        await f.apiRequest(
          path,
          "PUT",
          body,
          "owner",
          randomUUID(),
          `"${project.version}"`,
          p.workspace_id,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.apiRequest(
          path,
          "PUT",
          { ...body, name: "other" },
          "owner",
          key,
          `"${project.version}"`,
          p.workspace_id,
        )
      ).status,
    ).toBe(409);
  }
});
it("rejects missing MFA, other roles, foreign owners and immutable input", async () => {
  const path = `/${f.scope.projectId}/metadata`;
  const read = await f.apiRequest(path);
  expect(read.status).toBe(200);
  const version = (read.body.project as { version: number }).version;
  const body = { name: "Несохранённое имя", ownerIds: [owner], reason: "Тест доступа" };
  const before = digest(
    await f.source.query("SELECT * FROM project_registry_revisions ORDER BY revision_id"),
  );
  for (const token of ["executor", "lead", "no-mfa"])
    expect(
      (await f.apiRequest(path, "PUT", body, token, randomUUID(), `"${version}"`)).status,
    ).toBe(token === "no-mfa" ? 403 : 404);
  expect(
    (
      await f.apiRequest(
        path,
        "PUT",
        { ...body, ownerIds: ["15000000-0000-4000-8000-000000000003"] },
        "owner",
        randomUUID(),
        `"${version}"`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.apiRequest(
        path,
        "PUT",
        { ...body, key: "CHANGED" },
        "owner",
        randomUUID(),
        `"${version}"`,
      )
    ).status,
  ).toBe(400);
  expect(
    digest(await f.source.query("SELECT * FROM project_registry_revisions ORDER BY revision_id")),
  ).toBe(before);
});
it("updates suspended metadata without resuming work and serializes competing editors", async () => {
  const [p] = (await f.source.query(
    "SELECT id,workspace_id FROM projects WHERE state='SUSPENDED' ORDER BY id LIMIT 1",
  )) as { id: string; workspace_id: string }[];
  const path = `/${p!.id}/metadata`,
    workspace = p!.workspace_id;
  const read = await f.apiRequest(path, "GET", undefined, "owner", undefined, undefined, workspace);
  const version = (read.body.project as { version: number }).version;
  const [before] = (await f.source.query(
    "SELECT r.semantic_body FROM project_onboarding_headers h JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.version=h.current_version WHERE h.project_id=$1",
    [p!.id],
  )) as { semantic_body: Record<string, unknown> }[];
  const results = await Promise.all(
    ["Название A", "Название B"].map((name) =>
      f.apiRequest(
        path,
        "PUT",
        { name, ownerIds: [owner], reason: "Параллельное уточнение" },
        "owner",
        randomUUID(),
        `"${version}"`,
        workspace,
      ),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const [after] = (await f.source.query(
    "SELECT r.semantic_body FROM project_onboarding_headers h JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.version=h.current_version WHERE h.project_id=$1",
    [p!.id],
  )) as { semantic_body: Record<string, unknown> }[];
  for (const field of [
    "stage",
    "qaCapabilityMode",
    "operationalState",
    "incidentRef",
    "bindingRef",
    "qaProjectContextRef",
  ])
    expect(after!.semantic_body[field]).toEqual(before!.semantic_body[field]);
  expect(after!.semantic_body.gateResultRefs).toEqual([]);
  expect(after!.semantic_body.projectRegistryRef).not.toEqual(
    before!.semantic_body.projectRegistryRef,
  );
  const onboarding = await f.apiRequest(
    `/${p!.id}/onboarding`,
    "GET",
    undefined,
    "owner",
    undefined,
    undefined,
    workspace,
  );
  expect(onboarding.status).toBe(200);
  expect(after!.semantic_body.operationalState).toBe("SUSPENDED");
});
it("admin2 edits only its workspace and invalidates replay after authority revocation", async () => {
  const path = `/${f.scope.projectId}/metadata`;
  const read = await f.apiRequest(path, "GET", undefined, "admin");
  expect(read.status).toBe(200);
  const version = (read.body.project as { version: number }).version,
    key = randomUUID();
  const body = { name: "Карточка администратора 2", ownerIds: [owner], reason: "Уточнение" };
  expect((await f.apiRequest(path, "PUT", body, "admin", key, `"${version}"`)).status).toBe(200);
  const docs = "15000000-0000-4000-8000-000000000001",
    project = "15000000-0000-4000-8000-000000000002";
  expect(
    (
      await f.apiRequest(
        `/${project}/metadata`,
        "GET",
        undefined,
        "admin",
        undefined,
        undefined,
        docs,
      )
    ).status,
  ).toBe(404);
  await f.source.query(
    "UPDATE project_entitlements SET revoked_at=clock_timestamp(),row_version=row_version+1 WHERE principal_id=$1 AND project_id=$2",
    [localPersonaIds["integration-admin.alpha"], f.scope.projectId],
  );
  expect((await f.apiRequest(path, "PUT", body, "admin", key, `"${version}"`)).status).toBe(404);
});
it("one-time permission upgrade preserves revoked grants, other roles, scope, expiry and history", async () => {
  // Reconstruct the pre-feature permission catalog; revocation from the previous test stays present.
  await f.source.query(
    "UPDATE role_assignments SET permissions=permissions - 'project.metadata.update' WHERE role_key IN('system-administrator','project-registrar')",
  );
  await f.source.query(
    "UPDATE project_entitlements SET permissions=permissions - 'project.metadata.update'",
  );
  await f.source.query(
    "DELETE FROM local_seed_markers WHERE key='022-project-metadata-permission'",
  );
  const untouched = () =>
    f.source.query(
      "SELECT * FROM project_entitlements WHERE principal_id NOT IN($1,$2) OR revoked_at IS NOT NULL OR effect='DENY' ORDER BY id",
      [owner, localPersonaIds["integration-admin.alpha"]],
    );
  const beforeUntouched = await untouched();
  const beforeRoles = await f.source.query(
    "SELECT * FROM role_assignments WHERE role_key NOT IN('system-administrator','project-registrar') OR revoked_at IS NOT NULL OR effect='DENY' ORDER BY id",
  );
  const stable = () =>
    f.source.query(
      "SELECT id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,valid_from,valid_until,revoked_at,created_at FROM project_entitlements ORDER BY id",
    );
  const beforeStable = await stable();
  const history = await f.source.query(
    "SELECT revision_id,content_hash FROM project_entitlement_revisions ORDER BY revision_id",
  );
  await runProjectMetadataLocalSeed(f.source, "https://fake-idp:4443/oidc");
  expect(await untouched()).toEqual(beforeUntouched);
  expect(await stable()).toEqual(beforeStable);
  expect(
    await f.source.query(
      "SELECT * FROM role_assignments WHERE role_key NOT IN('system-administrator','project-registrar') OR revoked_at IS NOT NULL OR effect='DENY' ORDER BY id",
    ),
  ).toEqual(beforeRoles);
  expect(
    await f.source.query(
      "SELECT revision_id,content_hash FROM project_entitlement_revisions ORDER BY revision_id",
    ),
  ).toEqual(expect.arrayContaining(history));
  const state = (await f.source.query("SELECT * FROM project_entitlements ORDER BY id")) as {
    principal_id: string;
    permissions: string[];
  }[];
  expect(
    state.some(
      (r: { principal_id: string; permissions: string[] }) =>
        r.principal_id === owner && r.permissions.includes("project.metadata.update"),
    ),
  ).toBe(true);
  await runProjectMetadataLocalSeed(f.source, "https://fake-idp:4443/oidc");
  expect(await f.source.query("SELECT * FROM project_entitlements ORDER BY id")).toEqual(state);
  expect(
    (await f.apiRequest(`/${f.scope.projectId}/metadata`, "GET", undefined, "admin")).status,
  ).toBe(404);
});

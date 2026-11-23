import { afterAll, beforeAll, expect, it } from "vitest";

import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runPlatformAccessLocalSeed } from "../../../packages/runtime-composition/src/seed/platform-access-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let f: Awaited<ReturnType<typeof startBindingHttpFixture>>;
beforeAll(async () => {
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!, "SHADOW", {
    globalProblemFilter: true,
  });
  await runPlatformAccessLocalSeed(f.source, "https://fake-idp:4443/oidc");
}, 120_000);
afterAll(async () => {
  await f?.close();
});
const input = (key: string) => ({
  key,
  name: "Новый проект общей команды",
  ownerIds: Object.fromEntries(
    ["business", "technical", "qa", "security", "escalation"].map((key) => [
      key,
      localPersonaIds["owner.local"],
    ]),
  ),
  criticalityKey: "STANDARD",
  dataClassificationKey: "INTERNAL",
  reason: "Создание через интерфейс",
});
it("reads named owners without MFA, limits them to active humans and denies nonadmins", async () => {
  const options = await f.apiRequest("/registration-options", "GET", undefined, "no-mfa");
  expect(options, f.errors.join("; ")).toMatchObject({ status: 200, body: { schemaVersion: 1 } });
  const owners = options.body.owners as { id: string; displayName: string }[];
  expect(owners.map((o) => o.id)).toContain(localPersonaIds["executor.qa2"]);
  expect(owners.every((o) => o.displayName.length > 0)).toBe(true);
  expect(owners.map((o) => o.id)).not.toContain(localPersonaIds["worker.local"]);
  expect(owners.map((o) => o.id)).not.toContain(localPersonaIds["limited.alpha"]);
  for (const persona of ["executor", "lead"])
    expect((await f.apiRequest("/registration-options", "GET", undefined, persona)).status).toBe(
      404,
    );
});
it("registers a draft once with team access, explains duplicate key and requires MFA", async () => {
  expect(
    (await f.apiRequest("", "POST", input("UINOMFA"), "no-mfa", "ui-project-no-mfa")).body.code,
  ).toBe("STEP_UP_REQUIRED");
  const created = await f.apiRequest("", "POST", input("UICREATE"), "owner", "ui-project-create");
  expect(created, f.errors.join("; ")).toMatchObject({
    status: 201,
    body: { projectId: expect.any(String) },
  });
  expect(await f.apiRequest("", "POST", input("UICREATE"), "owner", "ui-project-create")).toEqual(
    created,
  );
  expect(
    (await f.apiRequest("", "POST", input("UICREATE"), "owner", "ui-project-duplicate")).body.code,
  ).toBe("PROJECT_KEY_CONFLICT");
  const grants = await f.source.query(
    "SELECT DISTINCT principal_id FROM project_entitlements WHERE project_id=$1 AND principal_id=ANY($2) AND revoked_at IS NULL ORDER BY principal_id",
    [created.body.projectId, [localPersonaIds["executor.alpha"], localPersonaIds["executor.qa2"]]],
  );
  expect(grants).toHaveLength(2);
});
it("rejects expired owners and live workspace-role revocation despite platform bootstrap", async () => {
  const original = input("BADOWNER");
  const body = {
    ...original,
    ownerIds: { ...original.ownerIds, qa: localPersonaIds["limited.alpha"] },
  };
  expect(
    (await f.apiRequest("", "POST", body, "owner", "ui-project-invalid-owner")).body.code,
  ).toBe("ACTIVE_WORKSPACE_MEMBER_REQUIRED");
  await f.source.query(
    "UPDATE role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND role_key='system-administrator'",
    [localPersonaIds["owner.local"]],
  );
  expect((await f.apiRequest("/registration-options", "GET", undefined, "owner")).status).toBe(404);
  expect(
    (await f.apiRequest("", "POST", input("GLOBALONLY"), "owner", "ui-global-only")).status,
  ).toBe(404);
});

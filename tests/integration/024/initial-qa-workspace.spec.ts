import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import type { INestApplication } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { WorkspaceInstallationModule } from "../../../apps/api/src/workspace/workspace.module.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { ProblemDetailsFilter } from "../../../packages/platform-runtime-nest/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { prepareQaWorkspace } from "../../../packages/runtime-composition/src/bootstrap/qa-workspace.ts";
import { workspaceInstallationReadiness } from "../../../packages/runtime-composition/src/bootstrap/workspace-installation.ts";
import { runtimePersistence } from "../../../packages/runtime-composition/src/pilot/composition.ts";
import { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import { createCorporateSessionBindings } from "../../../packages/runtime-composition/src/security/corporate-session-bindings.ts";
import { startOidcFixture } from "../../support/008-oidc-fixture.ts";

let fixture: Awaited<ReturnType<typeof startOidcFixture>>,
  postgres: RunningPostgres,
  source: ReturnType<typeof createPlatformDataSource>,
  runtimeSource: ReturnType<typeof createPlatformDataSource>,
  app: INestApplication,
  origin: string;
let workspaceId: string, adminId: string, adminCookie: string, adminCsrf: string, projectId: string;
const request = (cookie?: string, csrf?: string, body?: unknown) => ({
  headers: {
    origin,
    ...(cookie ? { cookie } : {}),
    ...(csrf ? { "x-csrf-token": csrf } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  fixture = await startOidcFixture();
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: runtimePersistence("qa-jira-gitlab-mattermost-test").entities,
    migrations: runtimePersistence("qa-jira-gitlab-mattermost-test").migrations,
  });
  await source.initialize();
  await source.query(`CREATE ROLE qa_fixture_migrator LOGIN PASSWORD 'fixture-migrator';
    CREATE ROLE qa_fixture_runtime LOGIN PASSWORD 'fixture-runtime';
    GRANT USAGE,CREATE ON SCHEMA public TO qa_fixture_migrator;
    GRANT USAGE ON SCHEMA public TO qa_fixture_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE qa_fixture_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO qa_fixture_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE qa_fixture_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO qa_fixture_runtime;`);
  await source.destroy();
  const url = new URL(postgres.url);
  url.username = "qa_fixture_migrator";
  url.password = "fixture-migrator";
  source = createPlatformDataSource({
    url: url.href,
    ...runtimePersistence("qa-jira-gitlab-mattermost-test"),
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  url.username = "qa_fixture_runtime";
  url.password = "fixture-runtime";
  runtimeSource = createPlatformDataSource({
    url: url.href,
    ...runtimePersistence("qa-jira-gitlab-mattermost-test"),
  });
  await runtimeSource.initialize();
  expect((await workspaceInstallationReadiness(source)).ready).toBe(false);
  const installed = await Promise.all([prepareQaWorkspace(source), prepareQaWorkspace(source)]);
  expect(installed[0]).toBe(installed[1]);
  workspaceId = installed[0]!;
  // Obtain a bound port before composing the exact session origin.
  const { createServer } = await import("node:net");
  const portServer = createServer();
  await new Promise<void>((resolve) => {
    portServer.listen(0, "127.0.0.1", resolve);
  });
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolve) => {
    portServer.close(() => resolve());
  });
  origin = `http://127.0.0.1:${port}`;
  const ref = {
    id: "024-corporate-policy",
    version: 1,
    contentHash: `sha256:${"a".repeat(64)}` as const,
  };
  const key = randomBytes(32);
  const bindings = createCorporateSessionBindings({
    source: runtimeSource,
    groups: { ref, issuer: fixture.origin, mappings: [] },
    tokens: {
      issuer: fixture.origin,
      audience: "awp-api",
      jwksUri: `${fixture.origin}/jwks`,
      algorithms: ["EdDSA"],
      mode: "LOCAL_FIXTURE",
      discriminator: { kind: "RFC9068" },
      allowedClientIds: ["awp-browser"],
      clockToleranceSeconds: 2,
      maximumTokenAgeSeconds: 300,
      maximumTokenLifetimeSeconds: 600,
      keyCacheMs: 60000,
      deadlineMs: 1000,
      maximumResponseBytes: 16384,
      groupsClaim: "groups",
    },
    session: {
      policyRef: ref,
      namespace: "024-test",
      browserOrigin: origin,
      authorizationEndpoint: `${fixture.origin}/authorize`,
      tokenEndpoint: `${fixture.origin}/token`,
      callbackUrl: `${origin}/api/v1/auth/callback`,
      clientId: "awp-browser",
      scopes: ["openid", "profile"],
      returnPaths: ["/access", "/admin/users", "/projects", "/projects/new"],
      loginLifetimeMs: 120000,
      sessionLifetimeMs: 300000,
      stepUp: { acrValues: ["urn:fixture:mfa"], amrValues: ["otp"], maximumAgeSeconds: 60 },
    },
    encryptionKeyId: "key",
    encryptionKeys: { withKey: async (_id, use) => use(key) },
    network: new PinnedNetworkTransport({
      ref: { ...ref, id: "024-network" },
      mode: "LOCAL_FIXTURE",
      validUntil: new Date(Date.now() + 300_000).toISOString(),
      deadlineMs: 1000,
      maximumRequestBytes: 16384,
      maximumResponseBytes: 16384,
      endpoints: [
        {
          origin: fixture.origin,
          addressRanges: ["127.0.0.1/32"],
          routes: [
            { path: "/jwks", match: "EXACT", methods: ["GET"], queryKeys: [] },
            { path: "/token", match: "EXACT", methods: ["POST"], queryKeys: [] },
          ],
        },
      ],
    }),
    clientAuthentication: { authorizeTokenRequest: async () => ({ headers: {}, form: {} }) },
  });
  app = await NestFactory.create(
    WorkspaceInstallationModule.register(runtimeSource, bindings.sessions),
    {
      logger: false,
    },
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(port, "127.0.0.1");
}, 120000);
afterAll(async () => {
  await app?.close();
  if (runtimeSource?.isInitialized) await runtimeSource.destroy();
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
  await fixture?.stop();
});
async function login(
  subject: string,
  groups: string[] = [],
  step?: { cookie: string; csrf: string },
) {
  fixture.state.subject = subject;
  fixture.state.groups = groups;
  fixture.state.accessOverrides = { name: `Имя ${subject}`, preferred_username: subject };
  const begin = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    ...request(step?.cookie, step?.csrf, {
      returnPath: "/access",
      ...(step ? { stepUp: true } : {}),
    }),
  });
  expect(begin.status).toBe(200);
  const body = (await begin.json()) as { authorizationUrl: string };
  const auth = await fetch(body.authorizationUrl, { redirect: "manual" });
  const callback = await fetch(auth.headers.get("location")!, {
    redirect: "manual",
    headers: { cookie: begin.headers.getSetCookie()[0]!.split(";")[0]! },
  });
  if (callback.status !== 303)
    return { status: callback.status, cookie: "", csrfToken: "", principalId: "" };
  const cookie = callback.headers
    .getSetCookie()
    .find((c) => c.startsWith("awp-session="))!
    .split(";")[0]!;
  const session = await fetch(`${origin}/api/v1/auth/session`, request(cookie));
  const value = (await session.json()) as { csrfToken: string; principalId: string };
  return { status: callback.status, cookie, ...value };
}

it("initializes exactly one QA workspace with its work type and no demo data", async () => {
  expect(await source.query("SELECT key,name,state FROM workspaces")).toEqual([
    { key: "qa", name: "QA", state: "ACTIVE" },
  ]);
  expect(await source.query("SELECT work_type_key,intake_state FROM workspace_work_types")).toEqual(
    [{ work_type_key: "qa.validation", intake_state: "ENABLED" }],
  );
  expect(await source.query("SELECT id FROM projects")).toHaveLength(0);
  expect(await source.query("SELECT id FROM identities WHERE kind='HUMAN'")).toHaveLength(0);
  expect(await source.query("SELECT id FROM workspace_memberships")).toHaveLength(0);
  expect(await source.query("SELECT id FROM project_integration_binding_headers")).toHaveLength(0);
  expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
  await expect(runtimeSource.query("CREATE TABLE forbidden_ddl(id int)")).rejects.toThrow();
  expect((await fetch(`${origin}/api/v1/auth/local/personas`)).status).toBe(404);
  expect((await fetch(`${origin}/api/v1/workspaces/${workspaceId}/projects`)).status).toBe(401);
});
it("rejects invalid identity before any administrator or membership is created", async () => {
  fixture.state.idOverrides = { nonce: "wrong-nonce" };
  expect((await login("invalid")).status).toBe(401);
  fixture.state.idOverrides = {};
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(0);
  expect(await source.query("SELECT * FROM qa_workspace_administrator_bootstrap")).toHaveLength(0);
});
it("rolls back identity and both administrator grants when workspace audit fails", async () => {
  await source.query(
    "ALTER TABLE platform_access_changes ADD CONSTRAINT test_deny_bootstrap CHECK (false) NOT VALID",
  );
  expect((await login("rollback")).status).not.toBe(303);
  await source.query("ALTER TABLE platform_access_changes DROP CONSTRAINT test_deny_bootstrap");
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(0);
  expect(await source.query("SELECT * FROM workspace_memberships")).toHaveLength(0);
  expect(await source.query("SELECT * FROM identities WHERE kind='HUMAN'")).toHaveLength(0);
});
it("first verified login can administer users and prepare projects in QA", async () => {
  const user = await login("qa-admin");
  expect(user.status).toBe(303);
  adminId = user.principalId;
  adminCookie = user.cookie;
  adminCsrf = user.csrfToken;
  const own = await fetch(`${origin}/api/v1/access/me`, request(adminCookie));
  expect(await own.json()).toMatchObject({
    status: "ACTIVE",
    memberships: [expect.objectContaining({ workspaceId, roleKeys: ["system-administrator"] })],
    platformPermissions: ["platform.users.read", "platform.workspace-roles.manage"],
  });
  const catalog = await fetch(
    `${origin}/api/v1/workspaces/${workspaceId}/projects`,
    request(adminCookie),
  );
  expect(catalog.status).toBe(200);
  expect(await catalog.json()).toMatchObject({ items: [] });
  const options = await fetch(
    `${origin}/api/v1/workspaces/${workspaceId}/projects/registration-options`,
    request(adminCookie),
  );
  expect(options.status).toBe(200);
  expect(await options.json()).toMatchObject({
    owners: [expect.objectContaining({ id: adminId })],
  });
  expect(
    await source.query("SELECT principal_id FROM qa_workspace_administrator_bootstrap"),
  ).toEqual([{ principal_id: adminId }]);
});
it("requires CSRF and step-up, then creates one draft project despite retry", async () => {
  const url = `${origin}/api/v1/workspaces/${workspaceId}/projects`;
  const body = {
    key: "FIRST",
    name: "Первый проект",
    ownerIds: Object.fromEntries(
      ["business", "technical", "qa", "security", "escalation"].map((k) => [k, adminId]),
    ),
    criticalityKey: "STANDARD",
    dataClassificationKey: "INTERNAL",
    reason: "Начальная регистрация проекта",
  };
  const key = randomUUID();
  const post = (csrf?: string) => {
    const r = request(adminCookie, csrf, body);
    return fetch(url, { method: "POST", ...r, headers: { ...r.headers, "idempotency-key": key } });
  };
  expect((await post()).status).toBe(403);
  const noStep = await post(adminCsrf);
  expect(noStep.status).toBe(403);
  expect(JSON.stringify(await noStep.json())).toContain("STEP_UP_REQUIRED");
  const stepped = await login("qa-admin", [], { cookie: adminCookie, csrf: adminCsrf });
  expect(stepped.status).toBe(303);
  adminCookie = stepped.cookie;
  adminCsrf = stepped.csrfToken;
  const created = await post(adminCsrf);
  const value = await created.json();
  expect(created.status, JSON.stringify(value)).toBe(201);
  expect((await post(adminCsrf)).status).toBe(201);
  const projects = (await source.query("SELECT id,key,name FROM projects")) as {
    id: string;
    key: string;
    name: string;
  }[];
  expect(projects).toHaveLength(1);
  projectId = projects[0]!.id;
  const catalog = await fetch(url, request(adminCookie));
  expect(await catalog.json()).toMatchObject({
    items: [
      expect.objectContaining({
        id: projectId,
        key: "FIRST",
        stage: "DRAFT",
        capabilityMode: "MANUAL_ONLY",
      }),
    ],
  });
});
it("edits metadata with optimistic concurrency and preserves admission status", async () => {
  const url = `${origin}/api/v1/workspaces/${workspaceId}/projects/${projectId}/metadata`;
  const current = await fetch(url, request(adminCookie));
  expect(current.status).toBe(200);
  const r = request(adminCookie, adminCsrf, {
    name: "Проект QA",
    ownerIds: [adminId],
    reason: "Уточнение названия",
  });
  const update = await fetch(url, {
    method: "PUT",
    ...r,
    headers: {
      ...r.headers,
      "idempotency-key": randomUUID(),
      "if-match": current.headers.get("etag")!,
    },
  });
  const result = await update.json();
  expect(update.status, JSON.stringify(result)).toBe(200);
  expect(result).toMatchObject({ status: "APPLIED", version: 2 });
  const stale = await fetch(url, {
    method: "PUT",
    ...r,
    headers: {
      ...r.headers,
      "idempotency-key": randomUUID(),
      "if-match": current.headers.get("etag")!,
    },
  });
  expect(stale.status).toBe(409);
});
it("later users remain pending and cannot register projects", async () => {
  const user = await login("second");
  expect(user.status).toBe(303);
  const own = await fetch(`${origin}/api/v1/access/me`, request(user.cookie));
  expect(await own.json()).toMatchObject({ status: "PENDING", memberships: [] });
  expect(
    (
      await fetch(
        `${origin}/api/v1/workspaces/${workspaceId}/projects/registration-options`,
        request(user.cookie),
      )
    ).status,
  ).toBe(404);
  expect(
    await source.query("SELECT principal_id FROM qa_workspace_administrator_bootstrap"),
  ).toEqual([{ principal_id: adminId }]);
});
it("administrator grants a colleague access to QA and the existing project", async () => {
  const colleague = await login("second");
  const body = {
    roleKeys: ["project-registrar"],
    requesterProjectIds: [],
    classificationCeiling: "INTERNAL",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Регистрация проектов QA",
  };
  const response = await fetch(
    `${origin}/api/v1/access/users/${colleague.principalId}/workspaces/${workspaceId}`,
    { method: "PUT", ...request(adminCookie, adminCsrf, body) },
  );
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  const options = await fetch(
    `${origin}/api/v1/workspaces/${workspaceId}/projects/registration-options`,
    request(colleague.cookie),
  );
  expect(options.status).toBe(200);
  expect(await options.json()).toMatchObject({
    owners: expect.arrayContaining([expect.objectContaining({ id: colleague.principalId })]),
  });
  const catalog = await fetch(
    `${origin}/api/v1/workspaces/${workspaceId}/projects`,
    request(colleague.cookie),
  );
  expect(await catalog.json()).toMatchObject({
    items: [expect.objectContaining({ id: projectId })],
  });
});
it("restart and login never recreate revoked access or overwrite projects", async () => {
  await source.query(
    "UPDATE workspace_memberships SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [adminId],
  );
  await source.query(
    "UPDATE role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [adminId],
  );
  expect(await prepareQaWorkspace(source)).toBe(workspaceId);
  expect((await login("qa-admin")).status).toBe(303);
  expect(
    await source.query(
      "SELECT id FROM workspace_memberships WHERE principal_id=$1 AND revoked_at IS NULL",
      [adminId],
    ),
  ).toHaveLength(0);
  expect(
    await source.query(
      "SELECT id FROM role_assignments WHERE principal_id=$1 AND revoked_at IS NULL",
      [adminId],
    ),
  ).toHaveLength(0);
  expect(await source.query("SELECT name FROM projects")).toEqual([{ name: "Проект QA" }]);
  await source.query(
    "UPDATE workspace_work_types SET intake_state='DISABLED' WHERE workspace_id=$1",
    [workspaceId],
  );
  expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
});

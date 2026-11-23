import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import type { INestApplication } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { CorporateAccessModule } from "../../../apps/api/src/access/access.module.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  PinnedOidcTokenVerifier,
  ProblemDetailsFilter,
} from "../../../packages/platform-runtime-nest/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import type { CorporateIdentityService } from "../../../packages/runtime-composition/src/security/corporate-identity.ts";
import { createCorporateSessionBindings } from "../../../packages/runtime-composition/src/security/corporate-session-bindings.ts";
import {
  localSeedIds,
  runLocalSeed,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { startOidcFixture } from "../../support/008-oidc-fixture.ts";

let fixture: Awaited<ReturnType<typeof startOidcFixture>>,
  postgres: RunningPostgres,
  source: ReturnType<typeof createPlatformDataSource>,
  app: INestApplication,
  origin: string,
  identities: CorporateIdentityService;
let pendingId: string, adminId: string, adminCookie: string, adminCsrf: string;
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
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runLocalSeed(source);
  await runQaLocalSeed(source);
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
    id: "019-corporate-policy",
    version: 1,
    contentHash: `sha256:${"a".repeat(64)}` as const,
  };
  const key = randomBytes(32);
  const bindings = createCorporateSessionBindings({
    source,
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
      namespace: "019-test",
      browserOrigin: origin,
      authorizationEndpoint: `${fixture.origin}/authorize`,
      tokenEndpoint: `${fixture.origin}/token`,
      callbackUrl: `${origin}/api/v1/auth/callback`,
      clientId: "awp-browser",
      scopes: ["openid", "profile"],
      returnPaths: ["/access", "/admin/users"],
      loginLifetimeMs: 120000,
      sessionLifetimeMs: 300000,
      stepUp: { acrValues: ["urn:fixture:mfa"], amrValues: ["otp"], maximumAgeSeconds: 60 },
    },
    encryptionKeyId: "key",
    encryptionKeys: { withKey: async (_id, use) => use(key) },
    network: new PinnedNetworkTransport({
      ref: { ...ref, id: "019-network" },
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
  identities = bindings.identities;
  app = await NestFactory.create(CorporateAccessModule.register(source, bindings.sessions), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(port, "127.0.0.1");
}, 120000);
afterAll(async () => {
  await app?.close();
  await source?.destroy();
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
it("invalid tokens and nonce cannot claim the initial administrator", async () => {
  fixture.state.idOverrides = { nonce: "wrong-nonce" };
  expect((await login("invalid-id-token")).status).toBe(401);
  fixture.state.idOverrides = {};
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(0);
  expect(
    await source.query("SELECT * FROM identities WHERE subject='invalid-id-token'"),
  ).toHaveLength(0);
});
it("first verified corporate login claims administration without groups or workspace grants", async () => {
  const user = await login("admin");
  expect(user.status).toBe(303);
  adminId = user.principalId;
  adminCookie = user.cookie;
  adminCsrf = user.csrfToken;
  const own = await fetch(`${origin}/api/v1/access/me`, request(adminCookie));
  expect(await own.json()).toMatchObject({
    status: "ACTIVE",
    memberships: [],
    platformPermissions: ["platform.users.read", "platform.workspace-roles.manage"],
  });
  const directory = await fetch(`${origin}/api/v1/access/users`, request(adminCookie));
  expect(await directory.json()).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({ principalId: adminId, status: "ACTIVE" }),
    ]),
  });
  expect(
    await source.query("SELECT principal_id,source FROM platform_administrator_bootstrap"),
  ).toEqual([{ principal_id: adminId, source: "CORPORATE_FIRST_LOGIN" }]);
});
it("subsequent login with the same claims registers a pending person without grants", async () => {
  const user = await login("pending");
  expect(user.status).toBe(303);
  pendingId = user.principalId;
  const response = await fetch(`${origin}/api/v1/access/me`, request(user.cookie));
  expect(response.status).toBe(200);
  const own = (await response.json()) as {
    status: string;
    memberships: unknown[];
    displayName: string;
  };
  expect(own).toMatchObject({ status: "PENDING", displayName: "Имя pending", memberships: [] });
  expect(
    (await source.query("SELECT * FROM role_assignments WHERE principal_id=$1", [pendingId]))
      .length,
  ).toBe(0);
  expect((await fetch(`${origin}/api/v1/access/users`, request(user.cookie))).status).toBe(403);
});
it("platform-only admin sees the directory but cannot read business data; mutations require CSRF and step-up", async () => {
  const user = await login("admin");
  adminId = user.principalId;
  adminCookie = user.cookie;
  adminCsrf = user.csrfToken;
  expect((await fetch(`${origin}/api/v1/access/users`, request(adminCookie))).status).toBe(200);
  const evidence = await new PinnedOidcTokenVerifier(
    {
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
    { authorizeEndpoint: async () => true },
  ).verifyAccessToken(fixture.token());
  await expect(
    identities.authorize(evidence, {
      scope: {
        kind: "PROJECT",
        workspaceId: localSeedIds.workspaceFunctional,
        projectId: localSeedIds.alpha,
      },
      permission: "work-item.read",
      operationClass: "READ",
    }),
  ).rejects.toThrow();
  const body = {
    roleKeys: ["requester", "qa-executor"],
    requesterProjectIds: [localSeedIds.beta],
    classificationCeiling: "RESTRICTED",
    expectedVersion: 0,
    requestKey: randomUUID(),
    reason: "Назначение QA после корпоративного входа",
  };
  const path = `${origin}/api/v1/access/users/${pendingId}/workspaces/${localSeedIds.workspaceFunctional}`;
  expect(
    (await fetch(path, { method: "PUT", ...request(adminCookie, undefined, body) })).status,
  ).toBe(403);
  expect(
    (await fetch(path, { method: "PUT", ...request(adminCookie, adminCsrf, body) })).status,
  ).toBe(403);
  const stepped = await login("admin", [], {
    cookie: adminCookie,
    csrf: adminCsrf,
  });
  adminCookie = stepped.cookie;
  adminCsrf = stepped.csrfToken;
  const result = await fetch(path, { method: "PUT", ...request(adminCookie, adminCsrf, body) });
  expect(result.status).toBe(200);
  const replay = await fetch(path, { method: "PUT", ...request(adminCookie, adminCsrf, body) });
  expect(replay.status).toBe(200);
  const differentOrigin = await fetch(path, {
    method: "PUT",
    ...request(adminCookie, adminCsrf, { ...body, requestKey: randomUUID() }),
    headers: {
      ...request(adminCookie, adminCsrf, body).headers,
      origin: "https://attacker.invalid",
    },
  });
  expect(differentOrigin.status).toBe(403);
});
it("granted roles work on existing and new login; revoking global role survives subsequent login", async () => {
  const user = await login("pending");
  expect(user.principalId).toBe(pendingId);
  const evidence = {
    issuer: fixture.origin,
    subject: "pending",
    tokenId: "verified-fixture",
    clientId: "awp-browser",
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 100,
    groups: [],
    amr: [],
  };
  for (const permission of ["qa.request.create", "qa.session.execute"])
    await expect(
      identities.authorize(evidence, {
        scope: {
          kind: "PROJECT",
          workspaceId: localSeedIds.workspaceFunctional,
          projectId: localSeedIds.beta,
        },
        permission,
        operationClass: "MUTATE",
      }),
    ).resolves.toBeDefined();
  const businessRequest = {
    scope: {
      kind: "PROJECT" as const,
      workspaceId: localSeedIds.workspaceFunctional,
      projectId: localSeedIds.beta,
    },
    permission: "qa.session.execute",
    operationClass: "MUTATE" as const,
  };
  const denyId = randomUUID();
  await source.query(
    "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,'explicit-denial','DENY','[\"qa.session.execute\"]',clock_timestamp())",
    [denyId, localSeedIds.workspaceFunctional, pendingId],
  );
  await expect(identities.authorize(evidence, businessRequest)).rejects.toThrow(
    "PROJECT_RESOURCE_NOT_AVAILABLE",
  );
  await source.query("UPDATE role_assignments SET revoked_at=clock_timestamp() WHERE id=$1", [
    denyId,
  ]);
  await expect(
    identities.authorize(evidence, {
      ...businessRequest,
      scope: { ...businessRequest.scope, workspaceId: localSeedIds.workspaceIsolated },
    }),
  ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
  await source.query(
    "UPDATE workspace_memberships SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [pendingId],
  );
  await expect(identities.authorize(evidence, businessRequest)).rejects.toThrow(
    "PROJECT_RESOURCE_NOT_AVAILABLE",
  );
  await source.query(
    "UPDATE platform_role_assignments SET revoked_at=clock_timestamp() WHERE principal_id=$1",
    [adminId],
  );
  expect((await fetch(`${origin}/api/v1/access/users`, request(adminCookie))).status).toBe(403);
  const again = await login("admin");
  expect((await fetch(`${origin}/api/v1/access/users`, request(again.cookie))).status).toBe(403);
  const later = await login("later", ["platform-admins"]);
  expect((await fetch(`${origin}/api/v1/access/users`, request(later.cookie))).status).toBe(403);
  expect(await source.query("SELECT * FROM platform_administrator_bootstrap")).toHaveLength(1);
});
it("invalid issuer cannot register identities", async () => {
  const evidence = {
    issuer: "https://wrong.invalid",
    subject: "forged",
    tokenId: "x",
    clientId: "awp-browser",
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 100,
    groups: ["platform-admins"],
    amr: [],
  };
  await expect(identities.completeVerifiedLogin(evidence)).rejects.toThrow(
    "CORPORATE_IDENTITY_DENIED",
  );
  expect(await source.query("SELECT id FROM identities WHERE subject='forged'")).toHaveLength(0);
});

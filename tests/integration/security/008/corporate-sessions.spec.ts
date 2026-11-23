import { createHash, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CorporateSessionPolicy,
  CorporateSessionService,
  type CorporateSessionStore,
} from "../../../../packages/platform-runtime-nest/src/auth/corporate-session.service.ts";
import {
  type PinnedOidcPolicy,
  PinnedOidcTokenVerifier,
} from "../../../../packages/platform-runtime-nest/src/auth/pinned-oidc-verifier.ts";
import { AesGcmSessionStateCodec } from "../../../../packages/platform-runtime-nest/src/auth/session-state-codec.ts";
import { startOidcFixture } from "../../../support/008-oidc-fixture.ts";

describe("008 server-side code/PKCE sessions", () => {
  let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
  let policy: CorporateSessionPolicy;
  let tokenPolicy: PinnedOidcPolicy;
  let service: CorporateSessionService;
  let revoked: boolean;
  let clock: number;
  let records: Map<string, { value: string; expiresAt: number }>;
  let store: CorporateSessionStore;
  const key = randomBytes(32);
  const transport = { authorizeEndpoint: async () => true };
  const request = (cookie?: string, csrf?: string) => ({
    headers: {
      origin: "http://127.0.0.1:3456",
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
  });
  const cookieValue = (cookie: string) => cookie.split(";", 1)[0]!;
  beforeEach(async () => {
    fixture = await startOidcFixture();
    revoked = false;
    clock = Date.now();
    records = new Map();
    store = {
      put: async (namespace, id, value, expiresAt) => {
        const k = `${namespace}:${id}`;
        if (records.has(k)) throw new Error("DUPLICATE");
        records.set(k, { value, expiresAt });
      },
      get: async (namespace, id, now) => {
        const row = records.get(`${namespace}:${id}`);
        return row && row.expiresAt > now ? row.value : undefined;
      },
      take: async (namespace, id, now) => {
        const k = `${namespace}:${id}`;
        const row = records.get(k);
        records.delete(k);
        return row && row.expiresAt > now ? row.value : undefined;
      },
      remove: async (namespace, id) => {
        records.delete(`${namespace}:${id}`);
      },
      rotate: async (namespace, previous, next, value, expiresAt, now) => {
        const old = records.get(`${namespace}:${previous}`);
        if (!old || old.expiresAt <= now) return false;
        if (records.has(`${namespace}:${next}`)) throw new Error("DUPLICATE");
        records.delete(`${namespace}:${previous}`);
        records.set(`${namespace}:${next}`, { value, expiresAt });
        return true;
      },
    };
    tokenPolicy = {
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
      keyCacheMs: 60_000,
      deadlineMs: 500,
      maximumResponseBytes: 16384,
      groupsClaim: "groups",
    };
    policy = {
      policyRef: { id: "identity-policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
      namespace: "fixture-identity-v1",
      browserOrigin: "http://127.0.0.1:3456",
      authorizationEndpoint: `${fixture.origin}/authorize`,
      tokenEndpoint: `${fixture.origin}/token`,
      callbackUrl: "http://127.0.0.1:3456/api/v1/auth/callback",
      clientId: "awp-browser",
      scopes: ["openid", "profile"],
      returnPaths: ["/pilot/readiness"],
      loginLifetimeMs: 120_000,
      sessionLifetimeMs: 300_000,
      stepUp: { acrValues: ["urn:fixture:mfa"], amrValues: ["otp"], maximumAgeSeconds: 60 },
    };
    service = makeService();
  });
  function makeService() {
    return new CorporateSessionService(
      policy,
      new PinnedOidcTokenVerifier(tokenPolicy, transport),
      transport,
      store,
      new AesGcmSessionStateCodec("key-1", { withKey: async (_id, use) => use(key) }),
      {
        authenticate: async (evidence) => {
          if (revoked) throw new Error("REVOKED");
          return {
            id: "principal",
            issuer: evidence.issuer,
            subject: evidence.subject,
            kind: "HUMAN",
            displayName: "Alice",
          };
        },
        authorize: async (evidence, input) => {
          if (revoked) throw new Error("REVOKED");
          return {
            actor: {
              kind: "HUMAN",
              principalId: "principal",
              issuer: evidence.issuer,
              subject: evidence.subject,
            },
            scope: input.scope,
            correlationId: "request",
            causationId: "cause",
          };
        },
      },
      { authorizeTokenRequest: async () => ({ headers: {}, form: {} }) },
      () => clock,
    );
  }
  afterEach(async () => {
    await fixture.stop();
  });
  async function flow(options: { session?: string; csrf?: string; stepUp?: boolean } = {}) {
    const begin = await service.begin(request(options.session, options.csrf), {
      returnPath: "/pilot/readiness",
      stepUp: options.stepUp ?? false,
    });
    const auth = await fetch(begin.authorizationUrl, { redirect: "manual" });
    const callback = new URL(auth.headers.get("location")!);
    return {
      begin,
      query: Object.fromEntries(callback.searchParams),
      request: request(cookieValue(begin.cookie)),
    };
  }
  async function login() {
    const started = await flow();
    const result = await service.callback(started.request, started.query);
    return { ...result, cookie: cookieValue(result.cookie) };
  }

  it("uses S256 PKCE, exact redirect, state/nonce and an opaque protected session cookie", async () => {
    const started = await flow();
    const url = new URL(started.begin.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(policy.callbackUrl);
    expect(url.searchParams.has("code_verifier")).toBe(false);
    const result = await service.callback(started.request, started.query);
    expect(result.returnPath).toBe("/pilot/readiness");
    expect(result.cookie).toMatch(/HttpOnly; SameSite=Lax/u);
    const session = await service.session(request(cookieValue(result.cookie)));
    expect(session).toMatchObject({ principalId: "principal", subject: "alice" });
    expect(session.csrfToken).toHaveLength(43);
    expect(JSON.stringify([...records.values()])).not.toMatch(/alice|code_verifier|qa-team/u);
    expect(JSON.stringify(result)).not.toMatch(
      /access_token|id_token|refresh_token|eyJ[a-zA-Z0-9_-]{12,}\./u,
    );
    expect(fixture.state.exchanges).toBe(1);
  });
  it("denies cross-origin login and unlisted return paths", async () => {
    await expect(
      service.begin(
        { headers: { origin: "https://attacker.example" } },
        { returnPath: "/pilot/readiness" },
      ),
    ).rejects.toThrow();
    for (const returnPath of ["https://attacker.example", "//attacker.example", "/other"])
      await expect(service.begin(request(), { returnPath })).rejects.toThrow();
  });
  it("denies stolen/replayed state, wrong browser cookie and issuer mix-up before token exchange", async () => {
    const started = await flow();
    await expect(service.callback(request(), started.query)).rejects.toThrow();
    await expect(
      service.callback(started.request, { ...started.query, iss: "https://other.example" }),
    ).rejects.toThrow();
    await service.callback(started.request, started.query);
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    expect(fixture.state.exchanges).toBe(1);
  });
  it("checks nonce and the ID/access subject pair", async () => {
    fixture.state.idOverrides = { nonce: "forged" };
    let started = await flow();
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    fixture.state.idOverrides = { sub: "mallory" };
    started = await flow();
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    expect([...records.values()].length).toBe(0);
  });
  it("requires origin and session-bound CSRF before writes/logout", async () => {
    const result = await login();
    const session = await service.session(request(result.cookie));
    await expect(service.logout(request(result.cookie))).rejects.toThrow();
    await expect(service.logout(request(result.cookie, "forged"))).rejects.toThrow();
    await expect(
      service.logout({
        headers: {
          cookie: result.cookie,
          origin: "https://attacker.example",
          "x-csrf-token": session.csrfToken,
        },
      }),
    ).rejects.toThrow();
    await service.logout(request(result.cookie, session.csrfToken));
    await expect(service.session(request(result.cookie))).rejects.toThrow();
  });
  it("binds interactions to the verified browser session and rechecks CSRF, rotation and revocation", async () => {
    const initial = await login();
    const info = await service.session(request(initial.cookie));
    await expect(service.interactionSession(request(initial.cookie))).rejects.toThrow();
    const bound = await service.interactionSession(request(initial.cookie, info.csrfToken));
    expect(bound.principalId).toBe("principal");
    expect(bound.binding).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(bound)).not.toContain(initial.cookie.split("=")[1]);
    for (const method of ["GET", "HEAD"])
      expect(
        await service.interactionSession({ method, headers: { cookie: initial.cookie } }),
      ).toEqual(bound);
    for (const method of ["POST", "PUT", "DELETE"])
      await expect(
        service.interactionSession({ method, headers: { cookie: initial.cookie } }),
      ).rejects.toThrow();
    await expect(
      service.interactionSession({
        method: "GET",
        headers: { cookie: initial.cookie, "sec-fetch-site": "cross-site" },
      }),
    ).rejects.toThrow();
    service = makeService();
    expect(await service.interactionSession(request(initial.cookie, info.csrfToken))).toEqual(
      bound,
    );
    const other = await login();
    const otherInfo = await service.session(request(other.cookie));
    expect(
      (await service.interactionSession(request(other.cookie, otherInfo.csrfToken))).binding,
    ).not.toBe(bound.binding);
    revoked = true;
    await expect(
      service.interactionSession(request(initial.cookie, info.csrfToken)),
    ).rejects.toThrow();
    revoked = false;
    const upgrade = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    const rotated = await service.callback(upgrade.request, upgrade.query);
    const rotatedCookie = cookieValue(rotated.cookie);
    const rotatedInfo = await service.session(request(rotatedCookie));
    expect(
      (await service.interactionSession(request(rotatedCookie, rotatedInfo.csrfToken))).binding,
    ).not.toBe(bound.binding);
    await expect(
      service.interactionSession(request(initial.cookie, info.csrfToken)),
    ).rejects.toThrow();
  });
  it("keeps sessions bounded across restart, provider outage and revocation", async () => {
    const result = await login();
    service = makeService();
    fixture.state.outage = true;
    expect((await service.session(request(result.cookie))).principalId).toBe("principal");
    revoked = true;
    await expect(service.session(request(result.cookie))).rejects.toThrow();
    revoked = false;
    clock += 301_000;
    await expect(service.session(request(result.cookie))).rejects.toThrow();
  });
  it("rotates a step-up session and rejects refresh-only authentication or an account switch", async () => {
    const initial = await login();
    const info = await service.session(request(initial.cookie));
    fixture.state.authAge = 120;
    let started = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    expect(new URL(started.begin.authorizationUrl).searchParams.get("max_age")).toBe("0");
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    fixture.state.authAge = 0;
    fixture.state.subject = "mallory";
    started = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    fixture.state.subject = "alice";
    started = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    const result = await service.callback(started.request, started.query);
    expect(result.cookie).not.toBe(initial.cookie);
    await expect(service.session(request(initial.cookie))).rejects.toThrow();
    expect((await service.session(request(cookieValue(result.cookie)))).stepUpAt).toBeDefined();
  });
  it("rejects tampered encrypted state and changed policy pins", async () => {
    const result = await login();
    const id = createHash("sha256").update(result.cookie.split("=")[1]!).digest("hex");
    const storageKey = `${policy.namespace}:session:${id}`;
    const row = records.get(storageKey)!;
    records.set(storageKey, { ...row, value: `${row.value.slice(0, -1)}!` });
    await expect(service.session(request(result.cookie))).rejects.toThrow();
    const second = await login();
    policy = { ...policy, policyRef: { ...policy.policyRef, version: 2 } };
    service = makeService();
    await expect(service.session(request(second.cookie))).rejects.toThrow();
  });
  it("consumes simultaneous callbacks only once and denies step-up after logout", async () => {
    const started = await flow();
    const race = await Promise.allSettled([
      service.callback(started.request, started.query),
      service.callback(started.request, started.query),
    ]);
    expect(race.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(fixture.state.exchanges).toBe(1);
    const initial = await login();
    const info = await service.session(request(initial.cookie));
    const upgrade = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    await service.logout(request(initial.cookie, info.csrfToken));
    await expect(service.callback(upgrade.request, upgrade.query)).rejects.toThrow();
  });
  it("rejects missing MFA/ACR and expired login flows", async () => {
    const initial = await login();
    const info = await service.session(request(initial.cookie));
    fixture.state.amr = ["pwd"];
    let started = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    fixture.state.amr = ["pwd", "otp"];
    fixture.state.acr = "weak";
    started = await flow({ session: initial.cookie, csrf: info.csrfToken, stepUp: true });
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
    started = await flow();
    clock += policy.loginLifetimeMs + 1;
    await expect(service.callback(started.request, started.query)).rejects.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type PinnedOidcPolicy,
  PinnedOidcTokenVerifier,
} from "../../../../packages/platform-runtime-nest/src/auth/pinned-oidc-verifier.ts";
import { startOidcFixture } from "../../../support/008-oidc-fixture.ts";

describe("008 pinned access token verification", () => {
  let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
  let policy: PinnedOidcPolicy;
  beforeEach(async () => {
    fixture = await startOidcFixture();
    policy = {
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
      maximumResponseBytes: 16_384,
      groupsClaim: "groups",
    };
  });
  afterEach(async () => {
    await fixture.stop();
  });
  const verifier = (overrides: Partial<PinnedOidcPolicy> = {}) =>
    new PinnedOidcTokenVerifier(
      { ...policy, ...overrides },
      { authorizeEndpoint: async () => true },
    );

  it("accepts the exact access-token policy and returns bounded identity evidence", async () => {
    const value = await verifier().verifyAccessToken(fixture.token());
    expect(value).toMatchObject({
      issuer: fixture.origin,
      subject: "alice",
      groups: ["qa-team"],
      clientId: "awp-browser",
      acr: "urn:fixture:mfa",
      amr: ["pwd", "otp"],
    });
    expect(value.expiresAt).toBeGreaterThan(value.issuedAt);
    expect(JSON.stringify(value)).not.toContain("eyJ");
  });
  it("accepts azp when the IAM does not issue a client_id claim", async () => {
    const value = await verifier().verifyAccessToken(
      fixture.token({ client_id: null, azp: "awp-browser" }),
    );
    expect(value).toMatchObject({ clientId: "awp-browser" });
    await expect(
      verifier().verifyAccessToken(fixture.token({ client_id: null, azp: "untrusted" })),
    ).rejects.toThrow("OIDC_TOKEN_REJECTED");
  });
  it.each([
    ["issuer", { iss: "https://other.example" }],
    ["audience", { aud: "other" }],
    ["missing expiry", { exp: null }],
    ["missing issued-at", { iat: null }],
    ["missing subject", { sub: "" }],
    ["missing client", { client_id: null }],
    ["missing token id", { jti: null }],
    ["expired", { exp: 1 }],
    ["future issue", { iat: 4_000_000_000 }],
    ["not yet valid", { nbf: 4_000_000_000 }],
    ["long-lived", { exp: 4_000_000_000 }],
    ["unknown client", { client_id: "untrusted" }],
    ["oversized groups", { groups: Array.from({ length: 257 }, (_, i) => `group-${i}`) }],
  ])("rejects %s", async (_label, claims) => {
    await expect(
      verifier().verifyAccessToken(fixture.token(claims as Record<string, unknown>)),
    ).rejects.toThrow("OIDC_TOKEN_REJECTED");
  });
  it("rejects ID tokens, opaque credentials, unknown keys and disallowed algorithms", async () => {
    const guard = verifier();
    for (const token of [
      fixture.token({}, { typ: "JWT" }),
      fixture.token({}, { kid: "unknown" }),
      fixture.token({}, { alg: "HS256" }),
      "opaque-access-token",
    ])
      await expect(guard.verifyAccessToken(token)).rejects.toThrow("OIDC_TOKEN_REJECTED");
  });
  it("supports a separately pinned vendor discriminator without accepting generic JWTs", async () => {
    const guard = verifier({
      discriminator: { kind: "VENDOR_JWT", typ: "JWT", claim: "token_use", value: "access" },
    });
    await expect(
      guard.verifyAccessToken(fixture.token({ token_use: "id" }, { typ: "JWT" })),
    ).rejects.toThrow();
    expect(
      (await guard.verifyAccessToken(fixture.token({ token_use: "access" }, { typ: "JWT" })))
        .subject,
    ).toBe("alice");
  });
  it("allows known cached keys during outage but never extends expiry or trusts unknown keys", async () => {
    const guard = verifier();
    const access = fixture.token();
    await guard.verifyAccessToken(access);
    fixture.state.outage = true;
    expect((await guard.verifyAccessToken(access)).subject).toBe("alice");
    fixture.rotate();
    await expect(guard.verifyAccessToken(fixture.token())).rejects.toThrow("OIDC_TOKEN_REJECTED");
    await expect(guard.verifyAccessToken(fixture.token({ exp: 1 }))).rejects.toThrow(
      "OIDC_TOKEN_REJECTED",
    );
    expect(fixture.state.jwksReads).toBe(1);
  });
  it("fails closed after key-cache expiry and on a denied endpoint, redirect, oversized body or timeout", async () => {
    const guard = verifier({ keyCacheMs: 1 });
    await guard.verifyAccessToken(fixture.token());
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    fixture.state.outage = true;
    await expect(guard.verifyAccessToken(fixture.token())).rejects.toThrow("OIDC_TOKEN_REJECTED");
    fixture.state.outage = false;
    const denied = new PinnedOidcTokenVerifier(policy, { authorizeEndpoint: async () => false });
    await expect(denied.verifyAccessToken(fixture.token())).rejects.toThrow("OIDC_TOKEN_REJECTED");
    fixture.state.redirect = true;
    await expect(verifier().verifyAccessToken(fixture.token())).rejects.toThrow();
    fixture.state.redirect = false;
    fixture.state.oversized = true;
    await expect(verifier().verifyAccessToken(fixture.token())).rejects.toThrow();
    fixture.state.oversized = false;
    fixture.state.delayMs = 200;
    await expect(verifier({ deadlineMs: 20 }).verifyAccessToken(fixture.token())).rejects.toThrow();
  });
  it("denies insecure corporate configuration and unsigned/symmetric algorithm policies", () => {
    expect(() => verifier({ mode: "CORPORATE" })).toThrow("OIDC_POLICY_INVALID");
    expect(() => verifier({ algorithms: ["HS256"] as never })).toThrow("OIDC_POLICY_INVALID");
    expect(() => verifier({ keyCacheMs: Infinity })).toThrow("OIDC_POLICY_INVALID");
  });
});

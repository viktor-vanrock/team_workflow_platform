import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VaultHttpClient } from "../../../../packages/runtime-composition/src/security/vault-http-client.ts";
import {
  secretAllowedUseHash,
  type VaultSecretMapping,
  VaultSecretResolver,
  type VaultSecretUse,
} from "../../../../packages/runtime-composition/src/security/vault-secret-resolver.ts";
import { startVaultFixture008 } from "../../../support/008-vault-fixture.ts";

const ref = { id: "published", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const use: VaultSecretUse = {
  workspaceId: "w1",
  projectId: "p1",
  servicePrincipalId: "worker",
  purpose: "CONNECTOR_READ",
  profileRef: ref,
  connectionRef: ref,
  policyRef: ref,
};
const mapping: VaultSecretMapping = {
  ref,
  secretRef: "secret-ref:qa/read",
  use,
  mount: "secret",
  path: "qa/read",
  field: "credential",
  secretVersion: 3,
  maximumLeaseMs: 1000,
};
describe("008 scoped Vault KV v2 resolution", () => {
  let fixture: Awaited<ReturnType<typeof startVaultFixture008>>;
  let now: number;
  let allowed: boolean;
  let networkAllowed: boolean;
  let credentialCalls: number;
  let resolver: VaultSecretResolver;
  beforeEach(async () => {
    fixture = await startVaultFixture008();
    now = Date.now();
    allowed = true;
    networkAllowed = true;
    credentialCalls = 0;
    const client = new VaultHttpClient({
      baseUrl: fixture.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 100,
      maximumResponseBytes: 8192,
      authorizeEndpoint: async () => networkAllowed,
      credentials: {
        withToken: async (_use, _signal, consume) => {
          credentialCalls++;
          return await consume("fixture-workload-credential", now + 5000);
        },
      },
      clock: () => now,
    });
    resolver = new VaultSecretResolver(
      client,
      use,
      [mapping],
      { authorize: async () => allowed, isCurrent: () => allowed },
      () => now,
    );
  });
  afterEach(async () => {
    await fixture.stop();
  });
  const resolve = () =>
    resolver.resolve(
      mapping.secretRef,
      secretAllowedUseHash(mapping),
      new AbortController().signal,
    );
  it("uses the exact secret version and grants a short one-use material lease", async () => {
    const lease = await resolve();
    let retained: Uint8Array | undefined;
    expect(
      lease.withMaterial(new Date(now), (bytes) => {
        retained = bytes;
        return Buffer.from(bytes).toString();
      }),
    ).toBe("fixture-secret-canary-008");
    expect(retained?.every((byte) => byte === 0)).toBe(true);
    expect(() => lease.withMaterial(new Date(now), () => true)).toThrow("SECRET_LEASE_CLOSED");
    expect(fixture.requests[0]).toEqual({
      method: "GET",
      path: "/v1/secret/data/qa/read?version=3",
      body: {},
    });
    expect(JSON.stringify(lease)).not.toContain("fixture-secret-canary-008");
  });
  it("denies a different purpose/profile/scope hash before credentials or network", async () => {
    for (const patch of [
      { purpose: "CONNECTOR_WRITE" as const },
      { projectId: "p2" },
      { workspaceId: "w2" },
      { profileRef: { ...ref, version: 2 } },
    ]) {
      await expect(
        resolver.resolve(
          mapping.secretRef,
          secretAllowedUseHash({ ...mapping, use: { ...use, ...patch } }),
          new AbortController().signal,
        ),
      ).rejects.toThrow("SECRET_USE_DENIED");
    }
    expect(credentialCalls).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });
  it("revocation, cancellation and expiry invalidate already-resolved material", async () => {
    const lease = await resolve();
    allowed = false;
    expect(() => lease.withMaterial(new Date(now), () => true)).toThrow("SECRET_LEASE_CLOSED");
    allowed = true;
    const expiring = await resolve();
    now += 1001;
    expect(() => expiring.withMaterial(new Date(now - 1001), () => true)).toThrow(
      "SECRET_LEASE_CLOSED",
    );
    const abort = new AbortController();
    const cancelled = await resolver.resolve(
      mapping.secretRef,
      secretAllowedUseHash(mapping),
      abort.signal,
    );
    abort.abort();
    expect(() => cancelled.withMaterial(new Date(now), () => true)).toThrow("SECRET_LEASE_CLOSED");
  });
  it("blocks drift/deleted versions without falling back to latest", async () => {
    fixture.state.responseVersion = 4;
    await expect(resolve()).rejects.toThrow("SECRET_VERSION_UNAVAILABLE");
    fixture.state.responseVersion = 3;
    fixture.state.deleted = true;
    await expect(resolve()).rejects.toThrow("SECRET_VERSION_UNAVAILABLE");
    expect(fixture.requests.every(({ path }) => path.endsWith("?version=3"))).toBe(true);
  });
  it("rejects unsafe network policy before credentials and never follows redirects", async () => {
    networkAllowed = false;
    await expect(resolve()).rejects.toThrow("VAULT_ENDPOINT_DENIED");
    expect(credentialCalls).toBe(0);
    networkAllowed = true;
    fixture.state.redirect = true;
    await expect(resolve()).rejects.toThrow("VAULT_REQUEST_FAILED");
    expect(fixture.requests).toHaveLength(1);
  });
  it.each([401, 403, 429, 503])(
    "redacts provider failure %s and performs no automatic retry",
    async (status) => {
      fixture.state.status = status;
      const error = await resolve().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe("Error: VAULT_REQUEST_FAILED");
      expect(fixture.requests).toHaveLength(1);
    },
  );
  it("bounds response bytes and request deadline", async () => {
    fixture.state.oversized = true;
    await expect(resolve()).rejects.toThrow("VAULT_RESPONSE_INVALID");
    fixture.state.oversized = false;
    fixture.state.delayMs = 250;
    await expect(resolve()).rejects.toThrow("VAULT_REQUEST_FAILED");
  });
  it("requires the pinned network transport for corporate Vault and preserves the legacy opaque GitLab ref namespace", async () => {
    expect(
      () =>
        new VaultHttpClient({
          baseUrl: "https://vault.example.test",
          namespace: "pilot/",
          mode: "CORPORATE",
          deadlineMs: 100,
          maximumResponseBytes: 8192,
          authorizeEndpoint: async () => true,
          credentials: {
            withToken: async (_use, _signal, consume) => consume("not-used", Date.now() + 1000),
          },
        }),
    ).toThrow("VAULT_ENDPOINT_DENIED");
    const legacy = { ...mapping, secretRef: "secretref://gitlab/qa/read" };
    const local = new VaultHttpClient({
      baseUrl: fixture.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 100,
      maximumResponseBytes: 8192,
      authorizeEndpoint: async () => true,
      credentials: {
        withToken: async (_use, _signal, consume) =>
          consume("fixture-workload-credential", now + 5000),
      },
    });
    const bridge = new VaultSecretResolver(
      local,
      use,
      [legacy],
      { authorize: async () => true, isCurrent: () => true },
      () => now,
    );
    const lease = await bridge.resolve(
      legacy.secretRef,
      secretAllowedUseHash(legacy),
      new AbortController().signal,
    );
    expect(lease.withMaterial(new Date(now), (bytes) => bytes.length)).toBeGreaterThan(0);
    for (const secretRef of [
      "https://vault.example.test/secret",
      "secretref://evil@host/path",
      "file:///tmp/token",
    ])
      expect(
        () =>
          new VaultSecretResolver(local, use, [{ ...mapping, secretRef }], {
            authorize: async () => true,
            isCurrent: () => true,
          }),
      ).toThrow("SECRET_MAPPING_INVALID");
  });
});

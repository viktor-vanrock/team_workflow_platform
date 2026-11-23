import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type * as Jose from "../../../apps/api/node_modules/jose/dist/types/index.js";
import { LocalSessionGuard } from "../../../apps/api/src/local/local-session.guard.ts";

const { exportJWK, generateKeyPair, SignJWT } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("jose") as typeof Jose;
let sign: (subject: string) => Promise<string>;
let guard: LocalSessionGuard;
const server = createServer();
beforeAll(async () => {
  const keys = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "018-key", alg: "ES256" };
  server.on("request", (_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_IDENTITY_ISSUER", issuer);
  vi.stubEnv("AWP_IDENTITY_AUDIENCE", "awp-local");
  sign = (subject) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "018-key" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience("awp-local")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
  guard = new LocalSessionGuard();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("019 request-bound authentication across Nest guard instances", () => {
  it("shares only verified evidence for the same request and clears it after a failed verification", async () => {
    const other = new LocalSessionGuard();
    const request = { headers: { authorization: `Bearer ${await sign("owner.local")}` } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    expect(other.authentication(request)).toEqual(guard.authentication(request));
    expect(other.authentication(request)).toBeDefined();
    expect(other.authentication({ ...request })).toBeUndefined();
    request.headers.authorization = "Bearer invalid";
    await expect(
      other.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(guard.authentication(request)).toBeUndefined();
  });
});

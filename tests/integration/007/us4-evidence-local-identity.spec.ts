import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import type * as Jose from "../../../apps/api/node_modules/jose/dist/types/index.js";
import {
  LocalSessionGuard,
  type LocalSessionRequest,
} from "../../../apps/api/src/local/local-session.guard.ts";

const { exportJWK, generateKeyPair, SignJWT } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("jose") as typeof Jose;

describe("007 local evidence authentication context", () => {
  it("derives step-up only from fresh verified JWT claims and clears it on failed reauthentication", async () => {
    const keys = await generateKeyPair("ES256"),
      publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "local-proof", alg: "ES256" };
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
    vi.stubEnv("AWP_IDENTITY_ISSUER", issuer);
    vi.stubEnv("AWP_IDENTITY_AUDIENCE", "awp-local");
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: "local-proof" })
        .setSubject("lead.alpha")
        .setIssuer(issuer)
        .setAudience("awp-local")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
    const context = (request: LocalSessionRequest) =>
      ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
    try {
      const guard = new LocalSessionGuard(),
        authTime = Math.floor(Date.now() / 1000);
      const token = await sign({ auth_time: authTime, amr: ["mfa"] });
      const request = {
        headers: { authorization: `Bearer ${token}` },
        localPersonaKey: "owner.local",
      };
      expect(await guard.canActivate(context(request))).toBe(true);
      expect(request.localPersonaKey).toBe("lead.alpha");
      expect(guard.authentication(request)?.stepUpAt).toBe(new Date(authTime * 1000).toISOString());
      expect(guard.authentication(request)?.contextRef).toMatch(/^sha256:[a-f0-9]{64}$/u);
      const ordinary = {
        headers: { authorization: `Bearer ${await sign({ amr: ["pwd"] })}` },
        authentication: { stepUpAt: new Date().toISOString() },
      };
      expect(await guard.canActivate(context(ordinary))).toBe(true);
      expect(guard.authentication(ordinary)?.stepUpAt).toBeUndefined();
      for (const offset of [-601, 60]) {
        const stale = {
          headers: {
            authorization: `Bearer ${await sign({ auth_time: authTime + offset, amr: ["mfa"] })}`,
          },
        };
        expect(await guard.canActivate(context(stale))).toBe(true);
        expect(guard.authentication(stale)?.stepUpAt).toBeUndefined();
      }
      request.headers.authorization = `Bearer ${token.slice(0, -8)}AAAAAAAA`;
      await expect(guard.canActivate(context(request))).rejects.toThrow(
        "Local session verification failed",
      );
      expect(guard.authentication(request)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

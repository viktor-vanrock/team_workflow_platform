import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Independent authorization server: validates code, redirect and PKCE before issuing tokens. */
export async function startOidcFixture() {
  const keys = [generateKeyPairSync("ed25519")];
  const codes = new Map<string, { challenge: string; nonce: string; redirect: string }>();
  const state = {
    outage: false,
    jwksReads: 0,
    exchanges: 0,
    delayMs: 0,
    oversized: false,
    redirect: false,
    subject: "alice",
    authAge: 0,
    acr: "urn:fixture:mfa",
    amr: ["pwd", "otp"],
    groups: ["qa-team"],
    accessOverrides: {} as Record<string, unknown>,
    idOverrides: {} as Record<string, unknown>,
  };
  let origin = "";
  function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
    const time = Math.floor(Date.now() / 1000);
    const protectedHeader = Buffer.from(
      JSON.stringify({ alg: "EdDSA", typ: "at+jwt", kid: String(keys.length), ...header }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        iss: origin,
        sub: state.subject,
        aud: "awp-api",
        client_id: "awp-browser",
        jti: randomBytes(16).toString("hex"),
        iat: time,
        exp: time + 300,
        auth_time: time - state.authAge,
        acr: state.acr,
        amr: state.amr,
        groups: state.groups,
        ...claims,
      }),
    ).toString("base64url");
    return `${protectedHeader}.${body}.${sign(null, Buffer.from(`${protectedHeader}.${body}`), keys.at(-1)!.privateKey).toString("base64url")}`;
  }
  const server = createServer((request, response) => {
    void (async () => {
      if (state.delayMs)
        await new Promise((resolve) => {
          setTimeout(resolve, state.delayMs);
        });
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (state.outage) {
        json(503, { error: "oidc-provider-canary-never-log" });
        return;
      }
      if (state.redirect) {
        response.writeHead(302, { location: `${origin}/unexpected` });
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname === "/jwks") {
        state.jwksReads++;
        json(200, {
          keys: keys.map(({ publicKey }, index) => ({
            ...publicKey.export({ format: "jwk" }),
            kid: String(index + 1),
            alg: "EdDSA",
            use: "sig",
          })),
          ...(state.oversized ? { padding: "x".repeat(100_000) } : {}),
        });
        return;
      }
      if (url.pathname === "/authorize") {
        const query = url.searchParams;
        if (
          query.get("client_id") !== "awp-browser" ||
          query.get("response_type") !== "code" ||
          query.get("code_challenge_method") !== "S256" ||
          !query.get("state") ||
          !query.get("nonce") ||
          !query.get("code_challenge") ||
          !query.get("scope")?.split(" ").includes("openid")
        ) {
          json(400, { error: "invalid_authorization" });
          return;
        }
        const code = randomBytes(32).toString("base64url");
        codes.set(code, {
          challenge: query.get("code_challenge")!,
          nonce: query.get("nonce")!,
          redirect: query.get("redirect_uri")!,
        });
        const target = new URL(query.get("redirect_uri")!);
        target.searchParams.set("code", code);
        target.searchParams.set("state", query.get("state")!);
        target.searchParams.set("iss", origin);
        response.writeHead(302, { location: target.href });
        response.end();
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const code = form.get("code") ?? "";
        const entry = codes.get(code);
        codes.delete(code);
        if (
          !entry ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== "awp-browser" ||
          form.get("redirect_uri") !== entry.redirect ||
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") !== entry.challenge
        ) {
          json(400, { error: "invalid_grant" });
          return;
        }
        state.exchanges++;
        json(200, {
          token_type: "Bearer",
          access_token: token(state.accessOverrides),
          id_token: token(
            { aud: "awp-browser", nonce: entry.nonce, ...state.idOverrides },
            { typ: "JWT" },
          ),
          expires_in: 300,
        });
        return;
      }
      json(404, { error: "unsupported" });
    })().catch(() => {
      response.writeHead(400);
      response.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    state,
    token,
    rotate: () => {
      keys.push(generateKeyPairSync("ed25519"));
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

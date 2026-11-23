import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startVaultFixture008() {
  const keys = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const state = {
    status: 200,
    responseVersion: 3,
    signatureVersion: 1,
    corruptSignature: false,
    redirect: false,
    deleted: false,
    delayMs: 0,
    oversized: false,
    credentials: { "qa/read": "fixture-secret-canary-008" } as Record<string, string>,
  };
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
      const text = Buffer.concat(chunks).toString();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      requests.push({ method: req.method ?? "", path: req.url ?? "", body });
      if (state.delayMs)
        await new Promise((resolve) => {
          setTimeout(resolve, state.delayMs);
        });
      if (
        req.headers["x-vault-token"] !== "fixture-workload-credential" ||
        req.headers["x-vault-namespace"] !== "pilot/"
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (state.redirect) {
        res.writeHead(302, { location: "/leaked-token" });
        res.end();
        return;
      }
      res.writeHead(state.status, { "content-type": "application/json" });
      if (state.status !== 200) {
        res.end(JSON.stringify({ errors: ["fixture-secret-canary-008 must never escape"] }));
        return;
      }
      if (state.oversized) {
        res.end(JSON.stringify({ padding: "x".repeat(100_000) }));
        return;
      }
      const secretPath = /^\/v1\/secret\/data\/(.+)\?version=3$/u.exec(req.url ?? "")?.[1];
      if (secretPath && Object.hasOwn(state.credentials, secretPath) && req.method === "GET") {
        res.end(
          JSON.stringify({
            data: {
              data: { credential: state.credentials[secretPath] },
              metadata: {
                version: state.responseVersion,
                destroyed: state.deleted,
                deletion_time: "",
              },
            },
          }),
        );
        return;
      }
      if (req.url === "/v1/transit/sign/evidence" && req.method === "POST") {
        const version = state.signatureVersion;
        const signature = sign(
          null,
          Buffer.from(String(body.input), "base64"),
          keys[version - 1]!.privateKey,
        );
        if (state.corruptSignature) signature[0] = signature[0]! ^ 1;
        res.end(
          JSON.stringify({
            data: { signature: `vault:v${version}:${signature.toString("base64")}` },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ errors: ["UNKNOWN_FIXTURE_ROUTE"] }));
    })().catch(() => {
      res.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    requests,
    publicJwk: (version: number) => keys[version - 1]!.publicKey.export({ format: "jwk" }),
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

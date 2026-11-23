import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const pilotFixtureIds = Object.freeze({
  workspaceA: "00000000-0000-4000-8000-000000000801",
  workspaceB: "00000000-0000-4000-8000-000000000802",
  projectA: "00000000-0000-4000-8000-000000000811",
  projectB: "00000000-0000-4000-8000-000000000812",
  projectOther: "00000000-0000-4000-8000-000000000813",
  human: "00000000-0000-4000-8000-000000000821",
  service: "00000000-0000-4000-8000-000000000822",
});
type Provider = "jira" | "gitlab" | "mattermost";
type Surface = Provider | "identity" | "secrets" | "signer" | "telemetry";
export type FixtureFailure =
  "healthy" | "unauthorized" | "forbidden" | "rate-limited" | "unavailable" | "lost-response";

/** Independent HTTP provider state survives client/worker restarts; POST has no invented idempotency. */
export async function startPilotFixture() {
  const failures = new Map<Surface, FixtureFailure>();
  const effects: Array<Readonly<{ id: string; provider: Provider; body: unknown }>> = [];
  const keys = [generateKeyPairSync("ed25519")];
  let visibleEffects = Infinity;
  let telemetryReceipts = 0;
  let origin = "";
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  async function requestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of request) {
      const bytes = Buffer.from(part as Uint8Array);
      size += bytes.length;
      if (size > 1_000_000) throw new Error("FIXTURE_BODY_TOO_LARGE");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  const server = createServer((request, response) => {
    void (async () => {
      const route = new URL(request.url ?? "/", "http://fixture");
      const surface = route.pathname.split("/")[1] as Surface;
      const failure = failures.get(surface) ?? "healthy";
      const status = (
        { unauthorized: 401, forbidden: 403, "rate-limited": 429, unavailable: 503 } as Partial<
          Record<FixtureFailure, number>
        >
      )[failure];
      if (status) {
        if (status === 429) response.setHeader("retry-after", "1");
        json(response, status, { code: "INJECTED_FAILURE" });
        return;
      }
      const bytes = await requestBody(request);
      if (surface === "identity") {
        if (route.pathname === "/identity/jwks") {
          json(response, 200, {
            keys: keys.map(({ publicKey }, index) => ({
              ...publicKey.export({ format: "jwk" }),
              kid: String(index + 1),
              alg: "EdDSA",
              use: "sig",
            })),
          });
          return;
        }
        if (route.pathname === "/identity/.well-known/openid-configuration") {
          json(response, 200, { issuer: origin, jwks_uri: `${origin}/identity/jwks` });
          return;
        }
      }
      if (surface === "secrets" && request.method === "POST") {
        const body = JSON.parse(bytes.toString()) as Record<string, unknown>;
        if (
          body.workspaceId !== pilotFixtureIds.workspaceA ||
          body.projectId !== pilotFixtureIds.projectA ||
          body.purpose !== "connector-read" ||
          body.ref !== "fixture-secret:read"
        ) {
          json(response, 403, { code: "SECRET_SCOPE_DENIED" });
          return;
        }
        json(response, 200, {
          leaseId: randomUUID(),
          expiresIn: 30,
          value: "fixture-canary-never-log-008",
        });
        return;
      }
      if (surface === "signer" && request.method === "POST") {
        const body = JSON.parse(bytes.toString()) as { keyVersion: number; input: string };
        const key = keys[body.keyVersion - 1];
        if (!key || typeof body.input !== "string") {
          json(response, 400, { code: "SIGNING_VERSION_INVALID" });
          return;
        }
        json(response, 200, {
          keyVersion: body.keyVersion,
          signature: sign(null, Buffer.from(body.input, "base64"), key.privateKey).toString(
            "base64url",
          ),
        });
        return;
      }
      if (surface === "telemetry" && request.method === "POST") {
        telemetryReceipts++;
        json(response, 200, {});
        return;
      }
      if (["jira", "gitlab", "mattermost"].includes(surface)) {
        if (request.method === "POST") {
          const effect = Object.freeze({
            id: randomUUID(),
            provider: surface as Provider,
            body: JSON.parse(bytes.toString()) as unknown,
          });
          effects.push(effect);
          if (failure === "lost-response") {
            response.destroy();
            return;
          }
          json(response, 201, effect);
          return;
        }
        if (request.method === "GET") {
          json(
            response,
            200,
            effects.filter(({ provider }) => provider === surface).slice(0, visibleEffects),
          );
          return;
        }
      }
      json(response, 404, { code: "FIXTURE_ROUTE_UNKNOWN" });
    })().catch(() => {
      if (!response.destroyed) json(response, 400, { code: "FIXTURE_REQUEST_INVALID" });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    ids: pilotFixtureIds,
    fail: (surface: Surface, mode: FixtureFailure) => {
      failures.set(surface, mode);
    },
    visible: (count: number) => {
      visibleEffects = count;
    },
    effects: () => structuredClone(effects),
    telemetryReceipts: () => telemetryReceipts,
    rotate: () => {
      keys.push(generateKeyPairSync("ed25519"));
      return keys.length;
    },
    token: (claims: Record<string, unknown> = {}) => {
      const header = Buffer.from(
        JSON.stringify({ alg: "EdDSA", typ: "at+jwt", kid: String(keys.length) }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: origin,
          aud: "awp",
          sub: pilotFixtureIds.human,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
          ...claims,
        }),
      ).toString("base64url");
      return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), keys.at(-1)!.privateKey).toString("base64url")}`;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

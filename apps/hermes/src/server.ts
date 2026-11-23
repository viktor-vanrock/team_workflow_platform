import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  hermesBodyLimit,
  type HermesServiceConfig,
  parseHermesContextRequest,
  parseHermesRequest,
  runHermesContext,
  runProjectModel,
} from "@awp/runtime-composition";

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
};
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > hermesBodyLimit) throw new Error("HERMES_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function createHermesServer(config: HermesServiceConfig) {
  const expected = Buffer.from(`Bearer ${config.token}`);
  const server = createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 },
    (request, response) => {
      void (async () => {
        if (request.method === "GET" && request.url === "/health/live")
          return send(response, 200, { service: "hermes", version: 1, status: "UP" });
        if (request.method === "GET" && request.url === "/health/ready") {
          if (request.headers.authorization) {
            const authorization = Buffer.from(request.headers.authorization);
            if (
              authorization.length !== expected.length ||
              !timingSafeEqual(authorization, expected)
            )
              return send(response, 401, { code: "HERMES_UNAUTHORIZED" });
          }
          const ready = config.ready();
          return send(response, ready ? 200 : 503, {
            service: "hermes",
            version: 1,
            ready,
            mode: config.mode,
          });
        }
        if (
          request.method !== "POST" ||
          !["/v1/project-dialogue", "/v1/project-context"].includes(request.url ?? "")
        )
          return send(response, 404, { code: "HERMES_ROUTE_NOT_FOUND" });
        const auth = Buffer.from(request.headers.authorization ?? "");
        if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
          return send(response, 401, { code: "HERMES_UNAUTHORIZED" });
        if (!/^application\/json(?:;|$)/iu.test(request.headers["content-type"] ?? ""))
          return send(response, 400, { code: "HERMES_CONTENT_TYPE_INVALID" });
        if (Number(request.headers["content-length"] ?? 0) > hermesBodyLimit)
          return send(response, 413, { code: "HERMES_BODY_TOO_LARGE" });
        if (request.url === "/v1/project-context")
          return send(
            response,
            200,
            await runHermesContext(
              parseHermesContextRequest(await body(request)),
              config.jsonModel,
            ),
          );
        const input = parseHermesRequest(await body(request));
        return send(response, 200, await runProjectModel(input, config.model));
      })().catch((error: unknown) => {
        if (!response.destroyed && !response.headersSent)
          send(
            response,
            error instanceof Error && error.message === "HERMES_BODY_TOO_LARGE" ? 413 : 400,
            { code: "HERMES_REQUEST_INVALID" },
          );
      });
    },
  );
  server.setTimeout(5000, (socket) => socket.destroy());
  return server;
}

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  createChatCompletionsModel,
  runProjectModel,
} from "../../../packages/runtime-composition/src/hermes/project-model.ts";
import { parseHermesRequest } from "../../../packages/runtime-composition/src/hermes/service-contract.ts";

let origin: string,
  status = 200,
  output: unknown = { key: "P-TEST", name: "Оплата", purpose: "Проверка возврата" },
  observed: Record<string, unknown>;
const server = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = [];
    for await (const part of request) chunks.push(Buffer.from(part as Uint8Array));
    observed = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(status, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
      }),
    );
  })().catch(() => response.destroy());
});
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
const input = () =>
  parseHermesRequest({
    schemaVersion: 1,
    workspaceId: randomUUID(),
    principalId: randomUUID(),
    dialogueId: randomUUID(),
    requestKey: randomUUID(),
    expectedVersion: 1,
    draft: { key: "P-TEST" },
    message: "Оплата",
  });
const model = () =>
  createChatCompletionsModel({
    endpoint: `${origin}/v1/chat/completions`,
    model: "fixture",
    token: "fixture-model-only",
    network: {
      ref: { id: "hermes-test-network", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
      mode: "LOCAL_FIXTURE",
      validUntil: new Date(Date.now() + 60000).toISOString(),
      deadlineMs: 1000,
      maximumRequestBytes: 16384,
      maximumResponseBytes: 32768,
      endpoints: [
        {
          origin,
          addressRanges: ["127.0.0.1/32"],
          routes: [
            { path: "/v1/chat/completions", match: "EXACT", methods: ["POST"], queryKeys: [] },
          ],
        },
      ],
    },
  });
it("uses real provider HTTP with minimized input and strict output", async () => {
  const request = input();
  expect(await runProjectModel(request, model())).toMatchObject({
    mode: "MODEL",
    draft: { name: "Оплата" },
  });
  expect(observed!).toMatchObject({
    model: "fixture",
    store: false,
    stream: false,
    response_format: { type: "json_object" },
  });
  expect(JSON.stringify(observed!)).not.toContain(request.principalId);
  expect(JSON.stringify(observed!)).not.toContain(request.workspaceId);
  expect(observed!).not.toHaveProperty("tools");
});
it("falls back on rate errors and unsafe provider output", async () => {
  status = 429;
  expect((await runProjectModel(input(), model())).mode).toBe("DETERMINISTIC_FALLBACK");
  status = 200;
  output = { key: "P-TEST", grants: ["admin"] };
  expect((await runProjectModel(input(), model())).mode).toBe("DETERMINISTIC_FALLBACK");
});

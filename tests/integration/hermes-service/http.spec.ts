import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import { createHermesServer } from "../../../apps/hermes/src/server.ts";
import { createHermesDialogueClient } from "../../../packages/runtime-composition/src/hermes/service-client.ts";
import { parseHermesRequest } from "../../../packages/runtime-composition/src/hermes/service-contract.ts";

const token = "local-hermes-test-only-token-32-bytes";
const server = createHermesServer({ token, port: 3020, mode: "deterministic", ready: () => true });
let origin: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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
    message: "Создай проект «Магазин» для проверки заказов",
  });
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
it("serves a real standalone dialogue through the internal client", async () => {
  const client = createHermesDialogueClient({
    AWP_HERMES_URL: origin,
    AWP_ENVIRONMENT: "LOCAL",
    AWP_HERMES_LOCAL_TOKEN: token,
  });
  expect(await client.ready()).toBe(true);
  expect(await client.advance(input())).toMatchObject({
    mode: "DETERMINISTIC",
    state: "READY",
    draft: { name: "Магазин", purpose: "проверки заказов" },
  });
  const health = await (await fetch(`${origin}/health/ready`)).text();
  expect(health).not.toContain(token);
});
it("rejects unauthorized, foreign fields, wrong schemas and oversized requests", async () => {
  expect(
    (
      await fetch(`${origin}/v1/project-dialogue`, {
        method: "POST",
        body: JSON.stringify(input()),
      })
    ).status,
  ).toBe(401);
  for (const invalid of [
    { ...input(), schemaVersion: 2 },
    { ...input(), grants: ["admin"] },
    { ...input(), draft: { key: "../bad" } },
  ])
    expect(
      (
        await fetch(`${origin}/v1/project-dialogue`, {
          method: "POST",
          headers,
          body: JSON.stringify(invalid),
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await fetch(`${origin}/v1/project-dialogue`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: "a".repeat(17000) }),
      })
    ).status,
  ).toBe(413);
});
it("falls back on an unavailable or unauthenticated service", async () => {
  const client = createHermesDialogueClient({
    AWP_HERMES_URL: origin,
    AWP_ENVIRONMENT: "LOCAL",
    AWP_HERMES_LOCAL_TOKEN: "wrong-token-that-still-has-32-characters",
  });
  expect(await client.ready()).toBe(false);
  expect(await client.advance(input())).toMatchObject({
    mode: "DETERMINISTIC_FALLBACK",
    reasonCode: "SERVICE_UNAVAILABLE",
    state: "READY",
  });
});

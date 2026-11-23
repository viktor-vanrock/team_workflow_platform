import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createHermesServer } from "../../../apps/hermes/src/server.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

let f: Awaited<ReturnType<typeof startBindingHttpFixture>>;
let entered: () => void, release: (value: unknown) => void;
const token = "hermes-dialogue-test-token-32-characters";
const server = createHermesServer({
  token,
  port: 3020,
  mode: "openai-compatible",
  ready: () => true,
  model: async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  },
});
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
  vi.stubEnv("AWP_HERMES_URL", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  vi.stubEnv("AWP_HERMES_LOCAL_TOKEN", token);
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
}, 120000);
afterAll(async () => {
  await f?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  vi.unstubAllEnvs();
});
it("does not hold authorization locks during model I/O and rechecks revoked rights", async () => {
  const id = randomUUID();
  expect((await f.dialogueRequest("", { id })).status).toBe(201);
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const response = f.dialogueRequest(`/${id}/messages`, {
    expectedVersion: 1,
    requestKey: randomUUID(),
    message: "Проект оплаты",
  });
  await waiting;
  // This mutation must finish while the model is still pending, then deny its late result.
  await f.source.transaction(async (manager) => {
    await manager.query("SET LOCAL lock_timeout='500ms'");
    await manager.query(
      "UPDATE role_assignments SET revoked_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND principal_id=$2 AND role_key='requester'",
      [f.scope.workspaceId, localPersonaIds["requester.alpha"]],
    );
  });
  release({ key: "P-TEST", name: "Оплата", purpose: "Проверка" });
  expect((await response).status).toBe(403);
  const rows = await f.source.query(
    "SELECT version,messages FROM project_registration_dialogues WHERE id=$1",
    [id],
  );
  expect(rows[0].version).toBe(1);
  expect(rows[0].messages).toHaveLength(1);
});

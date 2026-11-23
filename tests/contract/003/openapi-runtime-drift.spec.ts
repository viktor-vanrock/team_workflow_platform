import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
describe("003 generated OpenAPI runtime drift", () => {
  it("contains every authority action/webhook route and matching runtime handlers", async () => {
    const api = JSON.parse(
      await readFile(resolve(root, "apps/api/openapi.generated.json"), "utf8"),
    ) as { paths: Record<string, unknown> };
    for (const path of [
      "/api/v1/work-items/{workItemId}/operational-actions/transition",
      "/api/v1/work-items/{workItemId}/operational-actions/assignment",
      "/api/v1/work-items/{workItemId}/operational-actions/priority",
      "/api/v1/work-items/{workItemId}/operational-actions/due-date",
      "/api/v1/connectors/jira/connections/{connectionId}/webhooks/{webhookKey}",
    ])
      expect(api.paths[path]).toBeDefined();
    const controller = await readFile(
      resolve(root, "packages/platform-runtime-nest/src/http/operational-authority.controller.ts"),
      "utf8",
    );
    for (const operation of [
      "request.transition",
      "request.assign",
      "request.set-priority",
      "request.set-due-date",
    ])
      expect(controller).toContain(operation);
    const webhook = await readFile(
      resolve(root, "packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts"),
      "utf8",
    );
    expect(webhook).toContain("connectors/:connectorKey/connections");
    expect(webhook).toContain("webhooks/:webhookKey");
    expect(webhook).toContain("connectorKey: string");
  });
});

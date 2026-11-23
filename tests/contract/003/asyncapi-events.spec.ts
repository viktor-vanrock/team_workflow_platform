import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("003 AsyncAPI compatibility", () => {
  it("publishes typed import/projection/conflict/drift/reconciliation/rejection envelopes", async () => {
    const doc = parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../specs/003-jira-operational-authority/contracts/asyncapi/jira-operational-events.v1.yaml",
        ),
        "utf8",
      ),
    ) as { asyncapi: string; components: { messages: Record<string, { name: string }> } };
    expect(doc.asyncapi).toBe("3.0.0");
    const names = Object.values(doc.components.messages).map(({ name }) => name);
    for (const name of [
      "work_item.operational.imported",
      "work_item.operational.projection-updated",
      "work_item.operational.conflict-detected",
      "work_item.operational.mapping-required",
      "work_item.operational.reconciliation-completed",
      "connector.webhook.rejected",
    ])
      expect(names).toContain(name);
  });
});

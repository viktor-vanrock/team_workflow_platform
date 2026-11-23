import { describe, expect, it } from "vitest";

import { OperationalImportConvergence } from "../../../packages/platform-core/src/work-management/operational-import.ts";

describe("US2 create/import convergence", () => {
  it("converges duplicate webhook, reconciliation and concurrent create to one adoption", async () => {
    const convergence = new OperationalImportConvergence();
    const results = await Promise.all(
      ["WEBHOOK", "RECONCILIATION", "CREATE"].map(
        async (source) =>
          await convergence.adopt({
            authorityIdentity: "c:REQUEST:1",
            workItemId: `candidate-${source}`,
            source,
          }),
      ),
    );
    expect(new Set(results.map(({ workItemId }) => workItemId)).size).toBe(1);
    expect(results.filter(({ created }) => created)).toHaveLength(1);
  });
});

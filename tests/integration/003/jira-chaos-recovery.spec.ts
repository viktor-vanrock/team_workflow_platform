import { describe, expect, it } from "vitest";

import { JiraRequestCreateService } from "../../../packages/connector-jira/src/operational/request-create.ts";
import { TargetExecutionLane } from "../../../packages/platform-core/src/commanding/target-execution-lane.ts";
import { OperationalImportConvergence } from "../../../packages/platform-core/src/work-management/operational-import.ts";

describe("003 crash/concurrency recovery", () => {
  it("converges create/import and retains ambiguous command fencing across restart", async () => {
    let id: string | undefined;
    let creates = 0;
    const service = new JiraRequestCreateService({
      lookup: async () =>
        id ? { state: "FOUND", externalEntityId: id } : { state: "PROVEN_ABSENT" },
      create: async () => {
        creates++;
        id = "1";
        return { externalEntityId: id };
      },
      observe: async (value) => ({
        externalEntityId: value,
        externalDisplayKey: "Q-1",
        externalRevisionToken: "r",
        authorityFieldsHash: "h",
      }),
    });
    await Promise.all([
      service.execute({ effectMarker: "e", fields: {}, subEffects: [] }),
      service.execute({ effectMarker: "e", fields: {}, subEffects: [] }),
    ]);
    expect(creates).toBe(1);
    const convergence = new OperationalImportConvergence();
    expect(
      (
        await Promise.all([
          convergence.adopt({ authorityIdentity: "c:1", workItemId: "w1", source: "CREATE" }),
          convergence.adopt({ authorityIdentity: "c:1", workItemId: "w2", source: "IMPORT" }),
        ])
      ).filter((value) => value.created),
    ).toHaveLength(1);
    const lane = new TargetExecutionLane("c:1");
    const claim = lane.claim("cmd", "effect", new Date(0), 1);
    lane.markAmbiguous("cmd", claim.fencingToken);
    expect(() => lane.claim("other", "other", new Date(100), 1)).toThrow();
  });
});

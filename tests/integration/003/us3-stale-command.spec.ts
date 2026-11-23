import { describe, expect, it } from "vitest";

import { guardJiraCommand } from "../../../packages/connector-jira/src/operational/jira-command-guard.ts";
import { TargetExecutionLane } from "../../../packages/platform-core/src/commanding/target-execution-lane.ts";

describe("US3 stale command", () => {
  it("detects pre-read mismatch before a provider write", () => {
    let writes = 0;
    const result = guardJiraCommand({
      lane: new TargetExecutionLane("c:1"),
      commandId: "cmd",
      effectId: "effect",
      expected: { revisionToken: "r1", valueHash: "v1" },
      observed: { revisionToken: "r2", valueHash: "v2" },
      now: new Date(),
      leaseMs: 1000,
      write: () => {
        writes++;
      },
    });
    expect(result.status).toBe("CONFLICT");
    expect(writes).toBe(0);
  });
});

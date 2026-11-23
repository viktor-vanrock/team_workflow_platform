import { describe, expect, it } from "vitest";

import { confirmJiraCommand } from "../../packages/connector-jira/src/operational/jira-command-confirmation.ts";
import { guardJiraCommand } from "../../packages/connector-jira/src/operational/jira-command-guard.ts";
import { mapJiraAssignment } from "../../packages/connector-jira/src/operational/request-assign.ts";
import { mapJiraDueDate } from "../../packages/connector-jira/src/operational/request-set-due-date.ts";
import { mapJiraPriority } from "../../packages/connector-jira/src/operational/request-set-priority.ts";
import { mapJiraTransition } from "../../packages/connector-jira/src/operational/request-transition.ts";
import { TargetExecutionLane } from "../../packages/platform-core/src/commanding/target-execution-lane.ts";

describe("003 US3 sync/action/conflict E2E", () => {
  it("maps four actions, confirms by post-read and prevents stale overwrite", () => {
    expect(
      mapJiraTransition({
        contractVersion: "1.1.0",
        toStatusKey: "DONE",
        available: [{ id: "11", toStatusKey: "DONE" }],
      }),
    ).toBeTruthy();
    expect(
      mapJiraAssignment({ canonicalPrincipalId: "p", verifiedProviderSubject: "acct" }),
    ).toBeTruthy();
    expect(mapJiraPriority({ normalizedKey: "HIGH", mapping: { HIGH: "1" } })).toBeTruthy();
    expect(mapJiraDueDate({ value: "2026-09-01" })).toBeTruthy();
    let writes = 0;
    const good = guardJiraCommand({
      lane: new TargetExecutionLane("c:1"),
      commandId: "c1",
      effectId: "e1",
      expected: { revisionToken: "r1", valueHash: "v1" },
      observed: { revisionToken: "r1", valueHash: "v1" },
      now: new Date(0),
      leaseMs: 1000,
      write: () => {
        writes++;
      },
    });
    expect(good.status).toBe("EFFECT_STARTED");
    expect(
      confirmJiraCommand({
        requestedValueHash: "v2",
        postReadValueHash: "v2",
        postReadRevisionToken: "r2",
      }).status,
    ).toBe("CONFIRMED");
    const stale = guardJiraCommand({
      lane: new TargetExecutionLane("c:2"),
      commandId: "c2",
      effectId: "e2",
      expected: { revisionToken: "r1", valueHash: "v1" },
      observed: { revisionToken: "r2", valueHash: "human" },
      now: new Date(0),
      leaseMs: 1000,
      write: () => {
        writes++;
      },
    });
    expect(stale.status).toBe("CONFLICT");
    expect(writes).toBe(1);
  });
});

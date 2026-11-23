import { describe, expect, it } from "vitest";

import { mapJiraAssignment } from "../../../packages/connector-jira/src/operational/request-assign.ts";
import { mapJiraDueDate } from "../../../packages/connector-jira/src/operational/request-set-due-date.ts";
import { mapJiraPriority } from "../../../packages/connector-jira/src/operational/request-set-priority.ts";
import { mapJiraTransition } from "../../../packages/connector-jira/src/operational/request-transition.ts";

describe("US3 Jira command conformance", () => {
  it("maps only pinned available operations", () => {
    expect(
      mapJiraTransition({
        contractVersion: "1.1.0",
        toStatusKey: "DONE",
        available: [{ id: "11", toStatusKey: "DONE" }],
      }),
    ).toEqual({ transition: { id: "11" } });
    expect(
      mapJiraAssignment({ canonicalPrincipalId: "p", verifiedProviderSubject: "acct" }),
    ).toEqual({ fields: { assignee: { accountId: "acct" } } });
    expect(mapJiraPriority({ normalizedKey: "HIGH", mapping: { HIGH: "1" } })).toEqual({
      fields: { priority: { id: "1" } },
    });
    expect(mapJiraDueDate({ clear: true })).toEqual({ fields: { duedate: null } });
  });
});

import { describe, expect, it } from "vitest";

import { onOperationalImport } from "../../packages/competency-qa/src/application/on-operational-import.ts";
import { resolveImportCreator } from "../../packages/connector-jira/src/import/import-identity.ts";
import { routeImportCandidate } from "../../packages/connector-jira/src/import/import-router.ts";
import { OperationalImportConvergence } from "../../packages/platform-core/src/work-management/operational-import.ts";

describe("003 US2 direct import E2E", () => {
  it("adopts one verified in-scope issue and leaves an adjacent issue content unread", async () => {
    const profile = {
      workspaceId: "w",
      connectionHeaderId: "c",
      projectId: "100",
      issueTypeId: "10001",
      discriminator: "alpha",
      profileStatus: "VALID" as const,
    };
    let adjacentReads = 0;
    const ignored = await routeImportCandidate(
      {
        workspaceId: "w",
        connectionHeaderId: "c",
        projectId: "200",
        issueTypeId: "10001",
        discriminator: "alpha",
        externalEntityId: "2",
      },
      profile,
      async () => {
        adjacentReads++;
        return {};
      },
    );
    expect(ignored.state).toBe("IGNORED_OUT_OF_SCOPE");
    expect(adjacentReads).toBe(0);
    const routed = await routeImportCandidate(
      {
        workspaceId: "w",
        connectionHeaderId: "c",
        projectId: "100",
        issueTypeId: "10001",
        discriminator: "alpha",
        externalEntityId: "1",
      },
      profile,
      async () => ({ creator: "acct", goal: "Verify" }),
    );
    expect(routed.state).toBe("ROUTED");
    expect(
      resolveImportCreator({
        workspaceId: "w",
        connectionHeaderId: "c",
        creatorSubject: "acct",
        bindings: [
          {
            workspaceId: "w",
            connectionHeaderId: "c",
            externalPrincipalId: "acct",
            kind: "EXTERNAL_HUMAN",
            state: "VERIFIED",
            principalId: "p1",
          },
        ],
      }),
    ).toBe("p1");
    const adoption = await new OperationalImportConvergence().adopt({
      authorityIdentity: "c:REQUEST:1",
      workItemId: "wi1",
      source: "WEBHOOK",
    });
    expect(adoption.created).toBe(true);
    expect(
      onOperationalImport({
        workItemId: adoption.workItemId,
        normalizedOperationalStatus: "NEW",
        requiredFields: ["goal", "acceptanceOutcome"],
        fields: { goal: "Verify" },
      }).completeness,
    ).toBe("NEEDS_INFO");
  });
});

import { describe, expect, it } from "vitest";

import { routeImportCandidate } from "../../packages/connector-jira/src/import/import-router.ts";
import { JiraDefectCreateService } from "../../packages/connector-jira/src/operational/defect-create.ts";
import { guardJiraCommand } from "../../packages/connector-jira/src/operational/jira-command-guard.ts";
import { JiraRequestCreateService } from "../../packages/connector-jira/src/operational/request-create.ts";
import { TargetExecutionLane } from "../../packages/platform-core/src/commanding/target-execution-lane.ts";
import {
  type CompleteOperationalObservation,
  reduceOperationalProjection,
} from "../../packages/platform-core/src/work-management/operational-projection.ts";

describe("003 full operational-authority journey", () => {
  it("covers requester create, direct import, executor sync/action and approved defect", async () => {
    const issues = new Map<string, string>();
    let createCount = 0;
    const port = {
      lookup: async (marker: string) =>
        issues.has(marker)
          ? ({ state: "FOUND", externalEntityId: issues.get(marker)! } as const)
          : ({ state: "PROVEN_ABSENT" } as const),
      create: async ({ marker }: { marker: string }) => {
        const id = String(++createCount);
        issues.set(marker, id);
        return { externalEntityId: id };
      },
      observe: async (id: string) => ({
        externalEntityId: id,
        externalDisplayKey: `Q-${id}`,
        externalRevisionToken: `r${id}`,
        authorityFieldsHash: `h${id}`,
      }),
    };
    const request = await new JiraRequestCreateService(port).execute({
      effectMarker: "request",
      fields: { summary: "QA" },
      subEffects: [],
    });
    expect(request.status).toBe("CONFIRMED");
    expect(
      (
        await routeImportCandidate(
          {
            projectId: "100",
            issueTypeId: "qa",
            discriminator: "alpha",
            externalEntityId: "direct",
          },
          { projectId: "100", issueTypeId: "qa", discriminator: "alpha", profileStatus: "VALID" },
          async () => ({ creator: "verified" }),
        )
      ).state,
    ).toBe("ROUTED");
    const observation = {
      observationId: "o",
      source: "RECONCILIATION_READ",
      externalEntityId: "1",
      externalDisplayKey: "Q-1",
      externalRevisionToken: "r1",
      authorityFieldsHash: "h1",
      providerUpdatedAt: "2026-08-31T00:00:00Z",
      observedAt: "2026-08-31T00:00:01Z",
      rawStatus: { id: "1", name: "Open" },
      normalizedStatus: "NEW",
      requester: { externalPrincipalId: "acct" },
      profileRef: { id: "p", version: 1 },
      mappingRef: { id: "m", version: 1 },
      connectionRef: { id: "c", version: 1 },
      adapterFamily: "cloud",
      adapterContractVersion: "1",
    } as CompleteOperationalObservation;
    expect(reduceOperationalProjection(undefined, observation).disposition).toBe("APPLIED");
    let writes = 0;
    expect(
      guardJiraCommand({
        lane: new TargetExecutionLane("c:1"),
        commandId: "cmd",
        effectId: "action",
        expected: { revisionToken: "r1", valueHash: "h1" },
        observed: { revisionToken: "r1", valueHash: "h1" },
        now: new Date(0),
        leaseMs: 1000,
        write: () => {
          writes++;
        },
      }).status,
    ).toBe("EFFECT_STARTED");
    expect(writes).toBe(1);
    const defect = await new JiraDefectCreateService(port).execute({
      effectMarker: "defect",
      fields: { summary: "Bug" },
      subEffects: [],
    });
    expect(defect.status).toBe("CONFIRMED");
    expect(createCount).toBe(2);
  });
});

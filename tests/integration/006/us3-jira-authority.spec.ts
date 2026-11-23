import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  prepareQueueControlAction,
  queueControlDefaultState,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

describe("US3 Jira authority separation", () => {
  it("accepted planning/service-class controls contain no Jira status, priority, due, or assignment mutation", () => {
    const operational = {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: "jira",
      sourceVersion: 1,
      semanticHash: digest("jira"),
      confirmedAt: "2026-09-03T08:00:00Z",
    } as const;
    const queueEntry = {
      queueEntryId: "q",
      revision: 1,
      semanticHash: digest("q"),
      inputFingerprint: digest("qi"),
    } as const;
    const policyRef = { id: "policy", version: 1, semanticHash: digest("policy") } as const;
    const current = queueControlDefaultState({
      controlId: "control",
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      operationalProjectionRef: operational,
      qaSourceSetHash: digest("qa"),
      policyRef,
    });
    const pair = prepareQueueControlAction({
      actionId: "action",
      requestKey: "key",
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      workItemRef: {
        sourceType: "WORK_ITEM_REVISION",
        sourceId: "wi",
        sourceVersion: 1,
        semanticHash: digest("wi"),
      },
      current,
      currentQueueEntry: queueEntry,
      expectedState: {
        kind: "WORK_ITEM_CONTROL",
        policyRef,
        expectedControlVersion: 0,
        expectedQueueEntry: queueEntry,
        operationalProjectionRef: operational,
        qaSourceSetHash: digest("qa"),
      },
      effect: {
        kind: "ACCEPT_PLANNING_VALUES",
        after: {
          risk: "HIGH",
          businessImpact: "HIGH",
          dependencyReadiness: "READY",
          effortRange: { kind: "UNKNOWN" },
        },
      },
      reason: "Accepted by human",
    });
    expect(JSON.stringify(pair)).not.toMatch(
      /jiraStatus|jiraPriority|assignment|set-priority|set-due-date/u,
    );
  });

  it("keeps Jira mutations on the existing exact Connector command and confirmation path", () => {
    const source = readFileSync(
      new URL("../../../apps/api/src/extensions/qa-defects.controller.ts", import.meta.url),
      "utf8",
    );
    const operationalController = readFileSync(
      new URL(
        "../../../packages/platform-runtime-nest/src/http/operational-authority.controller.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const runtime = readFileSync(
      new URL("../../../apps/api/src/local/local-qa-defect-approval.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("QA_DEFECT_APPROVAL_RUNTIME");
    expect(source).toContain("this.approvals.approve");
    expect(runtime).toMatch(/ConnectorCommand|consumeEffectAuthorization/u);
    expect(operationalController).toMatch(/request\.set-priority/u);
    expect(operationalController).toMatch(/request\.set-due-date/u);
  });
});

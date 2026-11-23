import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  publishQueuePolicy,
  validateQueuePolicy,
} from "../../../packages/platform-core/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { cloneJson } from "../../helpers/006/triage-fixture.ts";
import { requiredFixture } from "../../support/fixture-value.ts";

describe("US4 policy publication contracts", () => {
  it("publishes an open-ended calendar and MEASURE_ONLY policy with null/empty enforcement fields", () => {
    const calendar = businessCalendarFixture();
    const policy = queuePolicyFixture("MEASURE_ONLY", calendar);
    expect(
      designContractRegistry.validateById("urn:awp:schemas:006:business-calendar:v1", calendar),
    ).toBe(calendar);
    expect(designContractRegistry.validateById("urn:awp:schemas:006:queue-policy:v1", policy)).toBe(
      policy,
    );
    expect(policy).toMatchObject({ workspaceHumanWipLimit: null, activeExpediteLimit: null });
    expect(
      policy.slaGoals.every(
        ({ targetBusinessSeconds, warningThresholds }) =>
          targetBusinessSeconds === null && warningThresholds.length === 0,
      ),
    ).toBe(true);
    expect(policy.projectEntries).toEqual([
      expect.objectContaining({ softWipLimit: null, reservedCapacity: null }),
    ]);
  });

  it("requires ENFORCED baseline evidence, numeric limits, and complete optional Project entries", () => {
    const calendar = businessCalendarFixture();
    const policy = queuePolicyFixture("ENFORCED", calendar);
    expect(designContractRegistry.validateById("urn:awp:schemas:006:queue-policy:v1", policy)).toBe(
      policy,
    );
    expect(policy).toMatchObject({
      workspaceHumanWipLimit: 2,
      activeExpediteLimit: 1,
      baselineEvidenceRef: { sourceType: "QA_READINESS_FACT_SET" },
    });
    const missingBaseline = cloneJson(policy) as unknown as Record<string, unknown>;
    delete missingBaseline.baselineEvidenceRef;
    expect(() =>
      validateQueuePolicy(
        missingBaseline as unknown as Parameters<typeof validateQueuePolicy>[0],
        calendar,
      ),
    ).toThrow("QUEUE_POLICY_ENFORCED_LIMIT_REQUIRED");
    const incompleteProject = cloneJson(policy) as unknown as Record<string, unknown>;
    const incompleteEntries = incompleteProject.projectEntries as Array<Record<string, unknown>>;
    delete requiredFixture(incompleteEntries[0]).reservedCapacity;
    expect(() =>
      designContractRegistry.validateById("urn:awp:schemas:006:queue-policy:v1", incompleteProject),
    ).toThrow();
    const { semanticHash: _hash, ...content } = policy;
    void _hash;
    const noProjectAllocation = { ...content, projectEntries: [] };
    expect(publishQueuePolicy(noProjectAllocation, calendar)).toMatchObject({
      workspaceId: policyIds.workspace,
      projectEntries: [],
    });
  });

  it("rejects finite calendars for active policy publication and hidden MEASURE_ONLY limits", () => {
    const finite = businessCalendarFixture({ validThrough: "2026-12-31" });
    expect(() => queuePolicyFixture("MEASURE_ONLY", finite)).toThrow(
      "QUEUE_POLICY_CALENDAR_MUST_BE_OPEN_ENDED",
    );
    const calendar = businessCalendarFixture();
    const measure = cloneJson(queuePolicyFixture("MEASURE_ONLY", calendar)) as unknown as Record<
      string,
      unknown
    >;
    measure.workspaceHumanWipLimit = 1;
    expect(() =>
      validateQueuePolicy(
        measure as unknown as Parameters<typeof validateQueuePolicy>[0],
        calendar,
      ),
    ).toThrow("QUEUE_POLICY_MEASURE_ONLY_ENFORCEMENT_FORBIDDEN");
  });
});

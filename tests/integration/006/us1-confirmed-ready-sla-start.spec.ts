import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  createInitialSlaClock,
  detectConfirmedJiraSlaStart,
} from "../../../packages/platform-core/src/work-management/sla-clock.ts";

const exact = {
  sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
  sourceId: "op-1",
  sourceVersion: 4,
  semanticHash: `sha256:${"a".repeat(64)}` as const,
  observedAt: "2026-09-02T09:00:00.000Z",
  confirmedAt: "2026-09-02T09:05:00.000Z",
};

describe("US1 confirmed Jira SLA start", () => {
  it("does not start from local DoR or a pending Jira command", () => {
    expect(
      detectConfirmedJiraSlaStart({
        operationalState: "PENDING",
        normalizedStatus: "READY",
        currentReadiness: "READY",
        operationalRef: exact,
      }),
    ).toEqual({ state: "NOT_STARTED", reason: "OPERATIONAL_CONFIRMATION_REQUIRED" });
  });

  it("starts at platform confirmedAt, never provider observedAt", () => {
    expect(
      detectConfirmedJiraSlaStart({
        operationalState: "CONFIRMED",
        normalizedStatus: "READY",
        currentReadiness: "READY",
        operationalRef: exact,
      }),
    ).toMatchObject({ state: "START", effectiveAt: exact.confirmedAt, startSourceRef: exact });
  });

  it("can start while missing current DoR leaves queue stage in Backlog", () => {
    expect(
      detectConfirmedJiraSlaStart({
        operationalState: "CONFIRMED",
        normalizedStatus: "PLANNED",
        currentReadiness: "NOT_ASSESSED",
        operationalRef: exact,
      }),
    ).toMatchObject({ state: "START", effectiveAt: exact.confirmedAt });
  });

  it("pins policy, calendar, mapping and confirmed start authority in revision one", () => {
    const transition = createInitialSlaClock({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      workItemId: "00000000-0000-4000-8000-000000000003",
      slaClockId: "00000000-0000-4000-8000-000000000004",
      goal: "READY_TO_FIRST_QA_START",
      startSourceRef: { ...exact, sourceId: "00000000-0000-4000-8000-000000000005" },
      policyFacetRef: {
        id: "00000000-0000-4000-8000-000000000006",
        version: 2,
        semanticHash: `sha256:${"b".repeat(64)}` as const,
      },
      calendarRef: {
        id: "00000000-0000-4000-8000-000000000007",
        version: 3,
        semanticHash: `sha256:${"c".repeat(64)}` as const,
      },
      mappingRef: {
        sourceType: "JIRA_STATUS_MAPPING_REVISION",
        sourceId: "00000000-0000-4000-8000-000000000008",
        sourceVersion: 4,
        semanticHash: `sha256:${"d".repeat(64)}` as const,
      },
      algorithmRef: {
        key: "sla-business-time",
        version: "1.0.0",
        semanticHash: `sha256:${"e".repeat(64)}` as const,
      },
    });
    expect(transition).toMatchObject({
      transition: "START",
      clockCycle: 1,
      currentClockState: "RUNNING",
      startedAt: exact.confirmedAt,
      mappingRef: { sourceVersion: 4 },
      clockRevisionRef: { version: 1 },
    });
    expect(transition.clockRevisionRef.semanticHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:schemas:006:sla-clock-transition:v1",
        transition as never,
      ),
    ).not.toThrow();
  });
});

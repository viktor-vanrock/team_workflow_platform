import { describe, expect, it, vi } from "vitest";

import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
} from "../../../packages/platform-core/src/index.ts";
import {
  evaluateSlaSnapshot,
  type ProjectSlaQueryDependencies,
  ProjectSlaQueryService,
  slaSnapshotSetEtag,
  validateSlaSnapshotSet,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `65000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function runningFixture() {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(
    queuePolicyFixture("ENFORCED", calendar),
    policyIds.projectA,
    { id: id("1"), version: 1 },
  );
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("2"),
    slaClockId: id("3"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: policy.policyFacetRef,
    calendarRef: policy.calendarRef,
    mappingRef: {
      ...policy.statusMappingRef,
      sourceVersion: Number(policy.statusMappingRef.sourceVersion),
    },
    algorithmRef: {
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: sha256({ key: "sla-business-time", version: "1.0.0" }),
    },
    startSourceRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 7,
      semanticHash: digest("jira-ready"),
      observedAt: "2026-09-07T04:59:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    },
  });
  const openSegment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id("5"),
  }).opened!;
  return { calendar, policy, transition, openSegment, target: policy.slaGoals[0]! };
}

describe("US5 SLA response contracts", () => {
  it("returns the closed default goal set with one server asOf when policy is not published", async () => {
    const provider = { read: vi.fn() };
    const model = { invoke: vi.fn() };
    const dependencies: ProjectSlaQueryDependencies = {
      authorize: vi.fn().mockResolvedValue(true),
      workItemExists: vi.fn().mockResolvedValue(true),
      currentPolicyFacet: vi.fn().mockResolvedValue(undefined),
      policyFacetByRef: vi.fn(),
      calendarByRef: vi.fn(),
      currentClock: vi.fn().mockResolvedValue(undefined),
      openSegment: vi.fn(),
      now: () => "2026-09-07T09:00:00.000Z",
      provider,
      model,
    };
    const response = await new ProjectSlaQueryService(dependencies).read({
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: id("2"),
      principalId: id("6"),
    });
    expect(response.snapshots.map(({ goal }) => goal).sort()).toEqual([
      "READY_TO_FIRST_QA_START",
      "READY_TO_SIGNED_VERDICT",
    ]);
    expect(
      response.snapshots.every(
        (snapshot) =>
          snapshot.asOf === "2026-09-07T09:00:00.000Z" &&
          snapshot.clockState === "NOT_STARTED" &&
          snapshot.notStartedReason === "POLICY_NOT_PUBLISHED" &&
          snapshot.policyFacetRef === undefined,
      ),
    ).toBe(true);
    for (const snapshot of response.snapshots) {
      expect(() =>
        designContractRegistry.validateById(
          "urn:awp:schemas:006:sla-snapshot:v1",
          snapshot as never,
        ),
      ).not.toThrow();
    }
    expect(provider.read).not.toHaveBeenCalled();
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it("keeps the durable clock ref stable while server-time elapsed and evaluation hash change", () => {
    const value = runningFixture();
    const first = evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T08:00:00.000Z" });
    const second = evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T09:00:00.000Z" });
    expect(first.clockRevisionRef).toEqual(second.clockRevisionRef);
    expect(first).toMatchObject({
      clockState: "RUNNING",
      lastTransition: "START",
      elapsedBusinessSeconds: 10_800,
      targetState: "ON_TRACK",
      providerStartObservedAt: "2026-09-07T04:59:00.000Z",
    });
    expect(second).toMatchObject({ elapsedBusinessSeconds: 14_400, targetState: "AT_RISK" });
    expect(first.evaluationHash).not.toBe(second.evaluationHash);
    expect(slaSnapshotSetEtag([first])).not.toBe(slaSnapshotSetEtag([second]));
    expect(() =>
      designContractRegistry.validateById("urn:awp:schemas:006:sla-snapshot:v1", first as never),
    ).not.toThrow();
    expect(() =>
      designContractRegistry.validateById("urn:awp:schemas:006:sla-snapshot:v1", second as never),
    ).not.toThrow();
  });

  it("requires exact path scope, one shared asOf, unique goals and exact evaluation hashes", () => {
    const value = runningFixture();
    const snapshot = evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T08:00:00.000Z" });
    const input = {
      snapshots: [snapshot],
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: id("2"),
      asOf: snapshot.asOf,
      expectedGoals: ["READY_TO_FIRST_QA_START" as const],
    };
    expect(() => validateSlaSnapshotSet(input)).not.toThrow();
    expect(() => validateSlaSnapshotSet({ ...input, projectId: policyIds.projectB })).toThrow(
      "SLA_SNAPSHOT_SET_INVALID",
    );
    expect(() =>
      validateSlaSnapshotSet({
        ...input,
        snapshots: [snapshot, snapshot],
        expectedGoals: ["READY_TO_FIRST_QA_START"],
      }),
    ).toThrow("SLA_SNAPSHOT_SET_INVALID");
    expect(() =>
      validateSlaSnapshotSet({
        ...input,
        snapshots: [{ ...snapshot, evaluationHash: digest("tampered") }],
      }),
    ).toThrow("SLA_SNAPSHOT_SET_INVALID");
  });

  it("builds a strong representation ETag over exact ordered snapshots", () => {
    const value = runningFixture();
    const snapshot = evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T08:00:00.000Z" });
    const etag = slaSnapshotSetEtag([snapshot]);
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/u);
    expect(etag).toBe(slaSnapshotSetEtag([snapshot]));
  });
});

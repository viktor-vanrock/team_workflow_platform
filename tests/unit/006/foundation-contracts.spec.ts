import { describe, expect, it } from "vitest";

import type { JsonValue } from "../../../packages/platform-contracts/src/index.ts";
import {
  assertAuthorizedQueueScope,
  type BusinessCalendarRevision,
  createExactApproval,
  createPlatformActionApprovalV2,
  createQueueActionPair,
  type MeasureOnlyQueuePolicyRevision,
  parseApprovalSubject,
  PlatformActionExecutionGuardRegistry,
  projectQueuePolicyNeutralView,
  projectSafeQueueAuthorizationWitness,
  publishBusinessCalendar,
  publishQueuePolicy,
  type QueueActionCandidateForApproval,
  QueueActionConsumerRegistry,
  type QueueControlAction,
  queueSourceSetHash,
} from "../../../packages/platform-core/src/index.ts";
import { requiredFixture } from "../../support/fixture-value.ts";

const id = (suffix: string): string => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function calendar(): BusinessCalendarRevision {
  return publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: id("1"),
    calendarKey: "qa-default",
    workspaceId: id("2"),
    revision: 1,
    timeZone: "Europe/Samara",
    validFrom: "2026-01-01",
    validThrough: null,
    weeklyIntervals: [
      { dayOfWeek: "MONDAY", startLocalTime: "09:00:00", endLocalTime: "18:00:00" },
    ],
    dateOverrides: [],
    dstAlgorithmRef: { key: "business-calendar-dst", version: "1.0.0", semanticHash: hash("a") },
    dstRules: {
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP",
      ambiguousStart: "EARLIEST_MATCHING_INSTANT",
      ambiguousEnd: "LATEST_MATCHING_INSTANT",
    },
    sourceKind: "MANUAL",
    sourceRef: "calendar-draft:1",
    sourceHash: hash("b"),
    ownerPrincipalId: id("3"),
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    publishedByPrincipalId: id("3"),
  });
}

function measurePolicy(projectId: string): MeasureOnlyQueuePolicyRevision {
  const sourceCalendar = calendar();
  return publishQueuePolicy(
    {
      schemaVersion: "queue-policy@1.0.0",
      queuePolicyId: id("4"),
      policyKey: "qa-default",
      workspaceId: sourceCalendar.workspaceId,
      revision: 1,
      mode: "MEASURE_ONLY",
      calendarRef: {
        id: sourceCalendar.calendarId,
        version: sourceCalendar.revision,
        semanticHash: sourceCalendar.semanticHash,
      },
      comparatorRef: { key: "queue-order", version: "1.0.0", semanticHash: hash("c") },
      stageRuleRef: { key: "queue-stage", version: "1.0.0", semanticHash: hash("d") },
      statusMappingRef: {
        sourceType: "JIRA_STATUS_MAPPING_REVISION",
        sourceId: id("5"),
        sourceVersion: 1,
        semanticHash: hash("e"),
      },
      serviceClassRules: {
        initialClass: "STANDARD",
        fixedDateRequiresConfirmedDueDate: true,
        expediteRequiresExactAction: true,
        overrideSeparationOfDuty: "SELF_APPROVAL_FORBIDDEN",
      },
      workspaceHumanWipLimit: null,
      activeExpediteLimit: null,
      externalActiveConsumesWip: ["IN_PROGRESS"],
      blockReasonRules: [],
      slaGoals: [
        {
          goal: "READY_TO_FIRST_QA_START",
          startNormalizedStatuses: ["READY"],
          stopEvent: "FIRST_CONSUMING_SESSION_STARTED",
          targetBusinessSeconds: null,
          warningThresholds: [],
        },
      ],
      agingBands: [],
      projectEntries: [
        {
          projectId,
          softWipLimit: null,
          reservedCapacity: null,
          explanation: `entry-${projectId}`,
        },
      ],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      publishedAt: "2026-01-01T00:00:00.000Z",
      publishedByPrincipalId: id("3"),
    },
    sourceCalendar,
  ) as MeasureOnlyQueuePolicyRevision;
}

function queueCandidate(): QueueActionCandidateForApproval {
  const workItemRef = {
    sourceType: "WORK_ITEM_REVISION",
    sourceId: id("10"),
    sourceVersion: 2,
    semanticHash: hash("1"),
  };
  const queueEntry = {
    queueEntryId: id("11"),
    revision: 3,
    semanticHash: hash("2"),
    inputFingerprint: hash("3"),
  };
  return {
    schemaVersion: "queue-action-candidate@1.0.0",
    actionId: id("12"),
    actionKind: "SERVICE_CLASS_EXPEDITE",
    scope: { kind: "PROJECT", workspaceId: id("2"), projectId: id("9") },
    target: { kind: "WORK_ITEM", workspaceId: id("2"), projectId: id("9"), workItemRef },
    requestHash: hash("4"),
    expectedVisibleState: {
      kind: "CAPACITY",
      policyFacetRef: { id: id("13"), version: 1, semanticHash: hash("5") },
      policyMode: "ENFORCED",
      expectedControlVersion: 0,
      expectedQueueEntry: queueEntry,
      authorizedCapacitySnapshotRef: { id: id("14"), version: 1, semanticHash: hash("6") },
      operationalProjectionRef: {
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
        sourceId: id("15"),
        sourceVersion: 4,
        semanticHash: hash("7"),
        confirmedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    requestedEffect: {
      kind: "SET_EXPEDITE",
      beforeServiceClass: "STANDARD",
      afterServiceClass: "EXPEDITE",
      reviewAt: "2026-01-03T00:00:00.000Z",
    },
    reason: "Production defect requires expedited validation",
    expiresAt: "2026-01-02T00:00:00.000Z",
    approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
  };
}

function privateWitness(
  candidate: QueueActionCandidateForApproval,
): Omit<QueueControlAction, "actionHash"> {
  return {
    schemaVersion: "queue-control-action@1.0.0",
    actionId: candidate.actionId,
    actionKind: candidate.actionKind,
    scope: candidate.scope,
    target: candidate.target,
    expectedState: {
      kind: "CAPACITY",
      policyRef: { id: id("16"), version: 7, semanticHash: hash("8") },
      policyMode: "ENFORCED",
      expectedControlVersion: 0,
      expectedQueueEntry: requiredFixture(
        (candidate.expectedVisibleState as Record<string, JsonValue>).expectedQueueEntry,
      ),
      expectedCapacityHeadVersion: 8,
      workspaceHumanWipLimit: 3,
      activeExpediteLimit: 1,
      humanOccupiedCount: 2,
      reviewReservedCount: 0,
      humanCommittedCount: 2,
      forcedExternalCount: 0,
      activeExpediteCount: 0,
      claimSetHash: hash("9"),
      reservationSetHash: hash("a"),
      expediteSetHash: hash("b"),
      operationalProjectionRef: requiredFixture(
        (candidate.expectedVisibleState as Record<string, JsonValue>).operationalProjectionRef,
      ),
    },
    requestedEffect: candidate.requestedEffect as Readonly<Record<string, never>>,
    reason: candidate.reason,
    expiresAt: requiredFixture(candidate.expiresAt),
    approvalPolicy: candidate.approvalPolicy,
    idempotencyKeyHash: hash("c"),
  };
}

describe("Feature 006 foundation domain contracts", () => {
  it("hashes exact source sets and rejects a forged authorized Project-set token", () => {
    const refs = [
      {
        sourceType: "WORK_ITEM_REVISION" as const,
        sourceId: "b",
        sourceVersion: 2,
        semanticHash: hash("a"),
      },
      {
        sourceType: "WORK_ITEM_REVISION" as const,
        sourceId: "a",
        sourceVersion: 1,
        semanticHash: hash("b"),
      },
    ];
    expect(queueSourceSetHash(refs)).toBe(queueSourceSetHash([...refs].reverse()));
    expect(() =>
      assertAuthorizedQueueScope({
        principalId: id("3"),
        workspaceId: id("2"),
        authorizedProjectIds: [id("9")],
        authorizedProjectSetHash: hash("f"),
      }),
    ).toThrow("AUTHORIZED_PROJECT_SET_HASH_MISMATCH");
  });

  it("publishes immutable measure-only policy and keeps its neutral view stable under hidden Project churn", () => {
    const first = measurePolicy(id("8"));
    const second = measurePolicy(id("9"));
    expect(first.workspaceHumanWipLimit).toBeNull();
    expect(first.semanticHash).not.toBe(second.semanticHash);
    expect(
      projectQueuePolicyNeutralView(first, { id: id("20"), version: 1 }).policyViewRef.semanticHash,
    ).toBe(
      projectQueuePolicyNeutralView(second, { id: id("20"), version: 1 }).policyViewRef
        .semanticHash,
    );
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("constructs exact Approval v2 candidate bindings and keeps legacy Approval reads", () => {
    const candidate = queueCandidate();
    const witness = projectSafeQueueAuthorizationWitness(
      candidate.scope,
      {
        workspaceId: id("2"),
        projectId: id("9"),
        requiredPermission: "queue.control.decide",
        classificationDecision: "ALLOW_CONFIDENTIAL",
        membershipRef: { id: "private" },
      },
      "2026-01-01T00:00:00.000Z",
    );
    const approval = createPlatformActionApprovalV2({
      approvalId: id("21"),
      workspaceId: id("2"),
      projectId: id("9"),
      initiator: { kind: "HUMAN", principalId: id("3"), issuer: "local", subject: "requester" },
      initiatorAuthorizationScopeWitness: witness,
      action: {
        actionKind: "PLATFORM_ACTION",
        actionId: candidate.actionId,
        commandType: "queue.service-class.set",
      },
      candidate,
      requiredPermission: "queue.control.decide",
      effectIdempotencyKey: "awp:queue-action:12",
      dataClassificationKey: "CONFIDENTIAL",
      expiresAt: candidate.expiresAt!,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(approval.payloadHash).toBe(approval.expectedLocalState.contentHash);
    expect(() => parseApprovalSubject({ ...approval, payloadHash: hash("0") })).toThrow(
      "APPROVAL_V2_SUBJECT_HASH_MISMATCH",
    );

    const legacy = createExactApproval({
      id: id("22"),
      workspaceId: id("2"),
      projectId: id("9"),
      initiatorId: id("3"),
      initiator: { kind: "HUMAN", principalId: id("3"), issuer: "local", subject: "requester" },
      action: { actionKind: "PLATFORM_ACTION", actionId: id("23"), commandType: "legacy.action" },
      target: { id: "target" },
      targetHash: hash("1"),
      payloadHash: hash("2"),
      expectedState: { version: 1 },
      bindingRef: { id: id("24"), version: 1 },
      profileRefs: [],
      requiredPermission: "project.admin",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
      effectIdempotencyKey: "legacy:23",
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(
      (parseApprovalSubject(JSON.stringify(legacy)) as typeof legacy).expiresAt,
    ).toBeInstanceOf(Date);
  });

  it("pairs public/private queue actions exactly and fails closed without a registered consumer or guard", async () => {
    const candidate = queueCandidate();
    const pair = createQueueActionPair({ candidate, witness: privateWitness(candidate) });
    expect(pair.publicIntentHash).not.toBe(pair.actionHash);
    expect(
      Object.keys(
        projectSafeQueueAuthorizationWitness(
          candidate.scope,
          {
            workspaceId: id("2"),
            projectId: id("9"),
            requiredPermission: "queue.control.decide",
            classificationDecision: "ALLOW_CONFIDENTIAL",
            membershipRef: { id: "private" },
            entitlementRefs: [{ id: "private" }],
            roleAssignmentRefs: [{ id: "private" }],
          },
          "2026-01-01T00:00:00.000Z",
        ),
      ),
    ).not.toEqual(
      expect.arrayContaining(["membershipRef", "entitlementRefs", "roleAssignmentRefs"]),
    );
    expect(() => new QueueActionConsumerRegistry([]).consumerFor(pair)).toThrow(
      "QUEUE_ACTION_CONSUMER_NOT_FOUND",
    );
    await expect(
      new PlatformActionExecutionGuardRegistry().verify(
        {
          id: pair.actionId,
          kind: pair.candidate.actionKind,
          candidate: pair.candidate,
          candidateHash: pair.publicIntentHash,
          initiatorId: id("3"),
          state: "PENDING_APPROVAL",
          rowVersion: 1,
        },
        {
          workspaceId: id("2"),
          projectId: id("9"),
          approvalId: id("21"),
          approverId: id("25"),
          authorizationBasisHash: hash("f"),
        },
      ),
    ).rejects.toThrow("PLATFORM_ACTION_GUARD_NOT_FOUND");
  });
});

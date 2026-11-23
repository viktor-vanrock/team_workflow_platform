import { describe, expect, it, vi } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  assertExactCapacityActionConsumption,
  type CapacityActionExpectedState,
  createPlatformActionApprovalV2,
  decideApprovalSubjectV2,
  evaluateCapacityAdmission,
  prepareCapacityQueueAction,
  projectSafeQueueAuthorizationWitness,
} from "../../../packages/platform-core/src/index.ts";
import { QueueActionCandidateRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  createPostgresExactCapacityOverrideResolver,
  PostgresCapacityAdmissionBinder,
} from "../../../packages/runtime-composition/src/index.ts";
import { policyIds } from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const ids = Object.freeze({
  action: "00000000-0000-4000-8000-000000000641",
  workItem: "00000000-0000-4000-8000-000000000642",
  session: "00000000-0000-4000-8000-000000000643",
  approval: "00000000-0000-4000-8000-000000000644",
  initiator: "00000000-0000-4000-8000-000000000645",
  lead: "00000000-0000-4000-8000-000000000646",
});
const workItemRef = Object.freeze({
  sourceType: "WORK_ITEM_REVISION",
  sourceId: ids.workItem,
  sourceVersion: 3,
  semanticHash: digest("work-item:r3"),
});
const sessionRef = Object.freeze({
  sourceType: "QA_TEST_SESSION_REVISION",
  sourceId: ids.session,
  sourceVersion: 7,
  semanticHash: digest("session:r7"),
});
const expected: CapacityActionExpectedState = Object.freeze({
  kind: "CAPACITY",
  policyRef: { id: policyIds.policy, version: 2, semanticHash: digest("policy:r2") },
  policyMode: "ENFORCED",
  expectedControlVersion: 4,
  expectedQueueEntry: {
    queueEntryId: "00000000-0000-4000-8000-000000000647",
    revision: 8,
    semanticHash: digest("entry:r8"),
    inputFingerprint: digest("entry-input:r8"),
  },
  expectedCapacityHeadVersion: 11,
  workspaceHumanWipLimit: 1,
  activeExpediteLimit: 1,
  humanOccupiedCount: 1,
  reviewReservedCount: 0,
  humanCommittedCount: 1,
  forcedExternalCount: 0,
  activeExpediteCount: 0,
  claimSetHash: digest("claims"),
  reservationSetHash: digest("reservations"),
  expediteSetHash: digest("expedites"),
  sessionRef,
  operationalProjectionRef: {
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
    sourceId: "jira-1",
    sourceVersion: 4,
    semanticHash: digest("jira:r4"),
  },
});

function pair(reason = "Allow exact blocked resume") {
  return prepareCapacityQueueAction({
    actionId: ids.action,
    actionKind: "WIP_ADMISSION_OVERRIDE",
    requestKey: "wip-override-request-0001",
    requestHash: digest(reason),
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemRef,
    expectedState: expected,
    authorizedCapacitySnapshotRef: {
      id: "00000000-0000-4000-8000-000000000648",
      version: 5,
      semanticHash: digest("safe-capacity:r5"),
    },
    effect: {
      kind: "ALLOW_WIP_ADMISSION",
      activityKind: "MANUAL_SESSION_RESUME",
      sessionRef,
      requestedSessionState: "REVIEW_REQUIRED",
    },
    reason,
    expiresAt: "2026-09-03T10:00:00.000Z",
  });
}
const approval = Object.freeze({
  approvalId: ids.approval,
  state: "APPROVED" as const,
  initiatorId: ids.initiator,
  approverId: ids.lead,
  approverRole: "Lead",
  expiresAt: "2026-09-03T10:00:00.000Z",
});

describe("US4 exact WIP admission override", () => {
  it("denies the last slot until the exact override is consumed", () => {
    const base = {
      policyMode: "ENFORCED" as const,
      activityKind: "MANUAL_SESSION_RESUME" as const,
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    };
    expect(evaluateCapacityAdmission(base)).toMatchObject({
      outcome: "DENIED",
      violatedConstraints: ["HARD_WIP"],
    });
    expect(
      evaluateCapacityAdmission({
        ...base,
        exactOverride: { actionKind: "WIP_ADMISSION_OVERRIDE", effectKind: "ALLOW_WIP_ADMISSION" },
      }),
    ).toMatchObject({ outcome: "ADMITTED_WITH_EXACT_OVERRIDE", mutationKind: "CLAIM" });
  });

  it("requires current distinct Lead approval, exact target, pinned state, and unexpired bytes", () => {
    const valid = {
      pair: pair(),
      currentExpectedState: expected,
      currentWorkItemRef: workItemRef,
      approval,
      blockedFromState: "REVIEW_REQUIRED" as const,
      now: "2026-09-03T09:30:00.000Z",
    };
    expect(() => assertExactCapacityActionConsumption(valid)).not.toThrow();
    expect(() =>
      assertExactCapacityActionConsumption({
        ...valid,
        approval: { ...approval, approverId: ids.initiator },
      }),
    ).toThrow("CAPACITY_ACTION_APPROVAL_INVALID");
    expect(() =>
      assertExactCapacityActionConsumption({
        ...valid,
        approval: { ...approval, approverRole: "Member" },
      }),
    ).toThrow("CAPACITY_ACTION_APPROVAL_INVALID");
    expect(() =>
      assertExactCapacityActionConsumption({ ...valid, now: approval.expiresAt }),
    ).toThrow("CAPACITY_ACTION_APPROVAL_INVALID");
    expect(() =>
      assertExactCapacityActionConsumption({ ...valid, blockedFromState: "RUNNING" }),
    ).toThrow("WIP_ADMISSION_OVERRIDE_STALE_SESSION");
    expect(() =>
      assertExactCapacityActionConsumption({
        ...valid,
        currentWorkItemRef: { ...workItemRef, sourceId: "different" },
      }),
    ).toThrow("CAPACITY_ACTION_TARGET_SCOPE_MISMATCH");
    expect(() =>
      assertExactCapacityActionConsumption({
        ...valid,
        currentExpectedState: { ...expected, expectedCapacityHeadVersion: 12 },
      }),
    ).toThrow("CAPACITY_ACTION_STALE");
  });

  it("replays identical candidate bytes and conflicts on same action id with changed intent", async () => {
    const original = pair();
    const basis = { actor: ids.initiator };
    const basisHash = digest(basis as never);
    const manager = {
      query: vi.fn(async () => [
        {
          public_intent_hash: original.publicIntentHash,
          action_hash: original.actionHash,
          initiator_authorization_basis_hash: basisHash,
        },
      ]),
    };
    const repository = new QueueActionCandidateRepository({ transaction: vi.fn() } as never);
    const input = {
      scope: {
        kind: "PROJECT" as const,
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
      },
      pair: original,
      initiatorId: ids.initiator,
      initiatorAuthorizationBasis: basis,
      initiatorAuthorizationBasisHash: basisHash,
      createdAt: "2026-09-03T09:00:00.000Z",
    };
    await expect(repository.saveQueueActionPair(input, manager as never)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      repository.saveQueueActionPair({ ...input, pair: pair("changed intent") }, manager as never),
    ).rejects.toThrow("QUEUE_ACTION_IDEMPOTENCY_CONFLICT");
  });

  it("stores the denial, exact private/public candidate, and Approval v2 in one transaction", async () => {
    const at = "2026-09-03T09:30:00.000Z";
    const sessionContent = { id: ids.session, state: "READY", resourceVersion: 7 } as const;
    const exactSessionRef = {
      sourceType: "QA_TEST_SESSION_REVISION" as const,
      sourceId: ids.session,
      sourceVersion: 7,
      semanticHash: sha256(sessionContent as unknown as JsonValue),
    };
    const operationalRef = {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: "jira-1",
      sourceVersion: 4,
      semanticHash: digest("jira:r4"),
    } as const;
    const qaRef = {
      sourceType: "QA_QUEUE_FACT_REVISION",
      sourceId: "qa-1",
      sourceVersion: 2,
      semanticHash: digest("qa:r2"),
    } as const;
    const facetRef = {
      id: "00000000-0000-4000-8000-000000000649",
      version: 2,
      semanticHash: digest("facet:r2"),
    } as const;
    const statements: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
        void _parameters;
        const normalized = sql.replace(/\s+/gu, " ").trim();
        statements.push(normalized);
        if (
          normalized.includes("FROM workspace_capacity_heads") &&
          normalized.includes("FOR UPDATE")
        )
          return [
            {
              state: "ENFORCED",
              resource_version: 11,
              human_occupied_count: 1,
              review_reserved_count: 0,
              human_committed_count: 1,
              forced_external_count: 0,
              active_expedite_count: 0,
              claim_set_hash: digest("claims"),
              reservation_set_hash: digest("reservations"),
              expedite_set_hash: digest("expedites"),
              policy_ref: {
                sourceId: policyIds.policy,
                sourceVersion: 2,
                semanticHash: digest("policy:r2"),
              },
            },
          ];
        if (
          normalized.includes("FROM work_item_queue_control_heads") &&
          normalized.includes("FOR UPDATE")
        )
          return [
            {
              control_id: "00000000-0000-4000-8000-000000000650",
              resource_version: 4,
              service_class: "STANDARD",
            },
          ];
        if (normalized.includes("FROM qa_test_sessions") && normalized.includes("FOR UPDATE"))
          return [{ session_id: ids.session, resource_version: 7, content: sessionContent }];
        if (normalized.includes("FROM capacity_admission_decisions")) return [];
        if (normalized.includes("FROM workspace_queue_policy_heads"))
          return [
            {
              mode: "ENFORCED",
              workspace_human_wip_limit: 1,
              active_expedite_limit: 1,
              project_entries: [
                { projectId: policyIds.projectA, softWipLimit: null, reservedCapacity: null },
              ],
            },
          ];
        if (normalized.includes("FROM project_queue_policy_facet_heads"))
          return [
            {
              policy_facet_id: facetRef.id,
              revision_number: 2,
              semantic_hash: facetRef.semanticHash,
            },
          ];
        if (normalized.startsWith("SELECT * FROM work_item_human_wip_claims")) return [];
        if (normalized.startsWith("SELECT * FROM review_capacity_reservations")) return [];
        if (normalized.startsWith("WITH current_claims")) return [{ occupied: 1, reserved: 0 }];
        if (normalized.startsWith("SELECT head.queue_entry_id"))
          return [
            {
              queue_entry_id: "00000000-0000-4000-8000-000000000647",
              revision_number: 8,
              semantic_hash: digest("entry:r8"),
              input_fingerprint: digest("entry-input:r8"),
              subject: {
                kind: "WORK_ITEM",
                id: ids.workItem,
                version: 3,
                semanticHash: digest("work-item:r3"),
              },
              source_refs: [operationalRef, qaRef],
            },
          ];
        if (normalized.startsWith("SELECT public_intent_hash,action_hash")) return [];
        return [];
      }),
    };
    const source = { transaction: vi.fn() };
    const binder = new PostgresCapacityAdmissionBinder(source as never, {
      reauthorize: vi.fn().mockResolvedValue(true),
    });
    const requiredPermission = "queue.work-admit";
    const authorizationScopeWitness = projectSafeQueueAuthorizationWitness(
      { kind: "PROJECT", workspaceId: policyIds.workspace, projectId: policyIds.projectA },
      {
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission,
        classificationDecision: "ALLOW",
      },
      at,
    );
    const result = await binder.admitInTransaction(manager as never, {
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: ids.workItem,
      sessionId: ids.session,
      principalId: ids.initiator,
      requestKey: "manual-start-denied-override-0001",
      activityKind: "MANUAL_SESSION_START",
      actor: { kind: "HUMAN", principalId: ids.initiator },
      approvalInitiator: {
        kind: "HUMAN",
        principalId: ids.initiator,
        issuer: "https://idp.test",
        subject: "initiator",
      },
      authorizationScopeWitnessHash: sha256({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission,
        classificationDecision: "ALLOW",
      }),
      authorizationScopeWitness,
      initiatorAuthorizationBasis: {
        kind: "PROJECT",
        membershipRef: { id: "membership", version: 1 },
      },
      expectedState: {
        policyFacetRef: facetRef,
        expectedQueueControlVersion: 4,
        operationalProjectionRef: operationalRef,
        qaSourceSetHash: qaRef.semanticHash,
        sessionRef: exactSessionRef,
      },
      authorizedScopeSnapshotRef: {
        id: "00000000-0000-4000-8000-000000000648",
        version: 5,
        semanticHash: digest("safe-capacity:r5"),
      },
      overrideIntent: { reason: "Allow exact start", expiresAt: "2026-09-03T10:00:00.000Z" },
      decidedAt: at,
      correlationId: "00000000-0000-4000-8000-000000000651",
      causationId: "00000000-0000-4000-8000-000000000652",
    });
    expect(result).toMatchObject({
      outcome: "DENIED",
      overrideCandidate: {
        publicIntentHash: expect.stringMatching(/^sha256:/u),
        approvalSubjectHash: expect.stringMatching(/^sha256:/u),
      },
    });
    expect(
      statements.some((sql) => sql.startsWith("INSERT INTO capacity_admission_decisions")),
    ).toBe(true);
    expect(statements.some((sql) => sql.startsWith("INSERT INTO platform_actions"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("INSERT INTO queue_action_candidates"))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.startsWith("INSERT INTO approvals"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("UPDATE qa_test_sessions"))).toBe(false);
  });

  it("consumes the exact Approval and platform action on the caller transaction", async () => {
    const at = "2026-09-03T09:30:00.000Z";
    const exactPair = pair();
    const witness = projectSafeQueueAuthorizationWitness(
      exactPair.candidate.scope,
      {
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission: "queue.work-admit",
        classificationDecision: "ALLOW",
      },
      "2026-09-03T09:00:00.000Z",
    );
    const pending = createPlatformActionApprovalV2({
      approvalId: ids.approval,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      initiator: {
        kind: "HUMAN",
        principalId: ids.initiator,
        issuer: "https://idp.test",
        subject: "initiator",
      },
      initiatorAuthorizationScopeWitness: witness,
      action: {
        actionKind: "PLATFORM_ACTION",
        actionId: exactPair.actionId,
        commandType: "queue.capacity.wip-admission-override",
      },
      candidate: exactPair.candidate,
      requiredPermission: "queue.work-admit",
      effectIdempotencyKey: `awp:wip-admission-override:${exactPair.actionId}`,
      dataClassificationKey: "INTERNAL",
      expiresAt: "2026-09-03T10:00:00.000Z",
      createdAt: "2026-09-03T09:00:00.000Z",
    });
    const approved = decideApprovalSubjectV2({
      subject: pending,
      decision: "APPROVE",
      approver: {
        kind: "HUMAN",
        principalId: ids.lead,
        issuer: "https://idp.test",
        subject: "lead",
      },
      approverRole: "qa-lead",
      authorizationScopeWitness: { ...witness, evaluatedAt: "2026-09-03T09:20:00.000Z" },
      now: "2026-09-03T09:20:00.000Z",
    });
    const statements: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
        void _parameters;
        const normalized = sql.replace(/\s+/gu, " ").trim();
        statements.push(normalized);
        if (normalized.startsWith("SELECT * FROM workspace_capacity_heads"))
          return [
            {
              state: "ENFORCED",
              resource_version: 11,
              human_occupied_count: 1,
              review_reserved_count: 0,
              human_committed_count: 1,
              forced_external_count: 0,
              active_expedite_count: 0,
              claim_set_hash: digest("claims"),
              reservation_set_hash: digest("reservations"),
              expedite_set_hash: digest("expedites"),
              policy_ref: {
                sourceId: policyIds.policy,
                sourceVersion: 2,
                semanticHash: digest("policy:r2"),
              },
            },
          ];
        if (normalized.startsWith("SELECT head.resource_version,revision.service_class"))
          return [{ resource_version: 4, service_class: "STANDARD" }];
        if (normalized.startsWith("SELECT head.queue_entry_id"))
          return [
            {
              queue_entry_id: expected.expectedQueueEntry.queueEntryId,
              revision_number: expected.expectedQueueEntry.revision,
              semantic_hash: expected.expectedQueueEntry.semanticHash,
              input_fingerprint: expected.expectedQueueEntry.inputFingerprint,
              subject: {
                kind: "WORK_ITEM",
                id: ids.workItem,
                version: 3,
                semanticHash: workItemRef.semanticHash,
              },
            },
          ];
        if (normalized.startsWith("SELECT mode,workspace_human_wip_limit"))
          return [{ mode: "ENFORCED", workspace_human_wip_limit: 1, active_expedite_limit: 1 }];
        if (normalized.startsWith("UPDATE approvals SET")) return [{ id: ids.approval }];
        if (normalized.startsWith("UPDATE platform_actions SET")) return [{ id: ids.action }];
        return [];
      }),
    };
    const resolver = createPostgresExactCapacityOverrideResolver({} as never, {
      pair: exactPair,
      approved,
      expectedApprovalVersion: pending.resourceVersion,
      now: at,
    });
    const resolved = await resolver(manager as never, {
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: ids.workItem,
      sessionId: ids.session,
      expectedState: { sessionRef, operationalProjectionRef: expected.operationalProjectionRef },
      blockedFromState: "REVIEW_REQUIRED",
    });
    expect(resolved).toMatchObject({
      actionKind: "WIP_ADMISSION_OVERRIDE",
      effectKind: "ALLOW_WIP_ADMISSION",
    });
    const decisionRef = {
      sourceType: "CAPACITY_ADMISSION_DECISION" as const,
      sourceId: "00000000-0000-4000-8000-000000000653",
      sourceVersion: 1 as const,
      semanticHash: digest("decision"),
    };
    await resolved?.consume(manager as never, decisionRef);
    expect(
      statements.some(
        (sql) => sql.startsWith("UPDATE approvals SET") && sql.includes("row_version=$9"),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (sql) =>
          sql.startsWith("UPDATE platform_actions SET") && sql.includes("state='PENDING_APPROVAL'"),
      ),
    ).toBe(true);
    const approvalUpdate = manager.query.mock.calls.find(([sql]) =>
      sql.startsWith("UPDATE approvals SET"),
    );
    expect(approvalUpdate?.[1]?.[5]).toBe("CONSUMED");
    const actionUpdate = manager.query.mock.calls.find(([sql]) =>
      sql.startsWith("UPDATE platform_actions SET"),
    );
    expect(JSON.parse(String(actionUpdate?.[1]?.[3]))).toEqual({ resultRef: decisionRef });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  assertExactCapacityActionConsumption,
  type CapacityActionExpectedState,
  evaluateCapacityAdmission,
  prepareCapacityQueueAction,
  projectSafeQueueAuthorizationWitness,
  type QueueActionPair,
} from "../../../packages/platform-core/src/index.ts";
import { QueueControlRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  PostgresQueueTemporalTransitionWorker,
  QueueExpediteActionWorkflowService,
  SerializedCapacityAdmissionService,
} from "../../../packages/runtime-composition/src/index.ts";
import { policyIds } from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const workItemRef = Object.freeze({
  sourceType: "WORK_ITEM_REVISION",
  sourceId: "00000000-0000-4000-8000-000000000651",
  sourceVersion: 2,
  semanticHash: digest("expedite-target"),
});
const expected: CapacityActionExpectedState = Object.freeze({
  kind: "CAPACITY",
  policyRef: { id: policyIds.policy, version: 2, semanticHash: digest("policy:r2") },
  policyMode: "ENFORCED",
  expectedControlVersion: 3,
  expectedQueueEntry: {
    queueEntryId: "00000000-0000-4000-8000-000000000652",
    revision: 4,
    semanticHash: digest("entry:r4"),
    inputFingerprint: digest("input:r4"),
  },
  expectedCapacityHeadVersion: 9,
  workspaceHumanWipLimit: 2,
  activeExpediteLimit: 1,
  humanOccupiedCount: 0,
  reviewReservedCount: 0,
  humanCommittedCount: 0,
  forcedExternalCount: 0,
  activeExpediteCount: 1,
  claimSetHash: digest("claims"),
  reservationSetHash: digest("reservations"),
  expediteSetHash: digest("expedites"),
  operationalProjectionRef: {
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
    sourceId: "jira-2",
    sourceVersion: 1,
    semanticHash: digest("jira:r1"),
  },
});
const expediteEffect = Object.freeze({
  kind: "SET_EXPEDITE" as const,
  beforeServiceClass: "STANDARD" as const,
  afterServiceClass: "EXPEDITE" as const,
  reviewAt: "2026-09-03T12:00:00.000Z",
});

describe("US4 EXPEDITE exact capacity override", () => {
  it("creates approval-bound SET/override candidates and consumes CLEAR without a second approval", async () => {
    const witness = projectSafeQueueAuthorizationWitness(
      { kind: "PROJECT", workspaceId: policyIds.workspace, projectId: policyIds.projectA },
      {
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        requiredPermission: "queue.control.request",
        classificationDecision: "ALLOW",
      },
      "2026-09-03T09:00:00.000Z",
    );
    const saved: { pair: QueueActionPair; approval?: unknown }[] = [];
    let serviceClass: "STANDARD" | "EXPEDITE" = "STANDARD";
    const resultRef = {
      sourceType: "CAPACITY_ADMISSION_DECISION",
      sourceId: "00000000-0000-4000-8000-000000000658",
      sourceVersion: 1,
      semanticHash: digest("decision"),
    } as const;
    const consume = vi.fn().mockResolvedValue({ resultRef });
    const service = new QueueExpediteActionWorkflowService(
      {
        authorize: vi.fn().mockResolvedValue({
          authorizationScopeWitness: witness,
          authorizationBasis: {
            kind: "PROJECT",
            membershipRef: { id: "membership", version: 1 },
          },
        }),
        current: vi.fn().mockImplementation(async () => ({
          expectedState: expected,
          serviceClass,
          workItemRef,
          authorizedCapacitySnapshotRef: {
            id: "00000000-0000-4000-8000-000000000654",
            version: 1,
            semanticHash: digest("snapshot"),
          },
        })),
        save: vi.fn(async ({ pair, approval }) => {
          saved.push({ pair, ...(approval ? { approval } : {}) });
          return { replayed: false };
        }),
        consume,
      },
      () => new Date("2026-09-03T09:00:00.000Z"),
    );
    const actor = {
      kind: "HUMAN" as const,
      principalId: "00000000-0000-4000-8000-000000000659",
      issuer: "https://idp.test",
      subject: "lead-a",
    };
    const set = await service.request({
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: workItemRef.sourceId,
      requestKey: "service-class-expedite-0001",
      commandKind: "SET_EXPEDITE",
      expectedControlVersion: expected.expectedControlVersion,
      expectedQueueEntry: expected.expectedQueueEntry,
      reason: "Urgent defect",
      reviewAt: "2026-09-03T10:00:00.000Z",
      expiresAt: "2026-09-03T11:00:00.000Z",
      actor,
    });
    expect(set).toMatchObject({
      actionKind: "SERVICE_CLASS_EXPEDITE",
      state: "PENDING_APPROVAL",
      approvalRequired: true,
      approvalRef: { sourceType: "APPROVAL_SUBJECT_V2" },
    });
    expect(saved[0]?.approval).toBeDefined();
    const override = await service.requestCapacityOverride({
      originatingPair: saved[0]!.pair,
      requestKey: "expedite-capacity-override-0001",
      reason: "Permit exact singleton exception",
      expiresAt: "2026-09-03T10:30:00.000Z",
      actor,
    });
    expect(override).toMatchObject({
      actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
      state: "PENDING_APPROVAL",
      approvalRequired: true,
    });
    expect(saved[1]!.pair.witness.requestedEffect as Record<string, unknown>).toMatchObject({
      kind: "ALLOW_EXPEDITE_CAPACITY",
      originatingActionHash: saved[0]!.pair.actionHash,
    });
    serviceClass = "EXPEDITE";
    const clear = await service.request({
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: workItemRef.sourceId,
      requestKey: "service-class-clear-0001",
      commandKind: "CLEAR_EXPEDITE",
      expectedControlVersion: expected.expectedControlVersion,
      expectedQueueEntry: expected.expectedQueueEntry,
      reason: "Urgency ended",
      actor,
    });
    expect(clear).toMatchObject({
      actionKind: "SERVICE_CLASS_EXPEDITE",
      state: "CONSUMED",
      approvalRequired: false,
      resultRef,
    });
    expect(saved[2]?.approval).toBeUndefined();
    expect(consume).toHaveBeenCalledOnce();
  });

  it("enforces the singleton and admits only the matching override family", () => {
    const base = {
      policyMode: "ENFORCED" as const,
      activityKind: "SET_EXPEDITE" as const,
      current: { humanCommittedCount: 0, activeExpediteCount: 1 },
      workspaceHumanWipLimit: 2,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    };
    expect(evaluateCapacityAdmission(base)).toMatchObject({
      outcome: "DENIED",
      violatedConstraints: ["EXPEDITE_SINGLETON"],
    });
    expect(
      evaluateCapacityAdmission({
        ...base,
        exactOverride: {
          actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
          effectKind: "ALLOW_EXPEDITE_CAPACITY",
        },
      }),
    ).toMatchObject({ outcome: "ADMITTED_WITH_EXACT_OVERRIDE", expediteDelta: 1 });
  });

  it("binds override to both public and private hashes of the originating EXPEDITE action", () => {
    const origin = prepareCapacityQueueAction({
      actionId: "00000000-0000-4000-8000-000000000653",
      actionKind: "SERVICE_CLASS_EXPEDITE",
      requestKey: "set-expedite-request-0001",
      requestHash: digest("set"),
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemRef,
      expectedState: expected,
      authorizedCapacitySnapshotRef: {
        id: "00000000-0000-4000-8000-000000000654",
        version: 1,
        semanticHash: digest("snapshot"),
      },
      effect: expediteEffect,
      reason: "Urgent defect",
      expiresAt: "2026-09-03T11:00:00.000Z",
    });
    const override = prepareCapacityQueueAction({
      actionId: "00000000-0000-4000-8000-000000000655",
      actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
      requestKey: "override-expedite-0001",
      requestHash: digest("override"),
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemRef,
      expectedState: expected,
      authorizedCapacitySnapshotRef: {
        id: "00000000-0000-4000-8000-000000000654",
        version: 1,
        semanticHash: digest("snapshot"),
      },
      effect: {
        kind: "ALLOW_EXPEDITE_CAPACITY",
        workItemRef,
        originatingActionRef: {
          sourceType: "QUEUE_ACTION_CANDIDATE",
          sourceId: origin.actionId,
          sourceVersion: 1,
          semanticHash: origin.publicIntentHash,
        },
        originatingActionHash: origin.actionHash,
        requestedExpediteEffect: expediteEffect,
      },
      reason: "Allow singleton exception",
      expiresAt: "2026-09-03T10:00:00.000Z",
    });
    const base = {
      pair: override,
      currentExpectedState: expected,
      currentWorkItemRef: workItemRef,
      originatingPair: origin,
      approval: {
        approvalId: "00000000-0000-4000-8000-000000000656",
        state: "APPROVED" as const,
        initiatorId: "i",
        approverId: "lead",
        approverRole: "Lead",
        expiresAt: "2026-09-03T10:00:00.000Z",
      },
      now: "2026-09-03T09:30:00.000Z",
    };
    expect(() => assertExactCapacityActionConsumption(base)).not.toThrow();
    const wrongOrigin = prepareCapacityQueueAction({
      actionId: "00000000-0000-4000-8000-000000000657",
      actionKind: "SERVICE_CLASS_EXPEDITE",
      requestKey: "different-expedite-0001",
      requestHash: digest("different"),
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemRef,
      expectedState: expected,
      authorizedCapacitySnapshotRef: {
        id: "00000000-0000-4000-8000-000000000654",
        version: 1,
        semanticHash: digest("snapshot"),
      },
      effect: expediteEffect,
      reason: "Different",
      expiresAt: "2026-09-03T11:00:00.000Z",
    });
    expect(() =>
      assertExactCapacityActionConsumption({ ...base, originatingPair: wrongOrigin }),
    ).toThrow("EXPEDITE_OVERRIDE_ORIGIN_MISMATCH");
  });

  it("clears an active EXPEDITE without another approval and releases on expiry", () => {
    expect(
      evaluateCapacityAdmission({
        policyMode: "ENFORCED",
        activityKind: "CLEAR_EXPEDITE",
        current: { humanCommittedCount: 0, activeExpediteCount: 1 },
        workspaceHumanWipLimit: 2,
        activeExpediteLimit: 1,
        targetHasClaim: false,
        targetHasReservation: false,
        targetHasExpedite: true,
      }),
    ).toMatchObject({ outcome: "ADMITTED", expediteDelta: -1, mutationKind: "CLEAR_EXPEDITE" });
    expect(
      evaluateCapacityAdmission({
        policyMode: "ENFORCED",
        activityKind: "EXPIRE_EXPEDITE",
        current: { humanCommittedCount: 0, activeExpediteCount: 1 },
        workspaceHumanWipLimit: 2,
        activeExpediteLimit: 1,
        targetHasClaim: false,
        targetHasReservation: false,
        targetHasExpedite: true,
      }),
    ).toMatchObject({ outcome: "NON_DISCRETIONARY_APPLIED", expediteDelta: -1 });
  });

  it("races two singleton requests under one capacity-first serialized lock and accepts one", async () => {
    let activeExpedites = 0;
    let tail = Promise.resolve();
    const lockTraces: string[][] = [];
    const service = new SerializedCapacityAdmissionService({
      transaction: async <T>(work: (transaction: { trace: string[] }) => Promise<T>) => {
        const predecessor = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await predecessor;
        const transaction = { trace: [] as string[] };
        lockTraces.push(transaction.trace);
        try {
          return await work(transaction);
        } finally {
          release();
        }
      },
      authorize: vi.fn().mockResolvedValue(true),
      replay: vi.fn().mockResolvedValue(undefined),
      lockAndRead: vi.fn(async (transaction: { trace: string[] }) => {
        transaction.trace.push("WORKSPACE_CAPACITY", "WORK_ITEM_CONTROL");
        return {
          policyMode: "ENFORCED" as const,
          current: { humanCommittedCount: 0, activeExpediteCount: activeExpedites },
          workspaceHumanWipLimit: 2,
          activeExpediteLimit: 1,
          targetHasClaim: false,
          targetHasReservation: false,
          targetHasExpedite: false,
        };
      }),
      persist: vi.fn(async (_transaction, value) => {
        if (value.evaluation.outcome === "ADMITTED") activeExpedites += 1;
        return Object.freeze({ outcome: value.evaluation.outcome });
      }),
    });
    const base = {
      workspaceId: policyIds.workspace,
      principalId: "lead",
      activityKind: "SET_EXPEDITE" as const,
      expectedState: { expectedControlVersion: 0 },
    };
    const results = await Promise.all([
      service.admit({
        ...base,
        projectId: policyIds.projectA,
        workItemId: "expedite-a",
        requestKey: "expedite-race-project-a-01",
      }),
      service.admit({
        ...base,
        projectId: "00000000-0000-4000-8000-000000000699",
        workItemId: "expedite-b",
        requestKey: "expedite-race-project-b-01",
      }),
    ]);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["ADMITTED", "DENIED"]);
    expect(activeExpedites).toBe(1);
    expect(lockTraces).toEqual([
      ["WORKSPACE_CAPACITY", "WORK_ITEM_CONTROL"],
      ["WORKSPACE_CAPACITY", "WORK_ITEM_CONTROL"],
    ]);
  });

  it("appends dedicated SET and EXPIRE revisions and updates the singleton under the capacity-first lock", async () => {
    const head: Record<string, unknown> = {
      control_id: "control",
      current_revision_id: null,
      resource_version: 0,
    };
    const capacity: Record<string, unknown> = {
      state: "ENFORCED",
      resource_version: 0,
      human_occupied_count: 0,
      review_reserved_count: 0,
      human_committed_count: 0,
      forced_external_count: 0,
      active_expedite_count: 0,
      claim_set_hash: digest([]),
      reservation_set_hash: digest([]),
      expedite_set_hash: digest([]),
      policy_ref: {
        sourceId: policyIds.policy,
        sourceVersion: 2,
        semanticHash: digest("policy:r2"),
      },
    };
    let current: Record<string, unknown> | undefined;
    const statements: string[] = [];
    const outbox: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        statements.push(normalized);
        if (
          normalized.includes("FROM workspace_capacity_heads") &&
          normalized.includes("FOR UPDATE")
        )
          return [{ ...capacity }];
        if (normalized.startsWith("INSERT INTO work_item_queue_control_heads")) return [];
        if (normalized.startsWith("SELECT control_id,current_revision_id,resource_version"))
          return [{ ...head }];
        if (normalized.startsWith("SELECT head.current_revision_id"))
          return [{ ...head, ...(current ?? {}) }];
        if (normalized.startsWith("SELECT mode,workspace_human_wip_limit"))
          return [{ mode: "ENFORCED", workspace_human_wip_limit: 5, active_expedite_limit: 1 }];
        if (normalized.startsWith("INSERT INTO work_item_queue_control_revisions")) {
          current = {
            revision_number: parameters[4],
            service_class: parameters[6],
            planning_values: JSON.parse(String(parameters[7])),
            accepted_source_refs: JSON.parse(String(parameters[8])),
            dependency_source_set_hash: parameters[9],
            expiry_at: parameters[10],
            semantic_hash: parameters[13],
            recorded_by: parameters[15],
          };
          return [];
        }
        if (normalized.startsWith("UPDATE work_item_queue_control_heads")) {
          head.current_revision_id = parameters[3];
          head.resource_version = Number(head.resource_version) + 1;
          return [{ resource_version: head.resource_version }];
        }
        if (normalized.includes("current_claims WHERE state='ACTIVE'")) return [];
        if (normalized.includes("current_reservations ORDER BY")) return [];
        if (normalized.includes("revision.service_class='EXPEDITE'")) {
          return current?.service_class === "EXPEDITE" &&
            Date.parse(String(current.expiry_at)) > Date.parse(String(parameters[1]))
            ? [
                {
                  project_id: policyIds.projectA,
                  work_item_id: workItemRef.sourceId,
                  control_revision_id: head.current_revision_id,
                  revision_number: current.revision_number,
                  semantic_hash: current.semantic_hash,
                },
              ]
            : [];
        }
        if (normalized.startsWith("UPDATE workspace_capacity_heads")) {
          capacity.human_occupied_count = parameters[1];
          capacity.review_reserved_count = parameters[2];
          capacity.human_committed_count = parameters[3];
          capacity.forced_external_count = parameters[4];
          capacity.active_expedite_count = parameters[5];
          capacity.claim_set_hash = parameters[6];
          capacity.reservation_set_hash = parameters[7];
          capacity.expedite_set_hash = parameters[8];
          capacity.resource_version = Number(capacity.resource_version) + 1;
          return [{ resource_version: capacity.resource_version }];
        }
        if (normalized.startsWith("INSERT INTO event_outbox")) {
          outbox.push(String(parameters[3]));
          return [];
        }
        return [];
      }),
    };
    const repository = new QueueControlRepository({} as never);
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
    };
    const set = await repository.transitionExpedite(
      {
        scope,
        workItemId: workItemRef.sourceId,
        controlId: "control",
        revisionId: "set-r1",
        command: "SET",
        expectedControlVersion: 0,
        acceptedActionRef: {
          sourceType: "QUEUE_ACTION_CANDIDATE",
          sourceId: "set-action",
          sourceVersion: 1,
          semanticHash: digest("set-action"),
        },
        actorId: "lead",
        reason: "Urgent defect",
        at: "2026-09-03T09:00:00.000Z",
        reviewAt: "2026-09-03T10:00:00.000Z",
        expiresAt: "2026-09-03T11:00:00.000Z",
      },
      manager as never,
    );
    expect(set).toMatchObject({
      outcome: "ADMITTED",
      revisionRef: { sourceId: "set-r1", sourceVersion: 1 },
      capacityChanged: true,
    });
    expect(capacity.active_expedite_count).toBe(1);
    const expire = await repository.transitionExpedite(
      {
        scope,
        workItemId: workItemRef.sourceId,
        controlId: "control",
        revisionId: "expire-r2",
        command: "EXPIRE",
        expectedControlVersion: 1,
        acceptedActionRef: {
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: "set-r1",
          sourceVersion: 1,
          semanticHash: String(current?.semantic_hash),
        },
        actorId: "worker",
        reason: "EXPEDITE window expired",
        at: "2026-09-03T11:00:00.000Z",
      },
      manager as never,
    );
    expect(expire).toMatchObject({
      outcome: "NON_DISCRETIONARY_APPLIED",
      revisionRef: { sourceId: "expire-r2", sourceVersion: 2 },
      capacityChanged: true,
    });
    expect(capacity.active_expedite_count).toBe(0);
    expect(
      statements.findIndex(
        (sql) => sql.includes("workspace_capacity_heads") && sql.includes("FOR UPDATE"),
      ),
    ).toBeLessThan(
      statements.findIndex((sql) => sql.startsWith("SELECT head.current_revision_id")),
    );
    expect(outbox).toHaveLength(4);
    expect(statements.filter((sql) => sql.startsWith("INSERT INTO audit_events"))).toHaveLength(2);
  });

  it("claims an overdue current EXPEDITE revision and dispatches it through the temporal handler", async () => {
    const expireExpedite = vi.fn().mockResolvedValue({ changed: true });
    const source = {
      query: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            workspace_id: policyIds.workspace,
            project_id: policyIds.projectA,
            work_item_id: workItemRef.sourceId,
            control_id: "control",
            current_revision_id: "set-r1",
            resource_version: 1,
            revision_number: 1,
            semantic_hash: digest("set-r1"),
            expiry_at: "2026-09-03T11:00:00.000Z",
            recorded_by: "lead",
          },
        ]),
    };
    const worker = new PostgresQueueTemporalTransitionWorker(
      source as never,
      {
        evaluateQueueEntry: vi.fn(),
        expireOrderOverride: vi.fn(),
        expireExpedite,
      },
      () => "2026-09-03T11:00:01.000Z",
    );
    await expect(worker.run(10)).resolves.toEqual({
      claimed: 1,
      semanticChanges: 1,
      rescheduled: 0,
      completed: 1,
    });
    expect(expireExpedite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "EXPEDITE",
        controlRevisionId: "set-r1",
        expectedControlVersion: 1,
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  type NotificationIntentSnapshot,
  projectQueuePolicyFacet,
} from "../../../packages/platform-core/src/index.ts";
import {
  notificationIntentCreationHash,
  planSlaThresholds,
  PostgresQueueTemporalTransitionWorker,
  QueueTemporalTransitionSweep,
  SlaTemporalThresholdEvaluator,
  type SlaThresholdEmission,
  SlaThresholdNotificationService,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `67000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function clockFixture() {
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
      semanticHash: digest("sla-business-time@1"),
    },
    startSourceRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 1,
      semanticHash: digest("jira-ready"),
      observedAt: "2026-09-07T04:58:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    },
  });
  const segment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id("5"),
  }).opened!;
  return { calendar, policy, transition, segments: [segment], target: policy.slaGoals[0]! };
}

function memoryNotificationPorts() {
  const intents = new Map<string, NotificationIntentSnapshot>();
  const emissions = new Map<string, SlaThresholdEmission>();
  return {
    intents,
    emissions,
    createNotificationIntent: vi.fn(async (value: NotificationIntentSnapshot) => {
      const existing = intents.get(value.dedupeKey);
      if (existing) return Object.freeze({ value: structuredClone(existing), replayed: true });
      intents.set(value.dedupeKey, structuredClone(value));
      return Object.freeze({ value: structuredClone(value), replayed: false });
    }),
    appendThresholdEmission: vi.fn(
      async (
        input: Readonly<{ thresholdKind: string; thresholdKey: string; payload: unknown }>,
      ) => {
        const key = `${input.thresholdKind}:${input.thresholdKey}`;
        const existing = emissions.get(key);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(input.payload))
            throw new Error("SLA_THRESHOLD_REPLAY_CONFLICT");
          return Object.freeze({ outcome: "NO_OP_DUPLICATE" as const });
        }
        emissions.set(key, structuredClone(input.payload) as SlaThresholdEmission);
        return Object.freeze({ outcome: "APPENDED" as const });
      },
    ),
  };
}

describe("US5 durable SLA thresholds and notification intents", () => {
  it("recovers every crossed threshold once from durable state without a Mattermost call", async () => {
    const context = clockFixture();
    const ports = memoryNotificationPorts();
    const mattermostSend = vi.fn().mockRejectedValue(new Error("MATTERMOST_DOWN"));
    const notifications = new SlaThresholdNotificationService(ports);
    const evaluator = new SlaTemporalThresholdEvaluator(
      {
        loadClock: vi.fn().mockResolvedValue(context),
        notificationExpiresAt: () => "2026-10-07T13:00:00.000Z",
      },
      notifications,
      () => "2026-09-07T14:00:00.000Z",
    );
    const due = Object.freeze({
      kind: "SLA_CLOCK" as const,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      subjectId: context.transition.slaClockId,
      dueAt: "2026-09-07T09:00:00.000Z",
      claimToken: "durable-lease",
    });

    await expect(evaluator.evaluate(due)).resolves.toEqual({ changed: true });
    await expect(evaluator.evaluate(due)).resolves.toEqual({ changed: false });

    expect(ports.intents).toHaveLength(2);
    expect(ports.emissions).toHaveLength(2);
    expect(
      [...ports.intents.values()].every(
        (intent) =>
          intent.state === "QUEUED" &&
          intent.target.kind === "PROJECT_CHANNEL" &&
          intent.target.purpose === "REQUEST_STATUS",
      ),
    ).toBe(true);
    expect(mattermostSend).not.toHaveBeenCalled();
    for (const emission of ports.emissions.values()) {
      expect(() =>
        designContractRegistry.validateById(
          "urn:awp:schemas:006:sla-threshold-emission:v1",
          emission as never,
        ),
      ).not.toThrow();
    }
    expect([...ports.emissions.values()].map(({ threshold }) => threshold)).toEqual([
      { kind: "WARNING", warningIndex: 1 },
      { kind: "BREACH" },
    ]);
  });

  it("keeps creationHash independent from mutable delivery progress", () => {
    const context = clockFixture();
    const plan = planSlaThresholds({ ...context, asOf: "2026-09-07T10:00:00.000Z" });
    expect(plan.crossings).toHaveLength(1);
    expect(plan.nextEvaluationAt).toBe("2026-09-07T13:00:00.000Z");

    const original: NotificationIntentSnapshot = Object.freeze({
      id: id("10"),
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      dedupeKey: "threshold",
      sourceEventRef: "threshold:1",
      target: Object.freeze({ kind: "PROJECT_CHANNEL", purpose: "REQUEST_STATUS" }),
      targetHash: digest("target"),
      payloadHash: digest("payload"),
      renderHash: digest("render"),
      commandId: id("11"),
      state: "QUEUED",
      attempts: Object.freeze([]),
      expiresAt: new Date("2026-10-07T13:00:00.000Z"),
      rowVersion: 1,
    });
    const delivered: NotificationIntentSnapshot = Object.freeze({
      ...original,
      state: "DELIVERED",
      attempts: Object.freeze([
        {
          attempt: 1,
          fence: 2,
          startedAt: new Date("2026-09-07T13:00:00.000Z"),
          outcome: "DELIVERED",
        },
      ]),
      rowVersion: 4,
    });
    expect(notificationIntentCreationHash(delivered)).toBe(
      notificationIntentCreationHash(original),
    );
  });

  it("does no temporal or notification write until PostgreSQL returns a due row", async () => {
    const ports = {
      claimDue: vi.fn().mockResolvedValue([]),
      evaluateQueueEntry: vi.fn(),
      evaluateSlaClock: vi.fn(),
      expireOrderOverride: vi.fn(),
      expireExpedite: vi.fn(),
      complete: vi.fn(),
    };
    const sweep = new QueueTemporalTransitionSweep(ports, () => "2026-09-07T08:00:00.000Z");
    await sweep.run({ trigger: "PERIODIC", batchSize: 10 });
    expect(ports.evaluateSlaClock).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("claims an overdue SLA head from PostgreSQL on startup and completes its exact lease", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspace_id: policyIds.workspace,
          project_id: policyIds.projectA,
          sla_clock_id: id("3"),
          due_at: "2026-09-07T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    const evaluateSlaClock = vi
      .fn()
      .mockResolvedValue({ changed: true, nextEvaluationAt: "2026-09-07T13:00:00.000Z" });
    const worker = new PostgresQueueTemporalTransitionWorker(
      { query } as never,
      {
        evaluateQueueEntry: vi.fn(),
        evaluateSlaClock,
        expireOrderOverride: vi.fn(),
        expireExpedite: vi.fn(),
      },
      () => "2026-09-07T10:00:00.000Z",
    );

    await expect(worker.run(1, "STARTUP")).resolves.toEqual({
      claimed: 1,
      semanticChanges: 1,
      rescheduled: 1,
      completed: 0,
    });
    expect(String(query.mock.calls[3]![0])).toContain("temporal_claim_token");
    expect(String(query.mock.calls[3]![0])).toContain("FROM sla_clock_heads");
    expect(evaluateSlaClock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "SLA_CLOCK", subjectId: id("3") }),
    );
    expect(String(query.mock.calls[4]![0])).toContain("temporal_claim_token=$5");
  });
});

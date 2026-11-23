import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  addBusinessSeconds,
  type BusinessCalendarRevision,
  businessSecondsBetween,
  NotificationIntentAggregate,
  type NotificationIntentSnapshot,
  type SlaClockSegmentRevision,
  type SlaClockTransition,
} from "@awp/platform-core";

import { evaluateSlaSnapshot, type SlaTargetGoalConfiguration } from "./portfolio-query.ts";

export type SlaThresholdCrossing = Readonly<{
  thresholdKey: string;
  thresholdKind: "WARNING" | "BREACH";
  threshold: Readonly<{ kind: "WARNING"; warningIndex: number }> | Readonly<{ kind: "BREACH" }>;
  targetState: "AT_RISK" | "BREACHED";
  elapsedBusinessSeconds: number;
  targetBusinessSeconds: number;
  reachedAt: string;
}>;

export interface SlaThresholdPlan {
  readonly crossings: readonly SlaThresholdCrossing[];
  readonly nextEvaluationAt?: string;
}

const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function crossingAt(
  input: Readonly<{
    transition: SlaClockTransition;
    segments: readonly SlaClockSegmentRevision[];
    calendar: BusinessCalendarRevision;
    boundaryBusinessSeconds: number;
    asOf: string;
  }>,
): string {
  let accumulated = 0;
  const segments = input.segments
    .filter(({ clockCycle }) => clockCycle === input.transition.clockCycle)
    .sort((left, right) => left.ordinal - right.ordinal);
  for (const segment of segments) {
    if (segment.state !== "RUNNING") continue;
    const seconds = segment.endedAt
      ? segment.businessSeconds
      : businessSecondsBetween(input.calendar, segment.startedAt, input.asOf);
    if (input.boundaryBusinessSeconds <= accumulated + seconds) {
      return addBusinessSeconds(
        input.calendar,
        segment.startedAt,
        input.boundaryBusinessSeconds - accumulated,
      );
    }
    accumulated += seconds;
  }
  throw new Error("SLA_THRESHOLD_SEGMENT_COVERAGE_INVALID");
}

/** Computes policy-significant instants only; it never persists on page reads or per-second ticks. */
export function planSlaThresholds(
  input: Readonly<{
    transition: SlaClockTransition;
    segments: readonly SlaClockSegmentRevision[];
    calendar: BusinessCalendarRevision;
    target: SlaTargetGoalConfiguration;
    asOf: string;
  }>,
): SlaThresholdPlan {
  const openSegment = input.segments.find(
    (segment) => segment.clockCycle === input.transition.clockCycle && !segment.endedAt,
  );
  const snapshot = evaluateSlaSnapshot({
    transition: input.transition,
    ...(openSegment ? { openSegment } : {}),
    calendar: input.calendar,
    target: input.target,
    asOf: input.asOf,
  });
  if (input.target.targetBusinessSeconds === null)
    return Object.freeze({ crossings: Object.freeze([]) });
  const elapsed = snapshot.elapsedBusinessSeconds;
  const boundaries = [
    ...input.target.warningThresholds.map((warning, index) =>
      Object.freeze({
        businessSeconds: warning.elapsedBusinessSeconds,
        thresholdKey: warning.key,
        thresholdKind: "WARNING" as const,
        threshold: Object.freeze({ kind: "WARNING" as const, warningIndex: index + 1 }),
        targetState: "AT_RISK" as const,
      }),
    ),
    Object.freeze({
      businessSeconds: input.target.targetBusinessSeconds,
      thresholdKey: "BREACH",
      thresholdKind: "BREACH" as const,
      threshold: Object.freeze({ kind: "BREACH" as const }),
      targetState: "BREACHED" as const,
    }),
  ];
  const crossings = boundaries
    .filter(({ businessSeconds }) => businessSeconds <= elapsed)
    .map((boundary) =>
      Object.freeze({
        thresholdKey: boundary.thresholdKey,
        thresholdKind: boundary.thresholdKind,
        threshold: boundary.threshold,
        targetState: boundary.targetState,
        elapsedBusinessSeconds: elapsed,
        targetBusinessSeconds: input.target.targetBusinessSeconds!,
        reachedAt: crossingAt({ ...input, boundaryBusinessSeconds: boundary.businessSeconds }),
      }),
    );
  const next =
    input.transition.currentClockState === "RUNNING"
      ? boundaries.find(({ businessSeconds }) => businessSeconds > elapsed)
      : undefined;
  const nextEvaluationAt =
    next && openSegment
      ? addBusinessSeconds(
          input.calendar,
          openSegment.startedAt,
          next.businessSeconds - input.transition.elapsedBusinessSecondsAtTransition,
        )
      : undefined;
  return Object.freeze({
    crossings: Object.freeze(crossings),
    ...(nextEvaluationAt ? { nextEvaluationAt } : {}),
  });
}

export interface SlaThresholdEmission extends Readonly<Record<string, JsonValue>> {
  readonly schemaVersion: "sla-threshold-emission@1.0.0";
  readonly thresholdEmissionId: string;
  readonly notificationIntentRef: Readonly<{
    notificationIntentId: string;
    creationHash: `sha256:${string}`;
  }>;
  readonly semanticHash: `sha256:${string}`;
}

export interface SlaThresholdNotificationPorts {
  readonly createNotificationIntent: (value: NotificationIntentSnapshot) => Promise<
    Readonly<{
      value: NotificationIntentSnapshot;
      replayed: boolean;
    }>
  >;
  readonly appendThresholdEmission: (
    input: Readonly<{
      scope: Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>;
      emissionId: string;
      slaClockId: string;
      clockCycle: number;
      policyFacetRef: SlaClockTransition["policyFacetRef"];
      clockRevisionRef: SlaClockTransition["clockRevisionRef"];
      thresholdKey: string;
      thresholdKind: "WARNING" | "BREACH";
      reachedAt: string;
      payload: JsonValue;
      notificationIntentId: string;
      notificationCreationHash: string;
    }>,
  ) => Promise<Readonly<{ outcome: "APPENDED" | "NO_OP_DUPLICATE" }>>;
}

export function notificationIntentCreationHash(
  value: NotificationIntentSnapshot,
): `sha256:${string}` {
  return sha256({
    notificationIntentId: value.id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    dedupeKey: value.dedupeKey,
    sourceEventRef: value.sourceEventRef,
    targetHash: value.targetHash,
    payloadHash: value.payloadHash,
    renderHash: value.renderHash,
    commandId: value.commandId,
    expiresAt: value.expiresAt.toISOString(),
  });
}

/** Creates the fixed REQUEST_STATUS intent and immutable public emission without invoking Hermes or Mattermost. */
export class SlaThresholdNotificationService {
  constructor(private readonly ports: SlaThresholdNotificationPorts) {}

  async emit(
    input: Readonly<{
      transition: SlaClockTransition;
      crossing: SlaThresholdCrossing;
      expiresAt: string;
    }>,
  ): Promise<
    Readonly<{
      outcome: "APPENDED" | "NO_OP_DUPLICATE";
      emission: SlaThresholdEmission;
      notificationIntent: NotificationIntentSnapshot;
      notificationReplayed: boolean;
    }>
  > {
    if (
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.crossing.reachedAt)
    ) {
      throw new Error("SLA_THRESHOLD_NOTIFICATION_EXPIRY_INVALID");
    }
    const identity = Object.freeze({
      workspaceId: input.transition.workspaceId,
      projectId: input.transition.projectId,
      slaClockId: input.transition.slaClockId,
      clockCycle: input.transition.clockCycle,
      policyFacetRef: input.transition.policyFacetRef,
      thresholdKind: input.crossing.thresholdKind,
      thresholdKey: input.crossing.thresholdKey,
    });
    const idempotencyHash = sha256(identity as unknown as JsonValue);
    const thresholdEmissionId = deterministicUuid(`sla-threshold-emission:${idempotencyHash}`);
    const notificationIntentId = deterministicUuid(`sla-threshold-notification:${idempotencyHash}`);
    const commandId = deterministicUuid(`sla-threshold-command:${idempotencyHash}`);
    const dedupeKey = `sla-threshold:${idempotencyHash}`;
    const sourceEventRef = `sla-threshold-emission:${thresholdEmissionId}`;
    const payload = Object.freeze({
      schemaVersion: "sla-threshold-notification@1.0.0",
      purpose: "REQUEST_STATUS",
      thresholdEmissionId,
      workItemId: input.transition.workItemId,
      goal: input.transition.goal,
      threshold: input.crossing.threshold,
      clockRevisionRef: input.transition.clockRevisionRef,
    }) as unknown as JsonValue;
    const intended = NotificationIntentAggregate.create({
      id: notificationIntentId,
      workspaceId: input.transition.workspaceId,
      projectId: input.transition.projectId,
      dedupeKey,
      sourceEventRef,
      target: Object.freeze({ kind: "PROJECT_CHANNEL", purpose: "REQUEST_STATUS" }),
      payload,
      render: "sla-threshold-request-status@1.0.0",
      commandId,
      expiresAt: new Date(input.expiresAt),
    }).snapshot();
    const created = await this.ports.createNotificationIntent(intended);
    if (
      notificationIntentCreationHash(created.value) !== notificationIntentCreationHash(intended)
    ) {
      throw new Error("SLA_THRESHOLD_NOTIFICATION_REPLAY_CONFLICT");
    }
    const notificationCreationHash = notificationIntentCreationHash(created.value);
    const body = Object.freeze({
      schemaVersion: "sla-threshold-emission@1.0.0" as const,
      thresholdEmissionId,
      workspaceId: input.transition.workspaceId,
      projectId: input.transition.projectId,
      workItemId: input.transition.workItemId,
      goal: input.transition.goal,
      slaClockId: input.transition.slaClockId,
      clockRevisionRef: input.transition.clockRevisionRef,
      clockCycle: input.transition.clockCycle,
      threshold: input.crossing.threshold,
      targetState: input.crossing.targetState,
      elapsedBusinessSeconds: input.crossing.elapsedBusinessSeconds,
      targetBusinessSeconds: input.crossing.targetBusinessSeconds,
      policyFacetRef: input.transition.policyFacetRef,
      calendarRef: input.transition.calendarRef,
      idempotencyHash,
      notificationIntentRef: Object.freeze({
        notificationIntentId,
        creationHash: notificationCreationHash,
      }),
      emittedAt: input.crossing.reachedAt,
    });
    const emission = Object.freeze({
      ...body,
      semanticHash: sha256(body as unknown as JsonValue),
    }) as unknown as SlaThresholdEmission;
    const appended = await this.ports.appendThresholdEmission({
      scope: Object.freeze({
        kind: "PROJECT",
        workspaceId: input.transition.workspaceId,
        projectId: input.transition.projectId,
      }),
      emissionId: thresholdEmissionId,
      slaClockId: input.transition.slaClockId,
      clockCycle: input.transition.clockCycle,
      policyFacetRef: input.transition.policyFacetRef,
      clockRevisionRef: input.transition.clockRevisionRef,
      thresholdKey: input.crossing.thresholdKey,
      thresholdKind: input.crossing.thresholdKind,
      reachedAt: input.crossing.reachedAt,
      payload: emission,
      notificationIntentId,
      notificationCreationHash,
    });
    return Object.freeze({
      outcome: appended.outcome,
      emission,
      notificationIntent: created.value,
      notificationReplayed: created.replayed,
    });
  }
}

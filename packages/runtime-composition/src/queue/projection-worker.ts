import type { DataSource } from "typeorm";

import { canonicalize, type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  type BusinessCalendarRevision,
  type ConfirmedJiraProjectionRef,
  createInitialSlaClock,
  deriveQueueStage,
  detectConfirmedJiraSlaStart,
  type JiraStatusMappingRef,
  type QueueAlgorithmRef,
  type QueueStageActivity,
  type QueueVersionedContentRef,
  type SlaClockSegmentRevision,
  type SlaClockStartTransition,
  type SlaClockTransition,
  type SlaGoal,
  type SlaSessionStopSourceRef,
  type SlaVerdictStopSourceRef,
  validateMutuallyExclusiveEmission,
} from "@awp/platform-core";

import { qaUs5SlaLifecycleEventTypes } from "../qa/confirmation-hooks.ts";
import type { SlaTargetGoalConfiguration } from "./portfolio-query.ts";
import {
  planSlaThresholds,
  type SlaThresholdEmission,
  type SlaThresholdPlan,
} from "./sla-notifications.ts";

export interface QueueExactSourceRef extends Readonly<Record<string, unknown>> {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string | number;
  readonly semanticHash: `sha256:${string}`;
}

export interface QueueProjectionSourceSnapshot extends Readonly<Record<string, unknown>> {
  readonly subjectId: string;
  readonly sourceRefs: readonly QueueExactSourceRef[];
  readonly precursorId?: string;
}

interface LocalQueueFactPort<T> {
  current(
    input: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ): Promise<T | undefined>;
}

export interface LocalQueueWorkItemFacts extends Readonly<Record<string, unknown>> {
  readonly subject: Readonly<{
    kind: "CANDIDATE" | "DRAFT" | "WORK_ITEM";
    id: string;
    version?: number;
    semanticHash?: `sha256:${string}`;
    candidateState?: "PENDING" | "SNOOZED";
    linkedToConfirmedWorkItem?: boolean;
  }>;
  readonly sourceRefs: readonly QueueExactSourceRef[];
  readonly precursorId?: string;
}

export interface LocalQueueOperationalFacts extends Readonly<Record<string, unknown>> {
  readonly state: "NOT_APPLICABLE" | "UNKNOWN" | "KNOWN";
  readonly normalizedStatus?: string;
  readonly displayStatus?: string;
  readonly reasonCode?: string;
  readonly freshness?: "CURRENT" | "STALE" | "UNKNOWN";
  readonly sourceRefs: readonly QueueExactSourceRef[];
}

export interface LocalQueueQaFacts extends Readonly<Record<string, unknown>> {
  readonly state: "NOT_APPLICABLE" | "UNKNOWN" | "KNOWN";
  readonly readiness?: "NOT_ASSESSED" | "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER" | "STALE";
  readonly activities?: readonly QueueStageActivity[];
  readonly reasonCode?: string;
  readonly sourceRefs: readonly QueueExactSourceRef[];
}

export interface LocalQueuePlanningFacts extends Readonly<Record<string, unknown>> {
  readonly policyFacetRef: Readonly<object>;
  readonly derivationRuleRef: Readonly<object>;
  readonly control: Readonly<Record<string, unknown>>;
  readonly capacity: Readonly<Record<string, unknown>>;
  readonly sla: Readonly<Record<string, unknown>>;
  readonly ordering: Readonly<Record<string, unknown>>;
  readonly sourceRefs: readonly QueueExactSourceRef[];
  readonly slaStartConfiguration?: Readonly<{
    calendarRef: QueueVersionedContentRef;
    mappingRef: JiraStatusMappingRef;
    algorithmRef: QueueAlgorithmRef;
    goals: readonly Readonly<{
      goal: SlaGoal;
      targetBusinessSeconds: number | null;
      warningThresholds: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[];
    }>[];
  }>;
}

export interface LocalQueueFactComposerPorts {
  readonly workItem: LocalQueueFactPort<LocalQueueWorkItemFacts>;
  readonly operational: LocalQueueFactPort<LocalQueueOperationalFacts>;
  readonly qa: LocalQueueFactPort<LocalQueueQaFacts>;
  readonly planning: LocalQueueFactPort<LocalQueuePlanningFacts>;
}

const queueSourceRefKey = (ref: QueueExactSourceRef): string =>
  canonicalize([ref.sourceType, ref.sourceId, ref.sourceVersion, ref.semanticHash] as JsonValue);

function localSourceRefs(
  groups: readonly (readonly QueueExactSourceRef[])[],
): readonly QueueExactSourceRef[] {
  const sorted = groups
    .flat()
    .map((ref) => Object.freeze({ ...ref }))
    .sort((left, right) => queueSourceRefKey(left).localeCompare(queueSourceRefKey(right)));
  for (let index = 1; index < sorted.length; index += 1) {
    if (queueSourceRefKey(sorted[index - 1]!) === queueSourceRefKey(sorted[index]!))
      throw new Error("QUEUE_SOURCE_REF_DUPLICATE");
  }
  return Object.freeze(sorted);
}

function stageDetail(
  stage: string,
  detail: string,
  activities: readonly QueueStageActivity[],
): string {
  if (stage === "CANDIDATE")
    return detail === "SNOOZED_CANDIDATE"
      ? "CANDIDATE_SNOOZED"
      : detail === "UNLINKED_DRAFT"
        ? "DRAFT_IN_PROGRESS"
        : "CANDIDATE_PENDING_CONFIRMATION";
  if (stage === "READY") return detail === "COMMITTED" ? "COMMITTED" : "QUEUEABLE";
  if (stage === "COMPLETED") return detail === "CANCELLED" ? "CANCELLED" : "DONE";
  if (stage === "ACTIVE") {
    if (detail === "REVIEW_REQUIRED" || detail === "BLOCKED") return detail;
    return activities.some(({ mode, state }) => mode === "MANUAL" && state === "RUNNING")
      ? "MANUAL_RUNNING"
      : "AUTOMATED_RUNNING";
  }
  const allowed = new Set([
    "NEEDS_INFO",
    "OPERATIONAL_PENDING",
    "SYNC_ERROR",
    "READINESS_STALE",
    "COMPLETION_PENDING",
    "JIRA_READY_WITHOUT_CURRENT_DOR",
  ]);
  return allowed.has(detail) ? detail : "NEEDS_INFO";
}

/** Reads only provider-neutral local ports and composes one deterministic snapshot. */
export class LocalQueueFactComposer {
  constructor(
    private readonly ports: LocalQueueFactComposerPorts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readCurrent(
    input: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ): Promise<QueueProjectionSourceSnapshot> {
    const [workItem, operationalValue, qaValue, planning] = await Promise.all([
      this.ports.workItem.current(input),
      this.ports.operational.current(input),
      this.ports.qa.current(input),
      this.ports.planning.current(input),
    ]);
    if (!workItem || !planning || workItem.subject.id !== input.subjectId)
      throw new Error("QUEUE_LOCAL_FACTS_NOT_FOUND");
    const operational: LocalQueueOperationalFacts =
      operationalValue ??
      Object.freeze({
        state: "UNKNOWN" as const,
        reasonCode: "NO_CONFIRMED_PROJECTION",
        freshness: "UNKNOWN" as const,
        sourceRefs: Object.freeze([]),
      });
    const qa: LocalQueueQaFacts =
      qaValue ??
      Object.freeze({
        state: "UNKNOWN" as const,
        reasonCode: "NOT_PROJECTED",
        readiness: "NOT_ASSESSED" as const,
        activities: Object.freeze([]),
        sourceRefs: Object.freeze([]),
      });
    const activities = qa.activities ?? Object.freeze([]);
    const subject =
      workItem.subject.kind === "CANDIDATE"
        ? {
            kind: "CANDIDATE" as const,
            id: workItem.subject.id,
            candidateState: workItem.subject.candidateState ?? ("PENDING" as const),
          }
        : workItem.subject.kind === "DRAFT"
          ? {
              kind: "DRAFT" as const,
              id: workItem.subject.id,
              linkedToConfirmedWorkItem: workItem.subject.linkedToConfirmedWorkItem ?? false,
            }
          : { kind: "WORK_ITEM" as const, id: workItem.subject.id };
    const stage = deriveQueueStage({
      subject,
      operational:
        operational.state === "KNOWN"
          ? {
              state: "CONFIRMED",
              normalizedStatus: operational.normalizedStatus ?? "NEW",
              displayStatus: operational.displayStatus ?? operational.normalizedStatus ?? "Unknown",
            }
          : operational.state === "NOT_APPLICABLE"
            ? { state: "NOT_APPLICABLE" }
            : { state: operational.reasonCode === "SYNC_ERROR" ? "ERROR" : "PENDING" },
      qa: { readiness: qa.readiness ?? "NOT_ASSESSED", activities },
    });
    const sourceRefs = localSourceRefs([
      workItem.sourceRefs,
      operational.sourceRefs,
      qa.sourceRefs,
      planning.sourceRefs,
    ]);
    if (sourceRefs.length === 0) throw new Error("QUEUE_LOCAL_SOURCE_REFS_REQUIRED");
    const calculatedAt = this.now().toISOString();
    const operationalFacet =
      operational.state === "KNOWN"
        ? Object.freeze({
            state: "KNOWN",
            projectionRef: operational.projectionRef,
            externalDisplayKey: operational.externalDisplayKey,
            rawStatus: operational.rawStatus,
            normalizedStatus: operational.normalizedStatus,
            priority: operational.priority,
            dueDate: operational.dueDate,
            assignee: operational.assignee,
            freshness: operational.freshness,
          })
        : operational.state === "NOT_APPLICABLE"
          ? Object.freeze({ state: "NOT_APPLICABLE" })
          : Object.freeze({
              state: "UNKNOWN",
              reasonCode: operational.reasonCode ?? "NO_CONFIRMED_PROJECTION",
              freshness: operational.freshness ?? "UNKNOWN",
            });
    const qaFacet =
      qa.state === "KNOWN"
        ? Object.freeze({
            state: "KNOWN",
            factsRef: qa.factsRef,
            readiness: qa.readiness ?? "NOT_ASSESSED",
            requiredCapabilities: qa.requiredCapabilities ?? Object.freeze([]),
            activities: Object.freeze(
              activities.map((activity) =>
                Object.freeze({
                  sessionRef: (activity as QueueStageActivity & Readonly<{ sessionRef?: unknown }>)
                    .sessionRef,
                  mode: activity.mode,
                  state: activity.state,
                }),
              ),
            ),
          })
        : qa.state === "NOT_APPLICABLE"
          ? Object.freeze({ state: "NOT_APPLICABLE" })
          : Object.freeze({
              state: "UNKNOWN",
              reasonCode: qa.reasonCode ?? "NOT_PROJECTED",
            });
    return Object.freeze({
      schemaVersion: "queue-entry@1.0.0",
      queueEntryId: input.subjectId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      subjectId: input.subjectId,
      subject: workItem.subject,
      stage: stage.stage,
      stageDetails: Object.freeze([stageDetail(stage.stage, stage.detail, activities)]),
      stageReasonCodes: stage.reasonCodes,
      operational: operationalFacet,
      qa: qaFacet,
      control: planning.control,
      capacity: planning.capacity,
      sla: planning.sla,
      ordering: planning.ordering,
      consistencyWarnings: stage.consistencyWarnings,
      freshness: Object.freeze({
        state: operational.state === "UNKNOWN" || qa.state === "UNKNOWN" ? "STALE" : "CURRENT",
        sourceStates: Object.freeze(
          sourceRefs.map((ref) =>
            Object.freeze({ sourceType: ref.sourceType, state: "CURRENT" as const }),
          ),
        ),
        evaluatedAt: calculatedAt,
      }),
      sourceRefs,
      sourceSetHash: sha256(sourceRefs as unknown as JsonValue),
      policyFacetRef: planning.policyFacetRef,
      derivationRuleRef: planning.derivationRuleRef,
      calculatedAt,
      ...(planning.slaStartConfiguration
        ? { slaStartConfiguration: planning.slaStartConfiguration }
        : {}),
      ...(workItem.precursorId === undefined ? {} : { precursorId: workItem.precursorId }),
    });
  }
}

export interface DurableInitialSlaClockPort {
  start(
    input: Readonly<{
      transition: SlaClockStartTransition;
      revisionId: string;
      segmentId: string;
      targetBusinessSeconds: number | null;
      warningThresholds: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[];
      correlationId: string;
      causationId: string;
    }>,
  ): Promise<unknown>;
}

const stableUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const slaClockSchemaRef = Object.freeze({
  id: "urn:awp:schemas:006:sla-clock-transition:v1",
  version: 1,
  digest: "sha256:39a0122a052a611fc817a63a245080481c8c05a727bb1690314d53e848788274",
});
const slaThresholdSchemaRef = Object.freeze({
  id: "urn:awp:schemas:006:sla-threshold-emission:v1",
  version: 1,
  digest: "sha256:fc3db628391931e73fcdf158ca99ce394452ce6cb5df86b2d5bfe2e1a33d00f7",
});

function slaEventEnvelope(
  input: Readonly<{
    eventId: string;
    eventType: string;
    workspaceId: string;
    projectId: string;
    entityType: "sla-clock" | "sla-threshold-emission";
    entityId: string;
    entityVersion: number;
    occurredAt: string;
    recordedAt: string;
    payloadSchemaRef: typeof slaClockSchemaRef | typeof slaThresholdSchemaRef;
    payload: Readonly<Record<string, unknown>>;
    correlationId: string;
    causationId: string;
  }>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    envelopeVersion: 1,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    producer: "worker.queue-projector",
    producerVersion: "1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: Object.freeze({
      kind: "SERVICE",
      principalId: stableUuid("worker.queue-projector"),
      serviceKey: "worker.queue-projector",
    }),
    dataClassificationKey: "INTERNAL",
    payloadVersion: 1,
    payloadSchemaRef: input.payloadSchemaRef,
    payload: input.payload,
  });
}

export function slaClockTransitionEventEnvelope(
  input: Readonly<{
    transition: SlaClockTransition;
    correlationId: string;
    causationId: string;
    recordedAt?: string;
  }>,
): Readonly<Record<string, unknown>> {
  const eventType =
    input.transition.transition === "START"
      ? "sla.clock.started"
      : input.transition.transition === "PAUSE"
        ? "sla.clock.paused"
        : input.transition.transition === "RESUME"
          ? "sla.clock.resumed"
          : "sla.clock.stopped";
  return slaEventEnvelope({
    eventId: stableUuid(
      `${eventType}:${input.transition.slaClockId}:${input.transition.clockRevisionRef.version}:${input.transition.clockRevisionRef.semanticHash}`,
    ),
    eventType,
    workspaceId: input.transition.workspaceId,
    projectId: input.transition.projectId,
    entityType: "sla-clock",
    entityId: input.transition.slaClockId,
    entityVersion: input.transition.clockRevisionRef.version,
    occurredAt: input.transition.effectiveAt,
    recordedAt: input.recordedAt ?? input.transition.effectiveAt,
    payloadSchemaRef: slaClockSchemaRef,
    payload: input.transition as unknown as Readonly<Record<string, unknown>>,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
}

export function slaThresholdEventEnvelope(
  input: Readonly<{
    emission: SlaThresholdEmission;
    correlationId?: string;
    causationId?: string;
  }>,
): Readonly<Record<string, unknown>> {
  const threshold = input.emission.threshold as Readonly<{ kind: "WARNING" | "BREACH" }>;
  const eventType = threshold.kind === "WARNING" ? "sla.warning" : "sla.breached";
  return slaEventEnvelope({
    eventId: stableUuid(
      `${eventType}:${input.emission.thresholdEmissionId}:${input.emission.semanticHash}`,
    ),
    eventType,
    workspaceId: String(input.emission.workspaceId),
    projectId: String(input.emission.projectId),
    entityType: "sla-threshold-emission",
    entityId: input.emission.thresholdEmissionId,
    entityVersion: 1,
    occurredAt: String(input.emission.emittedAt),
    recordedAt: String(input.emission.emittedAt),
    payloadSchemaRef: slaThresholdSchemaRef,
    payload: input.emission as unknown as Readonly<Record<string, unknown>>,
    correlationId:
      input.correlationId ??
      stableUuid(
        `sla-threshold-correlation:${String(input.emission.slaClockId)}:${String(input.emission.clockCycle)}`,
      ),
    causationId:
      input.causationId ??
      stableUuid(`sla-threshold-causation:${String(input.emission.idempotencyHash)}`),
  });
}

/** Starts clocks only from the confirmed Jira authority ref carried by local facts. */
export class ConfirmedJiraSlaStartProjector {
  constructor(private readonly clocks: DurableInitialSlaClockPort) {}

  async project(snapshot: QueueProjectionSourceSnapshot): Promise<number> {
    const configuration =
      snapshot.slaStartConfiguration as LocalQueuePlanningFacts["slaStartConfiguration"];
    const operational = snapshot.operational as Readonly<Record<string, unknown>> | undefined;
    const policyFacetRef = snapshot.policyFacetRef as QueueVersionedContentRef | undefined;
    if (!configuration || !operational || !policyFacetRef || operational.state !== "KNOWN")
      return 0;
    const startSourceRef = operational.projectionRef as ConfirmedJiraProjectionRef | undefined;
    const decision = detectConfirmedJiraSlaStart({
      operationalState: startSourceRef ? "CONFIRMED" : "PENDING",
      normalizedStatus: String(operational.normalizedStatus ?? ""),
      currentReadiness: String(
        (snapshot.qa as Readonly<Record<string, unknown>> | undefined)?.readiness ?? "NOT_ASSESSED",
      ),
      ...(startSourceRef ? { operationalRef: startSourceRef } : {}),
    });
    if (decision.state !== "START") return 0;
    let starts = 0;
    for (const goal of configuration.goals) {
      const identity = `${snapshot.workspaceId}:${snapshot.projectId}:${snapshot.subjectId}:${goal.goal}`;
      const slaClockId = stableUuid(`sla-clock:${identity}`);
      const transition = createInitialSlaClock({
        workspaceId: String(snapshot.workspaceId),
        projectId: String(snapshot.projectId),
        workItemId: snapshot.subjectId,
        slaClockId,
        goal: goal.goal,
        policyFacetRef,
        calendarRef: configuration.calendarRef,
        mappingRef: configuration.mappingRef,
        algorithmRef: configuration.algorithmRef,
        startSourceRef: decision.startSourceRef,
      });
      await this.clocks.start({
        transition,
        revisionId: stableUuid(`sla-clock-revision:${identity}:1`),
        segmentId: stableUuid(`sla-clock-segment:${identity}:1`),
        targetBusinessSeconds: goal.targetBusinessSeconds,
        warningThresholds: goal.warningThresholds,
        correlationId: stableUuid(`sla-clock-correlation:${identity}`),
        causationId: stableUuid(
          `sla-clock-causation:${decision.startSourceRef.sourceId}:${decision.startSourceRef.sourceVersion}`,
        ),
      });
      starts += 1;
    }
    return starts;
  }
}

export interface SlaLifecycleFacts {
  readonly transition: SlaClockTransition;
  readonly calendar: BusinessCalendarRevision;
  readonly segments: readonly SlaClockSegmentRevision[];
  readonly target: SlaTargetGoalConfiguration;
  readonly operational?: Readonly<{
    sourceRef: ConfirmedJiraProjectionRef;
    effect: "CONTINUE" | "PAUSE" | "RESUME";
    mappedPauseReasonCode?: string;
  }>;
  readonly firstConsumingSession?: Readonly<{
    sourceRef: SlaSessionStopSourceRef;
    effectiveAt: string;
  }>;
  readonly signedVerdict?: Readonly<{ sourceRef: SlaVerdictStopSourceRef; effectiveAt: string }>;
}

export interface SlaLifecyclePorts {
  readonly load: (
    input: Readonly<{ workspaceId: string; projectId: string; workItemId: string; goal: SlaGoal }>,
  ) => Promise<SlaLifecycleFacts | undefined>;
  readonly append: (
    input: Readonly<{
      transition: SlaClockTransition;
      revisionId: string;
      expectedVersion: number;
      nextTemporalEvaluationAt?: string;
      closedSegment: Readonly<{ revisionId: string; value: SlaClockSegmentRevision }>;
      openedSegment?: Readonly<{ revisionId: string; value: SlaClockSegmentRevision }>;
      correlationId: string;
      causationId: string;
    }>,
  ) => Promise<Readonly<{ outcome: "APPENDED" | "NO_OP_DUPLICATE" }>>;
}

/** Reconciles clocks only from already-persisted Jira/QA facts; provider and model ports are absent. */
export class SlaLifecycleProjector {
  constructor(private readonly ports: SlaLifecyclePorts) {}

  async project(
    input: Readonly<{ workspaceId: string; projectId: string; workItemId: string }>,
  ): Promise<number> {
    let appended = 0;
    for (const goal of ["READY_TO_FIRST_QA_START", "READY_TO_SIGNED_VERDICT"] as const) {
      const facts = await this.ports.load({ ...input, goal });
      if (!facts || facts.transition.currentClockState === "STOPPED") continue;
      const stop =
        goal === "READY_TO_FIRST_QA_START" ? facts.firstConsumingSession : facts.signedVerdict;
      const command = stop
        ? Object.freeze({
            kind: "STOP" as const,
            sourceRef: stop.sourceRef,
            effectiveAt: stop.effectiveAt,
          })
        : facts.transition.currentClockState === "RUNNING" && facts.operational?.effect === "PAUSE"
          ? Object.freeze({
              kind: "PAUSE" as const,
              sourceRef: facts.operational.sourceRef,
              ...(facts.operational.mappedPauseReasonCode
                ? { mappedPauseReasonCode: facts.operational.mappedPauseReasonCode }
                : {}),
            })
          : facts.transition.currentClockState === "PAUSED" &&
              facts.operational?.effect === "RESUME"
            ? Object.freeze({ kind: "RESUME" as const, sourceRef: facts.operational.sourceRef })
            : undefined;
      if (!command) continue;
      const advanced = advanceSlaClock({
        current: facts.transition,
        calendar: facts.calendar,
        command,
      });
      if (advanced.outcome === "NO_CHANGE") continue;
      const openSegment = facts.segments.find(
        (segment) => segment.clockCycle === facts.transition.clockCycle && !segment.endedAt,
      );
      if (!openSegment) throw new Error("SLA_LIFECYCLE_OPEN_SEGMENT_NOT_FOUND");
      const nextSegmentId =
        advanced.transition.currentClockState === "STOPPED"
          ? undefined
          : stableUuid(
              `sla-clock-segment:${advanced.transition.slaClockId}:${advanced.transition.clockCycle}:${openSegment.ordinal + 1}`,
            );
      const segments = applySlaClockTransitionToSegments({
        transition: advanced.transition,
        calendar: facts.calendar,
        openSegment,
        ...(nextSegmentId ? { nextSegmentId } : {}),
      });
      if (!segments.closed) throw new Error("SLA_LIFECYCLE_CLOSED_SEGMENT_REQUIRED");
      const nextPlan: SlaThresholdPlan =
        advanced.transition.currentClockState === "RUNNING"
          ? planSlaThresholds({
              transition: advanced.transition,
              calendar: facts.calendar,
              target: facts.target,
              segments: Object.freeze([
                ...facts.segments.filter(
                  (segment) => segment.segmentRef.sourceId !== segments.closed!.segmentRef.sourceId,
                ),
                segments.closed,
                segments.opened!,
              ]),
              asOf: advanced.transition.effectiveAt,
            })
          : Object.freeze({ crossings: Object.freeze([]) });
      const result = await this.ports.append({
        transition: advanced.transition,
        revisionId: stableUuid(
          `sla-clock-revision:${advanced.transition.slaClockId}:${advanced.transition.clockRevisionRef.version}:${advanced.transition.clockRevisionRef.semanticHash}`,
        ),
        expectedVersion: facts.transition.clockRevisionRef.version,
        correlationId: stableUuid(
          `sla-clock-correlation:${advanced.transition.slaClockId}:${advanced.transition.clockCycle}`,
        ),
        causationId: stableUuid(
          `sla-clock-causation:${advanced.transition.transitionSourceRef.sourceType}:${advanced.transition.transitionSourceRef.sourceId}:${advanced.transition.transitionSourceRef.sourceVersion}`,
        ),
        ...(nextPlan.nextEvaluationAt
          ? { nextTemporalEvaluationAt: nextPlan.nextEvaluationAt }
          : {}),
        closedSegment: Object.freeze({
          revisionId: stableUuid(
            `sla-clock-segment-revision:${segments.closed.segmentRef.sourceId}:${segments.closed.segmentRef.sourceVersion}:${segments.closed.segmentRef.semanticHash}`,
          ),
          value: segments.closed,
        }),
        ...(segments.opened
          ? {
              openedSegment: Object.freeze({
                revisionId: stableUuid(
                  `sla-clock-segment-revision:${segments.opened.segmentRef.sourceId}:${segments.opened.segmentRef.sourceVersion}:${segments.opened.segmentRef.semanticHash}`,
                ),
                value: segments.opened,
              }),
            }
          : {}),
      });
      if (result.outcome === "APPENDED") appended += 1;
    }
    return appended;
  }
}

export type QueueProjectionCause =
  | Readonly<{
      kind: "SOURCE_INVALIDATION" | "TEMPORAL_EVALUATION" | "CONTROL_TRANSITION" | "REBUILD";
    }>
  | Readonly<{ kind: "CORRECTION"; reasonCode?: string }>;

export function boundedQueueProjectionCause(input: QueueProjectionCause): QueueProjectionCause {
  if (input.kind !== "CORRECTION") return Object.freeze({ kind: input.kind });
  if (!input.reasonCode) throw new Error("QUEUE_CORRECTION_REASON_REQUIRED");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.reasonCode))
    throw new Error("QUEUE_CORRECTION_REASON_INVALID");
  return Object.freeze({ kind: "CORRECTION", reasonCode: input.reasonCode });
}

export function queueProjectionEventTypes(
  input: Readonly<{ controlTransition: boolean; stageChanged: boolean }>,
): readonly string[] {
  const types = Object.freeze([
    input.controlTransition ? "queue.control.changed" : "queue.projection.updated",
    ...(input.stageChanged ? ["queue.stage.changed"] : []),
  ]);
  validateMutuallyExclusiveEmission(types);
  return types;
}

export function queueProjectionInputFingerprint(
  value: QueueProjectionSourceSnapshot,
): ReturnType<typeof sha256> {
  const semantic = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete semantic.calculatedAt;
  delete semantic.reconciledAt;
  delete semantic.revision;
  delete semantic.inputFingerprint;
  delete semantic.semanticHash;
  const freshness = semantic.freshness as Record<string, unknown> | undefined;
  if (freshness) delete freshness.evaluatedAt;
  return sha256(semantic as JsonValue);
}

export interface QueueProjectionCoordinatorPorts {
  readCurrent(
    input: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ): Promise<QueueProjectionSourceSnapshot>;
  appendIfChanged(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      subjectId: string;
      generationId: string;
      inputFingerprint: string;
      snapshot: QueueProjectionSourceSnapshot;
      cause: QueueProjectionCause;
    }>,
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>>;
  suppressPrecursor(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      precursorId: string;
      workItemId: string;
    }>,
  ): Promise<void>;
  applySlaLifecycle?(input: QueueProjectionInvalidation): Promise<void>;
}

export interface QueueProjectionInvalidation {
  readonly eventId: string;
  readonly eventType?: string;
  readonly entityId: string;
  readonly entityVersion: number;
  /** Distinguishes independent version counters when the projected subject differs from the event entity. */
  readonly versionSourceId?: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly cause?: QueueProjectionCause;
}

/** Idempotent provider-neutral orchestration; all source reads are local ports. */
export class QueueProjectionCoordinator {
  readonly messages = new Map<string, string>();
  readonly versions = new Map<string, number>();

  constructor(private readonly ports: QueueProjectionCoordinatorPorts) {}

  async consume(
    event: QueueProjectionInvalidation,
  ): Promise<Readonly<{ status: "PROCESSED" | "DUPLICATE" | "STALE"; changed?: boolean }>> {
    const eventHash = sha256(JSON.parse(JSON.stringify(event)) as JsonValue);
    const messageKey = `${event.scope.workspaceId}\0${event.scope.projectId}\0${event.eventId}`;
    const priorHash = this.messages.get(messageKey);
    if (priorHash !== undefined) {
      if (priorHash !== eventHash) throw new Error("QUEUE_INVALIDATION_HASH_CONFLICT");
      return Object.freeze({ status: "DUPLICATE" as const });
    }
    // Jira projections, QA revisions and import timestamps have independent counters.
    const versionKey = `${event.scope.workspaceId}\0${event.scope.projectId}\0${event.versionSourceId ?? event.entityId}\0${event.eventType ?? ""}`;
    if (event.entityVersion <= (this.versions.get(versionKey) ?? 0))
      return Object.freeze({ status: "STALE" as const });
    const result = await this.project(
      { ...event.scope, subjectId: event.entityId },
      "ACTIVE",
      event.cause ?? {
        kind:
          event.eventType === "queue.control.changed"
            ? "CONTROL_TRANSITION"
            : "SOURCE_INVALIDATION",
      },
    );
    await this.ports.applySlaLifecycle?.(event);
    this.messages.set(messageKey, eventHash);
    this.versions.set(versionKey, event.entityVersion);
    return Object.freeze({ status: "PROCESSED" as const, changed: result.changed });
  }

  async rebuild(
    subjects: readonly Readonly<{ workspaceId: string; projectId: string; subjectId: string }>[],
    generationId: string,
  ): Promise<void> {
    for (const subject of subjects) await this.project(subject, generationId, { kind: "REBUILD" });
  }

  /** Worker-only transition. Queue reads intentionally have no path to this method. */
  async evaluateTemporal(
    subject: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>> {
    return await this.project(subject, "ACTIVE", { kind: "TEMPORAL_EVALUATION" });
  }

  private async project(
    subject: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
    generationId: string,
    cause: QueueProjectionCause,
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>> {
    const snapshot = await this.ports.readCurrent(subject);
    const result = await this.ports.appendIfChanged(
      Object.freeze({
        ...subject,
        generationId,
        inputFingerprint: queueProjectionInputFingerprint(snapshot),
        snapshot,
        cause: boundedQueueProjectionCause(cause),
      }),
    );
    if (snapshot.precursorId !== undefined) {
      await this.ports.suppressPrecursor(
        Object.freeze({
          workspaceId: subject.workspaceId,
          projectId: subject.projectId,
          precursorId: snapshot.precursorId,
          workItemId: subject.subjectId,
        }),
      );
    }
    return result;
  }
}

export const queueProjectionSourceEventTypes = Object.freeze([
  "intake.candidate.discovered",
  "intake.candidate.source-observed",
  "intake.candidate.decision-recorded",
  "intake.candidate.converted",
  "work-item.create",
  "work_item.operational.imported",
  "work_item.operational.projection-updated",
  "work_item.operational.reconciliation-completed",
  "qa.queue-facts.changed",
  "qa.readiness.confirmed",
  "qa.request.input-revised",
  "qa.required-session-plan.published",
  ...qaUs5SlaLifecycleEventTypes,
  "qa.automation-attempt.status-observed",
  "qa.automation-attempt.completed",
  "queue.control.changed",
  "capacity.admission.decided",
] as const);

type InvalidationRow = Readonly<{
  id: string;
  workspace_id: string;
  project_id: string;
  event_type: string;
  envelope: unknown;
  envelope_hash: string;
  created_at: Date | string;
}>;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : Object.freeze({});
};

function invalidationFrom(row: InvalidationRow): QueueProjectionInvalidation {
  const envelope = asRecord(row.envelope);
  const payload = asRecord(envelope.payload ?? envelope);
  const entityId =
    envelope.entityId ??
    payload.workItemId ??
    payload.candidateId ??
    payload.draftId ??
    payload.entityId;
  if (typeof entityId !== "string" || entityId.length === 0)
    throw new Error("QUEUE_INVALIDATION_SUBJECT_MISSING");
  const occurredAt = envelope.occurredAt ?? payload.occurredAt ?? row.created_at;
  const fallbackVersion = Math.max(1, Date.parse(String(occurredAt)));
  const rawVersion =
    envelope.entityVersion ??
    payload.entityVersion ??
    payload.revision ??
    payload.revisionNumber ??
    fallbackVersion;
  const entityVersion = Number(rawVersion);
  if (!Number.isSafeInteger(entityVersion) || entityVersion < 1)
    throw new Error("QUEUE_INVALIDATION_VERSION_INVALID");
  return Object.freeze({
    eventId: String(envelope.eventId ?? row.id),
    eventType: row.event_type,
    entityId,
    entityVersion,
    scope: Object.freeze({ workspaceId: row.workspace_id, projectId: row.project_id }),
    cause: Object.freeze({
      kind:
        row.event_type === "queue.control.changed"
          ? ("CONTROL_TRANSITION" as const)
          : ("SOURCE_INVALIDATION" as const),
    }),
  });
}

/** PostgreSQL is the durable projection queue; an accelerator may only wake this scan. */
export class PostgresQueueProjectionWorker {
  constructor(
    private readonly source: DataSource,
    private readonly coordinator?: Pick<QueueProjectionCoordinator, "consume">,
    private readonly deploymentScope?: Readonly<{
      workspaceId: string;
      projectIds: readonly string[];
    }>,
  ) {
    if (deploymentScope && (!deploymentScope.workspaceId || !deploymentScope.projectIds.length))
      throw new Error("QUEUE_PROJECTION_SCOPE_INVALID");
  }

  async run(
    batchSize = 100,
  ): Promise<Readonly<{ invalidations: number; temporalCandidates: number }>> {
    if (!this.coordinator)
      return Object.freeze({
        invalidations: 0,
        temporalCandidates: (await this.claimDue(batchSize)).length,
      });
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
      throw new Error("QUEUE_PROJECTION_BATCH_INVALID");
    const rows = (await this.source.query(
      `SELECT outbox.id,outbox.workspace_id,outbox.project_id,outbox.event_type,outbox.envelope,outbox.envelope_hash,outbox.created_at
         FROM event_outbox outbox
         LEFT JOIN consumer_inbox inbox ON inbox.consumer_key='queue-projector' AND inbox.message_id=outbox.id::text
        WHERE inbox.message_id IS NULL AND outbox.event_type=ANY($1::text[])
          AND ($3::uuid IS NULL OR (outbox.workspace_id=$3 AND outbox.project_id=ANY($4::uuid[])))
        ORDER BY outbox.created_at,outbox.id LIMIT $2`,
      [
        queueProjectionSourceEventTypes,
        batchSize,
        this.deploymentScope?.workspaceId ?? null,
        this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
      ],
    )) as InvalidationRow[];
    let processed = 0;
    for (const row of rows) {
      let invalidation = invalidationFrom(row);
      if (
        row.event_type === "qa.automation-attempt.status-observed" ||
        row.event_type === "qa.automation-attempt.completed"
      ) {
        const attempts = (await this.source.query(
          `SELECT work_item_id FROM qa_automation_attempts
           WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3`,
          [row.workspace_id, row.project_id, invalidation.entityId],
        )) as readonly { work_item_id: string }[];
        if (attempts.length !== 1 || !attempts[0]?.work_item_id)
          throw new Error("QUEUE_AUTOMATION_ATTEMPT_SUBJECT_MISSING");
        invalidation = Object.freeze({
          ...invalidation,
          versionSourceId: invalidation.entityId,
          entityId: attempts[0].work_item_id,
        });
      }
      await this.coordinator.consume(invalidation);
      const inserted = (await this.source.query(
        `INSERT INTO consumer_inbox(consumer_key,message_id,message_hash,processed_at)
         VALUES('queue-projector',$1,$2,clock_timestamp()) ON CONFLICT(consumer_key,message_id) DO NOTHING RETURNING message_id`,
        [row.id, row.envelope_hash],
      )) as readonly unknown[];
      if (inserted.length > 0) processed += 1;
    }
    return Object.freeze({ invalidations: processed, temporalCandidates: 0 });
  }

  async claimDue(batchSize = 100): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
      throw new Error("QUEUE_PROJECTION_BATCH_INVALID");
    return this.source.transaction(
      "READ COMMITTED",
      async (manager) =>
        (await manager.query(
          `SELECT queue_entry_id,workspace_id,project_id,current_revision_id
         FROM queue_entry_heads
        WHERE suppressed_by_work_item_id IS NULL
          AND ($2::uuid IS NULL OR (workspace_id=$2 AND project_id=ANY($3::uuid[])))
          AND (next_temporal_evaluation_at IS NULL OR next_temporal_evaluation_at<=clock_timestamp())
        ORDER BY next_temporal_evaluation_at NULLS FIRST,workspace_id,project_id,queue_entry_id
        LIMIT $1 FOR UPDATE SKIP LOCKED`,
          [
            batchSize,
            this.deploymentScope?.workspaceId ?? null,
            this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
          ],
        )) as readonly Readonly<Record<string, unknown>>[],
    );
  }
}

import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export const queueStages = Object.freeze([
  "CANDIDATE",
  "BACKLOG",
  "READY",
  "ACTIVE",
  "COMPLETED",
] as const);
export type QueueStage = (typeof queueStages)[number];

export type QueueStageSubject =
  | Readonly<{ kind: "CANDIDATE"; id: string; candidateState: "PENDING" | "SNOOZED" }>
  | Readonly<{ kind: "DRAFT"; id: string; linkedToConfirmedWorkItem: boolean }>
  | Readonly<{ kind: "WORK_ITEM"; id: string }>;

export type QueueOperationalStageFact =
  | Readonly<{ state: "NOT_APPLICABLE" | "PENDING" | "ERROR" }>
  | Readonly<{ state: "CONFIRMED"; normalizedStatus: string; displayStatus: string }>;

export interface QueueStageActivity {
  readonly sessionId: string;
  readonly mode: "MANUAL" | "AUTOMATED";
  readonly state:
    "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
}

export interface QueueStageInput {
  readonly subject: QueueStageSubject;
  readonly operational: QueueOperationalStageFact;
  readonly qa: Readonly<{
    readiness: "NOT_ASSESSED" | "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER" | "STALE";
    activities: readonly QueueStageActivity[];
  }>;
}

export interface QueueStageResult {
  readonly algorithm: "queue-stage@1.0.0";
  readonly stage: QueueStage;
  readonly detail: string;
  readonly reasonCodes: readonly string[];
  readonly activityOrigins: readonly ("JIRA" | "SESSION_AUTOMATED" | "SESSION_MANUAL")[];
  readonly consistencyWarnings: readonly (
    | "EXTERNAL_STATE_AHEAD"
    | "SESSION_STATE_AHEAD"
    | "TERMINAL_WITH_OPEN_QA"
    | "JIRA_READY_WITHOUT_CURRENT_DOR"
  )[];
  readonly jira: QueueOperationalStageFact;
}

const activeSessionStates = new Set<QueueStageActivity["state"]>([
  "RUNNING",
  "REVIEW_REQUIRED",
  "BLOCKED",
]);
const jiraTerminalStates = new Set(["DONE", "CANCELLED"]);
const jiraActiveStates = new Set(["ACTIVE", "IN_PROGRESS", "IN_REVIEW", "REVIEW", "BLOCKED"]);
const jiraReadyStates = new Set(["READY", "PLANNED"]);

const freezeResult = (input: Omit<QueueStageResult, "algorithm">): QueueStageResult =>
  Object.freeze({
    algorithm: "queue-stage@1.0.0",
    ...input,
    reasonCodes: Object.freeze([...new Set(input.reasonCodes)].sort()),
    activityOrigins: Object.freeze([...new Set(input.activityOrigins)].sort()),
    consistencyWarnings: Object.freeze([...new Set(input.consistencyWarnings)].sort()),
  });

export function deriveQueueStage(input: QueueStageInput): QueueStageResult {
  if (!input.subject.id) throw new Error("QUEUE_STAGE_SUBJECT_INVALID");
  if (input.subject.kind === "CANDIDATE") {
    return freezeResult({
      stage: "CANDIDATE",
      detail:
        input.subject.candidateState === "SNOOZED" ? "SNOOZED_CANDIDATE" : "PENDING_CANDIDATE",
      reasonCodes: [
        input.subject.candidateState === "SNOOZED" ? "CANDIDATE_SNOOZED" : "CANDIDATE_PENDING",
      ],
      activityOrigins: [],
      consistencyWarnings: [],
      jira: { state: "NOT_APPLICABLE" },
    });
  }
  if (input.subject.kind === "DRAFT") {
    if (input.subject.linkedToConfirmedWorkItem)
      throw new Error("QUEUE_STAGE_LINKED_DRAFT_MUST_USE_WORK_ITEM_SUBJECT");
    return freezeResult({
      stage: "CANDIDATE",
      detail: "UNLINKED_DRAFT",
      reasonCodes: ["DRAFT_NOT_CONFIRMED"],
      activityOrigins: [],
      consistencyWarnings: [],
      jira: { state: "NOT_APPLICABLE" },
    });
  }

  const activeActivities = input.qa.activities.filter(({ state }) =>
    activeSessionStates.has(state),
  );
  const sessionOrigins = activeActivities.map(({ mode }) =>
    mode === "MANUAL" ? ("SESSION_MANUAL" as const) : ("SESSION_AUTOMATED" as const),
  );
  const jiraStatus =
    input.operational.state === "CONFIRMED" ? input.operational.normalizedStatus : undefined;
  if (jiraStatus !== undefined && jiraTerminalStates.has(jiraStatus)) {
    return freezeResult({
      stage: "COMPLETED",
      detail: jiraStatus,
      reasonCodes: ["JIRA_TERMINAL"],
      activityOrigins: [],
      consistencyWarnings: activeActivities.length > 0 ? ["TERMINAL_WITH_OPEN_QA"] : [],
      jira: input.operational,
    });
  }

  const jiraActive = jiraStatus !== undefined && jiraActiveStates.has(jiraStatus);
  if (jiraActive || activeActivities.length > 0) {
    return freezeResult({
      stage: "ACTIVE",
      detail: activeActivities.some(({ state }) => state === "REVIEW_REQUIRED")
        ? "REVIEW_REQUIRED"
        : activeActivities.some(({ state }) => state === "BLOCKED")
          ? "BLOCKED"
          : "IN_PROGRESS",
      reasonCodes: [jiraActive ? "JIRA_ACTIVE_CONFIRMED" : "QA_ACTIVITY_STARTED"],
      activityOrigins: [...(jiraActive ? ["JIRA" as const] : []), ...sessionOrigins],
      consistencyWarnings:
        jiraActive && activeActivities.length === 0
          ? ["EXTERNAL_STATE_AHEAD"]
          : !jiraActive && activeActivities.length > 0
            ? ["SESSION_STATE_AHEAD"]
            : [],
      jira: input.operational,
    });
  }

  const readyQa = input.qa.readiness === "READY" || input.qa.readiness === "READY_WITH_WAIVER";
  if (jiraStatus !== undefined && jiraReadyStates.has(jiraStatus) && readyQa) {
    return freezeResult({
      stage: "READY",
      detail: jiraStatus === "PLANNED" ? "COMMITTED" : "READY",
      reasonCodes: [
        "JIRA_READY_CONFIRMED",
        input.qa.readiness === "READY_WITH_WAIVER" ? "READINESS_WAIVED" : "READINESS_CONFIRMED",
      ],
      activityOrigins: [],
      consistencyWarnings: [],
      jira: input.operational,
    });
  }

  const reason =
    input.operational.state === "PENDING"
      ? "OPERATIONAL_PENDING"
      : input.operational.state === "ERROR"
        ? "SYNC_ERROR"
        : jiraStatus === "COMPLETION_PENDING"
          ? "COMPLETION_PENDING"
          : input.qa.readiness === "STALE"
            ? "READINESS_STALE"
            : input.qa.readiness === "NEEDS_INFO" || input.qa.readiness === "NOT_ASSESSED"
              ? "NEEDS_INFO"
              : "OPERATIONAL_NOT_READY";
  return freezeResult({
    stage: "BACKLOG",
    detail: reason,
    reasonCodes: [reason],
    activityOrigins: [],
    consistencyWarnings:
      jiraStatus !== undefined && jiraReadyStates.has(jiraStatus) && !readyQa
        ? ["JIRA_READY_WITHOUT_CURRENT_DOR"]
        : [],
    jira: input.operational,
  });
}

export function shouldSuppressQueuePrecursor(
  input: Readonly<{
    precursorProjectId: string;
    workItemProjectId: string;
    linkedWorkItemId: string;
    confirmedWorkItemId: string;
  }>,
): boolean {
  return (
    input.precursorProjectId === input.workItemProjectId &&
    input.linkedWorkItemId === input.confirmedWorkItemId
  );
}

const publicSourceTypes = new Set([
  "INTAKE_CANDIDATE_REVISION",
  "INTAKE_DRAFT_REVISION",
  "WORK_ITEM_REVISION",
  "JIRA_OPERATIONAL_PROJECTION_REVISION",
  "JIRA_STATUS_MAPPING_REVISION",
  "QA_QUEUE_FACT_REVISION",
  "QA_READINESS_FACT_SET",
  "QA_TEST_SESSION_REVISION",
  "QA_AUTOMATED_ACTIVITY_FACT_SET",
  "QA_TRIAGE_ASSESSMENT_REVISION",
  "QA_VERDICT_REVISION",
  "WORK_ITEM_QUEUE_CONTROL_REVISION",
  "REVIEW_CAPACITY_RESERVATION_REVISION",
  "HUMAN_WIP_CLAIM_REVISION",
  "SLA_CLOCK_REVISION",
]);

export function validateQueueEntryProjection(entry: Readonly<Record<string, unknown>>): void {
  const subject = entry.subject as Readonly<Record<string, unknown>> | undefined;
  const operational = entry.operational as Readonly<Record<string, unknown>> | undefined;
  const capacity = entry.capacity as Readonly<Record<string, unknown>> | undefined;
  const sla = entry.sla as Readonly<Record<string, unknown>> | undefined;
  const refs = Array.isArray(entry.sourceRefs)
    ? (entry.sourceRefs as readonly Readonly<Record<string, unknown>>[])
    : [];
  for (const ref of refs)
    if (!publicSourceTypes.has(String(ref.sourceType)))
      throw new Error("QUEUE_SOURCE_FAMILY_FORBIDDEN");
  if (subject?.kind === "CANDIDATE" || subject?.kind === "DRAFT") {
    if (
      operational?.state !== "NOT_APPLICABLE" ||
      capacity?.state !== "NOT_CONSUMING" ||
      sla?.state !== "NOT_APPLICABLE"
    ) {
      throw new Error("CANDIDATE_OPERATIONAL_EFFECT_FORBIDDEN");
    }
    return;
  }
  if (subject?.kind === "WORK_ITEM") {
    const types = new Set(refs.map(({ sourceType }) => sourceType));
    if (
      !types.has("WORK_ITEM_REVISION") ||
      (operational?.state === "KNOWN" && !types.has("JIRA_OPERATIONAL_PROJECTION_REVISION"))
    ) {
      throw new Error("WORK_ITEM_SOURCE_REF_REQUIRED");
    }
    return;
  }
  throw new Error("QUEUE_ENTRY_SUBJECT_INVALID");
}

export interface ExactQueueEntryRef {
  readonly schemaVersion: "queue-entry@1.0.0";
  readonly queueEntryId: string;
  readonly revision: number;
  readonly semanticHash: Sha256Digest;
}

export interface QueueStageTransitionInput {
  readonly transitionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly previousQueueEntryRef: ExactQueueEntryRef;
  readonly currentQueueEntryRef: ExactQueueEntryRef;
  readonly previousStage: QueueStage;
  readonly currentStage: QueueStage;
  readonly reasonCodes: readonly string[];
  readonly occurredAt: string;
}

export function createQueueStageTransition(input: QueueStageTransitionInput) {
  if (
    input.previousStage === input.currentStage ||
    input.previousQueueEntryRef.queueEntryId !== input.currentQueueEntryRef.queueEntryId ||
    input.currentQueueEntryRef.revision <= input.previousQueueEntryRef.revision
  )
    throw new Error("QUEUE_STAGE_TRANSITION_NO_OP");
  const reasonCodes = Object.freeze([...new Set(input.reasonCodes)].sort());
  if (reasonCodes.length === 0 || Number.isNaN(Date.parse(input.occurredAt)))
    throw new Error("QUEUE_STAGE_TRANSITION_INVALID");
  const value = Object.freeze({
    schemaVersion: "queue-stage-transition@1.0.0" as const,
    transitionId: input.transitionId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    previousQueueEntryRef: input.previousQueueEntryRef,
    currentQueueEntryRef: input.currentQueueEntryRef,
    previousStage: input.previousStage,
    currentStage: input.currentStage,
    reasonCodes,
    occurredAt: input.occurredAt,
  });
  return Object.freeze({ ...value, semanticHash: sha256(value as unknown as JsonValue) });
}

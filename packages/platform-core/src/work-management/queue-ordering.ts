import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { ExactQueueSourceRef, QueueAlgorithmRef } from "./queue-query-ports.ts";
import type { QueueStage } from "./queue-stage.ts";

export const queueStagePartition = Object.freeze({
  CANDIDATE: 0,
  BACKLOG: 1,
  READY: 2,
  ACTIVE: 3,
  COMPLETED: 4,
} as const);

export const queueOrderAlgorithmRef: QueueAlgorithmRef = Object.freeze({
  key: "queue-order",
  version: "1.0.0",
  semanticHash: sha256({
    kind: "LEXICOGRAPHIC_QUEUE_ORDER",
    stagePartition: Object.keys(queueStagePartition),
    candidateTuple: ["enteredInboxAt", "subjectKind", "subjectId"],
    workItemTuple: [
      "serviceClassBand",
      "slaState",
      "urgencyTiming",
      "jiraPriority",
      "acceptedRisk",
      "acceptedBusinessImpact",
      "dependencyReadiness",
      "readyAge.agingBandKey",
      "readyAt",
      "jiraDisplayKey",
      "workItemId",
    ],
  }),
});

export interface CandidateInboxOrderComponents {
  readonly enteredInboxAt: string;
  readonly subjectKind: "CANDIDATE" | "DRAFT";
  readonly subjectId: string;
}

export type QueueUrgencyTiming =
  | Readonly<{
      state: "KNOWN";
      basis: "SLA_LATEST_SAFE_START" | "SLA_TARGET_AT" | "CONFIRMED_JIRA_DUE_END";
      instant: string;
      sourceRef: ExactQueueSourceRef;
    }>
  | Readonly<{
      state: "UNKNOWN";
      reasonCode: "SOURCE_STALE" | "SOURCE_ERROR" | "MAPPING_UNKNOWN" | "CLOCK_REBUILDING";
    }>
  | Readonly<{ state: "NOT_STARTED" | "NOT_CONFIGURED" | "NOT_APPLICABLE" }>;

export interface WorkItemOrderComponents {
  readonly serviceClassBand: "EXPEDITE" | "FIXED_DATE" | "STANDARD";
  readonly slaState:
    | "BREACHED"
    | "AT_RISK"
    | "ON_TRACK"
    | "NOT_STARTED"
    | "NOT_CONFIGURED"
    | "COMPLETED"
    | "UNKNOWN";
  readonly urgencyTiming: QueueUrgencyTiming;
  readonly jiraPriority: Readonly<
    | { state: "UNKNOWN" }
    | { state: "KNOWN"; normalizedKey: string; mappingRef: ExactQueueSourceRef }
  >;
  readonly acceptedRisk: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
  readonly acceptedBusinessImpact: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
  readonly dependencyReadiness: "READY" | "BLOCKED" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly readyAge: Readonly<
    | { state: "UNKNOWN" | "NOT_APPLICABLE" }
    | { state: "KNOWN"; businessSeconds: number; agingBandKey: string }
  >;
  readonly readyAt: Readonly<
    { state: "UNKNOWN" | "NOT_APPLICABLE" } | { state: "KNOWN"; value: string }
  >;
  readonly jiraDisplayKey: Readonly<
    { state: "UNKNOWN" | "NOT_APPLICABLE" } | { state: "KNOWN"; value: string }
  >;
  readonly workItemId: string;
}

export type QueueOrderingFacet =
  | Readonly<{
      state: "CANDIDATE_INBOX";
      comparatorRef: QueueAlgorithmRef;
      components: CandidateInboxOrderComponents;
      baseRankKey: Sha256Digest;
    }>
  | Readonly<{
      state: "COMPUTED";
      comparatorRef: QueueAlgorithmRef;
      components: WorkItemOrderComponents;
      baseRankKey: Sha256Digest;
    }>;

export interface QueueOrderEntry {
  readonly queueEntryId: string;
  readonly stage: QueueStage;
  readonly subject: Readonly<{ kind: "CANDIDATE" | "DRAFT" | "WORK_ITEM"; id: string }>;
  readonly ordering: QueueOrderingFacet;
}

const cCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const numberCompare = (left: number, right: number): number =>
  left < right ? -1 : left > right ? 1 : 0;
const instant = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("QUEUE_ORDER_INSTANT_INVALID");
  return parsed;
};

export function createCandidateInboxOrdering(
  components: CandidateInboxOrderComponents,
): Extract<QueueOrderingFacet, { state: "CANDIDATE_INBOX" }> {
  instant(components.enteredInboxAt);
  if (!components.subjectId) throw new Error("QUEUE_CANDIDATE_ORDER_SUBJECT_INVALID");
  const frozen = Object.freeze({ ...components });
  return Object.freeze({
    state: "CANDIDATE_INBOX",
    comparatorRef: queueOrderAlgorithmRef,
    components: frozen,
    baseRankKey: sha256(frozen as unknown as JsonValue),
  });
}

export function createWorkItemOrdering(
  components: WorkItemOrderComponents,
): Extract<QueueOrderingFacet, { state: "COMPUTED" }> {
  if (!components.workItemId) throw new Error("QUEUE_WORK_ITEM_ORDER_SUBJECT_INVALID");
  if (components.readyAt.state === "KNOWN") instant(components.readyAt.value);
  if (components.urgencyTiming.state === "KNOWN") instant(components.urgencyTiming.instant);
  if (
    components.readyAge.state === "KNOWN" &&
    (!Number.isSafeInteger(components.readyAge.businessSeconds) ||
      components.readyAge.businessSeconds < 0 ||
      !components.readyAge.agingBandKey)
  ) {
    throw new Error("QUEUE_READY_AGE_INVALID");
  }
  const frozen = Object.freeze({ ...components });
  return Object.freeze({
    state: "COMPUTED",
    comparatorRef: queueOrderAlgorithmRef,
    components: frozen,
    baseRankKey: sha256(frozen as unknown as JsonValue),
  });
}

type UrgencyCandidate = Readonly<{ instant: string; sourceRef: ExactQueueSourceRef }>;

export function selectUrgencyTiming(
  input: Readonly<{
    latestSafeStart?: UrgencyCandidate;
    activeSlaTarget?: UrgencyCandidate;
    confirmedJiraDueEnd?: UrgencyCandidate;
    emptyState?: "NOT_STARTED" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  }>,
): QueueUrgencyTiming {
  const candidates = [
    input.latestSafeStart &&
      Object.freeze({
        ...input.latestSafeStart,
        basis: "SLA_LATEST_SAFE_START" as const,
        basisRank: 0,
      }),
    input.activeSlaTarget &&
      Object.freeze({ ...input.activeSlaTarget, basis: "SLA_TARGET_AT" as const, basisRank: 1 }),
    input.confirmedJiraDueEnd &&
      Object.freeze({
        ...input.confirmedJiraDueEnd,
        basis: "CONFIRMED_JIRA_DUE_END" as const,
        basisRank: 2,
      }),
  ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  if (candidates.length === 0) return Object.freeze({ state: input.emptyState ?? "NOT_STARTED" });
  candidates.sort(
    (left, right) =>
      numberCompare(instant(left.instant), instant(right.instant)) ||
      numberCompare(left.basisRank, right.basisRank),
  );
  const selected = candidates[0]!;
  return Object.freeze({
    state: "KNOWN",
    basis: selected.basis,
    instant: new Date(instant(selected.instant)).toISOString(),
    sourceRef: Object.freeze({ ...selected.sourceRef }),
  });
}

const serviceClassRank = Object.freeze({ EXPEDITE: 0, FIXED_DATE: 1, STANDARD: 2 } as const);
const slaStateRank = Object.freeze({
  BREACHED: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
  NOT_STARTED: 3,
  NOT_CONFIGURED: 4,
  COMPLETED: 5,
  UNKNOWN: 6,
} as const);
const levelRank = Object.freeze({ VERY_HIGH: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 } as const);
const dependencyRank = Object.freeze({
  READY: 0,
  BLOCKED: 1,
  NOT_APPLICABLE: 2,
  UNKNOWN: 3,
} as const);
const optionalStateRank = Object.freeze({ KNOWN: 0, NOT_APPLICABLE: 1, UNKNOWN: 2 } as const);
const urgencyStateRank = Object.freeze({
  KNOWN: 0,
  NOT_STARTED: 1,
  NOT_CONFIGURED: 2,
  NOT_APPLICABLE: 3,
  UNKNOWN: 4,
} as const);

function compareCandidate(
  left: CandidateInboxOrderComponents,
  right: CandidateInboxOrderComponents,
): number {
  return (
    numberCompare(instant(left.enteredInboxAt), instant(right.enteredInboxAt)) ||
    numberCompare(
      left.subjectKind === "CANDIDATE" ? 0 : 1,
      right.subjectKind === "CANDIDATE" ? 0 : 1,
    ) ||
    cCompare(left.subjectId, right.subjectId)
  );
}

function compareUrgency(left: QueueUrgencyTiming, right: QueueUrgencyTiming): number {
  const state = numberCompare(urgencyStateRank[left.state], urgencyStateRank[right.state]);
  if (state !== 0 || left.state !== "KNOWN" || right.state !== "KNOWN") return state;
  const basisRank = {
    SLA_LATEST_SAFE_START: 0,
    SLA_TARGET_AT: 1,
    CONFIRMED_JIRA_DUE_END: 2,
  } as const;
  return (
    numberCompare(instant(left.instant), instant(right.instant)) ||
    numberCompare(basisRank[left.basis], basisRank[right.basis])
  );
}

function compareKnownPriority(
  left: WorkItemOrderComponents["jiraPriority"],
  right: WorkItemOrderComponents["jiraPriority"],
): number {
  const state = numberCompare(left.state === "KNOWN" ? 0 : 1, right.state === "KNOWN" ? 0 : 1);
  if (state !== 0 || left.state !== "KNOWN" || right.state !== "KNOWN") return state;
  return cCompare(left.normalizedKey, right.normalizedKey);
}

function compareKnownDisplayKey(
  left: WorkItemOrderComponents["jiraDisplayKey"],
  right: WorkItemOrderComponents["jiraDisplayKey"],
): number {
  const state = numberCompare(left.state === "KNOWN" ? 0 : 1, right.state === "KNOWN" ? 0 : 1);
  if (state !== 0 || left.state !== "KNOWN" || right.state !== "KNOWN") return state;
  return cCompare(left.value, right.value);
}

function compareWorkItem(left: WorkItemOrderComponents, right: WorkItemOrderComponents): number {
  const readyAgeState = numberCompare(
    optionalStateRank[left.readyAge.state],
    optionalStateRank[right.readyAge.state],
  );
  const readyAge =
    readyAgeState ||
    (left.readyAge.state === "KNOWN" && right.readyAge.state === "KNOWN"
      ? cCompare(left.readyAge.agingBandKey, right.readyAge.agingBandKey)
      : 0);
  const readyAtState = numberCompare(
    optionalStateRank[left.readyAt.state],
    optionalStateRank[right.readyAt.state],
  );
  const readyAt =
    readyAtState ||
    (left.readyAt.state === "KNOWN" && right.readyAt.state === "KNOWN"
      ? numberCompare(instant(left.readyAt.value), instant(right.readyAt.value))
      : 0);
  return (
    numberCompare(
      serviceClassRank[left.serviceClassBand],
      serviceClassRank[right.serviceClassBand],
    ) ||
    numberCompare(slaStateRank[left.slaState], slaStateRank[right.slaState]) ||
    compareUrgency(left.urgencyTiming, right.urgencyTiming) ||
    compareKnownPriority(left.jiraPriority, right.jiraPriority) ||
    numberCompare(levelRank[left.acceptedRisk], levelRank[right.acceptedRisk]) ||
    numberCompare(
      levelRank[left.acceptedBusinessImpact],
      levelRank[right.acceptedBusinessImpact],
    ) ||
    numberCompare(
      dependencyRank[left.dependencyReadiness],
      dependencyRank[right.dependencyReadiness],
    ) ||
    readyAge ||
    readyAt ||
    compareKnownDisplayKey(left.jiraDisplayKey, right.jiraDisplayKey) ||
    cCompare(left.workItemId, right.workItemId)
  );
}

export function compareQueueOrderEntries(left: QueueOrderEntry, right: QueueOrderEntry): number {
  const stage = numberCompare(queueStagePartition[left.stage], queueStagePartition[right.stage]);
  if (stage !== 0) return stage;
  if (left.ordering.state === "CANDIDATE_INBOX" || right.ordering.state === "CANDIDATE_INBOX") {
    if (left.ordering.state !== "CANDIDATE_INBOX" || right.ordering.state !== "CANDIDATE_INBOX")
      throw new Error("QUEUE_ORDER_STAGE_BRANCH_MISMATCH");
    return (
      compareCandidate(left.ordering.components, right.ordering.components) ||
      cCompare(left.queueEntryId, right.queueEntryId)
    );
  }
  return (
    compareWorkItem(left.ordering.components, right.ordering.components) ||
    cCompare(left.queueEntryId, right.queueEntryId)
  );
}

export function sortQueueOrderEntries<T extends QueueOrderEntry>(
  entries: readonly T[],
): readonly T[] {
  return Object.freeze([...entries].sort(compareQueueOrderEntries));
}

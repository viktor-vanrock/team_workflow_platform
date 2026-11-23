import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import {
  type BusinessCalendarRevision,
  type BusinessDay,
  type BusinessInterval,
  validateBusinessCalendar,
} from "./queue-policy.ts";
import type {
  ExactQueueSourceRef,
  QueueAlgorithmRef,
  QueueVersionedContentRef,
} from "./queue-query-ports.ts";

export type SlaGoal = "READY_TO_FIRST_QA_START" | "READY_TO_SIGNED_VERDICT";
export type ConfirmedJiraProjectionRef = ExactQueueSourceRef &
  Readonly<{
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION";
    sourceVersion: number;
    confirmedAt: string;
  }>;
export type JiraStatusMappingRef = ExactQueueSourceRef &
  Readonly<{
    sourceType: "JIRA_STATUS_MAPPING_REVISION";
    sourceVersion: number;
  }>;
export type SlaRolloutVerificationRef = Readonly<{
  sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION";
  sourceId: string;
  sourceVersion: 1;
  semanticHash: Sha256Digest;
  confirmedAt: string;
}>;
export type SlaStartSourceRef = ConfirmedJiraProjectionRef | SlaRolloutVerificationRef;

export type ConfirmedJiraSlaStart =
  | Readonly<{
      state: "NOT_STARTED";
      reason: "OPERATIONAL_CONFIRMATION_REQUIRED" | "STATUS_NOT_CONFIGURED";
    }>
  | Readonly<{ state: "START"; effectiveAt: string; startSourceRef: ConfirmedJiraProjectionRef }>;

export function detectConfirmedJiraSlaStart(
  input: Readonly<{
    operationalState: "PENDING" | "ERROR" | "CONFIRMED";
    normalizedStatus?: string;
    currentReadiness: string;
    operationalRef?: ConfirmedJiraProjectionRef;
  }>,
): ConfirmedJiraSlaStart {
  if (input.operationalState !== "CONFIRMED" || !input.operationalRef) {
    return Object.freeze({ state: "NOT_STARTED", reason: "OPERATIONAL_CONFIRMATION_REQUIRED" });
  }
  if (!new Set(["READY", "PLANNED"]).has(input.normalizedStatus ?? "")) {
    return Object.freeze({ state: "NOT_STARTED", reason: "STATUS_NOT_CONFIGURED" });
  }
  if (!Number.isFinite(Date.parse(input.operationalRef.confirmedAt)))
    throw new Error("SLA_START_CONFIRMATION_TIME_INVALID");
  return Object.freeze({
    state: "START",
    effectiveAt: input.operationalRef.confirmedAt,
    startSourceRef: Object.freeze({ ...input.operationalRef }),
  });
}

export interface InitialSlaClockInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly slaClockId: string;
  readonly goal: SlaGoal;
  readonly policyFacetRef: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly mappingRef: JiraStatusMappingRef;
  readonly algorithmRef: QueueAlgorithmRef;
  readonly startSourceRef: SlaStartSourceRef;
}

export interface SlaClockStartTransition {
  readonly schemaVersion: "sla-clock-transition@1.0.0";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly goal: SlaGoal;
  readonly slaClockId: string;
  readonly clockCycle: 1;
  readonly clockRevisionRef: QueueVersionedContentRef;
  readonly transition: "START";
  readonly previousClockState: "NOT_STARTED";
  readonly currentClockState: "RUNNING";
  readonly effectiveAt: string;
  readonly elapsedBusinessSecondsAtTransition: 0;
  readonly policyFacetRef: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly mappingRef: JiraStatusMappingRef;
  readonly algorithmRef: QueueAlgorithmRef;
  readonly startSourceRef: SlaStartSourceRef;
  readonly startedAt: string;
  readonly transitionSourceRef: SlaStartSourceRef;
  readonly inputFingerprint: Sha256Digest;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;

function assertStartSourceRef(value: SlaStartSourceRef): void {
  if (
    !new Set(["JIRA_OPERATIONAL_PROJECTION_REVISION", "SLA_ROLLOUT_AUTHORITY_VERIFICATION"]).has(
      value.sourceType,
    ) ||
    !Number.isSafeInteger(value.sourceVersion) ||
    value.sourceVersion < 1 ||
    (value.sourceType === "SLA_ROLLOUT_AUTHORITY_VERIFICATION" && value.sourceVersion !== 1) ||
    !hashPattern.test(value.semanticHash) ||
    !Number.isFinite(Date.parse(value.confirmedAt))
  ) {
    throw new Error("SLA_CLOCK_START_SOURCE_INVALID");
  }
}

export function createInitialSlaClock(input: InitialSlaClockInput): SlaClockStartTransition {
  const refs = [
    input.policyFacetRef,
    input.calendarRef,
    input.mappingRef,
    input.algorithmRef,
    input.startSourceRef,
  ];
  if (
    !new Set<SlaGoal>(["READY_TO_FIRST_QA_START", "READY_TO_SIGNED_VERDICT"]).has(input.goal) ||
    refs.some((ref) => !hashPattern.test(ref.semanticHash)) ||
    input.mappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION"
  ) {
    throw new Error("SLA_CLOCK_START_REF_INVALID");
  }
  assertStartSourceRef(input.startSourceRef);
  const inputFingerprint = sha256({
    goal: input.goal,
    policyFacetRef: input.policyFacetRef,
    calendarRef: input.calendarRef,
    mappingRef: input.mappingRef,
    algorithmRef: input.algorithmRef,
    startSourceRef: input.startSourceRef,
  } as unknown as JsonValue);
  const body = Object.freeze({
    schemaVersion: "sla-clock-transition@1.0.0" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    goal: input.goal,
    slaClockId: input.slaClockId,
    clockCycle: 1 as const,
    transition: "START" as const,
    previousClockState: "NOT_STARTED" as const,
    currentClockState: "RUNNING" as const,
    effectiveAt: input.startSourceRef.confirmedAt,
    elapsedBusinessSecondsAtTransition: 0 as const,
    policyFacetRef: Object.freeze({ ...input.policyFacetRef }),
    calendarRef: Object.freeze({ ...input.calendarRef }),
    mappingRef: Object.freeze({ ...input.mappingRef }),
    algorithmRef: Object.freeze({ ...input.algorithmRef }),
    startSourceRef: Object.freeze({ ...input.startSourceRef }),
    startedAt: input.startSourceRef.confirmedAt,
    transitionSourceRef: Object.freeze({ ...input.startSourceRef }),
    inputFingerprint,
  });
  const semanticHash = sha256(body as unknown as JsonValue);
  return Object.freeze({
    ...body,
    clockRevisionRef: Object.freeze({ id: input.slaClockId, version: 1, semanticHash }),
  });
}

type BoundaryKind = "START" | "END";
type LocalParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const dayNames: readonly BusinessDay[] = Object.freeze([
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]);

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

function localParts(timeZone: string, instantMs: number): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instantMs))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return Object.freeze({
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  });
}

function localDate(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dateParts(value: string): Pick<LocalParts, "year" | "month" | "day"> {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return Object.freeze({ year, month, day });
}

function timeParts(value: string): Pick<LocalParts, "hour" | "minute" | "second"> {
  const [hour, minute, second] = value.split(":").map(Number) as [number, number, number];
  return Object.freeze({ hour, minute, second });
}

function addLocalDays(value: string, days: number): string {
  const parts = dateParts(value);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return localDate({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

function matchingInstants(timeZone: string, target: LocalParts): readonly number[] {
  const naive = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const matches: number[] = [];
  // Every current IANA civil offset is a multiple of 15 minutes and falls in
  // this closed range. Verification against Intl keeps the search authoritative.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = naive - offsetMinutes * 60_000;
    const actual = localParts(timeZone, candidate);
    if (
      actual.year === target.year &&
      actual.month === target.month &&
      actual.day === target.day &&
      actual.hour === target.hour &&
      actual.minute === target.minute &&
      actual.second === target.second
    )
      matches.push(candidate);
  }
  return Object.freeze([...new Set(matches)].sort((left, right) => left - right));
}

function boundaryInstant(
  calendar: BusinessCalendarRevision,
  date: string,
  time: string,
  kind: BoundaryKind,
): number {
  let day = date;
  let parsed = timeParts(time);
  if (parsed.hour === 24) {
    day = addLocalDays(day, 1);
    parsed = Object.freeze({ hour: 0, minute: 0, second: 0 });
  }
  const dateValue = dateParts(day);
  const target: LocalParts = Object.freeze({ ...dateValue, ...parsed });
  const matches = matchingInstants(calendar.timeZone, target);
  if (matches.length > 0) return kind === "START" ? matches[0]! : matches.at(-1)!;
  // A nonexistent wall time shifts to the first representable civil instant
  // after the gap. Modern tzdb gaps are minute-aligned; second precision is
  // preserved for ordinary boundaries and the gap edge itself is exact.
  const naive = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  let probe = Math.floor(naive / 60_000) * 60_000 + 60_000;
  const limit = naive + 6 * 60 * 60_000;
  while (probe <= limit) {
    const value = new Date(probe);
    const shifted: LocalParts = Object.freeze({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
    });
    const shiftedMatches = matchingInstants(calendar.timeZone, shifted);
    if (shiftedMatches.length > 0)
      return kind === "START" ? shiftedMatches[0]! : shiftedMatches.at(-1)!;
    probe += 60_000;
  }
  throw new Error("BUSINESS_CALENDAR_NONEXISTENT_BOUNDARY_UNRESOLVED");
}

function intervalsForDate(
  calendar: BusinessCalendarRevision,
  date: string,
): readonly BusinessInterval[] {
  if (date < calendar.validFrom || (calendar.validThrough !== null && date > calendar.validThrough))
    return Object.freeze([]);
  const override = calendar.dateOverrides.find((candidate) => candidate.date === date);
  if (override?.kind === "CLOSED") return Object.freeze([]);
  if (override?.kind === "WORKING") return override.workingIntervals;
  const parts = dateParts(date);
  const day = dayNames[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()]!;
  return Object.freeze(
    calendar.weeklyIntervals
      .filter(({ dayOfWeek }) => dayOfWeek === day)
      .map(({ startLocalTime, endLocalTime }) => Object.freeze({ startLocalTime, endLocalTime })),
  );
}

function localDateAt(calendar: BusinessCalendarRevision, instantMs: number): string {
  return localDate(localParts(calendar.timeZone, instantMs));
}

/** Exact half-open business-time intersection using the calendar's pinned IANA/DST rules. */
export function businessMillisecondsBetween(
  calendar: BusinessCalendarRevision,
  from: string,
  to: string,
): number {
  validateBusinessCalendar(calendar);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs)
    throw new Error("BUSINESS_CALENDAR_RANGE_INVALID");
  if (toMs === fromMs) return 0;
  let date = addLocalDays(localDateAt(calendar, fromMs), -1);
  const finalDate = addLocalDays(localDateAt(calendar, toMs), 1);
  let total = 0;
  while (date <= finalDate) {
    for (const interval of intervalsForDate(calendar, date)) {
      const start = boundaryInstant(calendar, date, interval.startLocalTime, "START");
      const end = boundaryInstant(calendar, date, interval.endLocalTime, "END");
      total += Math.max(0, Math.min(toMs, end) - Math.max(fromMs, start));
    }
    date = addLocalDays(date, 1);
  }
  return total;
}

export function businessSecondsBetween(
  calendar: BusinessCalendarRevision,
  from: string,
  to: string,
): number {
  return Math.floor(businessMillisecondsBetween(calendar, from, to) / 1_000);
}

/** Adds non-negative business seconds and fails explicitly beyond finite coverage. */
export function addBusinessSeconds(
  calendar: BusinessCalendarRevision,
  from: string,
  businessSeconds: number,
): string {
  validateBusinessCalendar(calendar);
  const fromMs = Date.parse(from);
  if (!Number.isFinite(fromMs) || !Number.isSafeInteger(businessSeconds) || businessSeconds < 0)
    throw new Error("BUSINESS_CALENDAR_ADD_INPUT_INVALID");
  if (businessSeconds === 0) return new Date(fromMs).toISOString();
  let remaining = businessSeconds * 1_000;
  let cursor = fromMs;
  let date = localDateAt(calendar, fromMs);
  if (date < calendar.validFrom) date = calendar.validFrom;
  for (let scanned = 0; scanned < 366_000; scanned += 1) {
    if (calendar.validThrough !== null && date > calendar.validThrough)
      throw new Error("BUSINESS_CALENDAR_COVERAGE_EXHAUSTED");
    for (const interval of intervalsForDate(calendar, date)) {
      const start = Math.max(
        cursor,
        boundaryInstant(calendar, date, interval.startLocalTime, "START"),
      );
      const end = boundaryInstant(calendar, date, interval.endLocalTime, "END");
      if (end <= start) continue;
      const available = end - start;
      if (remaining <= available) return new Date(start + remaining).toISOString();
      remaining -= available;
      cursor = end;
    }
    date = addLocalDays(date, 1);
  }
  throw new Error("BUSINESS_CALENDAR_OPEN_ENDED_SEARCH_LIMIT");
}

export type SlaSessionStopSourceRef = ExactQueueSourceRef &
  Readonly<{ sourceType: "QA_TEST_SESSION_REVISION" }>;
export type SlaVerdictStopSourceRef = ExactQueueSourceRef &
  Readonly<{ sourceType: "QA_VERDICT_REVISION" }>;

export interface SlaClockFollowupTransition {
  readonly schemaVersion: "sla-clock-transition@1.0.0";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly goal: SlaGoal;
  readonly slaClockId: string;
  readonly clockCycle: number;
  readonly clockRevisionRef: QueueVersionedContentRef;
  readonly previousClockRevisionRef: QueueVersionedContentRef;
  readonly transition: "START" | "PAUSE" | "RESUME" | "STOP";
  readonly previousClockState: "STOPPED" | "RUNNING" | "PAUSED";
  readonly currentClockState: "RUNNING" | "PAUSED" | "STOPPED";
  readonly effectiveAt: string;
  readonly elapsedBusinessSecondsAtTransition: number;
  readonly policyFacetRef: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly mappingRef: JiraStatusMappingRef;
  readonly algorithmRef: QueueAlgorithmRef;
  readonly startSourceRef: SlaStartSourceRef;
  readonly startedAt: string;
  readonly transitionSourceRef:
    | ConfirmedJiraProjectionRef
    | SlaStartSourceRef
    | SlaSessionStopSourceRef
    | SlaVerdictStopSourceRef;
  readonly mappedPauseReasonCode?: string;
  readonly inputFingerprint: Sha256Digest;
}

export type SlaClockTransition = SlaClockStartTransition | SlaClockFollowupTransition;
export type SlaClockCommand =
  | Readonly<{
      kind: "PAUSE";
      sourceRef: ConfirmedJiraProjectionRef;
      mappedPauseReasonCode?: string;
    }>
  | Readonly<{ kind: "RESUME"; sourceRef: ConfirmedJiraProjectionRef }>
  | Readonly<{
      kind: "STOP";
      sourceRef: SlaSessionStopSourceRef | SlaVerdictStopSourceRef;
      effectiveAt: string;
    }>
  | Readonly<{ kind: "REOPEN"; sourceRef: SlaStartSourceRef }>;

function transitionHash<T extends Omit<SlaClockFollowupTransition, "clockRevisionRef">>(
  value: T,
  version: number,
): SlaClockFollowupTransition {
  const semanticHash = sha256(value as unknown as JsonValue);
  return Object.freeze({
    ...value,
    clockRevisionRef: Object.freeze({ id: value.slaClockId, version, semanticHash }),
  }) as SlaClockFollowupTransition;
}

/** Applies only authoritative mapped boundaries; unknown pause reasons are explicit no-ops. */
export function advanceSlaClock(
  input: Readonly<{
    current: SlaClockTransition;
    calendar: BusinessCalendarRevision;
    command: SlaClockCommand;
  }>,
):
  | Readonly<{ outcome: "APPENDED"; transition: SlaClockFollowupTransition }>
  | Readonly<{ outcome: "NO_CHANGE"; reason: "UNKNOWN_PAUSE_REASON" }> {
  const { current, calendar, command } = input;
  validateBusinessCalendar(calendar);
  if (
    current.calendarRef.id !== calendar.calendarId ||
    current.calendarRef.version !== calendar.revision ||
    current.calendarRef.semanticHash !== calendar.semanticHash
  ) {
    throw new Error("SLA_CLOCK_CALENDAR_PIN_MISMATCH");
  }
  if (command.kind === "PAUSE" && !command.mappedPauseReasonCode)
    return Object.freeze({ outcome: "NO_CHANGE", reason: "UNKNOWN_PAUSE_REASON" });
  if (command.kind === "REOPEN") assertStartSourceRef(command.sourceRef);
  if (command.kind === "PAUSE" && !/^[A-Z][A-Z0-9_]{0,63}$/u.test(command.mappedPauseReasonCode!))
    throw new Error("SLA_CLOCK_PAUSE_REASON_INVALID");
  if (
    (command.kind === "PAUSE" || command.kind === "RESUME") &&
    (command.sourceRef.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION" ||
      !hashPattern.test(command.sourceRef.semanticHash) ||
      !Number.isSafeInteger(command.sourceRef.sourceVersion) ||
      command.sourceRef.sourceVersion < 1)
  ) {
    throw new Error("SLA_CLOCK_JIRA_SOURCE_INVALID");
  }
  if (
    command.kind === "STOP" &&
    (!hashPattern.test(command.sourceRef.semanticHash) ||
      typeof command.sourceRef.sourceVersion !== "number" ||
      !Number.isSafeInteger(command.sourceRef.sourceVersion) ||
      command.sourceRef.sourceVersion < 1)
  ) {
    throw new Error("SLA_CLOCK_STOP_SOURCE_INVALID");
  }
  const effectiveAt = command.kind === "STOP" ? command.effectiveAt : command.sourceRef.confirmedAt;
  if (
    !Number.isFinite(Date.parse(effectiveAt)) ||
    Date.parse(effectiveAt) < Date.parse(current.effectiveAt)
  )
    throw new Error("SLA_CLOCK_SOURCE_TIME_NON_MONOTONIC");
  if (
    (command.kind === "PAUSE" || command.kind === "RESUME") &&
    current.transitionSourceRef.sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION" &&
    command.sourceRef.sourceVersion <= current.transitionSourceRef.sourceVersion
  )
    throw new Error("SLA_CLOCK_JIRA_SOURCE_NON_MONOTONIC");
  if (command.kind === "PAUSE" && current.currentClockState !== "RUNNING")
    throw new Error("SLA_CLOCK_PAUSE_STATE_INVALID");
  if (command.kind === "RESUME" && current.currentClockState !== "PAUSED")
    throw new Error("SLA_CLOCK_RESUME_STATE_INVALID");
  if (command.kind === "STOP" && current.currentClockState === "STOPPED")
    throw new Error("SLA_CLOCK_STOP_STATE_INVALID");
  if (command.kind === "REOPEN" && current.currentClockState !== "STOPPED")
    throw new Error("SLA_CLOCK_REOPEN_STATE_INVALID");
  if (command.kind === "STOP") {
    if (
      current.goal === "READY_TO_FIRST_QA_START" &&
      command.sourceRef.sourceType !== "QA_TEST_SESSION_REVISION"
    )
      throw new Error("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
    if (
      current.goal === "READY_TO_SIGNED_VERDICT" &&
      command.sourceRef.sourceType !== "QA_VERDICT_REVISION"
    )
      throw new Error("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
  }
  const version = current.clockRevisionRef.version + 1;
  const reopen = command.kind === "REOPEN";
  const elapsed = reopen
    ? 0
    : current.elapsedBusinessSecondsAtTransition +
      (current.currentClockState === "RUNNING"
        ? businessSecondsBetween(calendar, current.effectiveAt, effectiveAt)
        : 0);
  const transitionSourceRef = command.sourceRef;
  const body = Object.freeze({
    schemaVersion: "sla-clock-transition@1.0.0" as const,
    workspaceId: current.workspaceId,
    projectId: current.projectId,
    workItemId: current.workItemId,
    goal: current.goal,
    slaClockId: current.slaClockId,
    clockCycle: current.clockCycle + (reopen ? 1 : 0),
    previousClockRevisionRef: current.clockRevisionRef,
    transition: (reopen ? "START" : command.kind) as SlaClockFollowupTransition["transition"],
    previousClockState: current.currentClockState,
    currentClockState:
      reopen || command.kind === "RESUME"
        ? ("RUNNING" as const)
        : command.kind === "PAUSE"
          ? ("PAUSED" as const)
          : ("STOPPED" as const),
    effectiveAt,
    elapsedBusinessSecondsAtTransition: elapsed,
    policyFacetRef: current.policyFacetRef,
    calendarRef: current.calendarRef,
    mappingRef: current.mappingRef,
    algorithmRef: current.algorithmRef,
    startSourceRef: reopen ? command.sourceRef : current.startSourceRef,
    startedAt: reopen ? effectiveAt : current.startedAt,
    transitionSourceRef,
    ...(command.kind === "PAUSE" ? { mappedPauseReasonCode: command.mappedPauseReasonCode! } : {}),
    inputFingerprint: sha256({
      previousClockRevisionRef: current.clockRevisionRef,
      transition: reopen ? "START" : command.kind,
      transitionSourceRef,
      ...(command.kind === "PAUSE" ? { mappedPauseReasonCode: command.mappedPauseReasonCode } : {}),
    } as unknown as JsonValue),
  });
  return Object.freeze({ outcome: "APPENDED", transition: transitionHash(body, version) });
}

export interface SlaClockSegmentRevision {
  readonly segmentRef: Readonly<{
    sourceType: "SLA_CLOCK_SEGMENT_REVISION";
    sourceId: string;
    sourceVersion: number;
    semanticHash: Sha256Digest;
  }>;
  readonly slaClockId: string;
  readonly clockCycle: number;
  readonly ordinal: number;
  readonly state: "RUNNING" | "PAUSED";
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly businessSeconds: number;
  readonly startClockRevisionRef: QueueVersionedContentRef;
  readonly endClockRevisionRef?: QueueVersionedContentRef;
}

function segment(
  value: Omit<SlaClockSegmentRevision, "segmentRef">,
  segmentId: string,
  sourceVersion = 1,
): SlaClockSegmentRevision {
  const semanticHash = sha256(value as unknown as JsonValue);
  return Object.freeze({
    ...value,
    segmentRef: Object.freeze({
      sourceType: "SLA_CLOCK_SEGMENT_REVISION",
      sourceId: segmentId,
      sourceVersion,
      semanticHash,
    }),
  });
}

/** Closes the prior half-open segment and opens the next state segment, if any. */
export function applySlaClockTransitionToSegments(
  input: Readonly<{
    transition: SlaClockTransition;
    calendar: BusinessCalendarRevision;
    openSegment?: SlaClockSegmentRevision;
    nextSegmentId?: string;
    previousOrdinal?: number;
  }>,
): Readonly<{ closed?: SlaClockSegmentRevision; opened?: SlaClockSegmentRevision }> {
  const { transition, calendar, openSegment } = input;
  const opens = transition.currentClockState !== "STOPPED";
  if (transition.transition === "START") {
    if (openSegment || !input.nextSegmentId) throw new Error("SLA_SEGMENT_START_STATE_INVALID");
    return Object.freeze({
      opened: segment(
        {
          slaClockId: transition.slaClockId,
          clockCycle: transition.clockCycle,
          ordinal: (input.previousOrdinal ?? 0) + 1,
          state: "RUNNING",
          startedAt: transition.effectiveAt,
          businessSeconds: 0,
          startClockRevisionRef: transition.clockRevisionRef,
        },
        input.nextSegmentId,
      ),
    });
  }
  if (
    !openSegment ||
    openSegment.endedAt ||
    openSegment.slaClockId !== transition.slaClockId ||
    openSegment.clockCycle !== transition.clockCycle ||
    openSegment.state !== transition.previousClockState
  )
    throw new Error("SLA_SEGMENT_OPEN_STATE_INVALID");
  const { segmentRef: _openRef, ...openBody } = openSegment;
  void _openRef;
  const closed = segment(
    {
      ...openBody,
      endedAt: transition.effectiveAt,
      businessSeconds:
        openSegment.state === "RUNNING"
          ? businessSecondsBetween(calendar, openSegment.startedAt, transition.effectiveAt)
          : 0,
      endClockRevisionRef: transition.clockRevisionRef,
    },
    openSegment.segmentRef.sourceId,
    openSegment.segmentRef.sourceVersion + 1,
  );
  if (!opens) return Object.freeze({ closed });
  if (!input.nextSegmentId) throw new Error("SLA_SEGMENT_NEXT_ID_REQUIRED");
  const opened = segment(
    {
      slaClockId: transition.slaClockId,
      clockCycle: transition.clockCycle,
      ordinal: openSegment.ordinal + 1,
      state: transition.currentClockState as "RUNNING" | "PAUSED",
      startedAt: transition.effectiveAt,
      businessSeconds: 0,
      startClockRevisionRef: transition.clockRevisionRef,
    },
    input.nextSegmentId,
  );
  return Object.freeze({ closed, opened });
}

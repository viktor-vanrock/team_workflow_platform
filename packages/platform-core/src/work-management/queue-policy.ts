import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { Sha256Digest } from "../shared/primitives.ts";
import {
  authorizedProjectSetHash,
  type ExactQueueSourceRef,
  type QueueAlgorithmRef,
  type QueueVersionedContentRef,
} from "./queue-query-ports.ts";

export type BusinessDay =
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

export interface BusinessInterval {
  readonly startLocalTime: string;
  readonly endLocalTime: string;
}

export interface WeeklyBusinessInterval extends BusinessInterval {
  readonly dayOfWeek: BusinessDay;
}

export type BusinessDateOverride =
  | Readonly<{
      kind: "CLOSED";
      date: string;
      reasonCode:
        "PUBLIC_HOLIDAY" | "WORKSPACE_CLOSURE" | "SOURCE_CLOSURE" | "OTHER_CONFIGURED_CLOSURE";
    }>
  | Readonly<{
      kind: "WORKING";
      date: string;
      reasonCode: "WORKING_DAY_OVERRIDE" | "SOURCE_WORKING_OVERRIDE" | "OTHER_CONFIGURED_WORKING";
      workingIntervals: readonly BusinessInterval[];
    }>;

export interface BusinessCalendarRevision {
  readonly schemaVersion: "business-calendar@1.0.0";
  readonly calendarId: string;
  readonly calendarKey: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly previousCalendarRef?: QueueVersionedContentRef;
  readonly timeZone: string;
  readonly validFrom: string;
  readonly validThrough: string | null;
  readonly weeklyIntervals: readonly WeeklyBusinessInterval[];
  readonly dateOverrides: readonly BusinessDateOverride[];
  readonly dstAlgorithmRef: QueueAlgorithmRef &
    Readonly<{ key: "business-calendar-dst"; version: "1.0.0" }>;
  readonly dstRules: Readonly<{
    nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP";
    ambiguousStart: "EARLIEST_MATCHING_INSTANT";
    ambiguousEnd: "LATEST_MATCHING_INSTANT";
  }>;
  readonly sourceKind: "MANUAL" | "IMPORTED";
  readonly sourceRef: string;
  readonly sourceHash: Sha256Digest;
  readonly ownerPrincipalId: string;
  readonly effectiveFrom: string;
  readonly publishedAt: string;
  readonly publishedByPrincipalId: string;
  readonly semanticHash: Sha256Digest;
}

export type QueuePolicyMode = "MEASURE_ONLY" | "ENFORCED";
export type QueueSlaGoalKey = "READY_TO_FIRST_QA_START" | "READY_TO_SIGNED_VERDICT";

export interface QueuePolicyWarningThreshold {
  readonly key: string;
  readonly elapsedBusinessSeconds: number;
}

export interface QueuePolicySlaGoal {
  readonly goal: QueueSlaGoalKey;
  readonly startNormalizedStatuses: readonly ("READY" | "PLANNED")[];
  readonly stopEvent: "FIRST_CONSUMING_SESSION_STARTED" | "QA_VERDICT_SIGNED";
  readonly targetBusinessSeconds: number | null;
  readonly warningThresholds: readonly QueuePolicyWarningThreshold[];
}

export interface QueuePolicyProjectEntry {
  readonly projectId: string;
  readonly softWipLimit: number | null;
  readonly reservedCapacity: number | null;
  readonly explanation: string;
}

export interface QueuePolicyBlockReasonRule {
  readonly normalizedStatus: "BLOCKED";
  readonly reasonCode: string;
  readonly wipEffect: "HOLD_WIP" | "RELEASE_WIP";
  readonly slaEffect: "CONTINUE" | "PAUSE" | "RESUME";
}

export interface QueuePolicyAgingBand {
  readonly key: string;
  readonly upperBoundBusinessSeconds: number;
}

interface QueuePolicyRevisionBase {
  readonly schemaVersion: "queue-policy@1.0.0";
  readonly queuePolicyId: string;
  readonly policyKey: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly previousPolicyRef?: QueueVersionedContentRef;
  readonly calendarRef: QueueVersionedContentRef;
  readonly comparatorRef: QueueAlgorithmRef & Readonly<{ key: "queue-order"; version: "1.0.0" }>;
  readonly stageRuleRef: QueueAlgorithmRef & Readonly<{ key: "queue-stage"; version: "1.0.0" }>;
  readonly statusMappingRef: ExactQueueSourceRef &
    Readonly<{ sourceType: "JIRA_STATUS_MAPPING_REVISION" }>;
  readonly serviceClassRules: Readonly<{
    initialClass: "STANDARD";
    fixedDateRequiresConfirmedDueDate: true;
    expediteRequiresExactAction: true;
    overrideSeparationOfDuty: "SELF_APPROVAL_FORBIDDEN";
  }>;
  readonly externalActiveConsumesWip: readonly ("IN_PROGRESS" | "REVIEW" | "BLOCKED")[];
  readonly blockReasonRules: readonly QueuePolicyBlockReasonRule[];
  readonly agingBands: readonly QueuePolicyAgingBand[];
  readonly effectiveFrom: string;
  readonly publishedAt: string;
  readonly publishedByPrincipalId: string;
  readonly semanticHash: Sha256Digest;
}

export interface MeasureOnlyQueuePolicyRevision extends QueuePolicyRevisionBase {
  readonly mode: "MEASURE_ONLY";
  readonly workspaceHumanWipLimit: null;
  readonly activeExpediteLimit: null;
  readonly slaGoals: readonly (QueuePolicySlaGoal &
    Readonly<{ targetBusinessSeconds: null; warningThresholds: readonly [] }>)[];
  readonly projectEntries: readonly (QueuePolicyProjectEntry &
    Readonly<{ softWipLimit: null; reservedCapacity: null }>)[];
  readonly baselineEvidenceRef?: never;
}

export interface EnforcedQueuePolicyRevision extends QueuePolicyRevisionBase {
  readonly mode: "ENFORCED";
  readonly workspaceHumanWipLimit: number;
  readonly activeExpediteLimit: number;
  readonly slaGoals: readonly (QueuePolicySlaGoal & Readonly<{ targetBusinessSeconds: number }>)[];
  readonly projectEntries: readonly (QueuePolicyProjectEntry &
    Readonly<{ softWipLimit: number; reservedCapacity: number }>)[];
  readonly baselineEvidenceRef: ExactQueueSourceRef;
}

export type QueuePolicyRevision = MeasureOnlyQueuePolicyRevision | EnforcedQueuePolicyRevision;

const dayOrder: Readonly<Record<BusinessDay, number>> = Object.freeze({
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
});
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u;
const endLocalTimePattern = /^(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d|24:00:00)$/u;

function isLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day));
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function semanticProjection(value: object): JsonValue {
  const projection: Record<string, unknown> = { ...value };
  delete projection.semanticHash;
  return projection as JsonValue;
}

function assertSemanticHash(
  value: object & Readonly<{ semanticHash: Sha256Digest }>,
  code: string,
): void {
  const expected = sha256(semanticProjection(value));
  if (value.semanticHash !== expected) throw new Error(`${code}_SEMANTIC_HASH_MISMATCH`);
}

function assertVersionChain(
  revision: number,
  previous: QueueVersionedContentRef | undefined,
  code: string,
): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`${code}_REVISION_INVALID`);
  if ((revision === 1) === (previous !== undefined))
    throw new Error(`${code}_PREVIOUS_REF_INVALID`);
  if (previous && previous.version !== revision - 1)
    throw new Error(`${code}_PREVIOUS_VERSION_INVALID`);
}

function assertInterval(interval: BusinessInterval, code: string): void {
  if (
    !localTimePattern.test(interval.startLocalTime) ||
    !endLocalTimePattern.test(interval.endLocalTime)
  ) {
    throw new Error(`${code}_LOCAL_TIME_INVALID`);
  }
  if (interval.startLocalTime >= interval.endLocalTime) throw new Error(`${code}_INTERVAL_INVALID`);
}

export function validateBusinessCalendar(calendar: BusinessCalendarRevision): void {
  assertVersionChain(calendar.revision, calendar.previousCalendarRef, "BUSINESS_CALENDAR");
  if (
    !calendar.calendarId ||
    !calendar.calendarKey ||
    !calendar.workspaceId ||
    !calendar.sourceRef
  ) {
    throw new Error("BUSINESS_CALENDAR_IDENTITY_INVALID");
  }
  if (/^(?:[+-]\d|(?:UTC|GMT)[+-]|Etc\/GMT[+-])/u.test(calendar.timeZone))
    throw new Error("BUSINESS_CALENDAR_TIME_ZONE_INVALID");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: calendar.timeZone }).format(0);
  } catch {
    throw new Error("BUSINESS_CALENDAR_TIME_ZONE_INVALID");
  }
  if (
    !isLocalDate(calendar.validFrom) ||
    (calendar.validThrough !== null &&
      (!isLocalDate(calendar.validThrough) || calendar.validThrough < calendar.validFrom))
  ) {
    throw new Error("BUSINESS_CALENDAR_COVERAGE_INVALID");
  }
  if (
    calendar.dstAlgorithmRef.key !== "business-calendar-dst" ||
    calendar.dstAlgorithmRef.version !== "1.0.0"
  ) {
    throw new Error("BUSINESS_CALENDAR_DST_ALGORITHM_INVALID");
  }
  if (
    calendar.dstRules.nonexistentBoundary !== "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP" ||
    calendar.dstRules.ambiguousStart !== "EARLIEST_MATCHING_INSTANT" ||
    calendar.dstRules.ambiguousEnd !== "LATEST_MATCHING_INSTANT"
  ) {
    throw new Error("BUSINESS_CALENDAR_DST_RULE_INVALID");
  }
  let previousWeekly: WeeklyBusinessInterval | undefined;
  for (const interval of calendar.weeklyIntervals) {
    if (!(interval.dayOfWeek in dayOrder)) throw new Error("BUSINESS_CALENDAR_WEEKLY_DAY_INVALID");
    assertInterval(interval, "BUSINESS_CALENDAR_WEEKLY");
    if (previousWeekly) {
      const order = dayOrder[interval.dayOfWeek] - dayOrder[previousWeekly.dayOfWeek];
      if (order < 0 || (order === 0 && interval.startLocalTime < previousWeekly.startLocalTime)) {
        throw new Error("BUSINESS_CALENDAR_WEEKLY_NOT_NORMALIZED");
      }
      if (order === 0 && interval.startLocalTime < previousWeekly.endLocalTime)
        throw new Error("BUSINESS_CALENDAR_WEEKLY_OVERLAP");
    }
    previousWeekly = interval;
  }
  if (calendar.weeklyIntervals.length === 0) throw new Error("BUSINESS_CALENDAR_WEEKLY_REQUIRED");
  const overrideDates = new Set<string>();
  for (const override of calendar.dateOverrides) {
    if (
      !isLocalDate(override.date) ||
      override.date < calendar.validFrom ||
      (calendar.validThrough !== null && override.date > calendar.validThrough)
    ) {
      throw new Error("BUSINESS_CALENDAR_OVERRIDE_DATE_INVALID");
    }
    if (overrideDates.has(override.date)) throw new Error("BUSINESS_CALENDAR_OVERRIDE_DUPLICATE");
    overrideDates.add(override.date);
    if (override.kind === "WORKING") {
      let previous: BusinessInterval | undefined;
      for (const interval of override.workingIntervals) {
        assertInterval(interval, "BUSINESS_CALENDAR_OVERRIDE");
        if (previous && interval.startLocalTime < previous.endLocalTime)
          throw new Error("BUSINESS_CALENDAR_OVERRIDE_OVERLAP");
        previous = interval;
      }
      if (override.workingIntervals.length === 0)
        throw new Error("BUSINESS_CALENDAR_OVERRIDE_INTERVAL_REQUIRED");
    }
  }
  assertSemanticHash(calendar, "BUSINESS_CALENDAR");
}

export function publishBusinessCalendar(
  input: Omit<BusinessCalendarRevision, "semanticHash"> & Readonly<{ semanticHash?: Sha256Digest }>,
): BusinessCalendarRevision {
  const semantic = structuredClone(input) as Omit<BusinessCalendarRevision, "semanticHash"> & {
    semanticHash?: Sha256Digest;
  };
  delete semantic.semanticHash;
  const calendar = {
    ...semantic,
    semanticHash: sha256(semantic as unknown as JsonValue),
  } as BusinessCalendarRevision;
  if (input.semanticHash !== undefined && input.semanticHash !== calendar.semanticHash) {
    throw new Error("BUSINESS_CALENDAR_SEMANTIC_HASH_MISMATCH");
  }
  validateBusinessCalendar(calendar);
  return deepFreeze(calendar) as BusinessCalendarRevision;
}

function assertStrictlyIncreasing(values: readonly number[], code: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!Number.isSafeInteger(value) || value < 1 || (index > 0 && value <= values[index - 1]!))
      throw new Error(code);
  }
}

export function validateQueuePolicy(
  policy: QueuePolicyRevision,
  calendar: BusinessCalendarRevision,
): void {
  assertVersionChain(policy.revision, policy.previousPolicyRef, "QUEUE_POLICY");
  if (
    policy.workspaceId !== calendar.workspaceId ||
    policy.calendarRef.id !== calendar.calendarId ||
    policy.calendarRef.version !== calendar.revision ||
    policy.calendarRef.semanticHash !== calendar.semanticHash
  ) {
    throw new Error("QUEUE_POLICY_CALENDAR_REF_MISMATCH");
  }
  if (calendar.validThrough !== null) throw new Error("QUEUE_POLICY_CALENDAR_MUST_BE_OPEN_ENDED");
  if (
    policy.comparatorRef.key !== "queue-order" ||
    policy.comparatorRef.version !== "1.0.0" ||
    policy.stageRuleRef.key !== "queue-stage" ||
    policy.stageRuleRef.version !== "1.0.0"
  ) {
    throw new Error("QUEUE_POLICY_ALGORITHM_REF_INVALID");
  }
  if (policy.statusMappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION")
    throw new Error("QUEUE_POLICY_STATUS_MAPPING_REF_INVALID");
  if (new Set(policy.externalActiveConsumesWip).size !== policy.externalActiveConsumesWip.length) {
    throw new Error("QUEUE_POLICY_EXTERNAL_STATUS_DUPLICATE");
  }
  if (new Set(policy.slaGoals.map(({ goal }) => goal)).size !== policy.slaGoals.length)
    throw new Error("QUEUE_POLICY_GOAL_DUPLICATE");
  if (
    new Set(policy.projectEntries.map(({ projectId }) => projectId)).size !==
    policy.projectEntries.length
  ) {
    throw new Error("QUEUE_POLICY_PROJECT_DUPLICATE");
  }
  assertStrictlyIncreasing(
    policy.agingBands.map(({ upperBoundBusinessSeconds }) => upperBoundBusinessSeconds),
    "QUEUE_POLICY_AGING_BANDS_INVALID",
  );
  for (const goal of policy.slaGoals) {
    const expectedStop =
      goal.goal === "READY_TO_FIRST_QA_START"
        ? "FIRST_CONSUMING_SESSION_STARTED"
        : "QA_VERDICT_SIGNED";
    if (
      goal.stopEvent !== expectedStop ||
      new Set(goal.startNormalizedStatuses).size !== goal.startNormalizedStatuses.length
    ) {
      throw new Error("QUEUE_POLICY_GOAL_INVALID");
    }
    assertStrictlyIncreasing(
      goal.warningThresholds.map(({ elapsedBusinessSeconds }) => elapsedBusinessSeconds),
      "QUEUE_POLICY_WARNING_THRESHOLDS_INVALID",
    );
    if (
      goal.targetBusinessSeconds !== null &&
      goal.warningThresholds.some(
        ({ elapsedBusinessSeconds }) => elapsedBusinessSeconds >= goal.targetBusinessSeconds!,
      )
    ) {
      throw new Error("QUEUE_POLICY_WARNING_NOT_BEFORE_TARGET");
    }
  }
  if (policy.mode === "MEASURE_ONLY") {
    if (
      policy.workspaceHumanWipLimit !== null ||
      policy.activeExpediteLimit !== null ||
      "baselineEvidenceRef" in policy
    ) {
      throw new Error("QUEUE_POLICY_MEASURE_ONLY_ENFORCEMENT_FORBIDDEN");
    }
    if (
      policy.slaGoals.some(
        (goal) => goal.targetBusinessSeconds !== null || goal.warningThresholds.length > 0,
      ) ||
      policy.projectEntries.some(
        (entry) => entry.softWipLimit !== null || entry.reservedCapacity !== null,
      )
    ) {
      throw new Error("QUEUE_POLICY_MEASURE_ONLY_HIDDEN_LIMIT_FORBIDDEN");
    }
  } else {
    if (
      !Number.isSafeInteger(policy.workspaceHumanWipLimit) ||
      policy.workspaceHumanWipLimit < 1 ||
      !Number.isSafeInteger(policy.activeExpediteLimit) ||
      policy.activeExpediteLimit < 1 ||
      !policy.baselineEvidenceRef
    ) {
      throw new Error("QUEUE_POLICY_ENFORCED_LIMIT_REQUIRED");
    }
    if (
      policy.slaGoals.some(
        (goal) => goal.targetBusinessSeconds === null || goal.warningThresholds.length === 0,
      )
    ) {
      throw new Error("QUEUE_POLICY_ENFORCED_SLA_REQUIRED");
    }
    if (
      policy.projectEntries.some(
        (entry) =>
          entry.softWipLimit === null ||
          entry.reservedCapacity === null ||
          entry.softWipLimit < 0 ||
          entry.reservedCapacity < 0 ||
          entry.reservedCapacity > entry.softWipLimit,
      )
    ) {
      throw new Error("QUEUE_POLICY_PROJECT_ALLOCATION_INVALID");
    }
  }
  assertSemanticHash(policy, "QUEUE_POLICY");
}

export function publishQueuePolicy(
  input: Omit<QueuePolicyRevision, "semanticHash"> & Readonly<{ semanticHash?: Sha256Digest }>,
  calendar: BusinessCalendarRevision,
): QueuePolicyRevision {
  const semantic = structuredClone(input) as Omit<QueuePolicyRevision, "semanticHash"> & {
    semanticHash?: Sha256Digest;
  };
  delete semantic.semanticHash;
  const policy = {
    ...semantic,
    semanticHash: sha256(semantic as unknown as JsonValue),
  } as QueuePolicyRevision;
  if (input.semanticHash !== undefined && input.semanticHash !== policy.semanticHash)
    throw new Error("QUEUE_POLICY_SEMANTIC_HASH_MISMATCH");
  validateQueuePolicy(policy, calendar);
  return deepFreeze(policy) as QueuePolicyRevision;
}

export type QueuePolicyNeutralBody = Readonly<
  Pick<
    QueuePolicyRevision,
    | "schemaVersion"
    | "policyKey"
    | "workspaceId"
    | "mode"
    | "calendarRef"
    | "comparatorRef"
    | "stageRuleRef"
    | "statusMappingRef"
    | "serviceClassRules"
    | "workspaceHumanWipLimit"
    | "activeExpediteLimit"
    | "externalActiveConsumesWip"
    | "blockReasonRules"
    | "slaGoals"
    | "agingBands"
    | "effectiveFrom"
    | "publishedAt"
  >
>;

export interface QueuePolicyNeutralView extends Omit<QueuePolicyNeutralBody, "schemaVersion"> {
  readonly schemaVersion: "queue-policy-view@1.0.0";
  readonly policyViewRef: QueueVersionedContentRef;
}

export interface ProjectQueuePolicyFacet extends QueuePolicyNeutralBody {
  readonly projectId: string;
  readonly projectEntry: QueuePolicyProjectEntry | null;
  readonly policyFacetRef: QueueVersionedContentRef;
}

export interface AuthorizedScopeQueuePolicyFacet extends QueuePolicyNeutralBody {
  readonly authorizedProjectSetHash: Sha256Digest;
  readonly projectEntries: readonly QueuePolicyProjectEntry[];
  readonly policyFacetRef: QueueVersionedContentRef;
}

function neutralBody(policy: QueuePolicyRevision): QueuePolicyNeutralBody {
  return structuredClone({
    schemaVersion: policy.schemaVersion,
    policyKey: policy.policyKey,
    workspaceId: policy.workspaceId,
    mode: policy.mode,
    calendarRef: policy.calendarRef,
    comparatorRef: policy.comparatorRef,
    stageRuleRef: policy.stageRuleRef,
    statusMappingRef: policy.statusMappingRef,
    serviceClassRules: policy.serviceClassRules,
    workspaceHumanWipLimit: policy.workspaceHumanWipLimit,
    activeExpediteLimit: policy.activeExpediteLimit,
    externalActiveConsumesWip: policy.externalActiveConsumesWip,
    blockReasonRules: policy.blockReasonRules,
    slaGoals: policy.slaGoals,
    agingBands: policy.agingBands,
    effectiveFrom: policy.effectiveFrom,
    publishedAt: policy.publishedAt,
  });
}

export function projectQueuePolicyNeutralView(
  policy: QueuePolicyRevision,
  identity: Readonly<{ id: string; version: number }>,
): QueuePolicyNeutralView {
  const { schemaVersion: _schemaVersion, ...neutral } = neutralBody(policy);
  void _schemaVersion;
  const body = { schemaVersion: "queue-policy-view@1.0.0" as const, ...neutral };
  return deepFreeze({
    ...body,
    policyViewRef: { ...identity, semanticHash: sha256(body as unknown as JsonValue) },
  }) as QueuePolicyNeutralView;
}

export function projectQueuePolicyFacet(
  policy: QueuePolicyRevision,
  projectId: string,
  identity: Readonly<{ id: string; version: number }>,
): ProjectQueuePolicyFacet {
  const body = {
    ...neutralBody(policy),
    projectId,
    projectEntry: structuredClone(
      policy.projectEntries.find((entry) => entry.projectId === projectId) ?? null,
    ),
  };
  return deepFreeze({
    ...body,
    policyFacetRef: { ...identity, semanticHash: sha256(body as unknown as JsonValue) },
  }) as ProjectQueuePolicyFacet;
}

export function projectAuthorizedScopeQueuePolicyFacet(
  policy: QueuePolicyRevision,
  projectIds: readonly string[],
  identity: Readonly<{ id: string; version: number }>,
): AuthorizedScopeQueuePolicyFacet {
  const normalizedIds = [...new Set(projectIds)].sort();
  const allowed = new Set(normalizedIds);
  const body = {
    ...neutralBody(policy),
    authorizedProjectSetHash: authorizedProjectSetHash(normalizedIds),
    projectEntries: structuredClone(
      policy.projectEntries
        .filter(({ projectId }) => allowed.has(projectId))
        .sort((left, right) => left.projectId.localeCompare(right.projectId)),
    ),
  };
  return deepFreeze({
    ...body,
    policyFacetRef: { ...identity, semanticHash: sha256(body as unknown as JsonValue) },
  }) as AuthorizedScopeQueuePolicyFacet;
}

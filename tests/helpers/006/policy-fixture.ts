import {
  type BusinessCalendarRevision,
  publishBusinessCalendar,
  publishQueuePolicy,
  type QueuePolicyRevision,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "./triage-fixture.ts";

export const policyIds = Object.freeze({
  workspace: "00000000-0000-4000-8000-000000000601",
  projectA: "00000000-0000-4000-8000-000000000602",
  projectB: "00000000-0000-4000-8000-000000000603",
  calendar: "00000000-0000-4000-8000-000000000604",
  policy: "00000000-0000-4000-8000-000000000605",
  mapping: "00000000-0000-4000-8000-000000000606",
  baseline: "00000000-0000-4000-8000-000000000607",
  principal: "00000000-0000-4000-8000-000000000608",
});

export function businessCalendarFixture(
  overrides: Partial<Omit<BusinessCalendarRevision, "semanticHash">> = {},
): BusinessCalendarRevision {
  return publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: policyIds.calendar,
    calendarKey: "samara-business-hours",
    workspaceId: policyIds.workspace,
    revision: 1,
    timeZone: "Europe/Samara",
    validFrom: "2026-01-01",
    validThrough: null,
    weeklyIntervals: Object.freeze([
      Object.freeze({
        dayOfWeek: "MONDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "18:00:00",
      }),
      Object.freeze({
        dayOfWeek: "TUESDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "18:00:00",
      }),
    ]),
    dateOverrides: Object.freeze([]),
    dstAlgorithmRef: Object.freeze({
      key: "business-calendar-dst" as const,
      version: "1.0.0" as const,
      semanticHash: digest("business-calendar-dst@1"),
    }),
    dstRules: Object.freeze({
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP" as const,
      ambiguousStart: "EARLIEST_MATCHING_INSTANT" as const,
      ambiguousEnd: "LATEST_MATCHING_INSTANT" as const,
    }),
    sourceKind: "MANUAL",
    sourceRef: "policy-fixture",
    sourceHash: digest("policy-fixture-source"),
    ownerPrincipalId: policyIds.principal,
    effectiveFrom: "2026-09-03T08:00:00.000Z",
    publishedAt: "2026-09-03T08:00:00.000Z",
    publishedByPrincipalId: policyIds.principal,
    ...overrides,
  });
}

export function queuePolicyFixture(
  mode: "MEASURE_ONLY" | "ENFORCED" = "MEASURE_ONLY",
  calendar = businessCalendarFixture(),
): QueuePolicyRevision {
  const common = {
    schemaVersion: "queue-policy@1.0.0" as const,
    queuePolicyId: policyIds.policy,
    policyKey: "qa-default",
    workspaceId: policyIds.workspace,
    revision: 1,
    calendarRef: Object.freeze({
      id: calendar.calendarId,
      version: calendar.revision,
      semanticHash: calendar.semanticHash,
    }),
    comparatorRef: Object.freeze({
      key: "queue-order" as const,
      version: "1.0.0" as const,
      semanticHash: digest("queue-order@1"),
    }),
    stageRuleRef: Object.freeze({
      key: "queue-stage" as const,
      version: "1.0.0" as const,
      semanticHash: digest("queue-stage@1"),
    }),
    statusMappingRef: Object.freeze({
      sourceType: "JIRA_STATUS_MAPPING_REVISION" as const,
      sourceId: policyIds.mapping,
      sourceVersion: 1,
      semanticHash: digest("mapping@1"),
    }),
    serviceClassRules: Object.freeze({
      initialClass: "STANDARD" as const,
      fixedDateRequiresConfirmedDueDate: true as const,
      expediteRequiresExactAction: true as const,
      overrideSeparationOfDuty: "SELF_APPROVAL_FORBIDDEN" as const,
    }),
    externalActiveConsumesWip: Object.freeze([
      "IN_PROGRESS" as const,
      "REVIEW" as const,
      "BLOCKED" as const,
    ]),
    blockReasonRules: Object.freeze([
      Object.freeze({
        normalizedStatus: "BLOCKED" as const,
        reasonCode: "WAITING_EXTERNAL",
        wipEffect: "HOLD_WIP" as const,
        slaEffect: "PAUSE" as const,
      }),
    ]),
    agingBands: Object.freeze([
      Object.freeze({ key: "new", upperBoundBusinessSeconds: 14_400 }),
      Object.freeze({ key: "aging", upperBoundBusinessSeconds: 28_800 }),
    ]),
    effectiveFrom: "2026-09-03T08:00:00.000Z",
    publishedAt: "2026-09-03T08:00:00.000Z",
    publishedByPrincipalId: policyIds.principal,
  };
  return mode === "MEASURE_ONLY"
    ? publishQueuePolicy(
        {
          ...common,
          mode,
          workspaceHumanWipLimit: null,
          activeExpediteLimit: null,
          slaGoals: Object.freeze([
            Object.freeze({
              goal: "READY_TO_FIRST_QA_START" as const,
              startNormalizedStatuses: Object.freeze(["READY" as const]),
              stopEvent: "FIRST_CONSUMING_SESSION_STARTED" as const,
              targetBusinessSeconds: null,
              warningThresholds: Object.freeze([] as const),
            }),
            Object.freeze({
              goal: "READY_TO_SIGNED_VERDICT" as const,
              startNormalizedStatuses: Object.freeze(["READY" as const]),
              stopEvent: "QA_VERDICT_SIGNED" as const,
              targetBusinessSeconds: null,
              warningThresholds: Object.freeze([] as const),
            }),
          ]),
          projectEntries: Object.freeze([
            Object.freeze({
              projectId: policyIds.projectA,
              softWipLimit: null,
              reservedCapacity: null,
              explanation: "Measurement only",
            }),
          ]),
        },
        calendar,
      )
    : publishQueuePolicy(
        {
          ...common,
          mode,
          workspaceHumanWipLimit: 2,
          activeExpediteLimit: 1,
          baselineEvidenceRef: Object.freeze({
            sourceType: "QA_READINESS_FACT_SET" as const,
            sourceId: policyIds.baseline,
            sourceVersion: 1,
            semanticHash: digest("baseline@1"),
          }),
          slaGoals: Object.freeze([
            Object.freeze({
              goal: "READY_TO_FIRST_QA_START" as const,
              startNormalizedStatuses: Object.freeze(["READY" as const]),
              stopEvent: "FIRST_CONSUMING_SESSION_STARTED" as const,
              targetBusinessSeconds: 28_800,
              warningThresholds: Object.freeze([
                Object.freeze({ key: "warn", elapsedBusinessSeconds: 14_400 }),
              ]),
            }),
            Object.freeze({
              goal: "READY_TO_SIGNED_VERDICT" as const,
              startNormalizedStatuses: Object.freeze(["READY" as const]),
              stopEvent: "QA_VERDICT_SIGNED" as const,
              targetBusinessSeconds: 57_600,
              warningThresholds: Object.freeze([
                Object.freeze({ key: "warn", elapsedBusinessSeconds: 28_800 }),
              ]),
            }),
          ]),
          projectEntries: Object.freeze([
            Object.freeze({
              projectId: policyIds.projectA,
              softWipLimit: 1,
              reservedCapacity: 0,
              explanation: "Soft routing signal",
            }),
          ]),
        },
        calendar,
      );
}

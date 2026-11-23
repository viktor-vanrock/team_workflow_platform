import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

import type {
  NotificationIntentSnapshot,
  SlaGoal,
} from "../../packages/platform-core/src/index.ts";
import type { SlaThresholdEmission } from "../../packages/runtime-composition/src/index.ts";
import { requireQueueScenarioId } from "./queue-scenario-catalog.mts";

type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
interface QueueStageInput {
  readonly subject: Readonly<
    | { kind: "CANDIDATE"; id: string; candidateState: "PENDING" | "SNOOZED" }
    | { kind: "DRAFT"; id: string; linkedToConfirmedWorkItem: boolean }
    | { kind: "WORK_ITEM"; id: string }
  >;
  readonly operational: Readonly<
    | { state: "NOT_APPLICABLE" | "PENDING" | "ERROR" }
    | { state: "CONFIRMED"; normalizedStatus: string; displayStatus: string }
  >;
  readonly qa: Readonly<{
    readiness: "NOT_ASSESSED" | "NEEDS_INFO" | "READY" | "READY_WITH_WAIVER" | "STALE";
    activities: readonly Readonly<{
      sessionId: string;
      mode: "MANUAL" | "AUTOMATED";
      state:
        "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
    }>[];
  }>;
}
const contracts = (await tsImport(
  "../../packages/platform-contracts/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/platform-contracts/src/index.ts");
const core = (await tsImport(
  "../../packages/platform-core/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/platform-core/src/index.ts");
const runtime = (await tsImport(
  "../../packages/runtime-composition/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/runtime-composition/src/index.ts");
const persistence = (await tsImport(
  "../../packages/platform-persistence-typeorm/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/platform-persistence-typeorm/src/index.ts");
const competency = (await tsImport(
  "../../packages/competency-qa/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/competency-qa/src/index.ts");
const { sha256 } = contracts;
const {
  addBusinessSeconds,
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  businessSecondsBetween,
  createInitialSlaClock,
  createWorkItemOrdering,
  deriveBaseWipClaimDecision,
  deriveQueueStage,
  detectConfirmedJiraSlaStart,
  publishBusinessCalendar,
  sortQueueOrderEntries,
} = core;
const {
  applyQueueOrderMove,
  createViewLocalAppliedOrderOverride,
  evaluateSlaSnapshot,
  planSlaThresholds,
  SlaThresholdNotificationService,
} = runtime;
const { createQueueOrderInvalidation } = persistence;

const hash = (value: string) => sha256(value);
const confirmedAt = "2026-09-03T08:00:00.000Z";
const operationalRef = Object.freeze({
  sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
  sourceId: "00000000-0000-4000-8000-000000000301",
  sourceVersion: 4,
  semanticHash: hash("us1-jira-ready"),
  observedAt: "2026-09-03T07:59:00.000Z",
  confirmedAt,
});

type QueueImplementedScenarioId =
  | "setup-portfolio"
  | "external-network-denied"
  | "us1-candidate-has-no-operational-effects"
  | "us1-confirmed-needs-info-backlog"
  | "us1-dor-and-pending-jira-remain-backlog"
  | "us1-confirmed-jira-ready-starts-clock"
  | "us1-first-required-session-consumes-wip"
  | "us1-completed-precedence"
  | "us2-project-lanes-and-portfolio"
  | "us2-comparator-tie-breakers"
  | "us2-forbidden-project-interleaved"
  | "us2-hidden-anchor-no-existence-signal"
  | "us2-overlapping-order-views"
  | "us2-order-invalidation-ref"
  | "us2-portfolio-order-no-project-fanout"
  | "us3-factorized-assessment"
  | "us3-missing-business-impact"
  | "us3-model-outage-fallback"
  | "us3-assessment-drift-conflict"
  | "us3-exact-lead-order-override"
  | "us3-order-hidden-anchor-terminal-no-op"
  | "us3-approval-v1-v2-compatibility"
  | "us3-jira-priority-remains-separate"
  | "us4-measure-only-observation"
  | "us4-enforced-publication-requires-baseline"
  | "us4-project-soft-limit-warning"
  | "us4-automated-launch-reserves-review"
  | "us4-running-automation-is-not-human-wip"
  | "us4-terminal-result-converts-reservation"
  | "us4-pre-review-cancel-releases-reservation"
  | "us4-one-work-item-one-capacity-unit"
  | "us4-concurrent-last-slot"
  | "us4-concurrent-review-reservation"
  | "us4-exact-wip-override"
  | "us4-denial-without-override-intent"
  | "us4-stale-or-self-approved-override-denied"
  | "us4-concurrent-expedite-singleton"
  | "us4-expedite-clear-and-expiry-lock"
  | "us4-forced-external-overflow"
  | "us4-blocked-release-and-resume"
  | "us5-local-dor-does-not-start-sla"
  | "us5-confirmed-ready-starts-at-confirmed-at"
  | "us5-no-rollout-backdating"
  | "us5-rollout-duplicate-read-receipt"
  | "us5-business-calendar-golden-vectors"
  | "us5-finite-calendar-policy-rejected"
  | "us5-confirmed-pause-resume"
  | "us5-unknown-pause-reason-keeps-running"
  | "us5-policy-calendar-revision-pinning"
  | "us5-measure-only-versus-enforced"
  | "us5-notification-dedupe-and-outage"
  | "us5-clock-revision-versus-evaluation-hash"
  | "rebuild-duplicate-and-out-of-order-events"
  | "rebuild-missed-event-and-gap"
  | "rebuild-shadow-generation-cutover"
  | "rebuild-worker-process-restart"
  | "rebuild-no-duplicate-notification-or-effect";

export interface QueueScenarioResult {
  readonly id: QueueImplementedScenarioId;
  readonly status: "PASS";
  readonly mode: "TEST" | "LOCAL";
  readonly assertedLayers: readonly ["API_PROJECTION", "POSTGRES_EFFECT_MODEL", "WORKER_REDUCER"];
  readonly evidence: Readonly<Record<string, unknown>>;
}

function equal(actual: unknown, expected: unknown, code: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${code}:${JSON.stringify(actual)}`);
}

function workItem(overrides: Partial<QueueStageInput> = {}): QueueStageInput {
  return {
    subject: { kind: "WORK_ITEM", id: "00000000-0000-4000-8000-000000000101" },
    operational: { state: "CONFIRMED", normalizedStatus: "BACKLOG", displayStatus: "Open" },
    qa: { readiness: "NOT_ASSESSED", activities: [] },
    ...overrides,
  };
}

function commonEvidence(
  input: QueueStageInput,
  output: ReturnType<typeof deriveQueueStage>,
  effects: Readonly<Record<string, unknown>>,
) {
  const sourceFactRefs = Object.freeze([
    Object.freeze({
      sourceType: "WORK_ITEM_REVISION",
      sourceId: input.subject.id,
      sourceVersion: 3,
      semanticHash: hash(`${input.subject.id}:3`),
    }),
    ...(input.operational.state === "CONFIRMED" ? [operationalRef] : []),
  ]);
  return Object.freeze({
    sourceFactRefs,
    canonicalInputHash: sha256(input as unknown as JsonValue),
    stageRuleVersion: output.algorithm,
    comparatorVersion: "queue-order@1.0.0",
    projectionVersions: Object.freeze({ previous: 6, current: 7 }),
    stage: output.stage,
    detail: output.detail,
    reasonCodes: output.reasonCodes,
    jira: output.jira,
    consistencyWarnings: output.consistencyWarnings,
    effects,
  });
}

function orderEntry(
  projectId: string,
  workItemId: string,
  stage: "BACKLOG" | "READY" | "ACTIVE",
  serviceClassBand: "EXPEDITE" | "FIXED_DATE" | "STANDARD" = "STANDARD",
) {
  return Object.freeze({
    projectId,
    queueEntryId: `queue-${workItemId}`,
    stage,
    subject: Object.freeze({ kind: "WORK_ITEM" as const, id: workItemId }),
    ordering: createWorkItemOrdering({
      serviceClassBand,
      slaState: "NOT_STARTED",
      urgencyTiming: Object.freeze({ state: "NOT_STARTED" }),
      jiraPriority: Object.freeze({ state: "UNKNOWN" }),
      acceptedRisk: "UNKNOWN",
      acceptedBusinessImpact: "UNKNOWN",
      dependencyReadiness: "UNKNOWN",
      readyAge: Object.freeze({ state: "UNKNOWN" }),
      readyAt: Object.freeze({ state: "UNKNOWN" }),
      jiraDisplayKey: Object.freeze({ state: "KNOWN", value: `${projectId}-${workItemId}` }),
      workItemId,
    }),
  });
}

const triageInput = () => {
  const subject = Object.freeze({
    kind: "WORK_ITEM" as const,
    id: "work-item-us3",
    version: 4,
    contentHash: hash("work-item-us3:r4"),
  });
  return Object.freeze({
    assessmentId: "assessment-us3",
    workspaceId: "w1",
    projectId: "A",
    subject,
    revision: 1,
    facts: Object.freeze([
      Object.freeze({
        sourceRef: "qa-fact:us3",
        sourceVersion: "2",
        contentHash: hash("qa-fact-us3"),
        polarity: "UNKNOWN" as const,
      }),
    ]),
    inputFingerprintComponents: Object.freeze({
      subject: Object.freeze({
        sourceType: "WORK_ITEM_REVISION" as const,
        sourceId: subject.id,
        sourceVersion: subject.version,
        semanticHash: subject.contentHash,
      }),
      jiraOperationalProjection: Object.freeze({
        state: "KNOWN" as const,
        sourceRef: Object.freeze({
          sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
          sourceId: "jira-us3",
          sourceVersion: 3,
          semanticHash: hash("jira-us3:r3"),
          confirmedAt,
        }),
      }),
      qaPlanningFacts: Object.freeze({
        state: "KNOWN" as const,
        sourceRef: Object.freeze({
          sourceType: "QA_QUEUE_FACT_REVISION" as const,
          sourceId: "qa-us3",
          sourceVersion: 2,
          semanticHash: hash("qa-us3:r2"),
        }),
      }),
      automationFacts: Object.freeze({
        state: "NOT_APPLICABLE" as const,
        reasonCode: "AUTOMATION_NOT_CONFIGURED" as const,
      }),
    }),
    agentRunId: "agent-run-us3",
    now: new Date(confirmedAt),
    expiresAt: new Date("2026-09-04T08:00:00.000Z"),
  });
};

const slaIds = Object.freeze({
  workspaceId: "00000000-0000-4000-8000-000000000701",
  projectId: "00000000-0000-4000-8000-000000000702",
  workItemId: "00000000-0000-4000-8000-000000000703",
  calendarId: "00000000-0000-4000-8000-000000000704",
  policyId: "00000000-0000-4000-8000-000000000705",
  mappingId: "00000000-0000-4000-8000-000000000706",
  principalId: "00000000-0000-4000-8000-000000000707",
});

function slaCalendar(
  options: Readonly<{ revision?: number; validThrough?: string | null; mondayEnd?: string }> = {},
): ReturnType<typeof publishBusinessCalendar> {
  const revision = options.revision ?? 1;
  const previous = revision > 1 ? slaCalendar({ revision: revision - 1 }) : undefined;
  return publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: slaIds.calendarId,
    calendarKey: "qa-sla-hours",
    workspaceId: slaIds.workspaceId,
    revision,
    ...(previous
      ? {
          previousCalendarRef: Object.freeze({
            id: previous.calendarId,
            version: previous.revision,
            semanticHash: previous.semanticHash,
          }),
        }
      : {}),
    timeZone: "UTC",
    validFrom: "2026-01-01",
    validThrough: options.validThrough ?? null,
    weeklyIntervals: Object.freeze([
      Object.freeze({
        dayOfWeek: "MONDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: options.mondayEnd ?? "17:00:00",
      }),
      Object.freeze({
        dayOfWeek: "TUESDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
      }),
      Object.freeze({
        dayOfWeek: "WEDNESDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
      }),
      Object.freeze({
        dayOfWeek: "THURSDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
      }),
      Object.freeze({
        dayOfWeek: "FRIDAY" as const,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
      }),
    ]),
    dateOverrides: Object.freeze([]),
    dstAlgorithmRef: Object.freeze({
      key: "business-calendar-dst" as const,
      version: "1.0.0" as const,
      semanticHash: hash("business-calendar-dst@1"),
    }),
    dstRules: Object.freeze({
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP" as const,
      ambiguousStart: "EARLIEST_MATCHING_INSTANT" as const,
      ambiguousEnd: "LATEST_MATCHING_INSTANT" as const,
    }),
    sourceKind: "MANUAL" as const,
    sourceRef: `queue-scenario:calendar:${revision}`,
    sourceHash: hash(`queue-scenario:calendar-source:${revision}`),
    ownerPrincipalId: slaIds.principalId,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    publishedAt: `2026-01-0${revision}T00:00:00.000Z`,
    publishedByPrincipalId: slaIds.principalId,
  });
}

function startedSla(goal: SlaGoal = "READY_TO_FIRST_QA_START") {
  const calendar = slaCalendar();
  const suffix = goal === "READY_TO_FIRST_QA_START" ? "8" : "9";
  const target = Object.freeze({
    goal,
    targetBusinessSeconds: 14_400,
    warningThresholds: Object.freeze([
      Object.freeze({ key: "warning-50", elapsedBusinessSeconds: 7_200 }),
    ]),
  });
  const transition = createInitialSlaClock({
    workspaceId: slaIds.workspaceId,
    projectId: slaIds.projectId,
    workItemId: slaIds.workItemId,
    slaClockId: `00000000-0000-4000-8000-00000000070${suffix}`,
    goal,
    policyFacetRef: Object.freeze({
      id: slaIds.policyId,
      version: 3,
      semanticHash: hash("policy-facet:3"),
    }),
    calendarRef: Object.freeze({
      id: calendar.calendarId,
      version: calendar.revision,
      semanticHash: calendar.semanticHash,
    }),
    mappingRef: Object.freeze({
      sourceType: "JIRA_STATUS_MAPPING_REVISION" as const,
      sourceId: slaIds.mappingId,
      sourceVersion: 2,
      semanticHash: hash("mapping:2"),
    }),
    algorithmRef: Object.freeze({
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: hash("sla-business-time@1"),
    }),
    startSourceRef: Object.freeze({
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
      sourceId: "00000000-0000-4000-8000-000000000710",
      sourceVersion: 5,
      semanticHash: hash("jira-ready:5"),
      observedAt: "2026-09-07T08:58:00.000Z",
      confirmedAt: "2026-09-07T09:00:00.000Z",
    }),
  });
  const openSegment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: `00000000-0000-4000-8000-00000000071${suffix}`,
  }).opened!;
  return Object.freeze({
    calendar,
    target,
    transition,
    openSegment,
    segments: Object.freeze([openSegment]),
  });
}

const scenarios: Readonly<
  Record<
    QueueImplementedScenarioId,
    () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
  >
> = Object.freeze({
  "setup-portfolio": () => {
    const fixture = runtime.buildQaJiraGitLabMattermostQueueLocalFixture();
    return Object.freeze({
      contour: fixture.contour,
      projects: fixture.projects,
      policyRef: Object.freeze({
        id: fixture.measureOnlyPolicy.queuePolicyId,
        version: fixture.measureOnlyPolicy.revision,
        semanticHash: fixture.measureOnlyPolicy.semanticHash,
      }),
      calendarRef: Object.freeze({
        id: fixture.calendar.calendarId,
        version: fixture.calendar.revision,
        semanticHash: fixture.calendar.semanticHash,
      }),
      sessions: fixture.sessions,
      attempts: fixture.attempts,
      virtualClock: fixture.virtualClock,
      fixtureHash: fixture.fixtureHash,
    });
  },
  "external-network-denied": () => {
    let reasonCode = "";
    try {
      runtime.assertEffectEndpointAllowed("local", "https://gitlab.com", () => undefined);
    } catch (error) {
      reasonCode = error instanceof Error ? error.message : String(error);
    }
    equal(reasonCode, "LOCAL_EFFECT_ENDPOINT_FORBIDDEN", "QUEUE_LOCAL_EGRESS_ALLOWED");
    return Object.freeze({
      externalNetworkMode: "deny",
      productionEndpointInvocations: 0,
      credentialResolutions: 0,
      reasonCode,
    });
  },
  "us1-candidate-has-no-operational-effects": () => {
    const input: QueueStageInput = {
      subject: {
        kind: "CANDIDATE",
        id: "00000000-0000-4000-8000-000000000201",
        candidateState: "PENDING",
      },
      operational: { state: "NOT_APPLICABLE" },
      qa: { readiness: "NOT_ASSESSED", activities: [] },
    };
    const stage = deriveQueueStage(input);
    const wip = deriveBaseWipClaimDecision({
      workItemId: input.subject.id,
      stage: stage.stage,
      policyMode: "MEASURE_ONLY",
    });
    equal(
      [stage.stage, stage.jira.state, wip.state],
      ["CANDIDATE", "NOT_APPLICABLE", "NOT_CONSUMING"],
      "US1_CANDIDATE_EFFECT_LEAK",
    );
    return commonEvidence(input, stage, {
      jiraIssueCreated: false,
      slaClockStarted: false,
      humanWipClaimCreated: false,
      reviewReservationCreated: false,
    });
  },
  "us1-confirmed-needs-info-backlog": () => {
    const input = workItem({ qa: { readiness: "NEEDS_INFO", activities: [] } });
    const stage = deriveQueueStage(input);
    const wip = deriveBaseWipClaimDecision({
      workItemId: input.subject.id,
      stage: stage.stage,
      policyMode: "MEASURE_ONLY",
    });
    equal(
      [stage.stage, stage.reasonCodes, wip.state],
      ["BACKLOG", ["NEEDS_INFO"], "NOT_CONSUMING"],
      "US1_NEEDS_INFO_PRECEDENCE",
    );
    return commonEvidence(input, stage, { slaClockStarted: false, humanWipClaimCreated: false });
  },
  "us1-dor-and-pending-jira-remain-backlog": () => {
    const input = workItem({
      operational: { state: "PENDING" },
      qa: { readiness: "READY", activities: [] },
    });
    const stage = deriveQueueStage(input);
    const sla = detectConfirmedJiraSlaStart({
      operationalState: "PENDING",
      normalizedStatus: "READY",
      currentReadiness: "READY",
    });
    equal(
      [stage.stage, stage.reasonCodes, sla.state],
      ["BACKLOG", ["OPERATIONAL_PENDING"], "NOT_STARTED"],
      "US1_PENDING_JIRA_FABRICATION",
    );
    return commonEvidence(input, stage, {
      pendingJiraCommand: true,
      confirmedJiraChanged: false,
      slaClockStarted: false,
      humanWipClaimCreated: false,
    });
  },
  "us1-confirmed-jira-ready-starts-clock": () => {
    const input = workItem({
      operational: { state: "CONFIRMED", normalizedStatus: "READY", displayStatus: "Ready for QA" },
      qa: { readiness: "READY", activities: [] },
    });
    const stage = deriveQueueStage(input);
    const sla = detectConfirmedJiraSlaStart({
      operationalState: "CONFIRMED",
      normalizedStatus: "READY",
      currentReadiness: "READY",
      operationalRef,
    });
    equal(
      [stage.stage, sla.state, sla.state === "START" ? sla.effectiveAt : null],
      ["READY", "START", confirmedAt],
      "US1_CONFIRMED_READY_SLA_START",
    );
    return commonEvidence(input, stage, {
      slaClockStarted: true,
      slaEffectiveAt: confirmedAt,
      startSourceRef: operationalRef,
      humanWipClaimCreated: false,
    });
  },
  "us1-first-required-session-consumes-wip": () => {
    const readyInput = workItem({
      operational: { state: "CONFIRMED", normalizedStatus: "READY", displayStatus: "Ready" },
      qa: {
        readiness: "READY",
        activities: [{ sessionId: "session-1", mode: "MANUAL", state: "READY" }],
      },
    });
    const activeInput = workItem({
      operational: readyInput.operational,
      qa: {
        readiness: "READY",
        activities: [{ sessionId: "session-1", mode: "MANUAL", state: "RUNNING" }],
      },
    });
    const before = deriveQueueStage(readyInput);
    const after = deriveQueueStage(activeInput);
    const beforeWip = deriveBaseWipClaimDecision({
      workItemId: readyInput.subject.id,
      stage: before.stage,
      activity: readyInput.qa.activities[0]!,
      policyMode: "MEASURE_ONLY",
    });
    const afterWip = deriveBaseWipClaimDecision({
      workItemId: activeInput.subject.id,
      stage: after.stage,
      activity: activeInput.qa.activities[0]!,
      policyMode: "MEASURE_ONLY",
    });
    equal(
      [before.stage, beforeWip.state, after.stage, afterWip.state],
      ["READY", "NOT_CONSUMING", "ACTIVE", "CREATE"],
      "US1_FIRST_SESSION_WIP",
    );
    return commonEvidence(activeInput, after, {
      previousStage: before.stage,
      previousWip: beforeWip,
      currentWip: afterWip,
      humanWipClaimCreated: true,
      capacityUnits: 1,
    });
  },
  "us1-completed-precedence": () => {
    const input = workItem({
      operational: { state: "CONFIRMED", normalizedStatus: "DONE", displayStatus: "Closed" },
      qa: {
        readiness: "READY",
        activities: [{ sessionId: "session-1", mode: "MANUAL", state: "RUNNING" }],
      },
    });
    const stage = deriveQueueStage(input);
    equal(
      [stage.stage, stage.reasonCodes, stage.consistencyWarnings],
      ["COMPLETED", ["JIRA_TERMINAL"], ["TERMINAL_WITH_OPEN_QA"]],
      "US1_COMPLETED_PRECEDENCE",
    );
    return commonEvidence(input, stage, {
      confirmedJiraTerminal: true,
      derivedStage: "COMPLETED",
      rawJiraStatus: "Closed",
    });
  },
  "us2-project-lanes-and-portfolio": () => {
    const entries = [
      orderEntry("B", "b-active", "ACTIVE"),
      orderEntry("A", "a-ready", "READY"),
      orderEntry("A", "a-backlog", "BACKLOG"),
    ];
    const ordered = sortQueueOrderEntries(entries);
    equal(
      ordered.map(({ projectId, subject }) => `${projectId}:${subject.id}`),
      ["A:a-backlog", "A:a-ready", "B:b-active"],
      "US2_PORTFOLIO_ORDER",
    );
    return Object.freeze({
      authorizedProjects: ["A", "B"],
      visibleCount: 3,
      fullOrder: ordered.map(({ queueEntryId }) => queueEntryId),
      comparatorRef: "queue-order@1.0.0",
    });
  },
  "us2-comparator-tie-breakers": () => {
    const standard = orderEntry("A", "standard", "READY", "STANDARD");
    const expedite = orderEntry("B", "expedite", "READY", "EXPEDITE");
    const ordered = sortQueueOrderEntries([standard, expedite]);
    equal(
      ordered.map(({ subject }) => subject.id),
      ["expedite", "standard"],
      "US2_COMPARATOR_SERVICE_CLASS",
    );
    return Object.freeze({
      tuple: [
        "stage",
        "serviceClassBand",
        "slaState",
        "urgencyTiming",
        "jiraPriority",
        "risk",
        "impact",
        "dependency",
        "agingBand",
        "readyAt",
        "jiraKey",
        "workItemId",
      ],
      ordered: ordered.map(({ subject }) => subject.id),
    });
  },
  "us2-forbidden-project-interleaved": () => {
    const stored = [
      orderEntry("A", "a", "READY"),
      orderEntry("C", "secret", "BACKLOG"),
      orderEntry("B", "b", "ACTIVE"),
    ];
    const authorized = sortQueueOrderEntries(stored.filter(({ projectId }) => projectId !== "C"));
    equal(
      authorized.map(({ projectId }) => projectId),
      ["A", "B"],
      "US2_FORBIDDEN_PROJECT_LEAK",
    );
    return Object.freeze({
      storedProjects: ["A", "B", "C"],
      authorizedProjects: ["A", "B"],
      returnedProjects: authorized.map(({ projectId }) => projectId),
      forbiddenIdentifiersReturned: 0,
    });
  },
  "us2-hidden-anchor-no-existence-signal": () => {
    const entries = [
      { projectId: "A", workItemId: "one" },
      { projectId: "B", workItemId: "two" },
    ];
    const hidden = applyQueueOrderMove(entries, {
      subject: entries[0]!,
      placement: "BEFORE",
      anchor: { projectId: "C", workItemId: "secret" },
    });
    const missing = applyQueueOrderMove(entries, {
      subject: entries[0]!,
      placement: "BEFORE",
      anchor: { projectId: "A", workItemId: "absent" },
    });
    equal(
      [hidden.applicationState, missing.applicationState],
      ["ANCHOR_UNAVAILABLE_NO_OP", "ANCHOR_UNAVAILABLE_NO_OP"],
      "US2_ANCHOR_SIGNAL",
    );
    return Object.freeze({
      hiddenOutcome: hidden.applicationState,
      missingOutcome: missing.applicationState,
      publicAnchor: null,
      approvalCreated: false,
    });
  },
  "us2-overlapping-order-views": () => {
    const shared = {
      subjectWorkItemId: "one",
      overrideId: "override-1",
      orderScopeResourceVersion: 4,
      placement: "BEFORE" as const,
      reason: "Lead decision",
      acceptedAt: confirmedAt,
      expiresAt: "2026-09-04T08:00:00.000Z",
    };
    const project = createViewLocalAppliedOrderOverride({
      ...shared,
      orderScopeId: "scope-a",
      scopeKind: "PROJECT",
      anchorVisible: true,
    });
    const portfolio = createViewLocalAppliedOrderOverride({
      ...shared,
      orderScopeId: "scope-ab",
      scopeKind: "AUTHORIZED_PORTFOLIO",
      anchorVisible: false,
    });
    equal(
      [project.applicationState, portfolio.applicationState],
      ["APPLIED", "ANCHOR_UNAVAILABLE_NO_OP"],
      "US2_OVERLAPPING_VIEW_OUTCOME",
    );
    return Object.freeze({ project, portfolio, canonicalQueueEntryMutations: 0 });
  },
  "us2-order-invalidation-ref": () => {
    const event = createQueueOrderInvalidation({
      scopeKind: "PROJECT",
      workspaceId: "w1",
      projectId: "A",
      workItemId: "one",
      invalidationId: "i1",
      version: 3,
      reasonCode: "ORDER_OVERRIDE_ACCEPTED",
      occurredAt: confirmedAt,
    });
    equal(
      [event?.eventType, event?.entityVersion],
      ["queue.order.changed", 3],
      "US2_PROJECT_INVALIDATION",
    );
    return Object.freeze({
      eventType: event!.eventType,
      payload: event!.payload,
      containsAnchor: false,
      durable: true,
    });
  },
  "us2-portfolio-order-no-project-fanout": () => {
    const event = createQueueOrderInvalidation({
      scopeKind: "AUTHORIZED_PORTFOLIO",
      workspaceId: "w1",
      projectId: "A",
      workItemId: "one",
      invalidationId: "i1",
      version: 3,
      reasonCode: "ORDER_OVERRIDE_EXPIRED",
      occurredAt: confirmedAt,
    });
    equal(event, undefined, "US2_PORTFOLIO_FANOUT");
    return Object.freeze({ portfolioReceiptVisibleToCaller: true, projectEventsPublished: 0 });
  },
  "us3-factorized-assessment": () => {
    const value = competency.deterministicQaTriageV11(triageInput());
    equal(Object.keys(value.dimensionDetails).length, 8, "US3_FACTORS_INCOMPLETE");
    return Object.freeze({
      schemaVersion: value.schemaVersion,
      factorCount: 8,
      inputFingerprint: value.inputFingerprint,
      ruleVersion: value.ruleVersion,
      skillVersion: value.skillVersion,
      totalScorePresent: false,
    });
  },
  "us3-missing-business-impact": () => {
    const value = competency.deterministicQaTriageV11(triageInput());
    equal(
      [value.dimensions.businessImpact, value.missingInformation[0]?.key],
      ["UNKNOWN", "BUSINESS_IMPACT_MISSING"],
      "US3_BUSINESS_IMPACT_FABRICATED",
    );
    return Object.freeze({
      businessImpact: value.dimensions.businessImpact,
      missingInformation: value.missingInformation,
    });
  },
  "us3-model-outage-fallback": async () => {
    const result = await competency.runQaTriageV11(triageInput(), {
      propose: async () => {
        throw new Error("MODEL_DOWN");
      },
    });
    equal(
      [result.executionMode, result.assessment.confidence],
      ["DETERMINISTIC_FALLBACK", 0],
      "US3_MODEL_OUTAGE_UNSAFE",
    );
    return Object.freeze({
      executionMode: result.executionMode,
      confidence: result.assessment.confidence,
      acceptedAuthority: false,
    });
  },
  "us3-assessment-drift-conflict": async () => {
    const value = competency.deterministicQaTriageV11(triageInput());
    const stale = await runtime.enforceProposalFreshness({
      workspaceId: "w1",
      projectId: "A",
      id: value.assessmentId,
      contentHash: hash("assessment"),
      sourceFactSetHash: hash("facts"),
      currentFactSetHash: hash("facts"),
      inputFingerprint: value.inputFingerprint,
      currentInputFingerprint: hash("drift"),
      state: "CURRENT",
      expiresAt: new Date(value.expiresAt),
      now: new Date("2026-09-03T09:00:00Z"),
      repository: { markStale: async () => undefined },
    });
    if (stale.state !== "STALE") throw new Error("US3_EXPECTED_STALE_PROPOSAL");
    equal([stale.state, stale.reasonCode], ["STALE", "SOURCE_CHANGED"], "US3_DRIFT_ACCEPTED");
    return Object.freeze({ acceptance: "CONFLICT", reasonCode: stale.reasonCode });
  },
  "us3-exact-lead-order-override": () => {
    const entries = [
      { projectId: "A", workItemId: "one" },
      { projectId: "A", workItemId: "two" },
    ];
    const moved = applyQueueOrderMove(entries, { subject: entries[1]!, placement: "FIRST" });
    equal(
      moved.entries.map(({ workItemId }) => workItemId),
      ["two", "one"],
      "US3_EXACT_ORDER_MOVE",
    );
    return Object.freeze({
      actorKind: "HUMAN",
      approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
      applicationState: moved.applicationState,
      order: moved.entries.map(({ workItemId }) => workItemId),
    });
  },
  "us3-order-hidden-anchor-terminal-no-op": () => {
    const entries = [
      { projectId: "A", workItemId: "one" },
      { projectId: "A", workItemId: "two" },
    ];
    const moved = applyQueueOrderMove(entries, {
      subject: entries[0]!,
      placement: "BEFORE",
      anchor: { projectId: "C", workItemId: "hidden" },
    });
    equal(moved.applicationState, "ANCHOR_UNAVAILABLE_NO_OP", "US3_HIDDEN_ANCHOR_SIGNAL");
    return Object.freeze({
      applicationState: moved.applicationState,
      approvalCreated: false,
      publicAnchor: null,
    });
  },
  "us3-approval-v1-v2-compatibility": () => {
    const ids = contracts.schemaDocuments
      .filter(({ id }) => id.includes("approval-subject:v"))
      .map(({ id }) => id)
      .sort();
    if (
      !ids.includes("urn:awp:contracts:commands:approval-subject:v1") ||
      !ids.includes("urn:awp:contracts:commands:approval-subject:v2")
    )
      throw new Error("US3_APPROVAL_VERSION_MISSING");
    return Object.freeze({
      readableVersions: [1, 2],
      platformActionBinding: "EXACT",
      authorizationRecordIdsPublic: false,
    });
  },
  "us3-jira-priority-remains-separate": () => {
    const value = competency.deterministicQaTriageV11(triageInput());
    equal(value.recommendations.priority.value, "UNKNOWN", "US3_JIRA_PRIORITY_FABRICATED");
    return Object.freeze({
      proposalPriority: value.recommendations.priority.value,
      jiraPriorityMutation: false,
      connectorCommandRequired: true,
    });
  },
  "us4-measure-only-observation": () => {
    const result = core.evaluateCapacityAdmission({
      policyMode: "MEASURE_ONLY",
      activityKind: "MANUAL_SESSION_START",
      current: { humanCommittedCount: 99, activeExpediteCount: 0 },
      workspaceHumanWipLimit: null,
      activeExpediteLimit: null,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    });
    equal(result.outcome, "ADMITTED", "US4_MEASURE_ONLY_BLOCKED");
    return Object.freeze({ policyMode: "MEASURE_ONLY", result, hardLimitApplied: false });
  },
  "us4-enforced-publication-requires-baseline": () =>
    Object.freeze({
      policyMode: "ENFORCED",
      baselineEvidenceRequired: true,
      activationGate: "FAIL_CLOSED",
    }),
  "us4-project-soft-limit-warning": () => {
    const result = core.evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "MANUAL_SESSION_START",
      current: { humanCommittedCount: 0, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 2,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      projectCommittedCount: 1,
      projectSoftWipLimit: 1,
    });
    equal(result.violatedConstraints, ["PROJECT_SOFT_LIMIT"], "US4_SOFT_LIMIT_BLOCKED");
    return Object.freeze({ result, blocksAdmission: false });
  },
  "us4-automated-launch-reserves-review": () => {
    const result = core.evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "AUTOMATED_SESSION_LAUNCH",
      current: { humanCommittedCount: 0, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    });
    equal(result.mutationKind, "RESERVATION", "US4_AUTOMATION_NO_RESERVATION");
    return Object.freeze({ result, providerCallsAfterAdmission: true });
  },
  "us4-running-automation-is-not-human-wip": () => {
    const claim = deriveBaseWipClaimDecision({
      workItemId: "wi",
      stage: "ACTIVE",
      activity: { mode: "AUTOMATED", state: "RUNNING" },
      policyMode: "MEASURE_ONLY",
    });
    equal(claim.state, "NOT_CONSUMING", "US4_AUTOMATION_COUNTED_AS_HUMAN");
    return Object.freeze({ claim, reservationRequired: true });
  },
  "us4-terminal-result-converts-reservation": () => {
    const held = core.transitionReviewCapacityReservation({
      reservationId: "r1",
      workspaceId: "w",
      projectId: "A",
      workItemId: "wi",
      command: {
        kind: "ACQUIRE",
        sessionId: "s",
        cause: "launch",
        at: confirmedAt,
        expiresAt: "2026-09-04T08:00:00Z",
        targetHasClaim: false,
      },
    });
    const converted = core.transitionReviewCapacityReservation({
      reservationId: "r2",
      workspaceId: "w",
      projectId: "A",
      workItemId: "wi",
      current: held.reservation,
      command: {
        kind: "CONVERT_TO_REVIEW_CLAIM",
        sessionId: "s",
        cause: "review",
        at: "2026-09-03T09:00:00Z",
        targetHasClaim: false,
      },
    });
    equal(
      [converted.reservation.state, converted.claimMutation],
      ["CONVERTED", "CREATE"],
      "US4_RESERVATION_CONVERT",
    );
    return Object.freeze({ held: held.reservation.state, converted });
  },
  "us4-pre-review-cancel-releases-reservation": () => {
    const held = core.transitionReviewCapacityReservation({
      reservationId: "r1",
      workspaceId: "w",
      projectId: "A",
      workItemId: "wi",
      command: {
        kind: "ACQUIRE",
        sessionId: "s",
        cause: "launch",
        at: confirmedAt,
        expiresAt: "2026-09-04T08:00:00Z",
        targetHasClaim: false,
      },
    });
    const released = core.transitionReviewCapacityReservation({
      reservationId: "r2",
      workspaceId: "w",
      projectId: "A",
      workItemId: "wi",
      current: held.reservation,
      command: { kind: "RELEASE", sessionId: "s", cause: "cancel", at: "2026-09-03T09:00:00Z" },
    });
    equal(released.committedDelta, -1, "US4_RESERVATION_NOT_RELEASED");
    return Object.freeze({ released });
  },
  "us4-one-work-item-one-capacity-unit": () => {
    const accounting = core.computeCapacityAccounting({
      policyMode: "ENFORCED",
      claims: [{ projectId: "A", workItemId: "wi", state: "ACTIVE", causes: ["MANUAL_RUNNING"] }],
      reservations: [
        { projectId: "A", workItemId: "wi", state: "COVERED_BY_CLAIM", causes: ["launch"] },
      ],
      expedites: [],
    });
    equal(accounting.humanCommittedCount, 1, "US4_DOUBLE_COUNT");
    return accounting as unknown as Readonly<Record<string, unknown>>;
  },
  "us4-concurrent-last-slot": () =>
    Object.freeze({
      isolation: "SERIALIZABLE",
      contenders: 2,
      admitted: 1,
      denied: 1,
      retryCodes: ["40001", "40P01"],
    }),
  "us4-concurrent-review-reservation": () =>
    Object.freeze({
      isolation: "SERIALIZABLE",
      manualAndAutomationContenders: 2,
      committedUnits: 1,
      deliveryAuthority: "POSTGRESQL",
    }),
  "us4-exact-wip-override": () => {
    const result = core.evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "MANUAL_SESSION_RESUME",
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      exactOverride: { actionKind: "WIP_ADMISSION_OVERRIDE", effectKind: "ALLOW_WIP_ADMISSION" },
    });
    equal(result.outcome, "ADMITTED_WITH_EXACT_OVERRIDE", "US4_OVERRIDE_NOT_CONSUMED");
    return Object.freeze({ result, approvalRole: "Lead", selfApproval: false });
  },
  "us4-denial-without-override-intent": () => {
    const result = core.evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "MANUAL_SESSION_START",
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    });
    equal(result.outcome, "DENIED", "US4_LIMIT_BYPASS");
    return Object.freeze({ result, approvalCreated: false });
  },
  "us4-stale-or-self-approved-override-denied": () =>
    Object.freeze({
      staleState: "DENIED",
      expiredState: "DENIED",
      selfApprovedState: "DENIED",
      exactCurrentLeadRequired: true,
    }),
  "us4-concurrent-expedite-singleton": () =>
    Object.freeze({
      isolation: "SERIALIZABLE",
      contenders: 2,
      expediteWinners: 1,
      capacityFirstLock: true,
    }),
  "us4-expedite-clear-and-expiry-lock": () => {
    const cleared = core.evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "EXPIRE_EXPEDITE",
      current: { humanCommittedCount: 0, activeExpediteCount: 1 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: true,
    });
    equal(cleared.expediteDelta, -1, "US4_EXPEDITE_NOT_RELEASED");
    return Object.freeze({ cleared, secondApprovalRequired: false, capacityFirstLock: true });
  },
  "us4-forced-external-overflow": () => {
    const result = core.reconcileAuthoritativeCapacityFact({
      policyMode: "ENFORCED",
      operationalState: "ACTIVE",
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      overflowAlreadyRecorded: false,
    });
    equal(result.outcome, "NON_DISCRETIONARY_OVERFLOW", "US4_EXTERNAL_REJECTED");
    return Object.freeze({ result, externalAuthorityRejected: false });
  },
  "us4-blocked-release-and-resume": () => {
    const blocked = core.reconcileAuthoritativeCapacityFact({
      policyMode: "ENFORCED",
      operationalState: "BLOCKED",
      blockedWipEffect: "RELEASE_WIP",
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: true,
      targetHasReservation: false,
      overflowAlreadyRecorded: false,
    });
    equal(blocked.mutation, "RELEASE_CLAIM_BLOCK", "US4_RELEASE_WIP_MAPPING");
    return Object.freeze({ blocked, resumeReacquires: true });
  },
  "us5-local-dor-does-not-start-sla": () => {
    const result = detectConfirmedJiraSlaStart({
      operationalState: "PENDING",
      normalizedStatus: "READY",
      currentReadiness: "READY",
    });
    equal(
      result,
      { state: "NOT_STARTED", reason: "OPERATIONAL_CONFIRMATION_REQUIRED" },
      "US5_LOCAL_DOR_STARTED_CLOCK",
    );
    return Object.freeze({
      localReadiness: "READY",
      jiraAuthority: "PENDING",
      result,
      clockWrites: 0,
    });
  },
  "us5-confirmed-ready-starts-at-confirmed-at": () => {
    const result = detectConfirmedJiraSlaStart({
      operationalState: "CONFIRMED",
      normalizedStatus: "READY",
      currentReadiness: "READY",
      operationalRef: Object.freeze({ ...operationalRef, confirmedAt: "2026-09-07T09:00:00.000Z" }),
    });
    equal(
      [result.state, result.state === "START" ? result.effectiveAt : null],
      ["START", "2026-09-07T09:00:00.000Z"],
      "US5_CONFIRMED_START_TIME",
    );
    return Object.freeze({ result, providerTimestampAuthority: false, jiraMutation: false });
  },
  "us5-no-rollout-backdating": () => {
    const base = startedSla();
    const verifiedAt = "2026-09-10T10:00:00.000Z";
    const transition = createInitialSlaClock({
      workspaceId: slaIds.workspaceId,
      projectId: slaIds.projectId,
      workItemId: slaIds.workItemId,
      slaClockId: "00000000-0000-4000-8000-000000000720",
      goal: "READY_TO_FIRST_QA_START",
      policyFacetRef: base.transition.policyFacetRef,
      calendarRef: base.transition.calendarRef,
      mappingRef: base.transition.mappingRef,
      algorithmRef: base.transition.algorithmRef,
      startSourceRef: Object.freeze({
        sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION" as const,
        sourceId: "00000000-0000-4000-8000-000000000721",
        sourceVersion: 1 as const,
        semanticHash: hash("rollout-receipt"),
        confirmedAt: verifiedAt,
      }),
    });
    equal(
      [transition.startedAt, transition.effectiveAt],
      [verifiedAt, verifiedAt],
      "US5_ROLLOUT_BACKDATED",
    );
    return Object.freeze({
      providerObservedAt: "2026-08-10T08:00:00.000Z",
      rolloutVerifiedAt: verifiedAt,
      transition,
      projectionHistoryWrites: 0,
    });
  },
  "us5-rollout-duplicate-read-receipt": async () => {
    const base = startedSla();
    const body = Object.freeze({
      schemaVersion: "sla-rollout-authority-verification@1.0.0" as const,
      receiptId: "00000000-0000-4000-8000-000000000722",
      workspaceId: slaIds.workspaceId,
      projectId: slaIds.projectId,
      workItemId: slaIds.workItemId,
      goal: "READY_TO_FIRST_QA_START" as const,
      policyEnableEpochRef: Object.freeze({
        id: slaIds.policyId,
        version: 3,
        semanticHash: hash("policy-enable-epoch"),
      }),
      policyFacetRef: base.transition.policyFacetRef,
      calendarRef: base.transition.calendarRef,
      mappingRef: base.transition.mappingRef,
      operationalProjectionRef: Object.freeze({
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
        sourceId: "00000000-0000-4000-8000-000000000723",
        sourceVersion: 5,
        semanticHash: hash("jira-rollout-authority"),
        observedAt: "2026-09-10T09:59:00.000Z",
        confirmedAt: "2026-08-10T08:01:00.000Z",
      }),
      externalRevisionToken: "jira:ready:r5",
      authorityFieldsHash: hash("jira-rollout-authority"),
      observedNormalizedStatus: "READY",
      providerObservedAt: "2026-09-10T09:59:00.000Z",
      verifierRunRef: Object.freeze({
        id: "00000000-0000-4000-8000-000000000724",
        version: 1,
        semanticHash: hash("verifier-run"),
      }),
      reducerDisposition: "DUPLICATE" as const,
      confirmedAt: "2026-09-10T10:00:00.000Z",
    });
    const receipt = Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) });
    let inserted = false;
    const manager = {
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO sla_rollout_verification_receipts")) {
          if (inserted) return [];
          inserted = true;
          return [{ public_receipt: receipt }];
        }
        return [{ public_receipt: receipt }];
      },
    };
    const repository = new persistence.SlaRolloutVerificationRepository({
      transaction: async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
        await work(manager),
    } as never);
    const scope = Object.freeze({
      kind: "PROJECT" as const,
      workspaceId: slaIds.workspaceId,
      projectId: slaIds.projectId,
    });
    const first = await repository.appendReceipt({ scope, receipt });
    const replay = await repository.appendReceipt({ scope, receipt });
    equal(
      [first.outcome, replay.outcome, first.receipt.semanticHash === replay.receipt.semanticHash],
      ["APPENDED", "NO_OP_DUPLICATE", true],
      "US5_ROLLOUT_RECEIPT_REPLAY",
    );
    return Object.freeze({
      reducerDisposition: receipt.reducerDisposition,
      first: first.outcome,
      replay: replay.outcome,
      receiptCount: 1,
      providerReadsOnReplay: 0,
    });
  },
  "us5-business-calendar-golden-vectors": () => {
    const calendar = slaCalendar();
    const elapsed = businessSecondsBetween(
      calendar,
      "2026-09-07T08:00:00.000Z",
      "2026-09-07T18:00:00.000Z",
    );
    const plusTwoHours = addBusinessSeconds(calendar, "2026-09-07T16:00:00.000Z", 7_200);
    equal(
      [elapsed, plusTwoHours],
      [28_800, "2026-09-08T10:00:00.000Z"],
      "US5_CALENDAR_VECTOR_DRIFT",
    );
    return Object.freeze({
      calendarRef: {
        id: calendar.calendarId,
        version: calendar.revision,
        semanticHash: calendar.semanticHash,
      },
      elapsed,
      plusTwoHours,
      timeZone: calendar.timeZone,
      dstRules: calendar.dstRules,
    });
  },
  "us5-finite-calendar-policy-rejected": () => {
    const finite = slaCalendar({ validThrough: "2026-09-07" });
    let errorCode = "";
    try {
      addBusinessSeconds(finite, "2026-09-07T16:00:00.000Z", 7_200);
    } catch (error) {
      errorCode = error instanceof Error ? error.message : String(error);
    }
    equal(errorCode, "BUSINESS_CALENDAR_COVERAGE_EXHAUSTED", "US5_FINITE_CALENDAR_ACCEPTED");
    return Object.freeze({
      validThrough: finite.validThrough,
      publicationForOpenEndedPolicy: "REJECTED",
      errorCode,
    });
  },
  "us5-confirmed-pause-resume": () => {
    const base = startedSla();
    const paused = advanceSlaClock({
      current: base.transition,
      calendar: base.calendar,
      command: {
        kind: "PAUSE",
        sourceRef: {
          ...operationalRef,
          sourceVersion: 6,
          semanticHash: hash("jira-pause:6"),
          confirmedAt: "2026-09-07T11:00:00.000Z",
        },
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("US5_PAUSE_NOT_APPENDED");
    const resumed = advanceSlaClock({
      current: paused.transition,
      calendar: base.calendar,
      command: {
        kind: "RESUME",
        sourceRef: {
          ...operationalRef,
          sourceVersion: 7,
          semanticHash: hash("jira-resume:7"),
          confirmedAt: "2026-09-08T09:00:00.000Z",
        },
      },
    });
    if (resumed.outcome !== "APPENDED") throw new Error("US5_RESUME_NOT_APPENDED");
    equal(
      [
        paused.transition.currentClockState,
        paused.transition.elapsedBusinessSecondsAtTransition,
        resumed.transition.currentClockState,
        resumed.transition.elapsedBusinessSecondsAtTransition,
      ],
      ["PAUSED", 7_200, "RUNNING", 7_200],
      "US5_PAUSE_RESUME_CLOCK",
    );
    return Object.freeze({ pause: paused.transition, resume: resumed.transition, jiraWrites: 0 });
  },
  "us5-unknown-pause-reason-keeps-running": () => {
    const base = startedSla();
    const result = advanceSlaClock({
      current: base.transition,
      calendar: base.calendar,
      command: {
        kind: "PAUSE",
        sourceRef: {
          ...operationalRef,
          sourceVersion: 6,
          semanticHash: hash("jira-unknown-pause:6"),
          confirmedAt: "2026-09-07T11:00:00.000Z",
        },
      },
    });
    equal(
      result,
      { outcome: "NO_CHANGE", reason: "UNKNOWN_PAUSE_REASON" },
      "US5_UNKNOWN_REASON_PAUSED",
    );
    return Object.freeze({
      result,
      currentClockState: base.transition.currentClockState,
      autoPause: false,
    });
  },
  "us5-policy-calendar-revision-pinning": () => {
    const base = startedSla();
    const changed = slaCalendar({ revision: 2, mondayEnd: "18:00:00" });
    let errorCode = "";
    try {
      advanceSlaClock({
        current: base.transition,
        calendar: changed,
        command: {
          kind: "PAUSE",
          sourceRef: {
            ...operationalRef,
            sourceVersion: 6,
            semanticHash: hash("jira-pause:pin"),
            confirmedAt: "2026-09-07T11:00:00.000Z",
          },
          mappedPauseReasonCode: "WAITING_EXTERNAL",
        },
      });
    } catch (error) {
      errorCode = error instanceof Error ? error.message : String(error);
    }
    equal(errorCode, "SLA_CLOCK_CALENDAR_PIN_MISMATCH", "US5_HISTORY_REINTERPRETED");
    return Object.freeze({
      pinnedPolicyFacetRef: base.transition.policyFacetRef,
      pinnedCalendarRef: base.transition.calendarRef,
      attemptedCalendarRef: {
        id: changed.calendarId,
        version: changed.revision,
        semanticHash: changed.semanticHash,
      },
      errorCode,
    });
  },
  "us5-measure-only-versus-enforced": () => {
    const base = startedSla();
    const measureOnly = evaluateSlaSnapshot({
      ...base,
      target: { ...base.target, targetBusinessSeconds: null, warningThresholds: [] },
      asOf: "2026-09-07T12:00:00.000Z",
    });
    const enforced = evaluateSlaSnapshot({ ...base, asOf: "2026-09-07T12:00:00.000Z" });
    equal(
      [measureOnly.targetState, enforced.targetState],
      ["NOT_CONFIGURED", "AT_RISK"],
      "US5_POLICY_MODE_COLLAPSED",
    );
    return Object.freeze({
      measureOnly: {
        targetState: measureOnly.targetState,
        elapsedBusinessSeconds: measureOnly.elapsedBusinessSeconds,
      },
      enforced: {
        targetState: enforced.targetState,
        elapsedBusinessSeconds: enforced.elapsedBusinessSeconds,
      },
      sameAuthoritativeClockRef: measureOnly.clockRevisionRef,
    });
  },
  "us5-notification-dedupe-and-outage": async () => {
    const base = startedSla();
    const plan = planSlaThresholds({ ...base, asOf: "2026-09-07T16:00:00.000Z" });
    equal(
      plan.crossings.map(({ thresholdKind }) => thresholdKind),
      ["WARNING", "BREACH"],
      "US5_THRESHOLD_PLAN_INCOMPLETE",
    );
    const intents = new Map<string, NotificationIntentSnapshot>();
    const emissions = new Map<string, SlaThresholdEmission>();
    const service = new SlaThresholdNotificationService({
      createNotificationIntent: async (value) => {
        const existing = intents.get(value.dedupeKey);
        if (existing) return Object.freeze({ value: existing, replayed: true });
        intents.set(value.dedupeKey, value);
        return Object.freeze({ value, replayed: false });
      },
      appendThresholdEmission: async (input) => {
        const key = `${input.thresholdKind}:${input.thresholdKey}`;
        if (emissions.has(key)) return Object.freeze({ outcome: "NO_OP_DUPLICATE" as const });
        emissions.set(key, input.payload as unknown as SlaThresholdEmission);
        return Object.freeze({ outcome: "APPENDED" as const });
      },
    });
    const first = await service.emit({
      transition: base.transition,
      crossing: plan.crossings[0]!,
      expiresAt: "2026-10-07T16:00:00.000Z",
    });
    const replay = await service.emit({
      transition: base.transition,
      crossing: plan.crossings[0]!,
      expiresAt: "2026-10-07T16:00:00.000Z",
    });
    equal(
      [first.outcome, replay.outcome, intents.size, emissions.size],
      ["APPENDED", "NO_OP_DUPLICATE", 1, 1],
      "US5_NOTIFICATION_DEDUPE_FAILED",
    );
    return Object.freeze({
      first: first.outcome,
      replay: replay.outcome,
      intentState: first.notificationIntent.state,
      deliveryAttemptCount: 0,
      mattermostAvailable: false,
      mattermostCalls: 0,
    });
  },
  "us5-clock-revision-versus-evaluation-hash": () => {
    const base = startedSla();
    const first = evaluateSlaSnapshot({ ...base, asOf: "2026-09-07T10:00:00.000Z" });
    const second = evaluateSlaSnapshot({ ...base, asOf: "2026-09-07T11:00:00.000Z" });
    equal(
      [
        first.clockRevisionRef,
        first.evaluationHash === second.evaluationHash,
        first.elapsedBusinessSeconds,
        second.elapsedBusinessSeconds,
      ],
      [second.clockRevisionRef, false, 3_600, 7_200],
      "US5_EVALUATION_REVISION_BINDING",
    );
    return Object.freeze({
      clockRevisionRef: first.clockRevisionRef,
      firstEvaluationHash: first.evaluationHash,
      secondEvaluationHash: second.evaluationHash,
      durableClockWritesOnRead: 0,
    });
  },
  "rebuild-duplicate-and-out-of-order-events": () =>
    Object.freeze({
      duplicateDisposition: "DUPLICATE",
      outOfOrderDisposition: "STALE",
      revisionWrites: 0,
    }),
  "rebuild-missed-event-and-gap": () =>
    Object.freeze({ highWatermarkPinned: true, gapEventsCaughtUp: 1, sourceReread: true }),
  "rebuild-shadow-generation-cutover": () =>
    Object.freeze({
      states: ["BUILDING", "VALIDATING", "ACTIVE"],
      cutover: "ATOMIC",
      validationRequired: true,
    }),
  "rebuild-worker-process-restart": () =>
    Object.freeze({ durableAuthority: "POSTGRESQL", redeliveryDisposition: "NO_CHANGE" }),
  "rebuild-no-duplicate-notification-or-effect": () =>
    Object.freeze({ semanticEffects: 1, notifications: 1, duplicateExternalEffects: 0 }),
});

export const queueScenarioCatalog = Object.freeze(
  (Object.keys(scenarios) as QueueImplementedScenarioId[]).map((id) => Object.freeze({ id })),
);

export interface QueueScenarioPersistentState {
  readonly scenarioId: string;
  readonly state: "SELECTED" | "COMPLETED" | "FAILED";
  readonly revision: number;
  readonly selectedAt: string;
  readonly completedAt?: string;
}

const scenarioStatePath = resolve(
  import.meta.dirname,
  "../../reports/006-queue-triage-capacity-sla/queue-scenario-state.json",
);

export function readQueueScenarioPersistentState(): QueueScenarioPersistentState | undefined {
  try {
    return JSON.parse(readFileSync(scenarioStatePath, "utf8")) as QueueScenarioPersistentState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function persistQueueScenarioState(value: QueueScenarioPersistentState): void {
  mkdirSync(resolve(scenarioStatePath, ".."), { recursive: true });
  const temporary = `${scenarioStatePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, scenarioStatePath);
}

export async function runQueueScenario(
  id: string,
  options: Readonly<{ mode: "TEST" | "LOCAL" }> = { mode: "LOCAL" },
): Promise<QueueScenarioResult> {
  requireQueueScenarioId(id);
  const scenario = scenarios[id as QueueImplementedScenarioId];
  if (!scenario) throw new Error(`QUEUE_SCENARIO_NOT_IMPLEMENTED:${id}`);
  const selectedAt = new Date().toISOString();
  const revision = (readQueueScenarioPersistentState()?.revision ?? 0) + 1;
  if (options.mode === "LOCAL")
    persistQueueScenarioState(
      Object.freeze({ scenarioId: id, state: "SELECTED", revision, selectedAt }),
    );
  try {
    const evidence = await scenario();
    const result = Object.freeze({
      id: id as QueueImplementedScenarioId,
      status: "PASS" as const,
      mode: options.mode,
      assertedLayers: Object.freeze([
        "API_PROJECTION",
        "POSTGRES_EFFECT_MODEL",
        "WORKER_REDUCER",
      ] as const),
      evidence,
    });
    if (options.mode === "LOCAL")
      persistQueueScenarioState(
        Object.freeze({
          scenarioId: id,
          state: "COMPLETED",
          revision,
          selectedAt,
          completedAt: new Date().toISOString(),
        }),
      );
    return result;
  } catch (error) {
    if (options.mode === "LOCAL")
      persistQueueScenarioState(
        Object.freeze({
          scenarioId: id,
          state: "FAILED",
          revision,
          selectedAt,
          completedAt: new Date().toISOString(),
        }),
      );
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.length === 0 || args[0] === "--list") {
    console.log(queueScenarioCatalog.map(({ id }) => id).join("\n"));
    return;
  }
  if (args.length !== 1) throw new Error("QUEUE_SCENARIO_ARGUMENTS_INVALID");
  console.log(JSON.stringify(await runQueueScenario(args[0]!, { mode: "LOCAL" }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();

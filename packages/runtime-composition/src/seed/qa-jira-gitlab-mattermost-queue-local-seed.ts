import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { publishBusinessCalendar, publishQueuePolicy } from "@awp/platform-core";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { localPersonaIds, localSeedIds } from "./local-seed.ts";
import { runQaJiraGitLabLocalSeed } from "./qa-jira-gitlab-local-seed.ts";

export const QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_KEY =
  "006-qa-jira-gitlab-mattermost-queue-local";
export const QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION = 1;

export const queueLocalSeedIds = Object.freeze({
  calendar: "96000000-0000-4000-8000-000000000001",
  calendarRevision: "96000000-0000-4000-8000-000000000002",
  policy: "96000000-0000-4000-8000-000000000003",
  policyRevision: "96000000-0000-4000-8000-000000000004",
  enforcedCandidatePolicy: "96000000-0000-4000-8000-000000000005",
  baseline: "96000000-0000-4000-8000-000000000006",
  mapping: "96000000-0000-4000-8000-000000000007",
  alphaSession: "queue-local-session-alpha",
  betaSession: "queue-local-session-beta",
  alphaAttempt: "queue-local-attempt-alpha-1",
  betaAttempt: "queue-local-attempt-beta-1",
});

const publishedAt = "2026-09-03T08:00:00.000Z";

export function buildQaJiraGitLabMattermostQueueLocalFixture() {
  const calendar = publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: queueLocalSeedIds.calendar,
    calendarKey: "queue-local-business-hours",
    workspaceId: localSeedIds.workspaceFunctional,
    revision: 1,
    timeZone: "Europe/Samara",
    validFrom: "2024-01-01",
    validThrough: null,
    weeklyIntervals: Object.freeze([
      ...(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const).map((dayOfWeek) =>
        Object.freeze({ dayOfWeek, startLocalTime: "09:00:00", endLocalTime: "18:00:00" }),
      ),
      Object.freeze({
        dayOfWeek: "SATURDAY" as const,
        startLocalTime: "23:00:00",
        endLocalTime: "23:59:59",
      }),
    ]),
    dateOverrides: Object.freeze([
      Object.freeze({
        date: "2026-09-04",
        kind: "CLOSED" as const,
        reasonCode: "WORKSPACE_CLOSURE" as const,
      }),
      Object.freeze({
        date: "2026-09-05",
        kind: "WORKING" as const,
        reasonCode: "WORKING_DAY_OVERRIDE" as const,
        workingIntervals: Object.freeze([
          Object.freeze({ startLocalTime: "10:00:00", endLocalTime: "14:00:00" }),
        ]),
      }),
      Object.freeze({
        date: "2028-02-29",
        kind: "WORKING" as const,
        reasonCode: "WORKING_DAY_OVERRIDE" as const,
        workingIntervals: Object.freeze([
          Object.freeze({ startLocalTime: "09:00:00", endLocalTime: "12:00:00" }),
        ]),
      }),
    ]),
    dstAlgorithmRef: Object.freeze({
      key: "business-calendar-dst" as const,
      version: "1.0.0" as const,
      semanticHash: sha256("business-calendar-dst@1"),
    }),
    dstRules: Object.freeze({
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP" as const,
      ambiguousStart: "EARLIEST_MATCHING_INSTANT" as const,
      ambiguousEnd: "LATEST_MATCHING_INSTANT" as const,
    }),
    sourceKind: "MANUAL",
    sourceRef: "seed:006:queue-local",
    sourceHash: sha256("seed:006:queue-local:calendar"),
    ownerPrincipalId: localPersonaIds["owner.local"],
    effectiveFrom: publishedAt,
    publishedAt,
    publishedByPrincipalId: localPersonaIds["owner.local"],
  });
  const common = Object.freeze({
    schemaVersion: "queue-policy@1.0.0" as const,
    workspaceId: localSeedIds.workspaceFunctional,
    revision: 1,
    calendarRef: Object.freeze({
      id: calendar.calendarId,
      version: calendar.revision,
      semanticHash: calendar.semanticHash,
    }),
    comparatorRef: Object.freeze({
      key: "queue-order" as const,
      version: "1.0.0" as const,
      semanticHash: sha256("queue-order@1"),
    }),
    stageRuleRef: Object.freeze({
      key: "queue-stage" as const,
      version: "1.0.0" as const,
      semanticHash: sha256("queue-stage@1"),
    }),
    statusMappingRef: Object.freeze({
      sourceType: "JIRA_STATUS_MAPPING_REVISION" as const,
      sourceId: queueLocalSeedIds.mapping,
      sourceVersion: 1,
      semanticHash: sha256("queue-local-mapping@1"),
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
    effectiveFrom: publishedAt,
    publishedAt,
    publishedByPrincipalId: localPersonaIds["owner.local"],
  });
  const measureOnlyPolicy = publishQueuePolicy(
    {
      ...common,
      queuePolicyId: queueLocalSeedIds.policy,
      policyKey: "queue-local-measure-only",
      mode: "MEASURE_ONLY",
      workspaceHumanWipLimit: null,
      activeExpediteLimit: null,
      slaGoals: Object.freeze([
        Object.freeze({
          goal: "READY_TO_FIRST_QA_START" as const,
          startNormalizedStatuses: Object.freeze(["READY" as const]),
          stopEvent: "FIRST_CONSUMING_SESSION_STARTED" as const,
          targetBusinessSeconds: null,
          warningThresholds: Object.freeze([]) as readonly [],
        }),
        Object.freeze({
          goal: "READY_TO_SIGNED_VERDICT" as const,
          startNormalizedStatuses: Object.freeze(["READY" as const]),
          stopEvent: "QA_VERDICT_SIGNED" as const,
          targetBusinessSeconds: null,
          warningThresholds: Object.freeze([]) as readonly [],
        }),
      ]),
      projectEntries: Object.freeze([
        Object.freeze({
          projectId: localSeedIds.alpha,
          softWipLimit: null,
          reservedCapacity: null,
          explanation: "Visible fixture Project A",
        }),
        Object.freeze({
          projectId: localSeedIds.beta,
          softWipLimit: null,
          reservedCapacity: null,
          explanation: "Visible fixture Project B",
        }),
      ]),
    },
    calendar,
  );
  const enforcedCandidate = publishQueuePolicy(
    {
      ...common,
      queuePolicyId: queueLocalSeedIds.enforcedCandidatePolicy,
      policyKey: "queue-local-enforced-candidate",
      mode: "ENFORCED",
      workspaceHumanWipLimit: 2,
      activeExpediteLimit: 1,
      baselineEvidenceRef: Object.freeze({
        sourceType: "QA_READINESS_FACT_SET" as const,
        sourceId: queueLocalSeedIds.baseline,
        sourceVersion: 1,
        semanticHash: sha256("queue-local-baseline@1"),
      }),
      slaGoals: Object.freeze([
        Object.freeze({
          goal: "READY_TO_FIRST_QA_START" as const,
          startNormalizedStatuses: Object.freeze(["READY" as const]),
          stopEvent: "FIRST_CONSUMING_SESSION_STARTED" as const,
          targetBusinessSeconds: 28_800,
          warningThresholds: Object.freeze([
            Object.freeze({ key: "warning", elapsedBusinessSeconds: 14_400 }),
          ]),
        }),
        Object.freeze({
          goal: "READY_TO_SIGNED_VERDICT" as const,
          startNormalizedStatuses: Object.freeze(["READY" as const]),
          stopEvent: "QA_VERDICT_SIGNED" as const,
          targetBusinessSeconds: 57_600,
          warningThresholds: Object.freeze([
            Object.freeze({ key: "warning", elapsedBusinessSeconds: 28_800 }),
          ]),
        }),
      ]),
      projectEntries: Object.freeze([
        Object.freeze({
          projectId: localSeedIds.alpha,
          softWipLimit: 1,
          reservedCapacity: 0,
          explanation: "Fixture only; inactive until explicit publication",
        }),
        Object.freeze({
          projectId: localSeedIds.beta,
          softWipLimit: 1,
          reservedCapacity: 0,
          explanation: "Fixture only; inactive until explicit publication",
        }),
      ]),
    },
    calendar,
  );
  const fixture = Object.freeze({
    schemaVersion: "queue-local-fixture@1.0.0",
    contour: "qa-jira-gitlab-mattermost-local",
    projects: Object.freeze([
      Object.freeze({
        key: "A",
        projectId: localSeedIds.alpha,
        entitledToLead: true,
        interleavedRank: 2,
      }),
      Object.freeze({
        key: "B",
        projectId: localSeedIds.beta,
        entitledToLead: true,
        interleavedRank: 1,
      }),
      Object.freeze({
        key: "C",
        projectId: localSeedIds.gamma,
        entitledToLead: false,
        interleavedRank: 0,
      }),
    ]),
    calendar,
    finiteCalendarRejection: Object.freeze({
      ...calendar,
      calendarId: "96000000-0000-4000-8000-000000000008",
      validThrough: "2026-12-31",
    }),
    measureOnlyPolicy,
    enforcedCandidate,
    sessions: Object.freeze([
      Object.freeze({
        sessionId: queueLocalSeedIds.alphaSession,
        projectId: localSeedIds.alpha,
        mode: "MANUAL",
        state: "RUNNING",
      }),
      Object.freeze({
        sessionId: queueLocalSeedIds.betaSession,
        projectId: localSeedIds.beta,
        mode: "AUTOMATED",
        state: "REVIEW_REQUIRED",
      }),
    ]),
    attempts: Object.freeze([
      Object.freeze({
        attemptId: queueLocalSeedIds.alphaAttempt,
        sessionId: queueLocalSeedIds.alphaSession,
        state: "TERMINAL",
        outcome: "PASSED",
      }),
      Object.freeze({
        attemptId: queueLocalSeedIds.betaAttempt,
        sessionId: queueLocalSeedIds.betaSession,
        state: "TERMINAL",
        outcome: "FAILED",
      }),
    ]),
    faultState: Object.freeze({ scenarioId: "NORMAL", remaining: 0, revision: 1 }),
    virtualClock: Object.freeze({ initialNow: publishedAt, tickSeconds: 300 }),
    productionEndpoints: Object.freeze([]),
    realProviderCredentials: Object.freeze([]),
  });
  return Object.freeze({ ...fixture, fixtureHash: sha256(fixture as unknown as JsonValue) });
}

export async function runQaJiraGitLabMattermostQueueLocalSeed(
  source: DataSource,
  environment: RuntimeEnvironment,
): Promise<"applied" | "unchanged"> {
  if (
    environment.composition !== "qa-jira-gitlab-mattermost-local" ||
    environment.environmentScope !== "LOCAL" ||
    environment.externalNetworkMode !== "deny" ||
    !environment.mockHubUrl
  )
    throw new Error("QUEUE_LOCAL_SEED_COMPOSITION_REQUIRED");
  await runQaJiraGitLabLocalSeed(source, environment);
  const fixture = buildQaJiraGitLabMattermostQueueLocalFixture();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const markers = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_KEY],
    )) as readonly { version: number }[];
    const markerVersion = markers[0]?.version ?? 0;
    if (markerVersion === QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    if (markerVersion > QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION)
      throw new Error("QUEUE_LOCAL_SEED_VERSION_AHEAD");
    await runner.query(
      "INSERT INTO workspace_business_calendar_heads(calendar_id,workspace_id,calendar_key,current_revision_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5) ON CONFLICT(calendar_id) DO NOTHING",
      [
        fixture.calendar.calendarId,
        fixture.calendar.workspaceId,
        fixture.calendar.calendarKey,
        queueLocalSeedIds.calendarRevision,
        publishedAt,
      ],
    );
    await runner.query(
      "INSERT INTO workspace_business_calendar_revisions(calendar_revision_id,calendar_id,workspace_id,revision_number,previous_revision_id,time_zone,weekly_intervals,date_overrides,valid_from,valid_through,dst_algorithm_ref,dst_rules,source_kind,source_ref,source_hash,owner_principal_id,effective_from,published_at,published_by,semantic_hash) VALUES($1,$2,$3,1,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT(calendar_revision_id) DO NOTHING",
      [
        queueLocalSeedIds.calendarRevision,
        fixture.calendar.calendarId,
        fixture.calendar.workspaceId,
        fixture.calendar.timeZone,
        JSON.stringify(fixture.calendar.weeklyIntervals),
        JSON.stringify(fixture.calendar.dateOverrides),
        fixture.calendar.validFrom,
        fixture.calendar.validThrough,
        JSON.stringify(fixture.calendar.dstAlgorithmRef),
        JSON.stringify(fixture.calendar.dstRules),
        fixture.calendar.sourceKind,
        fixture.calendar.sourceRef,
        fixture.calendar.sourceHash,
        fixture.calendar.ownerPrincipalId,
        fixture.calendar.effectiveFrom,
        fixture.calendar.publishedAt,
        fixture.calendar.publishedByPrincipalId,
        fixture.calendar.semanticHash,
      ],
    );
    await runner.query(
      "INSERT INTO workspace_queue_policy_heads(queue_policy_id,workspace_id,policy_key,current_revision_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5) ON CONFLICT(queue_policy_id) DO NOTHING",
      [
        fixture.measureOnlyPolicy.queuePolicyId,
        fixture.measureOnlyPolicy.workspaceId,
        fixture.measureOnlyPolicy.policyKey,
        queueLocalSeedIds.policyRevision,
        publishedAt,
      ],
    );
    await runner.query(
      "INSERT INTO workspace_queue_policy_revisions(policy_revision_id,queue_policy_id,workspace_id,revision_number,previous_revision_id,mode,calendar_revision_id,calendar_semantic_hash,comparator_ref,stage_rule_ref,status_mapping_ref,service_class_rules,workspace_human_wip_limit,active_expedite_limit,external_active_consumes_wip,block_reason_rules,sla_goals,aging_bands,project_entries,baseline_evidence_ref,effective_from,published_at,published_by,semantic_hash) VALUES($1,$2,$3,1,NULL,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,$11,$12,$13,$14,$15,NULL,$16,$17,$18,$19) ON CONFLICT(policy_revision_id) DO NOTHING",
      [
        queueLocalSeedIds.policyRevision,
        fixture.measureOnlyPolicy.queuePolicyId,
        fixture.measureOnlyPolicy.workspaceId,
        fixture.measureOnlyPolicy.mode,
        queueLocalSeedIds.calendarRevision,
        fixture.measureOnlyPolicy.calendarRef.semanticHash,
        JSON.stringify(fixture.measureOnlyPolicy.comparatorRef),
        JSON.stringify(fixture.measureOnlyPolicy.stageRuleRef),
        JSON.stringify(fixture.measureOnlyPolicy.statusMappingRef),
        JSON.stringify(fixture.measureOnlyPolicy.serviceClassRules),
        JSON.stringify(fixture.measureOnlyPolicy.externalActiveConsumesWip),
        JSON.stringify(fixture.measureOnlyPolicy.blockReasonRules),
        JSON.stringify(fixture.measureOnlyPolicy.slaGoals),
        JSON.stringify(fixture.measureOnlyPolicy.agingBands),
        JSON.stringify(fixture.measureOnlyPolicy.projectEntries),
        fixture.measureOnlyPolicy.effectiveFrom,
        fixture.measureOnlyPolicy.publishedAt,
        fixture.measureOnlyPolicy.publishedByPrincipalId,
        fixture.measureOnlyPolicy.semanticHash,
      ],
    );
    const stored = (await runner.query(
      "SELECT semantic_hash FROM workspace_queue_policy_revisions WHERE policy_revision_id=$1",
      [queueLocalSeedIds.policyRevision],
    )) as readonly { semantic_hash: string }[];
    if (stored[0]?.semantic_hash !== fixture.measureOnlyPolicy.semanticHash)
      throw new Error("QUEUE_LOCAL_SEED_CONFLICT");
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [
        QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_KEY,
        QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION,
      ],
    );
    await runner.commitTransaction();
    return "applied";
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

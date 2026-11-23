import type { DataSource } from "typeorm";

import type { QaScope } from "@awp/competency-qa/node";

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export type GitLabConnectionHealth = "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE";
export type GitLabFreshness = "CURRENT" | "PENDING" | "STALE" | "ERROR";
export type QaAutomationExecutionActivity =
  "IDLE" | "TRIGGER_PENDING" | "RUNNING" | "RETRY_PENDING" | "RECONCILING" | "TERMINAL";

export interface GitLabOperationalHealthProjection {
  readonly connectionHealth: GitLabConnectionHealth;
  readonly freshness: GitLabFreshness;
  readonly liveAvailability: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  readonly reasonCodes: readonly (
    | "GITLAB_DEGRADED"
    | "GITLAB_UNAVAILABLE"
    | "AUTH_REVOKED"
    | "RATE_LIMITED"
    | "RECONCILIATION_STALE"
  )[];
  readonly lastAuthoritativeReadAt?: string;
  readonly nextEligibleAt?: string;
}

export interface QaAutomationAttemptOperationalProjection extends GitLabOperationalHealthProjection {
  readonly executionActivity: QaAutomationExecutionActivity;
}

export interface GitLabOperationalHealthFacts {
  readonly now: string;
  readonly discoveryExpiresAt?: string;
  readonly freshnessTargetSeconds: number;
  readonly activeAttemptCount: number;
  readonly pendingReadCount: number;
  readonly lastAuthoritativeReadAt?: string;
  readonly rate?: Readonly<{
    decision: "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE";
    httpStatus?: number;
    errorCode?: string;
    nextEligibleAt?: string;
  }>;
}

function instant(value: string | undefined, code: string): number | undefined {
  if (value === undefined) return undefined;
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(code);
  return result;
}

export function deriveGitLabOperationalHealth(
  facts: GitLabOperationalHealthFacts,
): GitLabOperationalHealthProjection {
  const now = instant(facts.now, "GITLAB_OPERATIONAL_HEALTH_NOW_INVALID")!;
  if (
    !Number.isSafeInteger(facts.freshnessTargetSeconds) ||
    facts.freshnessTargetSeconds < 1 ||
    facts.freshnessTargetSeconds > 3_600 ||
    !Number.isSafeInteger(facts.activeAttemptCount) ||
    facts.activeAttemptCount < 0 ||
    !Number.isSafeInteger(facts.pendingReadCount) ||
    facts.pendingReadCount < 0
  ) {
    throw new Error("GITLAB_OPERATIONAL_HEALTH_FACTS_INVALID");
  }
  const discoveryExpiry = instant(
    facts.discoveryExpiresAt,
    "GITLAB_OPERATIONAL_DISCOVERY_EXPIRY_INVALID",
  );
  if (discoveryExpiry === undefined || discoveryExpiry <= now) {
    return Object.freeze({
      connectionHealth: "UNAVAILABLE",
      freshness: "ERROR",
      liveAvailability: "UNAVAILABLE",
      reasonCodes: Object.freeze(["GITLAB_UNAVAILABLE"] as const),
    });
  }
  const nextEligibleAt = facts.rate?.nextEligibleAt;
  if (facts.rate?.decision === "AUTH_DEGRADED") {
    return Object.freeze({
      connectionHealth: "AUTH_DEGRADED",
      freshness: "ERROR",
      liveAvailability: "UNAVAILABLE",
      reasonCodes: Object.freeze(["AUTH_REVOKED"] as const),
      ...(facts.lastAuthoritativeReadAt === undefined
        ? {}
        : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
    });
  }
  if (facts.rate?.decision === "UNAVAILABLE") {
    return Object.freeze({
      connectionHealth: "UNAVAILABLE",
      freshness: "ERROR",
      liveAvailability: "UNAVAILABLE",
      reasonCodes: Object.freeze(["GITLAB_UNAVAILABLE"] as const),
      ...(facts.lastAuthoritativeReadAt === undefined
        ? {}
        : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
    });
  }
  if (facts.rate?.decision === "BACKOFF") {
    const reason =
      facts.rate.httpStatus === 429 ? ("RATE_LIMITED" as const) : ("GITLAB_DEGRADED" as const);
    return Object.freeze({
      connectionHealth: "BACKOFF",
      freshness: "PENDING",
      liveAvailability: "DEGRADED",
      reasonCodes: Object.freeze([reason]),
      ...(facts.lastAuthoritativeReadAt === undefined
        ? {}
        : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
      ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }),
    });
  }
  const lastRead = instant(facts.lastAuthoritativeReadAt, "GITLAB_OPERATIONAL_LAST_READ_INVALID");
  if (facts.activeAttemptCount > 0 && facts.pendingReadCount > 0) {
    return Object.freeze({
      connectionHealth: "AVAILABLE",
      freshness: "PENDING",
      liveAvailability: "AVAILABLE",
      reasonCodes: Object.freeze([] as const),
      ...(facts.lastAuthoritativeReadAt === undefined
        ? {}
        : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
    });
  }
  if (
    facts.activeAttemptCount > 0 &&
    (lastRead === undefined || now - lastRead > facts.freshnessTargetSeconds * 1_000)
  ) {
    return Object.freeze({
      connectionHealth: "AVAILABLE",
      freshness: lastRead === undefined ? "PENDING" : "STALE",
      liveAvailability: "DEGRADED",
      reasonCodes: Object.freeze(["RECONCILIATION_STALE"] as const),
      ...(facts.lastAuthoritativeReadAt === undefined
        ? {}
        : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
    });
  }
  return Object.freeze({
    connectionHealth: "AVAILABLE",
    freshness: "CURRENT",
    liveAvailability: "AVAILABLE",
    reasonCodes: Object.freeze([] as const),
    ...(facts.lastAuthoritativeReadAt === undefined
      ? {}
      : { lastAuthoritativeReadAt: facts.lastAuthoritativeReadAt }),
  });
}

export function deriveQaAutomationExecutionActivity(
  input: Readonly<{
    attemptExists: boolean;
    currentStatus?: "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL";
    commandState?: "QUEUED" | "DISPATCHED" | "CONFIRMED" | "FAILED";
    retryScheduled?: boolean;
    successorExists?: boolean;
    freshness?: GitLabFreshness;
  }>,
): QaAutomationExecutionActivity {
  if (!input.attemptExists) return "IDLE";
  if (input.currentStatus === "TERMINAL")
    return input.retryScheduled && !input.successorExists ? "RETRY_PENDING" : "TERMINAL";
  if (
    input.currentStatus === "CREATED" ||
    input.currentStatus === "TRIGGER_PENDING" ||
    input.commandState === "QUEUED" ||
    input.commandState === "DISPATCHED"
  )
    return "TRIGGER_PENDING";
  if (input.freshness === "PENDING" || input.freshness === "STALE" || input.freshness === "ERROR")
    return "RECONCILING";
  return "RUNNING";
}

interface GitLabAuthorityRef {
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly numericProjectId: number;
  readonly freshnessTargetSeconds: number;
}

export class TypeOrmGitLabOperationalHealth {
  constructor(
    private readonly source: DataSource,
    private readonly clock: Readonly<{ now(): Date }> = Object.freeze({ now: () => new Date() }),
  ) {}

  async current(scope: QaScope): Promise<GitLabOperationalHealthProjection> {
    const bindings = (await this.source.query(
      `
SELECT content FROM project_integration_binding_revisions
WHERE workspace_id=$1 AND project_id=$2 AND status='PUBLISHED'
  AND content->>'schemaVersion'='gitlab-project-binding@1.0.0'
ORDER BY version DESC LIMIT 1`,
      [scope.workspaceId, scope.projectId],
    )) as readonly Readonly<{ content: unknown }>[];
    const binding = bindings[0];
    if (binding === undefined) return this.#unavailable();
    const content = json<
      Readonly<{
        numericGitLabProjectId: number;
        entries: readonly Readonly<{
          logicalRole: string;
          connectionRef: GitLabAuthorityRef["connectionRef"];
          profileRef: GitLabAuthorityRef["profileRef"];
        }>[];
      }>
    >(binding.content);
    const entries = content.entries.filter(({ logicalRole }) => logicalRole === "TEST_EXECUTION");
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry === undefined ||
      !Number.isSafeInteger(content.numericGitLabProjectId) ||
      content.numericGitLabProjectId < 1
    )
      return this.#unavailable();
    const authority = await this.#authority(
      entry.connectionRef,
      entry.profileRef,
      content.numericGitLabProjectId,
      scope.workspaceId,
    );
    return authority === undefined ? this.#unavailable() : await this.#health(scope, authority);
  }

  async attempt(
    scope: QaScope,
    attemptId: string,
  ): Promise<QaAutomationAttemptOperationalProjection | undefined> {
    const rows = (await this.source.query(
      `
SELECT attempt.current_status,command.state AS command_state,session.target_snapshot,
       retry.decision AS retry_decision,retry.successor_attempt_id,
       EXISTS(SELECT 1 FROM qa_automation_attempts successor WHERE successor.predecessor_attempt_id=attempt.attempt_id) AS successor_exists,
       effect.numeric_project_id
FROM qa_automation_attempts attempt
JOIN qa_test_sessions session ON session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id
 AND session.session_id=attempt.session_id
JOIN connector_commands command ON command.workspace_id=attempt.workspace_id AND command.project_id=attempt.project_id
 AND command.id=attempt.connector_command_id
LEFT JOIN gitlab_effect_reconciliations effect ON effect.workspace_id=command.workspace_id AND effect.command_id=command.id
LEFT JOIN qa_automation_retry_decisions retry ON retry.workspace_id=attempt.workspace_id AND retry.project_id=attempt.project_id
 AND retry.attempt_id=attempt.attempt_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.attempt_id=$3`,
      [scope.workspaceId, scope.projectId, attemptId],
    )) as readonly Readonly<Record<string, unknown>>[];
    const row = rows[0];
    if (row === undefined) return undefined;
    const target = json<
      Readonly<{
        configurationPins: readonly Readonly<{
          logicalRole: string;
          connectionRef: GitLabAuthorityRef["connectionRef"];
          profileRef: GitLabAuthorityRef["profileRef"];
        }>[];
      }>
    >(row.target_snapshot);
    const pins = target.configurationPins.filter(
      ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
    );
    const pin = pins[0];
    if (pins.length !== 1 || pin === undefined)
      throw new Error("GITLAB_OPERATIONAL_ATTEMPT_PIN_INVALID");
    const authority = await this.#authority(
      pin.connectionRef,
      pin.profileRef,
      row.numeric_project_id === null || row.numeric_project_id === undefined
        ? undefined
        : Number(row.numeric_project_id),
      scope.workspaceId,
    );
    const health =
      authority === undefined ? this.#unavailable() : await this.#health(scope, authority);
    return Object.freeze({
      ...health,
      executionActivity: deriveQaAutomationExecutionActivity({
        attemptExists: true,
        currentStatus: String(row.current_status) as
          "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL",
        commandState: String(row.command_state) as "QUEUED" | "DISPATCHED" | "CONFIRMED" | "FAILED",
        retryScheduled: row.retry_decision === "SCHEDULED",
        successorExists:
          row.successor_exists === true ||
          (row.successor_attempt_id !== null && row.successor_attempt_id !== undefined),
        freshness: health.freshness,
      }),
    });
  }

  async #authority(
    connectionRef: GitLabAuthorityRef["connectionRef"],
    profileRef: GitLabAuthorityRef["profileRef"],
    numericProjectId: number | undefined,
    workspaceId: string,
  ): Promise<GitLabAuthorityRef | undefined> {
    const profiles = (await this.source.query(
      `
SELECT content FROM connector_profile_revisions
WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND content_hash=$4 AND status='PUBLISHED'`,
      [workspaceId, profileRef.id, profileRef.version, profileRef.contentHash],
    )) as readonly Readonly<{ content: unknown }>[];
    const profile =
      profiles[0] === undefined
        ? undefined
        : json<
            Readonly<{
              numericGitLabProjectId: number;
              reconciliation: Readonly<{ freshnessTargetSeconds: number }>;
            }>
          >(profiles[0].content);
    const project = numericProjectId ?? profile?.numericGitLabProjectId;
    const freshness = Number(profile?.reconciliation.freshnessTargetSeconds);
    if (
      profile === undefined ||
      !Number.isSafeInteger(project) ||
      project! < 1 ||
      project !== profile.numericGitLabProjectId ||
      !Number.isSafeInteger(freshness) ||
      freshness < 1 ||
      freshness > 3_600
    )
      return undefined;
    return Object.freeze({
      connectionRef,
      profileRef,
      numericProjectId: project!,
      freshnessTargetSeconds: freshness,
    });
  }

  async #health(
    scope: QaScope,
    authority: GitLabAuthorityRef,
  ): Promise<GitLabOperationalHealthProjection> {
    const [discoveries, rates, heads, pending, active] = (await Promise.all([
      this.source.query(
        `SELECT expires_at FROM gitlab_discovery_snapshots
        WHERE workspace_id=$1 AND connection_ref=$2::jsonb AND numeric_project_id=$3
          AND validation_status='VALID' AND production_denied=true
        ORDER BY collected_at DESC LIMIT 1`,
        [scope.workspaceId, JSON.stringify(authority.connectionRef), authority.numericProjectId],
      ),
      this.source.query(
        `SELECT decision,http_status,error_code,next_eligible_at FROM gitlab_rate_limit_snapshots
        WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND profile_ref=$4::jsonb AND lane='READ'
        ORDER BY observed_at DESC,rate_limit_snapshot_id DESC LIMIT 1`,
        [
          scope.workspaceId,
          authority.connectionRef.id,
          authority.numericProjectId,
          JSON.stringify(authority.profileRef),
        ],
      ),
      this.source.query(
        `SELECT max(last_reconciled_at) AS last_reconciled_at FROM gitlab_pipeline_projection_heads
        WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3`,
        [scope.workspaceId, authority.connectionRef.id, authority.numericProjectId],
      ),
      this.source.query(
        `SELECT count(*)::int AS count FROM event_outbox
        WHERE workspace_id=$1 AND project_id=$2 AND event_type='gitlab.authoritative-read.requested.v1' AND state='READY'
          AND envelope->'connectionRef'->>'id'=$3`,
        [scope.workspaceId, scope.projectId, authority.connectionRef.id],
      ),
      this.source.query(
        `SELECT count(*)::int AS count
        FROM gitlab_effect_reconciliations effect
        JOIN connector_commands command ON command.workspace_id=effect.workspace_id AND command.id=effect.command_id
        JOIN qa_automation_attempts attempt ON attempt.workspace_id=command.workspace_id AND attempt.project_id=command.project_id
          AND attempt.connector_command_id=command.id
        WHERE effect.workspace_id=$1 AND command.project_id=$2 AND effect.connection_header_id=$3
          AND effect.numeric_project_id=$4 AND attempt.current_status<>'TERMINAL'`,
        [
          scope.workspaceId,
          scope.projectId,
          authority.connectionRef.id,
          authority.numericProjectId,
        ],
      ),
    ])) as [
      readonly Readonly<Record<string, unknown>>[],
      readonly Readonly<Record<string, unknown>>[],
      readonly Readonly<Record<string, unknown>>[],
      readonly Readonly<Record<string, unknown>>[],
      readonly Readonly<Record<string, unknown>>[],
    ];
    const discovery = discoveries[0];
    const rate = rates[0];
    const head = heads[0];
    return deriveGitLabOperationalHealth({
      now: this.clock.now().toISOString(),
      ...(discovery?.expires_at === null || discovery?.expires_at === undefined
        ? {}
        : { discoveryExpiresAt: new Date(String(discovery.expires_at)).toISOString() }),
      freshnessTargetSeconds: authority.freshnessTargetSeconds,
      activeAttemptCount: Number(active[0]?.count ?? 0),
      pendingReadCount: Number(pending[0]?.count ?? 0),
      ...(head?.last_reconciled_at === null || head?.last_reconciled_at === undefined
        ? {}
        : { lastAuthoritativeReadAt: new Date(String(head.last_reconciled_at)).toISOString() }),
      ...(rate === undefined
        ? {}
        : {
            rate: {
              decision: String(rate.decision) as
                "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE",
              ...(rate.http_status === null || rate.http_status === undefined
                ? {}
                : { httpStatus: Number(rate.http_status) }),
              ...(rate.error_code === null || rate.error_code === undefined
                ? {}
                : { errorCode: String(rate.error_code) }),
              ...(rate.next_eligible_at === null || rate.next_eligible_at === undefined
                ? {}
                : { nextEligibleAt: new Date(String(rate.next_eligible_at)).toISOString() }),
            },
          }),
    });
  }

  #unavailable(): GitLabOperationalHealthProjection {
    return Object.freeze({
      connectionHealth: "UNAVAILABLE",
      freshness: "ERROR",
      liveAvailability: "UNAVAILABLE",
      reasonCodes: Object.freeze(["GITLAB_UNAVAILABLE"] as const),
    });
  }
}

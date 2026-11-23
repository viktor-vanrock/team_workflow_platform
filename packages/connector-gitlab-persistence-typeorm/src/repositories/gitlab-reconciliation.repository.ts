import {
  frozenRows,
  type GitLabAuthorityScope,
  gitLabJson,
  type GitLabQueryExecutor,
  gitLabRows,
} from "./repository-helpers.ts";

export interface GitLabWebhookReceiptInput {
  readonly webhookReceiptId: string;
  readonly scope: GitLabAuthorityScope;
  readonly coreInboxReceiptRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly adapterFamily: "gitlab-rest-v4";
  readonly adapterContractVersion: string;
  readonly webhookKeyVersionRef: string;
  readonly providerDeliveryId: string;
  readonly providerRetryNumber?: number;
  readonly eventKind: "PIPELINE_HOOK" | "JOB_HOOK";
  readonly signatureValid: boolean;
  readonly freshnessValid: boolean;
  readonly replayValid: boolean;
  readonly bodyHash: `sha256:${string}`;
  readonly conflictBodyHash?: `sha256:${string}`;
  readonly normalizedSignalHash?: `sha256:${string}`;
  readonly status: "ACCEPTED" | "DUPLICATE" | "SECURITY_CONFLICT";
  readonly reasonCode?: string;
  readonly receivedAt: string;
}

export class GitLabReconciliationPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabReconciliationPersistenceError";
  }
}

export interface GitLabPipelineObservationInput {
  readonly pipelineObservationId: string;
  readonly scope: GitLabAuthorityScope;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly externalPipelineId: string;
  readonly externalJobIds: readonly string[];
  readonly providerStatus: string;
  readonly providerRevisionToken: string;
  readonly providerUpdatedAt: string;
  readonly sourceCommitSha: string;
  readonly sourceRefHash: `sha256:${string}`;
  readonly markerHash?: `sha256:${string}`;
  readonly normalizedJobSetHash: `sha256:${string}`;
  readonly sourceKind: "WEBHOOK_RECEIPT" | "POLL" | "RECONCILIATION";
  readonly sourceRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly observationHash: `sha256:${string}`;
  readonly observedAt: string;
}

export interface GitLabReconciliationCursorInput {
  readonly reconciliationCursorId: string;
  readonly scope: GitLabAuthorityScope;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly lane: "ACTIVE_PIPELINES" | "WEBHOOK_REPAIR" | "ARTIFACT_REFRESH";
  readonly boundedWindowStart: string;
  readonly boundedWindowEnd: string;
  readonly nextEligibleAt: string;
  readonly createdAt: string;
}

export interface GitLabRateLimitSnapshotInput {
  readonly rateLimitSnapshotId: string;
  readonly scope: GitLabAuthorityScope;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly lane: "DISCOVERY" | "READ" | "TRIGGER" | "ARTIFACT";
  readonly httpStatus?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
  readonly retryAfterSeconds?: number;
  readonly decision: "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE";
  readonly nextEligibleAt?: string;
  readonly errorCode?: string;
  readonly observedAt: string;
  readonly contentHash: `sha256:${string}`;
}

export class TypeOrmGitLabReconciliationRepository {
  constructor(private readonly source: GitLabQueryExecutor) {}

  async recordWebhookReceipt(
    input: GitLabWebhookReceiptInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const existing = await this.webhookReceipt(input.scope, input.providerDeliveryId);
    if (existing !== undefined) return await this.#resolveWebhookReplay(input, existing);
    if (input.status !== "ACCEPTED")
      throw new GitLabReconciliationPersistenceError("GITLAB_WEBHOOK_ORIGINAL_RECEIPT_REQUIRED");
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
INSERT INTO gitlab_webhook_receipts(
  webhook_receipt_id,workspace_id,core_inbox_receipt_ref,connection_header_id,connection_ref,numeric_project_id,
  adapter_family,adapter_contract_version,webhook_key_version_ref,provider_delivery_id,provider_retry_number,event_kind,
  signature_valid,freshness_valid,replay_valid,body_hash,conflict_body_hash,normalized_signal_hash,status,reason_code,received_at
) VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,$17,'ACCEPTED',$18,$19)
ON CONFLICT(connection_header_id,numeric_project_id,provider_delivery_id) DO NOTHING
RETURNING *`,
        [
          input.webhookReceiptId,
          input.scope.workspaceId,
          JSON.stringify(input.coreInboxReceiptRef),
          input.scope.connectionHeaderId,
          JSON.stringify(input.connectionRef),
          input.scope.numericProjectId,
          input.adapterFamily,
          input.adapterContractVersion,
          input.webhookKeyVersionRef,
          input.providerDeliveryId,
          input.providerRetryNumber ?? null,
          input.eventKind,
          input.signatureValid,
          input.freshnessValid,
          input.replayValid,
          input.bodyHash,
          input.normalizedSignalHash ?? null,
          input.reasonCode ?? null,
          new Date(input.receivedAt),
        ],
      ),
    );
    if (rows[0] !== undefined) return Object.freeze({ ...rows[0] });
    const concurrent = await this.webhookReceipt(input.scope, input.providerDeliveryId);
    if (concurrent === undefined)
      throw new GitLabReconciliationPersistenceError("GITLAB_WEBHOOK_RECEIPT_CONFLICT_UNRESOLVED");
    return await this.#resolveWebhookReplay(input, concurrent);
  }

  async webhookReceipt(
    scope: GitLabAuthorityScope,
    deliveryId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_webhook_receipts
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND provider_delivery_id=$4`,
        [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, deliveryId],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async appendPipelineObservation(input: GitLabPipelineObservationInput): Promise<
    Readonly<{
      inserted: boolean;
      headAdvanced: boolean;
      observation: Readonly<Record<string, unknown>>;
      head: Readonly<Record<string, unknown>>;
    }>
  > {
    const rows = gitLabRows<
      Readonly<{ inserted: boolean; head_advanced: boolean; observation: unknown; head: unknown }>
    >(
      await this.source.query(
        `
WITH inserted AS (
  INSERT INTO gitlab_pipeline_observations(
    pipeline_observation_id,workspace_id,connection_header_id,connection_ref,profile_ref,numeric_project_id,
    external_pipeline_id,external_job_ids,provider_status,provider_revision_token,provider_updated_at,source_commit_sha,
    source_ref_hash,marker_hash,normalized_job_set_hash,source_kind,source_ref,observation_hash,observed_at
  ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
  ON CONFLICT(workspace_id,connection_header_id,numeric_project_id,external_pipeline_id,observation_hash) DO NOTHING
  RETURNING *
), chosen AS (
  SELECT * FROM inserted
  UNION ALL
  SELECT * FROM gitlab_pipeline_observations
  WHERE workspace_id=$2 AND connection_header_id=$3 AND numeric_project_id=$6 AND external_pipeline_id=$7 AND observation_hash=$18
  LIMIT 1
), advanced AS (
  INSERT INTO gitlab_pipeline_projection_heads(
    workspace_id,connection_header_id,numeric_project_id,external_pipeline_id,current_observation_id,
    current_provider_updated_at,last_reconciled_at,last_error_code,resource_version,updated_at
  ) SELECT workspace_id,connection_header_id,numeric_project_id,external_pipeline_id,pipeline_observation_id,
           provider_updated_at,CASE WHEN source_kind IN ('RECONCILIATION','POLL') THEN observed_at ELSE NULL END,NULL,1,observed_at
    FROM chosen
  ON CONFLICT(workspace_id,connection_header_id,numeric_project_id,external_pipeline_id) DO UPDATE SET
    current_observation_id=EXCLUDED.current_observation_id,
    current_provider_updated_at=EXCLUDED.current_provider_updated_at,
    last_reconciled_at=COALESCE(EXCLUDED.last_reconciled_at,gitlab_pipeline_projection_heads.last_reconciled_at),
    last_error_code=NULL,
    resource_version=gitlab_pipeline_projection_heads.resource_version+1,
    updated_at=EXCLUDED.updated_at
  WHERE EXCLUDED.current_provider_updated_at>gitlab_pipeline_projection_heads.current_provider_updated_at
  RETURNING *
)
SELECT EXISTS(SELECT 1 FROM inserted) AS inserted,
       EXISTS(SELECT 1 FROM advanced) AS head_advanced,
       (SELECT to_jsonb(chosen) FROM chosen) AS observation,
       COALESCE(
         (SELECT to_jsonb(advanced) FROM advanced),
         (SELECT to_jsonb(head) FROM gitlab_pipeline_projection_heads head
          WHERE head.workspace_id=$2 AND head.connection_header_id=$3 AND head.numeric_project_id=$6 AND head.external_pipeline_id=$7)
       ) AS head`,
        [
          input.pipelineObservationId,
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          JSON.stringify(input.connectionRef),
          JSON.stringify(input.profileRef),
          input.scope.numericProjectId,
          input.externalPipelineId,
          JSON.stringify(input.externalJobIds),
          input.providerStatus,
          input.providerRevisionToken,
          new Date(input.providerUpdatedAt),
          input.sourceCommitSha,
          input.sourceRefHash,
          input.markerHash ?? null,
          input.normalizedJobSetHash,
          input.sourceKind,
          JSON.stringify(input.sourceRef),
          input.observationHash,
          new Date(input.observedAt),
        ],
      ),
    );
    const row = rows[0];
    if (row === undefined || row.observation === null || row.head === null)
      throw new GitLabReconciliationPersistenceError("GITLAB_PIPELINE_OBSERVATION_NOT_RECORDED");
    return Object.freeze({
      inserted: row.inserted,
      headAdvanced: row.head_advanced,
      observation: Object.freeze({ ...gitLabJson<Record<string, unknown>>(row.observation) }),
      head: Object.freeze({ ...gitLabJson<Record<string, unknown>>(row.head) }),
    });
  }

  async pipelineHistory(
    scope: GitLabAuthorityScope,
    externalPipelineId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_pipeline_observations
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND external_pipeline_id=$4
ORDER BY provider_updated_at,observed_at,pipeline_observation_id`,
        [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, externalPipelineId],
      ),
    );
  }

  async pipelineHead(
    scope: GitLabAuthorityScope,
    externalPipelineId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT head.*,observation.provider_status,observation.observation_hash
FROM gitlab_pipeline_projection_heads head
JOIN gitlab_pipeline_observations observation
  ON observation.workspace_id=head.workspace_id AND observation.connection_header_id=head.connection_header_id
 AND observation.numeric_project_id=head.numeric_project_id AND observation.pipeline_observation_id=head.current_observation_id
WHERE head.workspace_id=$1 AND head.connection_header_id=$2 AND head.numeric_project_id=$3 AND head.external_pipeline_id=$4`,
        [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, externalPipelineId],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async ensureCursor(
    input: GitLabReconciliationCursorInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
INSERT INTO gitlab_reconciliation_cursors(
  reconciliation_cursor_id,workspace_id,connection_header_id,profile_ref,numeric_project_id,lane,
  bounded_window_start,bounded_window_end,cursor_value_hash,lease_owner,lease_token,lease_until,
  next_eligible_at,last_error_code,resource_version,created_at,updated_at
) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NULL,NULL,0,NULL,$9,NULL,1,$10,$10)
ON CONFLICT(workspace_id,connection_header_id,numeric_project_id,profile_ref,lane) DO NOTHING
RETURNING *`,
        [
          input.reconciliationCursorId,
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          JSON.stringify(input.profileRef),
          input.scope.numericProjectId,
          input.lane,
          new Date(input.boundedWindowStart),
          new Date(input.boundedWindowEnd),
          new Date(input.nextEligibleAt),
          new Date(input.createdAt),
        ],
      ),
    );
    if (rows[0] !== undefined) return Object.freeze({ ...rows[0] });
    const existing = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_reconciliation_cursors
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND profile_ref=$4::jsonb AND lane=$5`,
        [
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          input.scope.numericProjectId,
          JSON.stringify(input.profileRef),
          input.lane,
        ],
      ),
    );
    if (existing[0] === undefined)
      throw new GitLabReconciliationPersistenceError("GITLAB_RECONCILIATION_CURSOR_NOT_CREATED");
    return Object.freeze({ ...existing[0] });
  }

  async claimCursor(
    input: Readonly<{
      reconciliationCursorId: string;
      expectedResourceVersion: number;
      leaseOwner: string;
      now: string;
      leaseSeconds: number;
    }>,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    if (
      !Number.isSafeInteger(input.leaseSeconds) ||
      input.leaseSeconds < 1 ||
      input.leaseSeconds > 300
    )
      throw new GitLabReconciliationPersistenceError("GITLAB_RECONCILIATION_LEASE_INVALID");
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
UPDATE gitlab_reconciliation_cursors SET
  lease_owner=$3,lease_token=lease_token+1,lease_until=$4::timestamptz+($5::text||' seconds')::interval,
  resource_version=resource_version+1,updated_at=$4
WHERE reconciliation_cursor_id=$1 AND resource_version=$2 AND next_eligible_at<=$4
  AND (lease_until IS NULL OR lease_until<$4)
RETURNING *`,
        [
          input.reconciliationCursorId,
          input.expectedResourceVersion,
          input.leaseOwner,
          new Date(input.now),
          input.leaseSeconds,
        ],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async advanceCursor(
    input: Readonly<{
      reconciliationCursorId: string;
      expectedResourceVersion: number;
      leaseOwner: string;
      leaseToken: number;
      boundedWindowStart: string;
      boundedWindowEnd: string;
      cursorValueHash?: `sha256:${string}`;
      nextEligibleAt: string;
      lastErrorCode?: string;
      updatedAt: string;
    }>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
UPDATE gitlab_reconciliation_cursors SET
  bounded_window_start=$5,bounded_window_end=$6,cursor_value_hash=$7,next_eligible_at=$8,last_error_code=$9,
  lease_owner=NULL,lease_until=NULL,resource_version=resource_version+1,updated_at=$10
WHERE reconciliation_cursor_id=$1 AND resource_version=$2 AND lease_owner=$3 AND lease_token=$4 AND lease_until>=$10
RETURNING *`,
        [
          input.reconciliationCursorId,
          input.expectedResourceVersion,
          input.leaseOwner,
          input.leaseToken,
          new Date(input.boundedWindowStart),
          new Date(input.boundedWindowEnd),
          input.cursorValueHash ?? null,
          new Date(input.nextEligibleAt),
          input.lastErrorCode ?? null,
          new Date(input.updatedAt),
        ],
      ),
    );
    if (rows[0] === undefined)
      throw new GitLabReconciliationPersistenceError("GITLAB_RECONCILIATION_FENCE_STALE");
    return Object.freeze({ ...rows[0] });
  }

  async cursorsDue(
    lane: string,
    now: Date,
    limit: number,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("GITLAB_CURSOR_PAGE_LIMIT_INVALID");
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_reconciliation_cursors
WHERE lane=$1 AND next_eligible_at<=$2 AND (lease_until IS NULL OR lease_until<$2)
ORDER BY next_eligible_at,reconciliation_cursor_id LIMIT $3`,
        [lane, now, limit],
      ),
    );
  }

  async appendRateLimitSnapshot(
    input: GitLabRateLimitSnapshotInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
INSERT INTO gitlab_rate_limit_snapshots(
  rate_limit_snapshot_id,workspace_id,connection_header_id,profile_ref,numeric_project_id,lane,http_status,
  remaining,reset_at,retry_after_seconds,decision,next_eligible_at,error_code,observed_at,content_hash
) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT(workspace_id,connection_header_id,numeric_project_id,profile_ref,lane,content_hash) DO NOTHING
RETURNING *`,
        [
          input.rateLimitSnapshotId,
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          JSON.stringify(input.profileRef),
          input.scope.numericProjectId,
          input.lane,
          input.httpStatus ?? null,
          input.remaining ?? null,
          input.resetAt === undefined ? null : new Date(input.resetAt),
          input.retryAfterSeconds ?? null,
          input.decision,
          input.nextEligibleAt === undefined ? null : new Date(input.nextEligibleAt),
          input.errorCode ?? null,
          new Date(input.observedAt),
          input.contentHash,
        ],
      ),
    );
    if (rows[0] !== undefined) return Object.freeze({ ...rows[0] });
    const existing = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_rate_limit_snapshots
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND profile_ref=$4::jsonb AND lane=$5 AND content_hash=$6`,
        [
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          input.scope.numericProjectId,
          JSON.stringify(input.profileRef),
          input.lane,
          input.contentHash,
        ],
      ),
    );
    if (existing[0] === undefined)
      throw new GitLabReconciliationPersistenceError("GITLAB_RATE_SNAPSHOT_NOT_RECORDED");
    return Object.freeze({ ...existing[0] });
  }

  async latestRateLimitSnapshot(
    scope: GitLabAuthorityScope,
    lane: GitLabRateLimitSnapshotInput["lane"],
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_rate_limit_snapshots
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND lane=$4
ORDER BY observed_at DESC,rate_limit_snapshot_id DESC LIMIT 1`,
        [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, lane],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async #resolveWebhookReplay(
    input: GitLabWebhookReceiptInput,
    existing: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const existingBodyHash = String(existing.body_hash);
    if (existingBodyHash === input.bodyHash)
      return Object.freeze({ ...existing, status: "DUPLICATE", replayed: true });
    if (input.status !== "SECURITY_CONFLICT" && input.conflictBodyHash === undefined) {
      throw new GitLabReconciliationPersistenceError("GITLAB_WEBHOOK_DELIVERY_BODY_CONFLICT");
    }
    if (existing.status === "SECURITY_CONFLICT") {
      if (existing.conflict_body_hash !== input.bodyHash)
        throw new GitLabReconciliationPersistenceError("GITLAB_WEBHOOK_MULTIPLE_CONFLICT_BODIES");
      return Object.freeze({ ...existing, replayed: true });
    }
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
UPDATE gitlab_webhook_receipts
SET status='SECURITY_CONFLICT',conflict_body_hash=$5,reason_code='DELIVERY_ID_BODY_CONFLICT'
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND provider_delivery_id=$4
RETURNING *`,
        [
          input.scope.workspaceId,
          input.scope.connectionHeaderId,
          input.scope.numericProjectId,
          input.providerDeliveryId,
          input.bodyHash,
        ],
      ),
    );
    if (rows[0] === undefined)
      throw new GitLabReconciliationPersistenceError(
        "GITLAB_WEBHOOK_SECURITY_CONFLICT_NOT_RECORDED",
      );
    return Object.freeze({ ...rows[0] });
  }
}

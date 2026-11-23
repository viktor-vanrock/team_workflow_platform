import {
  frozenRows,
  type GitLabAuthorityScope,
  gitLabJson,
  type GitLabQueryExecutor,
  gitLabRows,
} from "./repository-helpers.ts";

export type GitLabEffectState =
  | "NOT_STARTED"
  | "EFFECT_STARTED"
  | "LOOKUP_REQUIRED"
  | "ONE_FOUND"
  | "CONFIRMED"
  | "AMBIGUOUS"
  | "FAILED_FINAL";

export interface GitLabEffectReconciliationRecord {
  readonly effectReconciliationId: string;
  readonly workspaceId: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly connectionHeaderId: string;
  readonly connectionRef: Readonly<Record<string, unknown>>;
  readonly profileRef: Readonly<Record<string, unknown>>;
  readonly numericProjectId: number;
  readonly exactRefHash: string;
  readonly expectedCommitSha: string;
  readonly triggerRequestHash: string;
  readonly payloadHash: string;
  readonly markerHash: string;
  readonly creationWindowStart: string;
  readonly creationWindowEnd: string;
  readonly effectInvocationStartedAt?: string;
  readonly state: GitLabEffectState;
  readonly externalPipelineId?: string;
  readonly lookupQueryHash?: string;
  readonly matchCount?: number;
  readonly receiptHash?: string;
  readonly attemptCount: number;
  readonly nextRetryAt?: string;
  readonly leaseOwner?: string;
  readonly leaseToken: number;
  readonly leaseUntil?: string;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitLabEffectClaimInput {
  readonly effectReconciliationId: string;
  readonly workspaceId: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly connectionHeaderId: string;
  readonly connectionRef: Readonly<Record<string, unknown>>;
  readonly profileRef: Readonly<Record<string, unknown>>;
  readonly numericProjectId: number;
  readonly exactRefHash: string;
  readonly expectedCommitSha: string;
  readonly triggerRequestHash: string;
  readonly payloadHash: string;
  readonly markerHash: string;
  readonly creationWindowStart: string;
  readonly creationWindowEnd: string;
  readonly createdAt: string;
}

export type GitLabEffectRecoveryMode = "TRIGGER_ALLOWED" | "LOOKUP_ONLY" | "CONFIRMED" | "TERMINAL";

interface GitLabTransactionalExecutor extends GitLabQueryExecutor {
  transaction<T>(work: (manager: GitLabQueryExecutor) => Promise<T>): Promise<T>;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;

function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return gitLabRows<Readonly<Record<string, unknown>>>(value);
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : iso(value);
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function record(row: Readonly<Record<string, unknown>>): GitLabEffectReconciliationRecord {
  const effectInvocationStartedAt = optionalIso(row.effect_invocation_started_at);
  const externalPipelineId = optionalString(row.external_pipeline_id);
  const lookupQueryHash = optionalString(row.lookup_query_hash);
  const receiptHash = optionalString(row.receipt_hash);
  const nextRetryAt = optionalIso(row.next_retry_at);
  const leaseOwner = optionalString(row.lease_owner);
  const leaseUntil = optionalIso(row.lease_until);
  return Object.freeze({
    effectReconciliationId: String(row.effect_reconciliation_id),
    workspaceId: String(row.workspace_id),
    commandId: String(row.command_id),
    effectId: String(row.effect_id),
    connectionHeaderId: String(row.connection_header_id),
    connectionRef: Object.freeze(gitLabJson<Record<string, unknown>>(row.connection_ref)),
    profileRef: Object.freeze(gitLabJson<Record<string, unknown>>(row.profile_ref)),
    numericProjectId: Number(row.numeric_project_id),
    exactRefHash: String(row.exact_ref_hash),
    expectedCommitSha: String(row.expected_commit_sha),
    triggerRequestHash: String(row.trigger_request_hash),
    payloadHash: String(row.payload_hash),
    markerHash: String(row.marker_hash),
    creationWindowStart: iso(row.creation_window_start),
    creationWindowEnd: iso(row.creation_window_end),
    ...(effectInvocationStartedAt === undefined ? {} : { effectInvocationStartedAt }),
    state: String(row.state) as GitLabEffectState,
    ...(externalPipelineId === undefined ? {} : { externalPipelineId }),
    ...(lookupQueryHash === undefined ? {} : { lookupQueryHash }),
    ...(row.match_count === null || row.match_count === undefined
      ? {}
      : { matchCount: Number(row.match_count) }),
    ...(receiptHash === undefined ? {} : { receiptHash }),
    attemptCount: Number(row.attempt_count),
    ...(nextRetryAt === undefined ? {} : { nextRetryAt }),
    ...(leaseOwner === undefined ? {} : { leaseOwner }),
    leaseToken: Number(row.lease_token),
    ...(leaseUntil === undefined ? {} : { leaseUntil }),
    resourceVersion: Number(row.resource_version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function assertScope(scope: GitLabAuthorityScope): void {
  if (
    !scope.workspaceId ||
    !scope.connectionHeaderId ||
    !Number.isSafeInteger(scope.numericProjectId) ||
    scope.numericProjectId < 1
  ) {
    throw new Error("GITLAB_EFFECT_SCOPE_INVALID");
  }
}

function assertClaim(input: GitLabEffectClaimInput): void {
  if (
    [
      input.effectReconciliationId,
      input.workspaceId,
      input.commandId,
      input.effectId,
      input.connectionHeaderId,
    ].some((value) => !value) ||
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    ![input.exactRefHash, input.triggerRequestHash, input.payloadHash, input.markerHash].every(
      (value) => hashPattern.test(value),
    ) ||
    !/^[a-f0-9]{40}$/u.test(input.expectedCommitSha) ||
    ![input.creationWindowStart, input.creationWindowEnd, input.createdAt].every(validTimestamp) ||
    Date.parse(input.creationWindowEnd) < Date.parse(input.creationWindowStart)
  )
    throw new Error("GITLAB_EFFECT_CLAIM_INVALID");
}

function sameClaim(
  existing: GitLabEffectReconciliationRecord,
  input: GitLabEffectClaimInput,
): boolean {
  return (
    existing.effectReconciliationId === input.effectReconciliationId &&
    existing.workspaceId === input.workspaceId &&
    existing.commandId === input.commandId &&
    existing.effectId === input.effectId &&
    existing.connectionHeaderId === input.connectionHeaderId &&
    existing.numericProjectId === input.numericProjectId &&
    existing.exactRefHash === input.exactRefHash &&
    existing.expectedCommitSha === input.expectedCommitSha &&
    existing.triggerRequestHash === input.triggerRequestHash &&
    existing.payloadHash === input.payloadHash &&
    existing.markerHash === input.markerHash &&
    existing.creationWindowStart === new Date(input.creationWindowStart).toISOString() &&
    existing.creationWindowEnd === new Date(input.creationWindowEnd).toISOString() &&
    JSON.stringify(existing.connectionRef) === JSON.stringify(input.connectionRef) &&
    JSON.stringify(existing.profileRef) === JSON.stringify(input.profileRef)
  );
}

export function gitLabEffectRecoveryMode(
  value: GitLabEffectReconciliationRecord,
): GitLabEffectRecoveryMode {
  if (value.state === "CONFIRMED") return "CONFIRMED";
  if (value.state === "AMBIGUOUS" || value.state === "FAILED_FINAL") return "TERMINAL";
  if (value.state === "NOT_STARTED" && value.effectInvocationStartedAt === undefined)
    return "TRIGGER_ALLOWED";
  return "LOOKUP_ONLY";
}

export class TypeOrmGitLabEffectRepository {
  constructor(private readonly source: GitLabTransactionalExecutor) {}

  async claim(
    input: GitLabEffectClaimInput,
  ): Promise<Readonly<{ record: GitLabEffectReconciliationRecord; replayed: boolean }>> {
    assertClaim(input);
    const inserted = rows(
      await this.source.query(
        `
INSERT INTO gitlab_effect_reconciliations(
  effect_reconciliation_id,workspace_id,command_id,effect_id,connection_header_id,connection_ref,profile_ref,
  numeric_project_id,exact_ref_hash,expected_commit_sha,trigger_request_hash,payload_hash,marker_hash,
  creation_window_start,creation_window_end,effect_invocation_started_at,state,attempt_count,resource_version,created_at,updated_at
) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,NULL,'NOT_STARTED',0,1,$16,$16)
ON CONFLICT(effect_id) DO NOTHING RETURNING *`,
        [
          input.effectReconciliationId,
          input.workspaceId,
          input.commandId,
          input.effectId,
          input.connectionHeaderId,
          JSON.stringify(input.connectionRef),
          JSON.stringify(input.profileRef),
          input.numericProjectId,
          input.exactRefHash,
          input.expectedCommitSha,
          input.triggerRequestHash,
          input.payloadHash,
          input.markerHash,
          input.creationWindowStart,
          input.creationWindowEnd,
          input.createdAt,
        ],
      ),
    );
    const value =
      inserted[0] === undefined
        ? await this.#byEffectIdGlobal(input.effectId)
        : record(inserted[0]);
    if (!value || !sameClaim(value, input)) throw new Error("GITLAB_EFFECT_CLAIM_CONFLICT");
    return Object.freeze({ record: value, replayed: inserted.length === 0 });
  }

  async byEffectId(
    scope: GitLabAuthorityScope,
    effectId: string,
  ): Promise<GitLabEffectReconciliationRecord | undefined> {
    assertScope(scope);
    const found = rows(
      await this.source.query(
        `
SELECT * FROM gitlab_effect_reconciliations
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4`,
        [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, effectId],
      ),
    );
    return found[0] === undefined ? undefined : record(found[0]);
  }

  async recordPreInvocationFailure(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      retryAt?: string;
      updatedAt: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(input.expectedResourceVersion) ||
      !validTimestamp(input.updatedAt) ||
      (input.retryAt !== undefined && !validTimestamp(input.retryAt))
    ) {
      throw new Error("GITLAB_EFFECT_PRE_INVOCATION_FAILURE_INVALID");
    }
    const updated = rows(
      await this.source.query(
        `
UPDATE gitlab_effect_reconciliations
SET state=CASE WHEN $6::timestamptz IS NULL THEN 'FAILED_FINAL' ELSE 'NOT_STARTED' END,
    attempt_count=attempt_count+1,next_retry_at=$6,resource_version=resource_version+1,updated_at=$7
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4
  AND resource_version=$5 AND state='NOT_STARTED' AND effect_invocation_started_at IS NULL AND attempt_count<2
RETURNING *`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectId,
          input.expectedResourceVersion,
          input.retryAt ?? null,
          input.updatedAt,
        ],
      ),
    );
    if (!updated[0]) throw new Error("GITLAB_EFFECT_PRE_INVOCATION_RETRY_FORBIDDEN");
    return record(updated[0]);
  }

  async markInvocationStarted(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      startedAt: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    if (!Number.isSafeInteger(input.expectedResourceVersion) || !validTimestamp(input.startedAt))
      throw new Error("GITLAB_EFFECT_INVOCATION_MARKER_INVALID");
    const updated = rows(
      await this.source.query(
        `
UPDATE gitlab_effect_reconciliations
SET state='EFFECT_STARTED',effect_invocation_started_at=$6,attempt_count=attempt_count+1,
    next_retry_at=NULL,resource_version=resource_version+1,updated_at=$6
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4
  AND resource_version=$5 AND state='NOT_STARTED' AND effect_invocation_started_at IS NULL AND attempt_count<2
RETURNING *`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectId,
          input.expectedResourceVersion,
          input.startedAt,
        ],
      ),
    );
    if (updated[0]) return record(updated[0]);
    const existing = await this.byEffectId(scope, effectId);
    if (existing?.effectInvocationStartedAt !== undefined) return existing;
    throw new Error("GITLAB_EFFECT_INVOCATION_MARKER_CONFLICT");
  }

  async markLookupRequired(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      lookupQueryHash: string;
      updatedAt: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(input.expectedResourceVersion) ||
      !hashPattern.test(input.lookupQueryHash) ||
      !validTimestamp(input.updatedAt)
    )
      throw new Error("GITLAB_EFFECT_LOOKUP_REQUIRED_INVALID");
    const updated = rows(
      await this.source.query(
        `
UPDATE gitlab_effect_reconciliations
SET state='LOOKUP_REQUIRED',lookup_query_hash=$6,next_retry_at=NULL,resource_version=resource_version+1,updated_at=$7
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4
  AND resource_version=$5 AND state IN('EFFECT_STARTED','LOOKUP_REQUIRED') AND effect_invocation_started_at IS NOT NULL
RETURNING *`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectId,
          input.expectedResourceVersion,
          input.lookupQueryHash,
          input.updatedAt,
        ],
      ),
    );
    if (!updated[0]) throw new Error("GITLAB_EFFECT_LOOKUP_REQUIRED_CONFLICT");
    return record(updated[0]);
  }

  async recordLookup(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      effectLookupObservationId: string;
      lookupQueryHash: string;
      observedWindowStart: string;
      observedWindowEnd: string;
      outcome: "ZERO" | "EXACT_ONE" | "MULTIPLE";
      externalPipelineId?: string;
      receiptHash?: string;
      matchCommitmentHashes: readonly string[];
      observationHash: string;
      observedAt: string;
      final: boolean;
      nextLookupAt?: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    const matchCount = input.matchCommitmentHashes.length;
    if (
      !Number.isSafeInteger(input.expectedResourceVersion) ||
      !input.effectLookupObservationId ||
      ![input.lookupQueryHash, input.observationHash, ...input.matchCommitmentHashes].every(
        (value) => hashPattern.test(value),
      ) ||
      ![input.observedWindowStart, input.observedWindowEnd, input.observedAt].every(
        validTimestamp,
      ) ||
      (input.nextLookupAt !== undefined && !validTimestamp(input.nextLookupAt)) ||
      Date.parse(input.observedWindowEnd) < Date.parse(input.observedWindowStart) ||
      (input.outcome === "ZERO" &&
        (matchCount !== 0 ||
          input.externalPipelineId !== undefined ||
          input.receiptHash !== undefined)) ||
      (input.outcome === "EXACT_ONE" &&
        (matchCount !== 1 ||
          !input.externalPipelineId ||
          !input.receiptHash ||
          !hashPattern.test(input.receiptHash))) ||
      (input.outcome === "MULTIPLE" &&
        (matchCount < 2 ||
          input.externalPipelineId !== undefined ||
          input.receiptHash !== undefined)) ||
      (!input.final && input.nextLookupAt === undefined)
    )
      throw new Error("GITLAB_EFFECT_LOOKUP_OBSERVATION_INVALID");

    return await this.source.transaction(async (manager) => {
      const lockedRows = rows(
        await manager.query(
          `
SELECT * FROM gitlab_effect_reconciliations
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4 FOR UPDATE`,
          [scope.workspaceId, scope.connectionHeaderId, scope.numericProjectId, effectId],
        ),
      );
      const locked = lockedRows[0] ? record(lockedRows[0]) : undefined;
      if (!locked) throw new Error("GITLAB_EFFECT_NOT_FOUND");
      const duplicate = rows(
        await manager.query(
          `
SELECT effect_lookup_observation_id FROM gitlab_effect_lookup_observations
WHERE workspace_id=$1 AND effect_reconciliation_id=$2 AND observation_hash=$3`,
          [scope.workspaceId, locked.effectReconciliationId, input.observationHash],
        ),
      );
      if (duplicate[0]) return locked;
      if (
        locked.resourceVersion !== input.expectedResourceVersion ||
        !["EFFECT_STARTED", "LOOKUP_REQUIRED"].includes(locked.state)
      ) {
        throw new Error("GITLAB_EFFECT_LOOKUP_STATE_CONFLICT");
      }
      await manager.query(
        `
INSERT INTO gitlab_effect_lookup_observations(
  effect_lookup_observation_id,workspace_id,connection_header_id,numeric_project_id,effect_reconciliation_id,
  lookup_query_hash,observed_window_start,observed_window_end,outcome,match_count,match_commitment_hashes,
  receipt_hash,observation_hash,observed_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
        [
          input.effectLookupObservationId,
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          locked.effectReconciliationId,
          input.lookupQueryHash,
          input.observedWindowStart,
          input.observedWindowEnd,
          input.outcome,
          matchCount,
          JSON.stringify(input.matchCommitmentHashes),
          input.receiptHash ?? null,
          input.observationHash,
          input.observedAt,
        ],
      );
      const nextState: GitLabEffectState =
        input.outcome === "EXACT_ONE" ? "ONE_FOUND" : input.final ? "AMBIGUOUS" : "LOOKUP_REQUIRED";
      const updated = rows(
        await manager.query(
          `
UPDATE gitlab_effect_reconciliations
SET state=$6,external_pipeline_id=$7,lookup_query_hash=$8,match_count=$9,receipt_hash=$10,
    next_retry_at=$11,resource_version=resource_version+1,updated_at=$12
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4 AND resource_version=$5
RETURNING *`,
          [
            scope.workspaceId,
            scope.connectionHeaderId,
            scope.numericProjectId,
            effectId,
            input.expectedResourceVersion,
            nextState,
            input.externalPipelineId ?? null,
            input.lookupQueryHash,
            matchCount,
            input.receiptHash ?? null,
            input.final ? null : input.nextLookupAt,
            input.observedAt,
          ],
        ),
      );
      if (!updated[0]) throw new Error("GITLAB_EFFECT_LOOKUP_CAS_CONFLICT");
      return record(updated[0]);
    });
  }

  async confirm(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      externalPipelineId: string;
      receiptHash: string;
      confirmedAt: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(input.expectedResourceVersion) ||
      !input.externalPipelineId ||
      !hashPattern.test(input.receiptHash) ||
      !validTimestamp(input.confirmedAt)
    ) {
      throw new Error("GITLAB_EFFECT_CONFIRMATION_INVALID");
    }
    const updated = rows(
      await this.source.query(
        `
UPDATE gitlab_effect_reconciliations
SET state='CONFIRMED',next_retry_at=NULL,resource_version=resource_version+1,updated_at=$8
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4 AND resource_version=$5
  AND state='ONE_FOUND' AND external_pipeline_id=$6 AND receipt_hash=$7
RETURNING *`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectId,
          input.expectedResourceVersion,
          input.externalPipelineId,
          input.receiptHash,
          input.confirmedAt,
        ],
      ),
    );
    if (updated[0]) return record(updated[0]);
    const existing = await this.byEffectId(scope, effectId);
    if (
      existing?.state === "CONFIRMED" &&
      existing.externalPipelineId === input.externalPipelineId &&
      existing.receiptHash === input.receiptHash
    )
      return existing;
    throw new Error("GITLAB_EFFECT_CONFIRMATION_CONFLICT");
  }

  async lookupHistory(
    scope: GitLabAuthorityScope,
    effectReconciliationId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    assertScope(scope);
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_effect_lookup_observations
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_reconciliation_id=$4
ORDER BY observed_at,effect_lookup_observation_id`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectReconciliationId,
        ],
      ),
    );
  }

  /** An unavailable/invalid read is not a ZERO observation. Keep its reason in
   * the command ledger; this only fences the existing provider effect. */
  async settleUnresolved(
    scope: GitLabAuthorityScope,
    effectId: string,
    input: Readonly<{
      expectedResourceVersion: number;
      observedAt: string;
      nextLookupAt?: string;
    }>,
  ): Promise<GitLabEffectReconciliationRecord> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(input.expectedResourceVersion) ||
      !validTimestamp(input.observedAt) ||
      (input.nextLookupAt !== undefined &&
        (!validTimestamp(input.nextLookupAt) ||
          Date.parse(input.nextLookupAt) <= Date.parse(input.observedAt)))
    )
      throw new Error("GITLAB_EFFECT_UNRESOLVED_INVALID");
    const updated = rows(
      await this.source.query(
        `
UPDATE gitlab_effect_reconciliations
SET state=$6,next_retry_at=$7,resource_version=resource_version+1,updated_at=$8
WHERE workspace_id=$1 AND connection_header_id=$2 AND numeric_project_id=$3 AND effect_id=$4
  AND resource_version=$5 AND effect_invocation_started_at IS NOT NULL
  AND state IN ('EFFECT_STARTED','LOOKUP_REQUIRED','ONE_FOUND')
RETURNING *`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          effectId,
          input.expectedResourceVersion,
          input.nextLookupAt ? "LOOKUP_REQUIRED" : "AMBIGUOUS",
          input.nextLookupAt ?? null,
          input.observedAt,
        ],
      ),
    );
    if (!updated[0]) throw new Error("GITLAB_EFFECT_UNRESOLVED_CONFLICT");
    return record(updated[0]);
  }

  async due(now: Date, limit: number): Promise<readonly GitLabEffectReconciliationRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("GITLAB_EFFECT_PAGE_LIMIT_INVALID");
    return Object.freeze(
      rows(
        await this.source.query(
          `
SELECT * FROM gitlab_effect_reconciliations
WHERE state IN ('NOT_STARTED','EFFECT_STARTED','LOOKUP_REQUIRED','ONE_FOUND')
  AND (next_retry_at IS NULL OR next_retry_at<=$1) AND (lease_until IS NULL OR lease_until<$1)
ORDER BY COALESCE(next_retry_at,created_at),effect_reconciliation_id LIMIT $2`,
          [now, limit],
        ),
      ).map(record),
    );
  }

  async #byEffectIdGlobal(effectId: string): Promise<GitLabEffectReconciliationRecord | undefined> {
    const found = rows(
      await this.source.query("SELECT * FROM gitlab_effect_reconciliations WHERE effect_id=$1", [
        effectId,
      ]),
    );
    return found[0] === undefined ? undefined : record(found[0]);
  }
}

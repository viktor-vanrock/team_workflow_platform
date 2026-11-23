import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

export type JiraEffectState =
  | "NOT_STARTED"
  | "LOOKUP_REQUIRED"
  | "ISSUE_FOUND"
  | "EFFECT_IN_PROGRESS"
  | "CONFIRMED"
  | "AMBIGUOUS"
  | "FAILED_FINAL";

export type JiraSubEffectKind =
  | "ISSUE_CREATE"
  | "FIELD_EDIT"
  | "TRANSITION"
  | "ISSUE_LINK"
  | "REMOTE_LINK"
  | "COMMENT"
  | "PROPERTY";

export interface JiraEffectIdentity {
  readonly id: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly connectionRef: Readonly<Record<string, unknown>>;
  readonly profileRef: Readonly<Record<string, unknown>>;
  readonly operation: string;
  readonly targetHash: string;
  readonly payloadHash: string;
  readonly marker: string;
  readonly now: Date;
}

export interface JiraEffectRecord {
  readonly id: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly connectionRef: Readonly<Record<string, unknown>>;
  readonly profileRef: Readonly<Record<string, unknown>>;
  readonly operation: string;
  readonly targetHash: string;
  readonly payloadHash: string;
  readonly marker: string;
  readonly externalEntityId?: string;
  readonly invocationStartedAt?: Date;
  readonly state: JiraEffectState;
  readonly receiptHash?: string;
  readonly externalRevisionToken?: string;
  readonly attempt: number;
}

/**
 * A single worker-attempt claim over one Jira provider effect. Tokens are kept
 * as strings because PostgreSQL bigint values can exceed JavaScript's safe
 * integer range.
 */
export interface JiraEffectClaim {
  readonly effectId: string;
  readonly owner: string;
  readonly token: string;
  readonly leaseUntil: Date;
}

export interface JiraSubEffectPlanEntry {
  readonly sequence: number;
  readonly kind: JiraSubEffectKind;
  readonly semanticIdentity: string;
  readonly semanticHash: string;
  readonly required: boolean;
}

type Row = Readonly<Record<string, unknown>>;

function mutationRows(value: unknown): readonly Row[] {
  if (!Array.isArray(value)) return [];
  const rows = Array.isArray(value[0]) ? value[0] : value;
  return rows.filter(
    (entry): entry is Row => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JIRA_EFFECT_REF_INVALID");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function date(value: unknown, code: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(code);
  return parsed;
}

function effectClaim(row: Row): JiraEffectClaim {
  return Object.freeze({
    effectId: String(row.effect_id),
    owner: String(row.lease_owner),
    token: String(row.lease_token),
    leaseUntil: date(row.lease_until, "JIRA_EFFECT_LEASE_INVALID"),
  });
}

function assertClaimInput(claim: JiraEffectClaim, now: Date): void {
  if (
    claim.effectId.length === 0 ||
    claim.owner.length === 0 ||
    !/^[1-9][0-9]*$/u.test(claim.token) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(claim.leaseUntil.getTime())
  )
    throw new Error("JIRA_EFFECT_CLAIM_INVALID");
}

function effectRecord(row: Row): JiraEffectRecord {
  return Object.freeze({
    id: String(row.id),
    commandId: String(row.command_id),
    effectId: String(row.effect_id),
    connectionRef: jsonRecord(row.connection_ref),
    profileRef: jsonRecord(row.profile_ref),
    operation: String(row.operation),
    targetHash: String(row.target_hash),
    payloadHash: String(row.payload_hash),
    marker: String(row.marker),
    ...(optionalString(row.external_entity_id)
      ? { externalEntityId: String(row.external_entity_id) }
      : {}),
    ...(row.invocation_started_at
      ? {
          invocationStartedAt: date(
            row.invocation_started_at,
            "JIRA_EFFECT_INVOCATION_TIME_INVALID",
          ),
        }
      : {}),
    state: String(row.state) as JiraEffectState,
    ...(optionalString(row.receipt_hash) ? { receiptHash: String(row.receipt_hash) } : {}),
    ...(optionalString(row.external_revision_token)
      ? { externalRevisionToken: String(row.external_revision_token) }
      : {}),
    attempt: Number(row.attempt),
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256(left as JsonValue) === sha256(right as JsonValue);
}

function assertImmutableIdentity(record: JiraEffectRecord, input: JiraEffectIdentity): void {
  if (
    record.id !== input.id ||
    record.commandId !== input.commandId ||
    record.effectId !== input.effectId ||
    record.operation !== input.operation ||
    record.targetHash !== input.targetHash ||
    record.payloadHash !== input.payloadHash ||
    record.marker !== input.marker ||
    !sameJson(record.connectionRef, input.connectionRef) ||
    !sameJson(record.profileRef, input.profileRef)
  ) {
    throw new Error("JIRA_EFFECT_IDENTITY_CONFLICT");
  }
}

/**
 * Connector-owned recovery ledger. Core command state remains authoritative;
 * this repository only records the exact provider effect and its recovery
 * observations. Every mutation is effect-id scoped and CAS guarded.
 */
export class JiraEffectRepository {
  constructor(private readonly source: DataSource) {}

  async ensure(input: JiraEffectIdentity): Promise<JiraEffectRecord> {
    await this.source.query(
      `INSERT INTO jira_effect_reconciliations(
         id,command_id,effect_id,connection_ref,profile_ref,operation,target_hash,
         payload_hash,marker,state,attempt,lease_token,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'NOT_STARTED',0,0,$10,$10)
       ON CONFLICT(effect_id) DO NOTHING`,
      [
        input.id,
        input.commandId,
        input.effectId,
        JSON.stringify(input.connectionRef),
        JSON.stringify(input.profileRef),
        input.operation,
        input.targetHash,
        input.payloadHash,
        input.marker,
        input.now,
      ],
    );
    const current = await this.byEffectId(input.effectId);
    if (!current) throw new Error("JIRA_EFFECT_ENSURE_FAILED");
    assertImmutableIdentity(current, input);
    return current;
  }

  async byEffectId(effectId: string): Promise<JiraEffectRecord | undefined> {
    const rows = (await this.source.query(
      "SELECT * FROM jira_effect_reconciliations WHERE effect_id=$1",
      [effectId],
    )) as readonly Row[];
    return rows[0] ? effectRecord(rows[0]) : undefined;
  }

  async claim(
    effectId: string,
    owner: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<JiraEffectClaim> {
    if (
      effectId.length === 0 ||
      owner.length === 0 ||
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(leaseUntil.getTime()) ||
      leaseUntil <= now
    )
      throw new Error("JIRA_EFFECT_LEASE_INVALID");
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET lease_owner=$2,
              lease_token=lease_token+1,
              lease_until=$4,
              attempt=attempt+1,
              updated_at=$3
        WHERE effect_id=$1
          AND state NOT IN ('AMBIGUOUS','FAILED_FINAL')
          AND (lease_owner=$2 OR lease_until IS NULL OR lease_until<=$3)
        RETURNING effect_id,lease_owner,lease_token,lease_until`,
        [effectId, owner, now, leaseUntil],
      ),
    );
    if (!rows[0]) {
      const current = await this.byEffectId(effectId);
      if (!current) throw new Error("JIRA_EFFECT_NOT_FOUND");
      if (current.state === "AMBIGUOUS" || current.state === "FAILED_FINAL") {
        throw new Error(`JIRA_EFFECT_${current.state}`);
      }
      throw new Error("JIRA_EFFECT_LEASE_CONFLICT");
    }
    return effectClaim(rows[0]);
  }

  async assertClaim(claim: JiraEffectClaim, now: Date): Promise<void> {
    assertClaimInput(claim, now);
    const rows = (await this.source.query(
      `SELECT effect_id
         FROM jira_effect_reconciliations
        WHERE effect_id=$1
          AND lease_owner=$2
          AND lease_token=$3::bigint
          AND lease_until>$4`,
      [claim.effectId, claim.owner, claim.token, now],
    )) as readonly Row[];
    if (rows.length !== 1) throw new Error("JIRA_EFFECT_FENCE_REJECTED");
  }

  async beginLookup(claim: JiraEffectClaim, now: Date): Promise<JiraEffectRecord> {
    assertClaimInput(claim, now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET state=CASE
                WHEN state IN ('NOT_STARTED','LOOKUP_REQUIRED','ISSUE_FOUND','EFFECT_IN_PROGRESS')
                  THEN 'LOOKUP_REQUIRED'
                ELSE state
              END,
              updated_at=$2
        WHERE effect_id=$1
          AND lease_owner=$3
          AND lease_token=$4::bigint
          AND lease_until>$2
        RETURNING *`,
        [claim.effectId, now, claim.owner, claim.token],
      ),
    );
    if (!rows[0]) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_EFFECT_STATE_CONFLICT");
    }
    const current = effectRecord(rows[0]);
    if (current.state === "AMBIGUOUS" || current.state === "FAILED_FINAL") {
      throw new Error(`JIRA_EFFECT_${current.state}`);
    }
    return current;
  }

  async recordLookup(
    claim: JiraEffectClaim,
    lookup: Readonly<{
      state: "FOUND" | "PROVEN_ABSENT" | "UNKNOWN" | "MULTIPLE";
      externalEntityId?: string;
      matchCount: number;
      queryHash: string;
    }>,
    now: Date,
  ): Promise<JiraEffectRecord> {
    assertClaimInput(claim, now);
    const next: JiraEffectState =
      lookup.state === "FOUND"
        ? "ISSUE_FOUND"
        : lookup.state === "UNKNOWN" || lookup.state === "MULTIPLE"
          ? "AMBIGUOUS"
          : "LOOKUP_REQUIRED";
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET state=CASE WHEN state='CONFIRMED' THEN state
                WHEN $9='PROVEN_ABSENT' AND invocation_started_at IS NOT NULL THEN 'AMBIGUOUS'
                ELSE $2 END,
              external_entity_id=CASE
                WHEN $3::text IS NULL THEN external_entity_id
                WHEN external_entity_id IS NULL OR external_entity_id=$3 THEN $3
                ELSE external_entity_id
              END,
              lookup_query_hash=COALESCE(lookup_query_hash,$4),
              match_count=$5,
              updated_at=$6
        WHERE effect_id=$1
          AND ($3::text IS NULL OR external_entity_id IS NULL OR external_entity_id=$3)
          AND lease_owner=$7
          AND lease_token=$8::bigint
          AND lease_until>$6
        RETURNING *`,
        [
          claim.effectId,
          next,
          lookup.externalEntityId ?? null,
          lookup.queryHash,
          lookup.matchCount,
          now,
          claim.owner,
          claim.token,
          lookup.state,
        ],
      ),
    );
    if (!rows[0]) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_EFFECT_LOOKUP_CONFLICT");
    }
    return effectRecord(rows[0]);
  }

  async markInProgress(claim: JiraEffectClaim, now: Date): Promise<JiraEffectRecord> {
    assertClaimInput(claim, now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET state='EFFECT_IN_PROGRESS',invocation_started_at=$2,
              updated_at=$2
        WHERE effect_id=$1
          AND state='LOOKUP_REQUIRED'
          AND invocation_started_at IS NULL AND external_entity_id IS NULL
          AND lease_owner=$3
          AND lease_token=$4::bigint
          AND lease_until>$2
        RETURNING *`,
        [claim.effectId, now, claim.owner, claim.token],
      ),
    );
    if (!rows[0]) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_EFFECT_STATE_CONFLICT");
    }
    return effectRecord(rows[0]);
  }

  async recordCreated(
    claim: JiraEffectClaim,
    externalEntityId: string,
    now: Date,
  ): Promise<JiraEffectRecord> {
    assertClaimInput(claim, now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET external_entity_id=$2,updated_at=$3
        WHERE effect_id=$1
          AND state IN ('EFFECT_IN_PROGRESS','CONFIRMED')
          AND (external_entity_id IS NULL OR external_entity_id=$2)
          AND lease_owner=$4
          AND lease_token=$5::bigint
          AND lease_until>$3
        RETURNING *`,
        [claim.effectId, externalEntityId, now, claim.owner, claim.token],
      ),
    );
    if (!rows[0]) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_EFFECT_EXTERNAL_ID_CONFLICT");
    }
    return effectRecord(rows[0]);
  }

  async confirm(
    claim: JiraEffectClaim,
    input: Readonly<{
      externalEntityId: string;
      receiptHash: string;
      externalRevisionToken: string;
      now: Date;
    }>,
  ): Promise<JiraEffectRecord> {
    assertClaimInput(claim, input.now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET state='CONFIRMED',
              external_entity_id=$2,
              receipt_hash=COALESCE(receipt_hash,$3),
              external_revision_token=COALESCE(external_revision_token,$4),
              lease_owner=NULL,
              lease_until=NULL,
              next_retry_at=NULL,
              updated_at=$5
        WHERE effect_id=$1
          AND state IN ('LOOKUP_REQUIRED','ISSUE_FOUND','EFFECT_IN_PROGRESS','CONFIRMED')
          AND (external_entity_id IS NULL OR external_entity_id=$2)
          AND lease_owner=$6
          AND lease_token=$7::bigint
          AND lease_until>$5
        RETURNING *`,
        [
          claim.effectId,
          input.externalEntityId,
          input.receiptHash,
          input.externalRevisionToken,
          input.now,
          claim.owner,
          claim.token,
        ],
      ),
    );
    if (!rows[0]) {
      await this.assertClaim(claim, input.now);
      throw new Error("JIRA_EFFECT_CONFIRMATION_CONFLICT");
    }
    return effectRecord(rows[0]);
  }

  async prepareSubEffects(
    claim: JiraEffectClaim,
    entries: readonly JiraSubEffectPlanEntry[],
    now: Date,
  ): Promise<void> {
    assertClaimInput(claim, now);
    await this.source.transaction(async (manager) => {
      const parents = (await manager.query(
        `SELECT id
           FROM jira_effect_reconciliations
          WHERE effect_id=$1
            AND lease_owner=$2
            AND lease_token=$3::bigint
            AND lease_until>$4
          FOR UPDATE`,
        [claim.effectId, claim.owner, claim.token, now],
      )) as readonly Readonly<{ id: string }>[];
      const parent = parents[0];
      if (!parent) throw new Error("JIRA_EFFECT_FENCE_REJECTED");
      for (const entry of entries) {
        await manager.query(
          `INSERT INTO jira_effect_sub_effects(
             effect_id,sequence,kind,semantic_identity,semantic_hash,required,state,attempt,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,'PENDING',0,$7,$7)
           ON CONFLICT DO NOTHING`,
          [
            parent.id,
            entry.sequence,
            entry.kind,
            entry.semanticIdentity,
            entry.semanticHash,
            entry.required,
            now,
          ],
        );
      }
      const persisted = (await manager.query(
        `SELECT sequence,kind,semantic_identity,semantic_hash,required
           FROM jira_effect_sub_effects
          WHERE effect_id=$1
          ORDER BY sequence`,
        [parent.id],
      )) as readonly Readonly<{
        sequence: number;
        kind: string;
        semantic_identity: string;
        semantic_hash: string;
        required: boolean;
      }>[];
      if (
        persisted.length !== entries.length ||
        persisted.some((row, index) => {
          const entry = entries[index];
          return (
            !entry ||
            row.sequence !== entry.sequence ||
            row.kind !== entry.kind ||
            row.semantic_identity !== entry.semanticIdentity ||
            row.semantic_hash !== entry.semanticHash ||
            row.required !== entry.required
          );
        })
      ) {
        throw new Error("JIRA_SUB_EFFECT_PLAN_CONFLICT");
      }
    });
  }

  async beginSubEffect(claim: JiraEffectClaim, semanticIdentity: string, now: Date): Promise<void> {
    assertClaimInput(claim, now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_sub_effects child
          SET attempt=child.attempt+1,updated_at=$3
         FROM jira_effect_reconciliations parent
        WHERE parent.id=child.effect_id
          AND parent.effect_id=$1
          AND child.semantic_identity=$2
          AND child.state<>'CONFIRMED'
          AND parent.lease_owner=$4
          AND parent.lease_token=$5::bigint
          AND parent.lease_until>$3
        RETURNING child.semantic_identity`,
        [claim.effectId, semanticIdentity, now, claim.owner, claim.token],
      ),
    );
    if (rows.length === 0) {
      const receipt = await this.subEffectReceipt(claim, semanticIdentity, now);
      if (!receipt) throw new Error("JIRA_SUB_EFFECT_STATE_CONFLICT");
    }
  }

  async subEffectReceipt(
    claim: JiraEffectClaim,
    semanticIdentity: string,
    now: Date,
  ): Promise<string | undefined> {
    assertClaimInput(claim, now);
    const rows = (await this.source.query(
      `SELECT child.state,child.external_identity
         FROM jira_effect_sub_effects child
         JOIN jira_effect_reconciliations parent ON parent.id=child.effect_id
        WHERE parent.effect_id=$1
          AND child.semantic_identity=$2
          AND parent.lease_owner=$3
          AND parent.lease_token=$4::bigint
          AND parent.lease_until>$5`,
      [claim.effectId, semanticIdentity, claim.owner, claim.token, now],
    )) as readonly Readonly<{ state: string; external_identity: string | null }>[];
    if (!rows[0]) {
      await this.assertClaim(claim, now);
      return undefined;
    }
    return rows[0].state === "CONFIRMED" ? optionalString(rows[0].external_identity) : undefined;
  }

  async confirmSubEffect(
    claim: JiraEffectClaim,
    semanticIdentity: string,
    receipt: string,
    now: Date,
  ): Promise<void> {
    assertClaimInput(claim, now);
    const receiptHash = sha256(receipt as JsonValue);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_sub_effects child
          SET state='CONFIRMED',external_identity=$3,receipt_hash=$4,updated_at=$5
         FROM jira_effect_reconciliations parent
        WHERE parent.id=child.effect_id
          AND parent.effect_id=$1
          AND child.semantic_identity=$2
          AND child.state IN ('PENDING','OBSERVED','APPLIED','CONFIRMED')
          AND (child.external_identity IS NULL OR child.external_identity=$3)
          AND (child.receipt_hash IS NULL OR child.receipt_hash=$4)
          AND parent.lease_owner=$6
          AND parent.lease_token=$7::bigint
          AND parent.lease_until>$5
        RETURNING child.semantic_identity`,
        [claim.effectId, semanticIdentity, receipt, receiptHash, now, claim.owner, claim.token],
      ),
    );
    if (rows.length !== 1) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_SUB_EFFECT_CONFIRMATION_CONFLICT");
    }
  }

  async advance(
    claim: JiraEffectClaim,
    expected: JiraEffectState,
    next: JiraEffectState,
    patch: Readonly<{
      externalEntityId?: string;
      receiptHash?: string;
      externalRevisionToken?: string;
    }> = {},
  ): Promise<void> {
    const now = new Date();
    assertClaimInput(claim, now);
    const rows = mutationRows(
      await this.source.query(
        `UPDATE jira_effect_reconciliations
          SET state=$3,
              external_entity_id=COALESCE($4,external_entity_id),
              receipt_hash=COALESCE($5,receipt_hash),
              external_revision_token=COALESCE($6,external_revision_token),
              updated_at=$7
        WHERE effect_id=$1 AND state=$2
          AND lease_owner=$8
          AND lease_token=$9::bigint
          AND lease_until>$7
        RETURNING id`,
        [
          claim.effectId,
          expected,
          next,
          patch.externalEntityId ?? null,
          patch.receiptHash ?? null,
          patch.externalRevisionToken ?? null,
          now,
          claim.owner,
          claim.token,
        ],
      ),
    );
    if (rows.length !== 1) {
      await this.assertClaim(claim, now);
      throw new Error("JIRA_EFFECT_STATE_CONFLICT");
    }
  }
}

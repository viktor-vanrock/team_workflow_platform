import type { DataSource, EntityManager } from "typeorm";

import {
  type AuthorizedProjectQueryToken,
  bridgePilotGate,
  freezePilotValue,
  pilotContentHash,
  type PilotExecutionVerifier,
  type PilotOnboardingGateResult,
  type PilotRecord,
  type ProjectScope,
} from "@awp/platform-core";

type RecordRow = Readonly<{
  semantic_body: Omit<PilotRecord, "contentHash">;
  content_hash: string;
  workspace_id: string;
  project_id: string;
  record_id: string;
  kind: string;
  version: number;
}>;
const recordColumns =
  "r.semantic_body,r.content_hash,r.workspace_id,r.project_id,r.record_id,r.kind,r.version";
const kinds = new Set(["GATE_EXECUTION", "COHORT", "RECOVERY", "DEPLOYMENT", "FENCE"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
function validate(record: PilotRecord): void {
  const { contentHash, ...body } = record;
  if (
    ![record.id, record.workspaceId, record.projectId, record.actorRef].every((id) =>
      uuid.test(id),
    ) ||
    record.schemaVersion !== 1 ||
    !kinds.has(record.kind) ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !record.correlationId ||
    record.correlationId.length > 255 ||
    !record.body ||
    Array.isArray(record.body) ||
    JSON.stringify(body).length > 1_000_000 ||
    pilotContentHash(body) !== contentHash
  )
    throw new Error("PILOT_RECORD_INVALID");
}
function decode(row: RecordRow): PilotRecord {
  const record = { ...row.semantic_body, contentHash: row.content_hash };
  validate(record);
  if (
    record.workspaceId !== row.workspace_id ||
    record.projectId !== row.project_id ||
    record.id !== row.record_id ||
    record.version !== row.version ||
    record.kind !== row.kind
  )
    throw new Error("PILOT_RECORD_SCOPE_OR_HASH_CONFLICT");
  return freezePilotValue(record);
}

/** Every read is authorized before SQL; immutable revisions and CAS headers share a transaction. */
export class PilotRepository {
  constructor(private readonly source: DataSource) {}

  async recordOnboardingGate(
    input: Parameters<typeof bridgePilotGate>[0],
    verifier: PilotExecutionVerifier,
    manager?: EntityManager,
  ): Promise<PilotOnboardingGateResult> {
    const gate = await bridgePilotGate(input, verifier);
    const persist = async (transaction: EntityManager) => {
      if (!transaction.queryRunner?.isTransactionActive)
        throw new Error("PILOT_TRANSACTION_REQUIRED");
      const { contentHash, ...body } = gate;
      await transaction.query(
        `INSERT INTO project_onboarding_gate_results(gate_result_id,version,workspace_id,project_id,gate_kind,check_key,check_version,subject_refs,outcome,safe_issue_codes,evidence_refs,evaluated_by,evaluated_at,valid_until,semantic_body,content_hash)
        VALUES($1,1,$2,$3,$4,'pilot.execution.bridge','1',$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(gate_result_id) DO NOTHING`,
        [
          gate.id,
          gate.workspaceId,
          gate.projectId,
          gate.gateKind,
          JSON.stringify([gate.subjectRef]),
          gate.outcome,
          JSON.stringify(gate.safeIssueCodes),
          JSON.stringify(gate.evidenceRefs),
          { kind: "SERVICE", principalId: gate.evaluatedBy },
          gate.evaluatedAt,
          gate.validUntil,
          body,
          contentHash,
        ],
      );
      const stored = (await transaction.query(
        "SELECT content_hash FROM project_onboarding_gate_results WHERE gate_result_id=$1 AND workspace_id=$2 AND project_id=$3",
        [gate.id, gate.workspaceId, gate.projectId],
      )) as Array<{ content_hash: string }>;
      if (stored[0]?.content_hash !== contentHash) throw new Error("PILOT_IMMUTABLE_CONFLICT");
      return gate;
    };
    return manager ? await persist(manager) : await this.source.transaction(persist);
  }

  async publish(
    record: PilotRecord,
    expectedRowVersion: number,
    manager?: EntityManager,
  ): Promise<PilotRecord> {
    validate(record);
    if (
      !Number.isSafeInteger(expectedRowVersion) ||
      expectedRowVersion < 0 ||
      record.version !== expectedRowVersion + 1
    )
      throw new Error("PILOT_VERSION_CONFLICT");
    if (manager) {
      if (!manager.queryRunner?.isTransactionActive) throw new Error("PILOT_TRANSACTION_REQUIRED");
      return await this.publishInTransaction(manager, record, expectedRowVersion);
    }
    return await this.source.transaction(
      async (transaction) =>
        await this.publishInTransaction(transaction, record, expectedRowVersion),
    );
  }

  private async publishInTransaction(
    manager: EntityManager,
    record: PilotRecord,
    expected: number,
  ): Promise<PilotRecord> {
    // Serialize the same aggregate, including first publication, without locks across Projects.
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `pilot:${record.workspaceId}:${record.projectId}:${record.id}`,
    ]);
    const scope = [record.workspaceId, record.projectId, record.id];
    const prior = (await manager.query(
      `SELECT ${recordColumns} FROM pilot_record_revisions r WHERE workspace_id=$1 AND project_id=$2 AND record_id=$3 AND version=$4`,
      [...scope, record.version],
    )) as RecordRow[];
    if (prior[0]) {
      const existing = decode(prior[0]);
      if (existing.contentHash !== record.contentHash) throw new Error("PILOT_IMMUTABLE_CONFLICT");
      return existing;
    }
    const { contentHash, ...body } = record;
    await manager.query(
      `INSERT INTO pilot_record_revisions(workspace_id,project_id,record_id,kind,version,schema_version,actor_ref,correlation_id,created_at,semantic_body,content_hash)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,
      [
        ...scope,
        record.kind,
        record.version,
        record.actorRef,
        record.correlationId,
        record.createdAt,
        body,
        contentHash,
      ],
    );
    const updated =
      expected === 0
        ? ((await manager.query(
            `INSERT INTO pilot_record_headers(workspace_id,project_id,record_id,kind,current_version,current_hash,row_version)
          VALUES($1,$2,$3,$4,1,$5,1) ON CONFLICT DO NOTHING RETURNING record_id`,
            [...scope, record.kind, contentHash],
          )) as unknown[])
        : ((await manager.query(
            `UPDATE pilot_record_headers SET current_version=$4,current_hash=$5,row_version=row_version+1
          WHERE workspace_id=$1 AND project_id=$2 AND record_id=$3 AND row_version=$6 AND kind=$7 RETURNING record_id`,
            [...scope, record.version, contentHash, expected, record.kind],
          )) as [unknown[], number]);
    const rows = Array.isArray(updated[0]) ? updated[0] : updated;
    if (rows.length !== 1) throw new Error("PILOT_VERSION_CONFLICT");
    return freezePilotValue(structuredClone(record));
  }

  async current(
    token: AuthorizedProjectQueryToken,
    scope: ProjectScope,
    id: string,
  ): Promise<PilotRecord | undefined> {
    this.authorize(token, scope);
    const values = (await this.source.query(
      `SELECT ${recordColumns} FROM pilot_record_headers h JOIN pilot_record_revisions r
      ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.record_id=$3`,
      [scope.workspaceId, scope.projectId, id],
    )) as RecordRow[];
    return values[0] ? decode(values[0]) : undefined;
  }
  async list(
    token: AuthorizedProjectQueryToken,
    scope: ProjectScope,
    kind: PilotRecord["kind"],
    afterId?: string,
    limit = 50,
  ): Promise<readonly PilotRecord[]> {
    this.authorize(token, scope);
    if (
      !kinds.has(kind) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (afterId !== undefined && !uuid.test(afterId))
    )
      throw new Error("PILOT_QUERY_INVALID");
    const values = (await this.source.query(
      `SELECT ${recordColumns} FROM pilot_record_headers h JOIN pilot_record_revisions r
      ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.kind=$3 AND ($4::uuid IS NULL OR h.record_id>$4) ORDER BY h.record_id LIMIT $5`,
      [scope.workspaceId, scope.projectId, kind, afterId ?? null, limit],
    )) as RecordRow[];
    return Object.freeze(values.map(decode));
  }
  private authorize(token: AuthorizedProjectQueryToken, scope: ProjectScope): void {
    if (token.workspaceId !== scope.workspaceId || token.permission !== "pilot.report.read")
      throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
    token.assert(scope.projectId, 20, "READ");
  }
}

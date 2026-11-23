import type { DataSource, EntityManager } from "typeorm";

import {
  IntakeCandidateAggregate,
  type IntakeCandidateDecision,
  type IntakeCandidateSnapshot,
} from "@awp/platform-core";

export class InMemoryIntakeCandidateRepository {
  readonly #byId = new Map<string, IntakeCandidateSnapshot>();
  readonly #dedupe = new Map<string, string>();
  async create(
    value: IntakeCandidateSnapshot,
  ): Promise<Readonly<{ value: IntakeCandidateSnapshot; replayed: boolean }>> {
    const key = `${value.workspaceId}:${value.projectId}:${value.deduplicationKey}`;
    const id = this.#dedupe.get(key);
    if (id) return Object.freeze({ value: structuredClone(this.#byId.get(id)!), replayed: true });
    this.#dedupe.set(key, value.id);
    this.#byId.set(value.id, structuredClone(value));
    return Object.freeze({ value: structuredClone(value), replayed: false });
  }
  async get(workspaceId: string, projectId: string, id: string) {
    const value = this.#byId.get(id);
    return value?.workspaceId === workspaceId && value.projectId === projectId
      ? structuredClone(value)
      : undefined;
  }
}
const snapshot = (row: Readonly<Record<string, unknown>>): IntakeCandidateSnapshot =>
  Object.freeze({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    deduplicationKey: String(row.deduplication_key),
    state: String(row.state) as IntakeCandidateSnapshot["state"],
    currentSourceObservationVersion: Number(row.current_source_observation_version),
    currentSourceFingerprint: String(row.current_source_fingerprint),
    currentDecisionVersion: Number(row.current_decision_version),
    expiresAt: new Date(String(row.expires_at)),
    ...(row.snoozed_until ? { snoozedUntil: new Date(String(row.snoozed_until)) } : {}),
    ...(row.converted_draft_id ? { convertedDraftId: String(row.converted_draft_id) } : {}),
    rowVersion: Number(row.row_version),
  });
export interface CandidateObservationInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly deduplicationKey: string;
  readonly sourceFingerprint: string;
  readonly sourceEntityVersion: string;
  readonly minimalSummary: unknown;
  readonly expiresAt: Date;
  readonly actionProvenanceRef: string;
  readonly observedAt: Date;
}
export class TypeOrmIntakeCandidateRepository {
  constructor(readonly source: DataSource) {}
  async get(
    workspaceId: string,
    projectId: string,
    id: string,
  ): Promise<IntakeCandidateSnapshot | undefined> {
    const rows = (await this.source.query(
      "SELECT * FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, id],
    )) as Record<string, unknown>[];
    return rows[0] ? snapshot(rows[0]) : undefined;
  }
  async list(workspaceId: string, projectId: string): Promise<readonly IntakeCandidateSnapshot[]> {
    const rows = (await this.source.query(
      "SELECT * FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC,id",
      [workspaceId, projectId],
    )) as readonly Record<string, unknown>[];
    return rows.map(snapshot);
  }
  async discoverOrObserve(input: CandidateObservationInput) {
    return await this.source.transaction(
      "SERIALIZABLE",
      async (manager) => await this.discoverOrObserveInTransaction(manager, input),
    );
  }
  async discoverOrObserveInTransaction(manager: EntityManager, input: CandidateObservationInput) {
    await manager.query(
      "INSERT INTO intake_candidates(id,workspace_id,project_id,deduplication_key,state,current_source_observation_version,current_source_fingerprint,current_decision_version,expires_at,row_version,created_at,updated_at,creation_action_provenance_ref) VALUES($1,$2,$3,$4,'PENDING_CONFIRMATION',1,$5,0,$6,1,$7,$7,$8) ON CONFLICT(workspace_id,project_id,deduplication_key) DO NOTHING",
      [
        input.id,
        input.workspaceId,
        input.projectId,
        input.deduplicationKey,
        input.sourceFingerprint,
        input.expiresAt,
        input.observedAt,
        input.actionProvenanceRef,
      ],
    );
    const rows = (await manager.query(
      "SELECT * FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND deduplication_key=$3 FOR UPDATE",
      [input.workspaceId, input.projectId, input.deduplicationKey],
    )) as readonly Record<string, unknown>[];
    const row = rows[0];
    if (!row) throw new Error("CANDIDATE_DISCOVERY_FAILED");
    const current = snapshot(row);
    const observations = (await manager.query(
      "SELECT version FROM intake_candidate_source_observations WHERE candidate_id=$1 AND source_fingerprint=$2",
      [current.id, input.sourceFingerprint],
    )) as readonly Readonly<{ version: number }>[];
    if (observations[0])
      return Object.freeze({
        value: current,
        observationVersion: observations[0].version,
        replayed: true,
        changed: false,
      });
    const version =
      String(row.id) === input.id && Number(row.current_source_observation_version) === 1
        ? 1
        : current.currentSourceObservationVersion + 1;
    await manager.query(
      "INSERT INTO intake_candidate_source_observations(candidate_id,workspace_id,project_id,version,source_entity_version,source_fingerprint,minimal_summary,action_provenance_ref,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        current.id,
        input.workspaceId,
        input.projectId,
        version,
        input.sourceEntityVersion,
        input.sourceFingerprint,
        JSON.stringify(input.minimalSummary),
        input.actionProvenanceRef,
        input.observedAt,
      ],
    );
    if (version > 1)
      await manager.query(
        "UPDATE intake_candidates SET current_source_observation_version=$4,current_source_fingerprint=$5,state=CASE WHEN state='SNOOZED' THEN 'PENDING_CONFIRMATION' ELSE state END,snoozed_until=CASE WHEN state='SNOOZED' THEN NULL ELSE snoozed_until END,row_version=row_version+1,updated_at=$6 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [
          input.workspaceId,
          input.projectId,
          current.id,
          version,
          input.sourceFingerprint,
          input.observedAt,
        ],
      );
    const value =
      version === 1
        ? current
        : {
            ...current,
            currentSourceObservationVersion: version,
            currentSourceFingerprint: input.sourceFingerprint,
            state: current.state === "SNOOZED" ? "PENDING_CONFIRMATION" : current.state,
            rowVersion: current.rowVersion + 1,
          };
    return Object.freeze({
      value,
      observationVersion: version,
      replayed: false,
      changed: version > 1,
    });
  }
  async decide(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      actorPrincipalId: string;
      actorKind: "HUMAN" | "SERVICE";
      decision: IntakeCandidateDecision;
      expectedRowVersion: number;
      expectedSourceObservationVersion: number;
      snoozedUntil?: Date;
      convertedDraftId?: string;
      authorizationBasisHash: string;
      interactionIntentId?: string;
      actionProvenanceRef: string;
      now: Date;
    }>,
  ) {
    return await this.source.transaction(
      "SERIALIZABLE",
      async (manager) => await this.decideInTransaction(manager, input),
    );
  }
  async decideInTransaction(
    manager: EntityManager,
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      actorPrincipalId: string;
      actorKind: "HUMAN" | "SERVICE";
      decision: IntakeCandidateDecision;
      expectedRowVersion: number;
      expectedSourceObservationVersion: number;
      snoozedUntil?: Date;
      convertedDraftId?: string;
      authorizationBasisHash: string;
      interactionIntentId?: string;
      actionProvenanceRef: string;
      now: Date;
    }>,
  ) {
    const rows = (await manager.query(
      "SELECT * FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      [input.workspaceId, input.projectId, input.candidateId],
    )) as readonly Record<string, unknown>[];
    if (!rows[0]) throw new Error("CANDIDATE_NOT_FOUND");
    const aggregate = IntakeCandidateAggregate.restore(snapshot(rows[0]));
    const value = aggregate.decide(
      input.actorKind,
      input.decision,
      input.now,
      input.expectedRowVersion,
      {
        expectedSourceObservationVersion: input.expectedSourceObservationVersion,
        ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
        ...(input.convertedDraftId ? { convertedDraftId: input.convertedDraftId } : {}),
      },
    );
    const version = value.currentDecisionVersion;
    await manager.query(
      "INSERT INTO intake_candidate_decisions(candidate_id,workspace_id,project_id,version,decision,expected_candidate_version,snoozed_until,actor_principal_id,authorization_basis_hash,interaction_intent_id,action_provenance_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        input.candidateId,
        input.workspaceId,
        input.projectId,
        version,
        input.decision,
        input.expectedRowVersion,
        input.snoozedUntil ?? null,
        input.actorPrincipalId,
        input.authorizationBasisHash,
        input.interactionIntentId ?? null,
        input.actionProvenanceRef,
        input.now,
      ],
    );
    await manager.query(
      "UPDATE intake_candidates SET state=$4,current_decision_version=$5,snoozed_until=$6,converted_draft_id=$7,row_version=$8,updated_at=$9 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [
        input.workspaceId,
        input.projectId,
        input.candidateId,
        value.state,
        value.currentDecisionVersion,
        value.snoozedUntil ?? null,
        value.convertedDraftId ?? null,
        value.rowVersion,
        input.now,
      ],
    );
    return value;
  }
}

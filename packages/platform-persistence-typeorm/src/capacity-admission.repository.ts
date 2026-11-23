import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type CapacityClaimFact,
  type CapacityExpediteFact,
  type CapacityReservationFact,
  computeCapacityAccounting,
  type HumanWipClaimRevision,
  type MeasureOnlyAdmissionDecision,
  type ResourceScope,
  type ReviewCapacityReservationRevision,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const retryable = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  new Set(["40001", "40P01"]).has(String((error as { code?: unknown }).code));

export async function withBoundedSerializationRetry<T>(
  work: (attempt: number) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8)
    throw new Error("CAPACITY_SERIALIZATION_RETRY_LIMIT_INVALID");
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      if (!retryable(error) || attempt === maxAttempts) throw error;
      last = error;
    }
  }
  throw last;
}

export class CapacityAdmissionRepository extends ScopedRepositoryBase {
  async lockWorkspaceCapacity(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    manager: EntityManager,
  ): Promise<Row> {
    const rows = (await manager.query(
      "SELECT * FROM workspace_capacity_heads WHERE workspace_id=$1 FOR UPDATE",
      [scope.workspaceId],
    )) as Row[];
    if (!rows[0]) throw new Error("CAPACITY_HEAD_NOT_FOUND");
    return rows[0];
  }

  async decisionByRequest(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    requestKeyHash: string,
  ): Promise<Row | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      "SELECT * FROM capacity_admission_decisions WHERE workspace_id=$1 AND project_id=$2 AND request_key_hash=$3",
      [requestKeyHash],
    );
    return rows[0];
  }

  async activeClaims(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<readonly Row[]> {
    return await this.projectRows<Row>(
      scope,
      `SELECT * FROM (
         SELECT * FROM work_item_human_wip_claims
          WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
          ORDER BY revision_number DESC LIMIT 1
       ) current_claim WHERE state='ACTIVE'`,
      [workItemId],
    );
  }

  async activeReservations(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
    asOf: string,
  ): Promise<readonly Row[]> {
    return await this.projectRows<Row>(
      scope,
      `SELECT * FROM (
         SELECT * FROM review_capacity_reservations
          WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
          ORDER BY revision_number DESC LIMIT 1
       ) current_reservation WHERE state IN ('HELD','COVERED_BY_CLAIM') AND expires_at>$4`,
      [workItemId, asOf],
    );
  }

  async appendReviewReservationRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    revision: ReviewCapacityReservationRevision,
    sourceRef: Readonly<Record<string, unknown>>,
    manager: EntityManager,
  ): Promise<Readonly<{ outcome: "APPENDED" | "DUPLICATE"; reservationId: string }>> {
    if (revision.workspaceId !== scope.workspaceId || revision.projectId !== scope.projectId)
      throw new Error("REVIEW_RESERVATION_SCOPE_MISMATCH");
    const existing = (await manager.query(
      "SELECT semantic_hash FROM review_capacity_reservations WHERE workspace_id=$1 AND project_id=$2 AND reservation_id=$3",
      [scope.workspaceId, scope.projectId, revision.reservationId],
    )) as Row[];
    if (existing[0]) {
      if (String(existing[0].semantic_hash) !== revision.semanticHash)
        throw new Error("REVIEW_RESERVATION_IDEMPOTENCY_CONFLICT");
      return Object.freeze({
        outcome: "DUPLICATE" as const,
        reservationId: revision.reservationId,
      });
    }
    const current = (await manager.query(
      "SELECT reservation_id,revision_number FROM review_capacity_reservations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY revision_number DESC LIMIT 1",
      [scope.workspaceId, scope.projectId, revision.workItemId],
    )) as Row[];
    if (
      revision.revision !== Number(current[0]?.revision_number ?? 0) + 1 ||
      (revision.revision > 1 && revision.previousRevisionId !== String(current[0]?.reservation_id))
    ) {
      throw new Error("REVIEW_RESERVATION_STALE_REVISION");
    }
    await manager.query(
      `INSERT INTO review_capacity_reservations(
         reservation_id,workspace_id,project_id,work_item_id,revision_number,previous_revision_id,session_ids,state,
         source_ref,cause_set,cause_set_hash,reserved_at,expires_at,completed_at,semantic_hash
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        revision.reservationId,
        scope.workspaceId,
        scope.projectId,
        revision.workItemId,
        revision.revision,
        revision.previousRevisionId ?? null,
        JSON.stringify(revision.sessionIds),
        revision.state,
        JSON.stringify(sourceRef),
        JSON.stringify(revision.causes),
        revision.causeSetHash,
        revision.reservedAt,
        revision.expiresAt,
        revision.completedAt ?? null,
        revision.semanticHash,
      ],
    );
    return Object.freeze({ outcome: "APPENDED" as const, reservationId: revision.reservationId });
  }

  async appendHumanWipClaimRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    revision: HumanWipClaimRevision,
    sourceRef: Readonly<Record<string, unknown>>,
    manager: EntityManager,
  ): Promise<Readonly<{ outcome: "APPENDED" | "DUPLICATE"; claimId: string }>> {
    if (revision.workspaceId !== scope.workspaceId || revision.projectId !== scope.projectId)
      throw new Error("HUMAN_WIP_CLAIM_SCOPE_MISMATCH");
    const existing = (await manager.query(
      "SELECT semantic_hash FROM work_item_human_wip_claims WHERE workspace_id=$1 AND project_id=$2 AND claim_id=$3",
      [scope.workspaceId, scope.projectId, revision.claimId],
    )) as Row[];
    if (existing[0]) {
      if (String(existing[0].semantic_hash) !== revision.semanticHash)
        throw new Error("HUMAN_WIP_CLAIM_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ outcome: "DUPLICATE" as const, claimId: revision.claimId });
    }
    const current = (await manager.query(
      "SELECT claim_id,revision_number FROM work_item_human_wip_claims WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY revision_number DESC LIMIT 1",
      [scope.workspaceId, scope.projectId, revision.workItemId],
    )) as Row[];
    if (
      revision.revision !== Number(current[0]?.revision_number ?? 0) + 1 ||
      (revision.revision > 1 && revision.previousRevisionId !== String(current[0]?.claim_id))
    )
      throw new Error("HUMAN_WIP_CLAIM_STALE_REVISION");
    await manager.query(
      `INSERT INTO work_item_human_wip_claims(
         claim_id,workspace_id,project_id,work_item_id,revision_number,previous_revision_id,session_ids,state,
         source_ref,cause_set,cause_set_hash,acquired_at,released_at,semantic_hash
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        revision.claimId,
        scope.workspaceId,
        scope.projectId,
        revision.workItemId,
        revision.revision,
        revision.previousRevisionId ?? null,
        JSON.stringify(revision.sessionIds),
        revision.state,
        JSON.stringify(sourceRef),
        JSON.stringify(revision.causes),
        revision.causeSetHash,
        revision.acquiredAt,
        revision.releasedAt ?? null,
        revision.semanticHash,
      ],
    );
    return Object.freeze({ outcome: "APPENDED" as const, claimId: revision.claimId });
  }

  async currentHumanWipClaimRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
    manager: EntityManager,
  ): Promise<HumanWipClaimRevision | undefined> {
    const rows = (await manager.query(
      `SELECT * FROM work_item_human_wip_claims
        WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
        ORDER BY revision_number DESC LIMIT 1 FOR UPDATE`,
      [scope.workspaceId, scope.projectId, workItemId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    return Object.freeze({
      claimId: String(row.claim_id),
      revision: Number(row.revision_number),
      ...(row.previous_revision_id ? { previousRevisionId: String(row.previous_revision_id) } : {}),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
      sessionIds: Object.freeze(json<readonly string[]>(row.session_ids)),
      state: String(row.state) as HumanWipClaimRevision["state"],
      causes: Object.freeze(json<HumanWipClaimRevision["causes"]>(row.cause_set)),
      causeSetHash: String(row.cause_set_hash) as `sha256:${string}`,
      acquiredAt: new Date(String(row.acquired_at)).toISOString(),
      ...(row.released_at ? { releasedAt: new Date(String(row.released_at)).toISOString() } : {}),
      semanticHash: String(row.semantic_hash) as `sha256:${string}`,
    });
  }

  async currentReviewReservationRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
    manager: EntityManager,
  ): Promise<ReviewCapacityReservationRevision | undefined> {
    const rows = (await manager.query(
      `SELECT * FROM review_capacity_reservations
        WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
        ORDER BY revision_number DESC LIMIT 1 FOR UPDATE`,
      [scope.workspaceId, scope.projectId, workItemId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    return Object.freeze({
      reservationId: String(row.reservation_id),
      revision: Number(row.revision_number),
      ...(row.previous_revision_id ? { previousRevisionId: String(row.previous_revision_id) } : {}),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
      sessionIds: Object.freeze(json<readonly string[]>(row.session_ids)),
      state: String(row.state) as ReviewCapacityReservationRevision["state"],
      causes: Object.freeze(json<readonly string[]>(row.cause_set)),
      causeSetHash: String(row.cause_set_hash) as `sha256:${string}`,
      reservedAt: new Date(String(row.reserved_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      ...(row.completed_at
        ? { completedAt: new Date(String(row.completed_at)).toISOString() }
        : {}),
      semanticHash: String(row.semantic_hash) as `sha256:${string}`,
    });
  }

  /** Recomputes the Workspace union from append-only current revisions while the caller holds the capacity lock. */
  async reconcileWorkspaceCapacity(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    at: string,
    manager: EntityManager,
    lockedCapacity?: Row,
    apply = true,
  ): Promise<
    Readonly<{
      before: Row;
      accounting: ReturnType<typeof computeCapacityAccounting>;
      changed: boolean;
    }>
  > {
    const capacity = lockedCapacity ?? (await this.lockWorkspaceCapacity(scope, manager));
    const allClaims = (await manager.query(
      `SELECT * FROM (
      SELECT DISTINCT ON (project_id,work_item_id) claim_id,project_id,work_item_id,state,source_ref,cause_set,semantic_hash
        FROM work_item_human_wip_claims WHERE workspace_id=$1 ORDER BY project_id,work_item_id,revision_number DESC
      ) current_claims WHERE state='ACTIVE' ORDER BY project_id,work_item_id,claim_id`,
      [scope.workspaceId],
    )) as Row[];
    const allReservations = (await manager.query(
      `SELECT * FROM (
      SELECT DISTINCT ON (project_id,work_item_id) reservation_id,project_id,work_item_id,state,source_ref,cause_set,semantic_hash
        FROM review_capacity_reservations WHERE workspace_id=$1 ORDER BY project_id,work_item_id,revision_number DESC
      ) current_reservations ORDER BY project_id,work_item_id,reservation_id`,
      [scope.workspaceId],
    )) as Row[];
    const allExpedites = (await manager.query(
      `SELECT revision.project_id,head.work_item_id,revision.control_revision_id,revision.revision_number,revision.semantic_hash
      FROM work_item_queue_control_heads head JOIN work_item_queue_control_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.control_revision_id=head.current_revision_id
      WHERE head.workspace_id=$1 AND revision.service_class='EXPEDITE' AND (revision.expiry_at IS NULL OR revision.expiry_at>$2) ORDER BY revision.project_id,head.work_item_id`,
      [scope.workspaceId, at],
    )) as Row[];
    const accounting = computeCapacityAccounting({
      claims: allClaims.map((row): CapacityClaimFact => ({
        projectId: String(row.project_id),
        workItemId: String(row.work_item_id),
        state: "ACTIVE",
        causes: json(row.cause_set),
        sourceRefs: [json(row.source_ref)],
      })),
      reservations: allReservations.map((row): CapacityReservationFact => ({
        projectId: String(row.project_id),
        workItemId: String(row.work_item_id),
        state: String(row.state) as CapacityReservationFact["state"],
        causes: json(row.cause_set),
        sourceRefs: [json(row.source_ref)],
      })),
      expedites: allExpedites.map((row): CapacityExpediteFact => ({
        projectId: String(row.project_id),
        workItemId: String(row.work_item_id),
        state: "ACTIVE",
        controlRef: {
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: String(row.control_revision_id),
          sourceVersion: Number(row.revision_number),
          semanticHash: String(row.semantic_hash) as `sha256:${string}`,
        },
      })),
      policyMode: String(capacity.state) === "MEASURE_ONLY" ? "MEASURE_ONLY" : "ENFORCED",
    });
    const changed =
      Number(capacity.human_occupied_count) !== accounting.humanOccupiedCount ||
      Number(capacity.review_reserved_count) !== accounting.reviewReservedCount ||
      Number(capacity.human_committed_count) !== accounting.humanCommittedCount ||
      Number(capacity.forced_external_count) !== accounting.forcedExternalCount ||
      Number(capacity.active_expedite_count) !== accounting.activeExpediteCount ||
      String(capacity.claim_set_hash) !== accounting.claimSetHash ||
      String(capacity.reservation_set_hash) !== accounting.reservationSetHash ||
      String(capacity.expedite_set_hash) !== accounting.expediteSetHash;
    if (changed && apply) {
      const updated = (await manager.query(
        `UPDATE workspace_capacity_heads SET current_revision=current_revision+1,resource_version=resource_version+1,
          human_occupied_count=$2,review_reserved_count=$3,human_committed_count=$4,forced_external_count=$5,active_expedite_count=$6,
          claim_set_hash=$7,reservation_set_hash=$8,expedite_set_hash=$9,updated_at=$10 WHERE workspace_id=$1 AND resource_version=$11 RETURNING resource_version`,
        [
          scope.workspaceId,
          accounting.humanOccupiedCount,
          accounting.reviewReservedCount,
          accounting.humanCommittedCount,
          accounting.forcedExternalCount,
          accounting.activeExpediteCount,
          accounting.claimSetHash,
          accounting.reservationSetHash,
          accounting.expediteSetHash,
          at,
          capacity.resource_version,
        ],
      )) as Row[];
      if (!updated[0]) throw new Error("CAPACITY_HEAD_CAS_CONFLICT");
    }
    return Object.freeze({ before: capacity, accounting, changed });
  }

  /** Read-only integrity check used by the ENFORCED activation gate. */
  async validateWorkspaceCapacity(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    at: string,
    manager: EntityManager,
    lockedCapacity?: Row,
  ): Promise<
    Readonly<{
      before: Row;
      accounting: ReturnType<typeof computeCapacityAccounting>;
      valid: boolean;
    }>
  > {
    const checked = await this.reconcileWorkspaceCapacity(
      scope,
      at,
      manager,
      lockedCapacity,
      false,
    );
    return Object.freeze({
      before: checked.before,
      accounting: checked.accounting,
      valid: !checked.changed,
    });
  }

  async commitMeasureOnlyBaseClaim(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      decision: MeasureOnlyAdmissionDecision;
      claimSourceRef: Readonly<Record<string, unknown>>;
      eventPayload: Readonly<Record<string, unknown>>;
      correlationId: string;
      causationId: string;
    }>,
    transactionManager?: EntityManager,
  ): Promise<Readonly<{ outcome: "COMMITTED" | "DUPLICATE"; claimId: string | null }>> {
    const execute = async (manager: EntityManager) => {
      const capacity = await this.lockWorkspaceCapacity(
        { kind: "WORKSPACE", workspaceId: input.scope.workspaceId },
        manager,
      );
      const existing = (await manager.query(
        "SELECT request_hash,committed_effect_refs FROM capacity_admission_decisions WHERE workspace_id=$1 AND project_id=$2 AND request_key_hash=$3 FOR UPDATE",
        [input.scope.workspaceId, input.scope.projectId, input.decision.requestKeyHash],
      )) as Row[];
      if (existing[0]) {
        if (existing[0].request_hash !== input.decision.requestHash)
          throw new Error("CAPACITY_ADMISSION_IDEMPOTENCY_CONFLICT");
        const refs =
          typeof existing[0].committed_effect_refs === "string"
            ? (JSON.parse(existing[0].committed_effect_refs) as readonly Record<string, unknown>[])
            : (existing[0].committed_effect_refs as readonly Record<string, unknown>[]);
        return Object.freeze({
          outcome: "DUPLICATE" as const,
          claimId:
            (refs.find(({ sourceType }) => sourceType === "HUMAN_WIP_CLAIM_REVISION")?.sourceId as
              string | undefined) ?? null,
        });
      }
      const currentClaims = (await manager.query(
        `SELECT * FROM (
           SELECT claim_id,semantic_hash,state FROM work_item_human_wip_claims
            WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
            ORDER BY revision_number DESC LIMIT 1
         ) current_claim WHERE state='ACTIVE'`,
        [input.scope.workspaceId, input.scope.projectId, input.decision.workItemId],
      )) as Row[];
      let claimId: string | null = currentClaims[0] ? String(currentClaims[0].claim_id) : null;
      const committedEffectRefs: Readonly<Record<string, unknown>>[] = [];
      if (!currentClaims[0] && input.decision.claim) {
        claimId = input.decision.claim.claimId;
        const claimBody = Object.freeze({
          claimId,
          workItemId: input.decision.workItemId,
          sessionId: input.decision.sessionId,
          cause: input.decision.claim.cause,
          sourceRef: input.claimSourceRef,
          acquiredAt: input.decision.decidedAt,
        });
        const causeSet = Object.freeze([input.decision.claim.cause]);
        const causeSetHash = sha256(causeSet as JsonValue);
        const claimHash = sha256(claimBody as unknown as JsonValue);
        await manager.query(
          "INSERT INTO work_item_human_wip_claims(claim_id,workspace_id,project_id,work_item_id,revision_number,previous_revision_id,session_ids,state,source_ref,cause_set,cause_set_hash,acquired_at,released_at,semantic_hash) VALUES($1,$2,$3,$4,1,NULL,$5,'ACTIVE',$6,$7,$8,$9,NULL,$10)",
          [
            claimId,
            input.scope.workspaceId,
            input.scope.projectId,
            input.decision.workItemId,
            JSON.stringify([input.decision.sessionId]),
            JSON.stringify(input.claimSourceRef),
            JSON.stringify(causeSet),
            causeSetHash,
            input.decision.decidedAt,
            claimHash,
          ],
        );
        committedEffectRefs.push(
          Object.freeze({
            sourceType: "HUMAN_WIP_CLAIM_REVISION",
            sourceId: claimId,
            sourceVersion: 1,
            semanticHash: claimHash,
          }),
        );
      }
      const allClaims = (await manager.query(
        `SELECT * FROM (
        SELECT DISTINCT ON (project_id,work_item_id) claim_id,project_id,work_item_id,state,source_ref,cause_set,semantic_hash
          FROM work_item_human_wip_claims WHERE workspace_id=$1 ORDER BY project_id,work_item_id,revision_number DESC
        ) current_claims WHERE state='ACTIVE' ORDER BY project_id,work_item_id,claim_id`,
        [input.scope.workspaceId],
      )) as Row[];
      const allReservations = (await manager.query(
        `SELECT * FROM (
        SELECT DISTINCT ON (project_id,work_item_id) reservation_id,project_id,work_item_id,state,source_ref,cause_set,semantic_hash
          FROM review_capacity_reservations WHERE workspace_id=$1 ORDER BY project_id,work_item_id,revision_number DESC
        ) current_reservations ORDER BY project_id,work_item_id,reservation_id`,
        [input.scope.workspaceId],
      )) as Row[];
      const allExpedites = (await manager.query(
        `SELECT revision.project_id,head.work_item_id,revision.control_revision_id,revision.revision_number,revision.semantic_hash
        FROM work_item_queue_control_heads head JOIN work_item_queue_control_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.control_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND revision.service_class='EXPEDITE' AND (revision.expiry_at IS NULL OR revision.expiry_at>$2) ORDER BY revision.project_id,head.work_item_id`,
        [input.scope.workspaceId, input.decision.decidedAt],
      )) as Row[];
      const accounting = computeCapacityAccounting({
        claims: allClaims.map((row): CapacityClaimFact => ({
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          state: "ACTIVE",
          causes: json(row.cause_set),
          sourceRefs: [json(row.source_ref)],
        })),
        reservations: allReservations.map((row): CapacityReservationFact => ({
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          state: String(row.state) as CapacityReservationFact["state"],
          causes: json(row.cause_set),
          sourceRefs: [json(row.source_ref)],
        })),
        expedites: allExpedites.map((row): CapacityExpediteFact => ({
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          state: "ACTIVE",
          controlRef: {
            sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
            sourceId: String(row.control_revision_id),
            sourceVersion: Number(row.revision_number),
            semanticHash: String(row.semantic_hash) as `sha256:${string}`,
          },
        })),
        policyMode: String(capacity.state) === "MEASURE_ONLY" ? "MEASURE_ONLY" : "ENFORCED",
      });
      await manager.query(
        `UPDATE workspace_capacity_heads SET current_revision=current_revision+1,resource_version=resource_version+1,
          human_occupied_count=$2,review_reserved_count=$3,human_committed_count=$4,forced_external_count=$5,active_expedite_count=$6,
          claim_set_hash=$7,reservation_set_hash=$8,expedite_set_hash=$9,updated_at=$10 WHERE workspace_id=$1 AND resource_version=$11`,
        [
          input.scope.workspaceId,
          accounting.humanOccupiedCount,
          accounting.reviewReservedCount,
          accounting.humanCommittedCount,
          accounting.forcedExternalCount,
          accounting.activeExpediteCount,
          accounting.claimSetHash,
          accounting.reservationSetHash,
          accounting.expediteSetHash,
          input.decision.decidedAt,
          capacity.resource_version,
        ],
      );
      await manager.query(
        `INSERT INTO capacity_admission_decisions(decision_id,workspace_id,project_id,work_item_id,request_key_hash,request_hash,activity_kind,outcome,policy_facet_ref,authorization_scope_witness_hash,before_ref,after_ref,action_candidate_ref,approval_ref,committed_effect_refs,violations,warnings,decided_at,semantic_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,$13,'[]'::jsonb,'[]'::jsonb,$14,$15)`,
        [
          input.decision.decisionId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.decision.workItemId,
          input.decision.requestKeyHash,
          input.decision.requestHash,
          input.decision.activityKind,
          input.decision.outcome,
          JSON.stringify(input.decision.policyFacetRef),
          input.decision.authorizationScopeWitnessHash,
          JSON.stringify({
            resourceVersion: Number(capacity.resource_version),
            claimSetHash: capacity.claim_set_hash,
            reservationSetHash: capacity.reservation_set_hash,
            expediteSetHash: capacity.expedite_set_hash,
          }),
          JSON.stringify({
            resourceVersion: Number(capacity.resource_version) + 1,
            claimSetHash: accounting.claimSetHash,
            reservationSetHash: accounting.reservationSetHash,
            expediteSetHash: accounting.expediteSetHash,
          }),
          JSON.stringify(committedEffectRefs),
          input.decision.decidedAt,
          input.decision.semanticHash,
        ],
      );
      const eventId = crypto.randomUUID();
      const envelope = Object.freeze({
        envelopeVersion: 1,
        eventId,
        eventType: "capacity.admission.decided",
        occurredAt: input.decision.decidedAt,
        recordedAt: input.decision.decidedAt,
        producer: "queue.admission",
        producerVersion: "1.0.0",
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        entityType: "capacity-admission",
        entityId: input.decision.decisionId,
        entityVersion: 1,
        correlationId: input.correlationId,
        causationId: input.causationId,
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: input.decision.decisionId,
          serviceKey: "queue.admission",
        }),
        dataClassificationKey: "INTERNAL",
        payloadVersion: 1,
        payloadSchemaRef: Object.freeze({
          id: "urn:awp:schemas:006:capacity-admission:v1",
          version: 1,
          digest: sha256(input.eventPayload as unknown as JsonValue),
        }),
        payload: input.eventPayload,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'capacity.admission.decided',$4,$5,'READY',$6)",
        [
          eventId,
          input.scope.workspaceId,
          input.scope.projectId,
          JSON.stringify(envelope),
          sha256(envelope as unknown as JsonValue),
          input.decision.decidedAt,
        ],
      );
      return Object.freeze({ outcome: "COMMITTED" as const, claimId });
    };
    return transactionManager
      ? await execute(transactionManager)
      : await withBoundedSerializationRetry(
          async () => await this.source.transaction("SERIALIZABLE", execute),
        );
  }
}

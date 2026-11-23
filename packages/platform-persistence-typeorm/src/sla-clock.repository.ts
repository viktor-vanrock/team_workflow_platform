import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type {
  QueueVersionedContentRef,
  ResourceScope,
  SlaClockSegmentRevision,
  SlaClockStartTransition,
  SlaClockTransition,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
type ProjectScope = Extract<ResourceScope, { kind: "PROJECT" }>;
type WorkspaceScope = Extract<ResourceScope, { kind: "WORKSPACE" }>;

const rows = (value: unknown): readonly Row[] => {
  const candidate = value as readonly unknown[];
  return (Array.isArray(candidate?.[0]) ? candidate[0] : candidate) as readonly Row[];
};

const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const sameRef = (left: QueueVersionedContentRef, right: QueueVersionedContentRef): boolean =>
  left.id === right.id &&
  left.version === right.version &&
  left.semanticHash === right.semanticHash;

function assertTransitionHash(value: SlaClockTransition): void {
  const { clockRevisionRef: _clockRevisionRef, ...body } = value;
  void _clockRevisionRef;
  if (
    value.clockRevisionRef.id !== value.slaClockId ||
    value.clockRevisionRef.semanticHash !== sha256(body as unknown as JsonValue)
  ) {
    throw new Error("SLA_CLOCK_TRANSITION_HASH_INVALID");
  }
}

function assertTransitionFingerprint(value: SlaClockTransition): void {
  const expected =
    "previousClockRevisionRef" in value
      ? sha256({
          previousClockRevisionRef: value.previousClockRevisionRef,
          transition: value.transition,
          transitionSourceRef: value.transitionSourceRef,
          ...(value.transition === "PAUSE"
            ? { mappedPauseReasonCode: value.mappedPauseReasonCode }
            : {}),
        } as unknown as JsonValue)
      : sha256({
          goal: value.goal,
          policyFacetRef: value.policyFacetRef,
          calendarRef: value.calendarRef,
          mappingRef: value.mappingRef,
          algorithmRef: value.algorithmRef,
          startSourceRef: value.startSourceRef,
        } as unknown as JsonValue);
  if (value.inputFingerprint !== expected) throw new Error("SLA_CLOCK_INPUT_FINGERPRINT_INVALID");
}

function assertSegmentHash(value: SlaClockSegmentRevision): void {
  const { segmentRef: _segmentRef, ...body } = value;
  void _segmentRef;
  if (value.segmentRef.semanticHash !== sha256(body as unknown as JsonValue))
    throw new Error("SLA_SEGMENT_HASH_INVALID");
}

function sourceVersion(value: SlaClockTransition): number | undefined {
  return value.transitionSourceRef.sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION"
    ? value.transitionSourceRef.sourceVersion
    : undefined;
}

export interface SlaSegmentAppendInput {
  readonly revisionId: string;
  readonly value: SlaClockSegmentRevision;
}

export interface SlaClockAppendInput {
  readonly scope: ProjectScope;
  readonly transition: SlaClockTransition;
  readonly revisionId: string;
  readonly expectedVersion: number;
  readonly targetBusinessSeconds?: number | null;
  readonly warningThresholds?: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[];
  readonly nextTemporalEvaluationAt?: string;
  readonly closedSegment?: SlaSegmentAppendInput;
  readonly openedSegment?: SlaSegmentAppendInput;
  readonly afterAppend?: (manager: EntityManager, transition: SlaClockTransition) => Promise<void>;
}

/** Durable append-only clock and segment store. Mutable heads are CAS pointers only. */
export class SlaClockRepository extends ScopedRepositoryBase {
  async currentClock(
    scope: ProjectScope,
    workItemId: string,
    goal: string,
  ): Promise<SlaClockTransition | undefined> {
    const found = await this.projectRows<Row>(
      scope,
      `SELECT revision.public_transition
         FROM sla_clock_heads head
         JOIN sla_clock_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.sla_clock_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 AND head.goal=$4`,
      [workItemId, goal],
    );
    return found[0] ? json<SlaClockTransition>(found[0].public_transition) : undefined;
  }

  async clockHistory(
    scope: ProjectScope,
    slaClockId: string,
  ): Promise<readonly SlaClockTransition[]> {
    const found = await this.projectRows<Row>(
      scope,
      `SELECT public_transition FROM sla_clock_revisions
        WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3 ORDER BY revision_number`,
      [slaClockId],
    );
    return Object.freeze(found.map((row) => json<SlaClockTransition>(row.public_transition)));
  }

  async segmentHistory(
    scope: ProjectScope,
    slaClockId: string,
  ): Promise<readonly SlaClockSegmentRevision[]> {
    const found = await this.projectRows<Row>(
      scope,
      `SELECT segment.*, start_clock.public_transition AS start_transition, end_clock.public_transition AS end_transition
         FROM sla_clock_segments segment
         JOIN sla_clock_revisions start_clock
           ON start_clock.workspace_id=segment.workspace_id AND start_clock.project_id=segment.project_id
          AND start_clock.sla_clock_revision_id=segment.start_revision_id
         LEFT JOIN sla_clock_revisions end_clock
           ON end_clock.workspace_id=segment.workspace_id AND end_clock.project_id=segment.project_id
          AND end_clock.sla_clock_revision_id=segment.end_revision_id
        WHERE segment.workspace_id=$1 AND segment.project_id=$2 AND segment.sla_clock_id=$3
        ORDER BY segment.ordinal,segment.revision_number`,
      [slaClockId],
    );
    return Object.freeze(
      found.map((row) => {
        const start = json<SlaClockTransition>(row.start_transition);
        const end =
          row.end_transition === null || row.end_transition === undefined
            ? undefined
            : json<SlaClockTransition>(row.end_transition);
        return Object.freeze({
          segmentRef: Object.freeze({
            sourceType: "SLA_CLOCK_SEGMENT_REVISION" as const,
            sourceId: String(row.segment_id),
            sourceVersion: Number(row.revision_number),
            semanticHash: String(
              row.semantic_hash,
            ) as SlaClockSegmentRevision["segmentRef"]["semanticHash"],
          }),
          slaClockId: String(row.sla_clock_id),
          clockCycle: Number(row.clock_cycle),
          ordinal: Number(row.ordinal),
          state: String(row.state) as SlaClockSegmentRevision["state"],
          startedAt: new Date(String(row.started_at)).toISOString(),
          ...(row.ended_at === null || row.ended_at === undefined
            ? {}
            : { endedAt: new Date(String(row.ended_at)).toISOString() }),
          businessSeconds: Number(row.business_seconds),
          startClockRevisionRef: start.clockRevisionRef,
          ...(end ? { endClockRevisionRef: end.clockRevisionRef } : {}),
        });
      }),
    );
  }

  async dueClocks(
    scope: WorkspaceScope,
    dueBefore: string,
    limit: number,
  ): Promise<readonly Row[]> {
    this.#assertDueInput(dueBefore, limit);
    return await this.workspaceRows<Row>(
      scope,
      `SELECT * FROM sla_clock_heads
        WHERE workspace_id=$1 AND next_temporal_evaluation_at <= $2
          AND (temporal_claimed_until IS NULL OR temporal_claimed_until <= $2)
        ORDER BY next_temporal_evaluation_at,project_id,sla_clock_id LIMIT $3`,
      [dueBefore, limit],
    );
  }

  async claimDueClocks(
    input: Readonly<{
      scope: WorkspaceScope;
      dueBefore: string;
      limit: number;
      leaseMilliseconds?: number;
    }>,
  ): Promise<
    readonly Readonly<{
      workspaceId: string;
      projectId: string;
      slaClockId: string;
      dueAt: string;
      claimToken: string;
      claimedUntil: string;
    }>[]
  > {
    this.#assertDueInput(input.dueBefore, input.limit);
    const leaseMilliseconds = input.leaseMilliseconds ?? 300_000;
    if (
      !Number.isSafeInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1_000 ||
      leaseMilliseconds > 3_600_000
    ) {
      throw new Error("SLA_DUE_LEASE_INVALID");
    }
    const claimToken = crypto.randomUUID();
    const claimedUntil = new Date(Date.parse(input.dueBefore) + leaseMilliseconds).toISOString();
    const found = await this.workspaceRows<Row>(
      input.scope,
      `WITH due AS (
         SELECT workspace_id,project_id,sla_clock_id,next_temporal_evaluation_at AS due_at
           FROM sla_clock_heads
          WHERE workspace_id=$1 AND next_temporal_evaluation_at <= $2
            AND (temporal_claimed_until IS NULL OR temporal_claimed_until <= $2)
          ORDER BY next_temporal_evaluation_at,project_id,sla_clock_id
          FOR UPDATE SKIP LOCKED LIMIT $3
       ), claimed AS (
         UPDATE sla_clock_heads head
            SET temporal_claim_token=$4,temporal_claimed_until=$5,updated_at=clock_timestamp()
           FROM due
          WHERE head.workspace_id=due.workspace_id AND head.project_id=due.project_id
            AND head.sla_clock_id=due.sla_clock_id
         RETURNING head.workspace_id,head.project_id,head.sla_clock_id,due.due_at
       ) SELECT * FROM claimed ORDER BY due_at,project_id,sla_clock_id`,
      [input.dueBefore, input.limit, claimToken, claimedUntil],
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          slaClockId: String(row.sla_clock_id),
          dueAt: new Date(String(row.due_at)).toISOString(),
          claimToken,
          claimedUntil,
        }),
      ),
    );
  }

  async completeTemporalClaim(
    input: Readonly<{
      scope: ProjectScope;
      slaClockId: string;
      claimToken: string;
      nextTemporalEvaluationAt?: string;
    }>,
  ): Promise<boolean> {
    if (
      input.nextTemporalEvaluationAt !== undefined &&
      !Number.isFinite(Date.parse(input.nextTemporalEvaluationAt))
    ) {
      throw new Error("SLA_NEXT_TEMPORAL_EVALUATION_INVALID");
    }
    const result = rows(
      await this.source.query(
        `UPDATE sla_clock_heads
          SET next_temporal_evaluation_at=$1,temporal_claim_token=NULL,temporal_claimed_until=NULL,updated_at=clock_timestamp()
        WHERE workspace_id=$2 AND project_id=$3 AND sla_clock_id=$4 AND temporal_claim_token=$5
        RETURNING sla_clock_id`,
        [
          input.nextTemporalEvaluationAt ?? null,
          input.scope.workspaceId,
          input.scope.projectId,
          input.slaClockId,
          input.claimToken,
        ],
      ),
    );
    return result.length === 1;
  }

  async appendTransition(input: SlaClockAppendInput): Promise<
    Readonly<{
      outcome: "APPENDED" | "NO_OP_DUPLICATE";
      revision: number;
    }>
  > {
    const value = input.transition;
    this.assertEntityScope(input.scope, value);
    assertTransitionHash(value);
    assertTransitionFingerprint(value);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      value.clockRevisionRef.version !== input.expectedVersion + 1
    ) {
      throw new Error("SLA_CLOCK_EXPECTED_VERSION_INVALID");
    }
    if (
      input.nextTemporalEvaluationAt !== undefined &&
      !Number.isFinite(Date.parse(input.nextTemporalEvaluationAt))
    ) {
      throw new Error("SLA_NEXT_TEMPORAL_EVALUATION_INVALID");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const headRows = rows(
        await manager.query(
          `SELECT head.*, revision.public_transition, revision.target_business_seconds, revision.warning_thresholds
           FROM sla_clock_heads head
           LEFT JOIN sla_clock_revisions revision
             ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
            AND revision.sla_clock_revision_id=head.current_revision_id
          WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.sla_clock_id=$3
          FOR UPDATE OF head`,
          [value.workspaceId, value.projectId, value.slaClockId],
        ),
      );
      const head = headRows[0];
      if (head) {
        if (String(head.work_item_id) !== value.workItemId || String(head.goal) !== value.goal) {
          throw new Error("SLA_CLOCK_IDENTITY_MISMATCH");
        }
        const existingRows = rows(
          await manager.query(
            `SELECT semantic_hash FROM sla_clock_revisions
            WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3 AND revision_number=$4`,
            [value.workspaceId, value.projectId, value.slaClockId, value.clockRevisionRef.version],
          ),
        );
        if (existingRows[0]) {
          if (String(existingRows[0].semantic_hash) !== value.clockRevisionRef.semanticHash)
            throw new Error("SLA_CLOCK_REVISION_CONFLICT");
          return Object.freeze({
            outcome: "NO_OP_DUPLICATE" as const,
            revision: value.clockRevisionRef.version,
          });
        }
      }

      const currentVersion = head ? Number(head.resource_version) : 0;
      if (currentVersion !== input.expectedVersion) throw new Error("SLA_CLOCK_CAS_CONFLICT");
      const current = head?.public_transition
        ? json<SlaClockTransition>(head.public_transition)
        : undefined;
      this.#assertLineage(value, current);
      await this.#assertMonotonicJiraSource(manager, value);

      const targetBusinessSeconds = current
        ? head?.target_business_seconds === null
          ? null
          : Number(head?.target_business_seconds)
        : (input.targetBusinessSeconds ?? null);
      const warningThresholds = current
        ? (json<readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[] | undefined>(
            head?.warning_thresholds,
          ) ?? [])
        : (input.warningThresholds ?? []);
      this.#assertTargetConfiguration(targetBusinessSeconds, warningThresholds);

      if (!head) {
        await manager.query(
          `INSERT INTO sla_clock_heads(
             sla_clock_id,workspace_id,project_id,work_item_id,goal,current_revision_id,resource_version,current_clock_cycle,
             next_temporal_evaluation_at,temporal_claim_token,temporal_claimed_until,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,NULL,NULL,$9,$9)`,
          [
            value.slaClockId,
            value.workspaceId,
            value.projectId,
            value.workItemId,
            value.goal,
            input.revisionId,
            value.clockCycle,
            input.nextTemporalEvaluationAt ?? null,
            value.effectiveAt,
          ],
        );
      }

      await manager.query(
        `INSERT INTO sla_clock_revisions(
           sla_clock_revision_id,sla_clock_id,workspace_id,project_id,revision_number,previous_revision_id,
           transition_kind,state,goal,clock_cycle,calendar_ref,policy_ref,start_source_ref,transition_source_ref,
           target_business_seconds,warning_thresholds,accumulated_business_seconds,last_started_at,stopped_at,
           public_transition,input_fingerprint,semantic_hash,recorded_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          input.revisionId,
          value.slaClockId,
          value.workspaceId,
          value.projectId,
          value.clockRevisionRef.version,
          current ? String(head!.current_revision_id) : null,
          value.transition,
          value.currentClockState,
          value.goal,
          value.clockCycle,
          JSON.stringify(value.calendarRef),
          JSON.stringify({
            policyFacetRef: value.policyFacetRef,
            mappingRef: value.mappingRef,
            algorithmRef: value.algorithmRef,
          }),
          JSON.stringify(value.startSourceRef),
          JSON.stringify(value.transitionSourceRef),
          targetBusinessSeconds,
          JSON.stringify(warningThresholds),
          value.elapsedBusinessSecondsAtTransition,
          value.currentClockState === "RUNNING" ? value.effectiveAt : null,
          value.currentClockState === "STOPPED" ? value.effectiveAt : null,
          JSON.stringify(value),
          value.inputFingerprint,
          value.clockRevisionRef.semanticHash,
          value.effectiveAt,
        ],
      );

      const openRows = rows(
        await manager.query(
          `SELECT head.*, revision.*
           FROM sla_clock_segment_heads head
           JOIN sla_clock_segments revision
             ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
            AND revision.segment_revision_id=head.current_revision_id
          WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.sla_clock_id=$3 AND head.is_open
          FOR UPDATE OF head`,
          [value.workspaceId, value.projectId, value.slaClockId],
        ),
      );
      const open = openRows[0];
      if (value.transition === "START") {
        if (open || input.closedSegment || !input.openedSegment)
          throw new Error("SLA_SEGMENT_START_APPEND_INVALID");
      } else if (!open || !input.closedSegment) {
        throw new Error("SLA_SEGMENT_CLOSE_APPEND_REQUIRED");
      }
      if (input.closedSegment)
        await this.#closeSegment(manager, value, input.revisionId, open!, input.closedSegment);
      if (input.openedSegment) {
        const priorOrdinalRows = rows(
          await manager.query(
            `SELECT COALESCE(MAX(ordinal),0) AS ordinal FROM sla_clock_segment_heads
            WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3`,
            [value.workspaceId, value.projectId, value.slaClockId],
          ),
        );
        await this.#openSegment(
          manager,
          value,
          input.revisionId,
          Number(priorOrdinalRows[0]?.ordinal ?? 0) + 1,
          input.openedSegment,
        );
      } else if (value.currentClockState !== "STOPPED") {
        throw new Error("SLA_SEGMENT_OPEN_APPEND_REQUIRED");
      }

      if (head) {
        const updated = rows(
          await manager.query(
            `UPDATE sla_clock_heads
              SET current_revision_id=$1,resource_version=$2,current_clock_cycle=$3,next_temporal_evaluation_at=$4,
                  temporal_claim_token=NULL,temporal_claimed_until=NULL,updated_at=$5
            WHERE workspace_id=$6 AND project_id=$7 AND sla_clock_id=$8 AND resource_version=$9
            RETURNING sla_clock_id`,
            [
              input.revisionId,
              value.clockRevisionRef.version,
              value.clockCycle,
              input.nextTemporalEvaluationAt ?? null,
              value.effectiveAt,
              value.workspaceId,
              value.projectId,
              value.slaClockId,
              input.expectedVersion,
            ],
          ),
        );
        if (updated.length !== 1) throw new Error("SLA_CLOCK_CAS_CONFLICT");
      }
      await input.afterAppend?.(manager, value);
      return Object.freeze({
        outcome: "APPENDED" as const,
        revision: value.clockRevisionRef.version,
      });
    });
  }

  async startInitial(
    input: Readonly<{
      scope: ProjectScope;
      transition: SlaClockStartTransition;
      revisionId: string;
      segmentId: string;
      targetBusinessSeconds: number | null;
      warningThresholds: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[];
      nextTemporalEvaluationAt?: string;
      correlationId: string;
      causationId: string;
      afterAppend?: (manager: EntityManager, transition: SlaClockTransition) => Promise<void>;
    }>,
  ): Promise<Readonly<{ outcome: "STARTED" | "NO_OP_DUPLICATE"; revision: 1 }>> {
    const transition = input.transition;
    const segmentBody = Object.freeze({
      slaClockId: transition.slaClockId,
      clockCycle: transition.clockCycle,
      ordinal: 1,
      state: "RUNNING" as const,
      startedAt: transition.effectiveAt,
      businessSeconds: 0,
      startClockRevisionRef: transition.clockRevisionRef,
    });
    const opened = Object.freeze({
      ...segmentBody,
      segmentRef: Object.freeze({
        sourceType: "SLA_CLOCK_SEGMENT_REVISION" as const,
        sourceId: input.segmentId,
        sourceVersion: 1,
        semanticHash: sha256(segmentBody as unknown as JsonValue),
      }),
    });
    const result = await this.appendTransition({
      scope: input.scope,
      transition,
      revisionId: input.revisionId,
      expectedVersion: 0,
      targetBusinessSeconds: input.targetBusinessSeconds,
      warningThresholds: input.warningThresholds,
      ...(input.nextTemporalEvaluationAt
        ? { nextTemporalEvaluationAt: input.nextTemporalEvaluationAt }
        : {}),
      openedSegment: { revisionId: input.segmentId, value: opened },
      ...(input.afterAppend ? { afterAppend: input.afterAppend } : {}),
    });
    return Object.freeze({
      outcome: result.outcome === "APPENDED" ? "STARTED" : "NO_OP_DUPLICATE",
      revision: 1,
    });
  }

  async appendThresholdEmission(
    input: Readonly<{
      scope: ProjectScope;
      emissionId: string;
      slaClockId: string;
      clockCycle: number;
      policyFacetRef: QueueVersionedContentRef;
      clockRevisionRef: QueueVersionedContentRef;
      thresholdKey: string;
      thresholdKind: "WARNING" | "BREACH";
      reachedAt: string;
      payload: JsonValue;
      notificationIntentId?: string;
      notificationCreationHash?: string;
      afterAppend?: (manager: EntityManager) => Promise<void>;
    }>,
  ): Promise<Readonly<{ outcome: "APPENDED" | "NO_OP_DUPLICATE" }>> {
    if (
      !Number.isSafeInteger(input.clockCycle) ||
      input.clockCycle < 1 ||
      !input.thresholdKey ||
      !Number.isFinite(Date.parse(input.reachedAt))
    )
      throw new Error("SLA_THRESHOLD_INPUT_INVALID");
    const semanticHash = sha256(input.payload);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const clockRows = rows(
        await manager.query(
          `SELECT public_transition FROM sla_clock_revisions
          WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3 AND revision_number=$4`,
          [
            input.scope.workspaceId,
            input.scope.projectId,
            input.slaClockId,
            input.clockRevisionRef.version,
          ],
        ),
      );
      const transition = clockRows[0]
        ? json<SlaClockTransition>(clockRows[0].public_transition)
        : undefined;
      if (
        !transition ||
        !sameRef(transition.clockRevisionRef, input.clockRevisionRef) ||
        transition.clockCycle !== input.clockCycle ||
        transition.policyFacetRef.semanticHash !== input.policyFacetRef.semanticHash ||
        !sameRef(transition.policyFacetRef, input.policyFacetRef)
      )
        throw new Error("SLA_THRESHOLD_CLOCK_REF_INVALID");
      const existing = rows(
        await manager.query(
          `SELECT semantic_hash FROM sla_threshold_emissions
          WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3 AND clock_cycle=$4
            AND policy_facet_hash=$5 AND threshold_kind=$6 AND threshold_key=$7 FOR UPDATE`,
          [
            input.scope.workspaceId,
            input.scope.projectId,
            input.slaClockId,
            input.clockCycle,
            input.policyFacetRef.semanticHash,
            input.thresholdKind,
            input.thresholdKey,
          ],
        ),
      );
      if (existing[0]) {
        if (String(existing[0].semantic_hash) !== semanticHash)
          throw new Error("SLA_THRESHOLD_REPLAY_CONFLICT");
        return Object.freeze({ outcome: "NO_OP_DUPLICATE" as const });
      }
      await manager.query(
        `INSERT INTO sla_threshold_emissions(
           emission_id,workspace_id,project_id,sla_clock_id,clock_cycle,policy_facet_hash,clock_revision_ref,
           threshold_key,threshold_kind,reached_at,notification_intent_id,notification_creation_hash,payload,semantic_hash
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          input.emissionId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.slaClockId,
          input.clockCycle,
          input.policyFacetRef.semanticHash,
          JSON.stringify(input.clockRevisionRef),
          input.thresholdKey,
          input.thresholdKind,
          input.reachedAt,
          input.notificationIntentId ?? null,
          input.notificationCreationHash ?? null,
          JSON.stringify(input.payload),
          semanticHash,
        ],
      );
      await input.afterAppend?.(manager);
      return Object.freeze({ outcome: "APPENDED" as const });
    });
  }

  #assertDueInput(dueBefore: string, limit: number): void {
    if (!Number.isFinite(Date.parse(dueBefore))) throw new Error("SLA_DUE_INSTANT_INVALID");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error("SLA_DUE_LIMIT_INVALID");
  }

  #assertTargetConfiguration(
    targetBusinessSeconds: number | null,
    warningThresholds: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[],
  ): void {
    if (
      targetBusinessSeconds !== null &&
      (!Number.isSafeInteger(targetBusinessSeconds) || targetBusinessSeconds <= 0)
    ) {
      throw new Error("SLA_TARGET_INVALID");
    }
    let previous = 0;
    const keys = new Set<string>();
    for (const threshold of warningThresholds) {
      if (
        !threshold.key ||
        keys.has(threshold.key) ||
        !Number.isSafeInteger(threshold.elapsedBusinessSeconds) ||
        threshold.elapsedBusinessSeconds <= previous ||
        (targetBusinessSeconds !== null &&
          threshold.elapsedBusinessSeconds >= targetBusinessSeconds)
      ) {
        throw new Error("SLA_WARNING_THRESHOLDS_INVALID");
      }
      keys.add(threshold.key);
      previous = threshold.elapsedBusinessSeconds;
    }
  }

  #assertLineage(value: SlaClockTransition, current: SlaClockTransition | undefined): void {
    if (!current) {
      if (
        value.transition !== "START" ||
        value.previousClockState !== "NOT_STARTED" ||
        value.currentClockState !== "RUNNING" ||
        value.clockCycle !== 1 ||
        value.clockRevisionRef.version !== 1 ||
        "previousClockRevisionRef" in value ||
        value.transitionSourceRef.sourceType !== value.startSourceRef.sourceType ||
        value.transitionSourceRef.sourceId !== value.startSourceRef.sourceId ||
        value.transitionSourceRef.sourceVersion !== value.startSourceRef.sourceVersion ||
        value.transitionSourceRef.semanticHash !== value.startSourceRef.semanticHash ||
        value.effectiveAt !== value.startSourceRef.confirmedAt
      ) {
        throw new Error("SLA_CLOCK_INITIAL_LINEAGE_INVALID");
      }
      return;
    }
    if (
      !("previousClockRevisionRef" in value) ||
      !sameRef(value.previousClockRevisionRef, current.clockRevisionRef) ||
      value.clockRevisionRef.version !== current.clockRevisionRef.version + 1 ||
      value.previousClockState !== current.currentClockState ||
      value.workItemId !== current.workItemId ||
      value.goal !== current.goal ||
      value.slaClockId !== current.slaClockId ||
      !sameRef(value.policyFacetRef, current.policyFacetRef) ||
      !sameRef(value.calendarRef, current.calendarRef) ||
      value.mappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION" ||
      current.mappingRef.sourceType !== "JIRA_STATUS_MAPPING_REVISION" ||
      JSON.stringify(value.mappingRef) !== JSON.stringify(current.mappingRef) ||
      JSON.stringify(value.algorithmRef) !== JSON.stringify(current.algorithmRef) ||
      Date.parse(value.effectiveAt) < Date.parse(current.effectiveAt)
    ) {
      throw new Error("SLA_CLOCK_LINEAGE_INVALID");
    }
    const reopen = value.transition === "START";
    if (
      (reopen &&
        (current.currentClockState !== "STOPPED" || value.clockCycle !== current.clockCycle + 1)) ||
      (!reopen && value.clockCycle !== current.clockCycle)
    )
      throw new Error("SLA_CLOCK_CYCLE_INVALID");
    if (
      (reopen &&
        (value.elapsedBusinessSecondsAtTransition !== 0 ||
          !("confirmedAt" in value.transitionSourceRef) ||
          JSON.stringify(value.startSourceRef) !== JSON.stringify(value.transitionSourceRef))) ||
      (!reopen &&
        (value.elapsedBusinessSecondsAtTransition < current.elapsedBusinessSecondsAtTransition ||
          JSON.stringify(value.startSourceRef) !== JSON.stringify(current.startSourceRef)))
    ) {
      throw new Error("SLA_CLOCK_CYCLE_LINEAGE_INVALID");
    }
    const stateValid =
      value.transition === "START"
        ? value.previousClockState === "STOPPED" && value.currentClockState === "RUNNING"
        : value.transition === "PAUSE"
          ? value.previousClockState === "RUNNING" && value.currentClockState === "PAUSED"
          : value.transition === "RESUME"
            ? value.previousClockState === "PAUSED" && value.currentClockState === "RUNNING"
            : (value.previousClockState === "RUNNING" || value.previousClockState === "PAUSED") &&
              value.currentClockState === "STOPPED";
    if (!stateValid) throw new Error("SLA_CLOCK_TRANSITION_STATE_INVALID");
    if (
      (value.transition === "PAUSE" || value.transition === "RESUME") &&
      value.transitionSourceRef.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION"
    ) {
      throw new Error("SLA_CLOCK_JIRA_SOURCE_INVALID");
    }
    if (
      value.transition === "STOP" &&
      ((value.goal === "READY_TO_FIRST_QA_START" &&
        value.transitionSourceRef.sourceType !== "QA_TEST_SESSION_REVISION") ||
        (value.goal === "READY_TO_SIGNED_VERDICT" &&
          value.transitionSourceRef.sourceType !== "QA_VERDICT_REVISION"))
    ) {
      throw new Error("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
    }
    if (
      value.transition !== "STOP" &&
      "confirmedAt" in value.transitionSourceRef &&
      value.effectiveAt !== value.transitionSourceRef.confirmedAt
    )
      throw new Error("SLA_CLOCK_EFFECTIVE_TIME_MISMATCH");
  }

  async #assertMonotonicJiraSource(
    manager: EntityManager,
    value: SlaClockTransition,
  ): Promise<void> {
    const next = sourceVersion(value);
    if (next === undefined) return;
    if (!Number.isSafeInteger(next) || next < 1) throw new Error("SLA_CLOCK_JIRA_SOURCE_INVALID");
    const found = rows(
      await manager.query(
        `SELECT MAX((public_transition->'transitionSourceRef'->>'sourceVersion')::bigint) AS source_version
         FROM sla_clock_revisions
        WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3
          AND public_transition->'transitionSourceRef'->>'sourceType'='JIRA_OPERATIONAL_PROJECTION_REVISION'`,
        [value.workspaceId, value.projectId, value.slaClockId],
      ),
    );
    const prior = found[0]?.source_version;
    if (prior !== null && prior !== undefined && next <= Number(prior))
      throw new Error("SLA_CLOCK_JIRA_SOURCE_NON_MONOTONIC");
  }

  async #closeSegment(
    manager: EntityManager,
    transition: SlaClockTransition,
    endClockRevisionId: string,
    open: Row,
    input: SlaSegmentAppendInput,
  ): Promise<void> {
    const value = input.value;
    assertSegmentHash(value);
    const expectedVersion = Number(open.resource_version) + 1;
    if (
      value.segmentRef.sourceId !== String(open.segment_id) ||
      value.segmentRef.sourceVersion !== expectedVersion ||
      value.slaClockId !== transition.slaClockId ||
      value.clockCycle !== Number(open.clock_cycle) ||
      value.ordinal !== Number(open.ordinal) ||
      value.state !== String(open.state) ||
      value.startedAt !== new Date(String(open.started_at)).toISOString() ||
      value.endedAt !== transition.effectiveAt ||
      !value.endClockRevisionRef ||
      !sameRef(value.endClockRevisionRef, transition.clockRevisionRef) ||
      !Number.isSafeInteger(value.businessSeconds) ||
      value.businessSeconds < 0
    ) {
      throw new Error("SLA_SEGMENT_CLOSE_LINEAGE_INVALID");
    }
    await manager.query(
      `INSERT INTO sla_clock_segments(
         segment_revision_id,segment_id,sla_clock_id,workspace_id,project_id,revision_number,previous_revision_id,
         clock_cycle,ordinal,state,started_at,ended_at,start_revision_id,end_revision_id,business_seconds,semantic_hash
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.revisionId,
        value.segmentRef.sourceId,
        value.slaClockId,
        transition.workspaceId,
        transition.projectId,
        value.segmentRef.sourceVersion,
        String(open.current_revision_id),
        value.clockCycle,
        value.ordinal,
        value.state,
        value.startedAt,
        value.endedAt,
        String(open.start_revision_id),
        endClockRevisionId,
        value.businessSeconds,
        value.segmentRef.semanticHash,
      ],
    );
    const updated = rows(
      await manager.query(
        `UPDATE sla_clock_segment_heads
          SET current_revision_id=$1,resource_version=$2,is_open=false,updated_at=$3
        WHERE workspace_id=$4 AND project_id=$5 AND segment_id=$6 AND resource_version=$7 AND is_open
        RETURNING segment_id`,
        [
          input.revisionId,
          value.segmentRef.sourceVersion,
          transition.effectiveAt,
          transition.workspaceId,
          transition.projectId,
          value.segmentRef.sourceId,
          expectedVersion - 1,
        ],
      ),
    );
    if (updated.length !== 1) throw new Error("SLA_SEGMENT_CAS_CONFLICT");
  }

  async #openSegment(
    manager: EntityManager,
    transition: SlaClockTransition,
    startClockRevisionId: string,
    expectedOrdinal: number,
    input: SlaSegmentAppendInput,
  ): Promise<void> {
    const value = input.value;
    assertSegmentHash(value);
    if (
      value.segmentRef.sourceVersion !== 1 ||
      value.slaClockId !== transition.slaClockId ||
      value.clockCycle !== transition.clockCycle ||
      value.ordinal !== expectedOrdinal ||
      value.state !== transition.currentClockState ||
      value.endedAt !== undefined ||
      value.startedAt !== transition.effectiveAt ||
      value.businessSeconds !== 0 ||
      !sameRef(value.startClockRevisionRef, transition.clockRevisionRef)
    ) {
      throw new Error("SLA_SEGMENT_OPEN_LINEAGE_INVALID");
    }
    await manager.query(
      `INSERT INTO sla_clock_segment_heads(
         segment_id,sla_clock_id,workspace_id,project_id,clock_cycle,ordinal,state,current_revision_id,
         resource_version,is_open,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,true,$9,$9)`,
      [
        value.segmentRef.sourceId,
        value.slaClockId,
        transition.workspaceId,
        transition.projectId,
        value.clockCycle,
        value.ordinal,
        value.state,
        input.revisionId,
        transition.effectiveAt,
      ],
    );
    await manager.query(
      `INSERT INTO sla_clock_segments(
         segment_revision_id,segment_id,sla_clock_id,workspace_id,project_id,revision_number,previous_revision_id,
         clock_cycle,ordinal,state,started_at,ended_at,start_revision_id,end_revision_id,business_seconds,semantic_hash
       ) VALUES($1,$2,$3,$4,$5,1,NULL,$6,$7,$8,$9,NULL,$10,NULL,0,$11)`,
      [
        input.revisionId,
        value.segmentRef.sourceId,
        value.slaClockId,
        transition.workspaceId,
        transition.projectId,
        value.clockCycle,
        value.ordinal,
        value.state,
        value.startedAt,
        startClockRevisionId,
        value.segmentRef.semanticHash,
      ],
    );
  }
}

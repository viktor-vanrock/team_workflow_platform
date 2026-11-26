import type { DataSource } from "typeorm";

import type {
  BusinessCalendarRevision,
  QueueVersionedContentRef,
  SlaClockSegmentRevision,
  SlaClockTransition,
} from "@awp/platform-core";
import { SlaClockRepository } from "@awp/platform-persistence-typeorm";

import type { SlaTargetGoalConfiguration } from "./portfolio-query.ts";
import {
  planSlaThresholds,
  type SlaThresholdCrossing,
  type SlaThresholdNotificationService,
} from "./sla-notifications.ts";

export interface QueuePolicyAgingBandBoundary {
  readonly key: string;
  readonly upperBoundBusinessSeconds: number;
}

export function readyAgingBandAt(
  input: Readonly<{
    readyAt: string;
    asOf: string;
    elapsedBusinessSeconds: number;
    bands: readonly QueuePolicyAgingBandBoundary[];
    addBusinessSeconds: (instant: string, seconds: number) => string;
  }>,
): Readonly<{ agingBandKey: string; businessSeconds: number; nextEvaluationAt?: string }> {
  if (!Number.isFinite(Date.parse(input.readyAt)) || !Number.isFinite(Date.parse(input.asOf)))
    throw new Error("QUEUE_READY_AGING_INSTANT_INVALID");
  if (!Number.isSafeInteger(input.elapsedBusinessSeconds) || input.elapsedBusinessSeconds < 0)
    throw new Error("QUEUE_READY_AGING_ELAPSED_INVALID");
  let previous = 0;
  for (const band of input.bands) {
    if (
      !band.key ||
      !Number.isSafeInteger(band.upperBoundBusinessSeconds) ||
      band.upperBoundBusinessSeconds <= previous
    ) {
      throw new Error("QUEUE_READY_AGING_BANDS_INVALID");
    }
    previous = band.upperBoundBusinessSeconds;
  }
  const index = input.bands.findIndex(
    ({ upperBoundBusinessSeconds }) => input.elapsedBusinessSeconds < upperBoundBusinessSeconds,
  );
  if (index < 0)
    return Object.freeze({
      agingBandKey: `${String(input.bands.length).padStart(2, "0")}-OLDEST`,
      businessSeconds: input.elapsedBusinessSeconds,
    });
  const band = input.bands[index]!;
  const nextEvaluationAt = input.addBusinessSeconds(input.readyAt, band.upperBoundBusinessSeconds);
  if (
    !Number.isFinite(Date.parse(nextEvaluationAt)) ||
    Date.parse(nextEvaluationAt) <= Date.parse(input.asOf)
  ) {
    throw new Error("QUEUE_READY_AGING_NEXT_EVALUATION_INVALID");
  }
  return Object.freeze({
    agingBandKey: band.key,
    businessSeconds: input.elapsedBusinessSeconds,
    nextEvaluationAt,
  });
}

export type QueueTemporalDue =
  | Readonly<{
      kind: "QUEUE_ENTRY";
      workspaceId: string;
      projectId: string;
      subjectId: string;
      dueAt: string;
      claimToken?: string;
    }>
  | Readonly<{
      kind: "SLA_CLOCK";
      workspaceId: string;
      projectId: string;
      subjectId: string;
      dueAt: string;
      claimToken?: string;
    }>
  | Readonly<{
      kind: "ORDER_OVERRIDE";
      workspaceId: string;
      projectId: string;
      subjectId: string;
      dueAt: string;
      orderScopeId: string;
      overrideId: string;
      semanticHash: string;
      sourceVersion: number;
    }>
  | Readonly<{
      kind: "EXPEDITE";
      workspaceId: string;
      projectId: string;
      subjectId: string;
      dueAt: string;
      controlId: string;
      controlRevisionId: string;
      semanticHash: string;
      sourceVersion: number;
      expectedControlVersion: number;
      recordedBy: string;
    }>;

export interface QueueTemporalEvaluationResult {
  readonly changed: boolean;
  readonly nextEvaluationAt?: string;
}

export interface SlaTemporalClockContext {
  readonly transition: SlaClockTransition;
  readonly segments: readonly SlaClockSegmentRevision[];
  readonly calendar: BusinessCalendarRevision;
  readonly target: SlaTargetGoalConfiguration;
}

export interface SlaTemporalThresholdPorts {
  readonly loadClock: (
    input: Extract<QueueTemporalDue, { kind: "SLA_CLOCK" }>,
  ) => Promise<SlaTemporalClockContext | undefined>;
  readonly notificationExpiresAt: (crossing: SlaThresholdCrossing) => string;
}

/** Rebuilds threshold truth from the pinned clock inputs after every durable wake-up. */
export class SlaTemporalThresholdEvaluator {
  constructor(
    private readonly ports: SlaTemporalThresholdPorts,
    private readonly notifications: SlaThresholdNotificationService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async evaluate(
    input: Extract<QueueTemporalDue, { kind: "SLA_CLOCK" }>,
  ): Promise<QueueTemporalEvaluationResult> {
    const asOf = this.now();
    if (!Number.isFinite(Date.parse(asOf))) throw new Error("SLA_TEMPORAL_NOW_INVALID");
    const context = await this.ports.loadClock(input);
    if (!context) return Object.freeze({ changed: false });
    if (
      context.transition.workspaceId !== input.workspaceId ||
      context.transition.projectId !== input.projectId ||
      context.transition.slaClockId !== input.subjectId
    )
      throw new Error("SLA_TEMPORAL_CLOCK_SCOPE_MISMATCH");
    const plan = planSlaThresholds({ ...context, asOf });
    let changed = false;
    for (const crossing of plan.crossings) {
      const result = await this.notifications.emit({
        transition: context.transition,
        crossing,
        expiresAt: this.ports.notificationExpiresAt(crossing),
      });
      if (result.outcome === "APPENDED") changed = true;
    }
    return Object.freeze({
      changed,
      ...(plan.nextEvaluationAt ? { nextEvaluationAt: plan.nextEvaluationAt } : {}),
    });
  }
}

export interface QueueTemporalTransitionPorts {
  claimDue(
    input: Readonly<{ dueBefore: string; batchSize: number }>,
  ): Promise<readonly QueueTemporalDue[]>;
  evaluateQueueEntry(
    input: Extract<QueueTemporalDue, { kind: "QUEUE_ENTRY" }>,
  ): Promise<QueueTemporalEvaluationResult>;
  evaluateSlaClock?(
    input: Extract<QueueTemporalDue, { kind: "SLA_CLOCK" }>,
  ): Promise<QueueTemporalEvaluationResult>;
  expireOrderOverride(
    input: Extract<QueueTemporalDue, { kind: "ORDER_OVERRIDE" }>,
  ): Promise<Readonly<{ changed: boolean }>>;
  expireExpedite(
    input: Extract<QueueTemporalDue, { kind: "EXPEDITE" }>,
  ): Promise<Readonly<{ changed: boolean }>>;
  complete(input: QueueTemporalDue, nextEvaluationAt: string | undefined): Promise<void>;
  release?(input: QueueTemporalDue): Promise<void>;
}

/** Executes only rows made due by PostgreSQL; it is not reachable from queue reads. */
export class QueueTemporalTransitionSweep {
  constructor(
    private readonly ports: QueueTemporalTransitionPorts,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async run(input: Readonly<{ trigger: "STARTUP" | "PERIODIC"; batchSize?: number }>): Promise<
    Readonly<{
      claimed: number;
      semanticChanges: number;
      rescheduled: number;
      completed: number;
    }>
  > {
    const batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
      throw new Error("QUEUE_TEMPORAL_BATCH_INVALID");
    const dueBefore = this.now();
    if (!Number.isFinite(Date.parse(dueBefore))) throw new Error("QUEUE_TEMPORAL_NOW_INVALID");
    const due = await this.ports.claimDue({ dueBefore, batchSize });
    if (due.length > batchSize) throw new Error("QUEUE_TEMPORAL_CLAIM_OVERFLOW");
    let semanticChanges = 0;
    let rescheduled = 0;
    let completed = 0;
    for (const item of due) {
      try {
        const result =
          item.kind === "QUEUE_ENTRY"
            ? await this.ports.evaluateQueueEntry(item)
            : item.kind === "SLA_CLOCK"
              ? this.ports.evaluateSlaClock
                ? await this.ports.evaluateSlaClock(item)
                : Object.freeze({ changed: false })
              : item.kind === "ORDER_OVERRIDE"
                ? await this.ports.expireOrderOverride(item)
                : await this.ports.expireExpedite(item);
        if (result.changed) semanticChanges += 1;
        const nextEvaluationAt =
          "nextEvaluationAt" in result && typeof result.nextEvaluationAt === "string"
            ? result.nextEvaluationAt
            : undefined;
        await this.ports.complete(item, nextEvaluationAt);
        if (nextEvaluationAt) rescheduled += 1;
        else completed += 1;
      } catch (error) {
        await this.ports.release?.(item);
        throw error;
      }
    }
    return Object.freeze({ claimed: due.length, semanticChanges, rescheduled, completed });
  }
}

type Row = Readonly<Record<string, unknown>>;
const rowsOf = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  if (!Array.isArray(raw)) return Object.freeze([]);
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const iso = (value: unknown): string => new Date(String(value)).toISOString();
const dateOnly = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Resolves a due clock only through its immutable transition and exact pinned calendar revision. */
export class PostgresBusinessCalendarRevisionReader {
  constructor(private readonly source: DataSource) {}

  async read(
    workspaceId: string,
    ref: QueueVersionedContentRef,
  ): Promise<BusinessCalendarRevision | undefined> {
    const calendars = rowsOf(
      await this.source.query(
        `SELECT head.calendar_key,revision.*
         FROM workspace_business_calendar_revisions revision
         JOIN workspace_business_calendar_heads head
           ON head.workspace_id=revision.workspace_id AND head.calendar_id=revision.calendar_id
        WHERE revision.workspace_id=$1 AND revision.calendar_id=$2
          AND revision.revision_number=$3 AND revision.semantic_hash=$4`,
        [workspaceId, ref.id, ref.version, ref.semanticHash],
      ),
    );
    const row = calendars[0];
    if (!row) return undefined;
    return Object.freeze({
      schemaVersion: "business-calendar@1.0.0" as const,
      calendarId: String(row.calendar_id),
      calendarKey: String(row.calendar_key),
      workspaceId: String(row.workspace_id),
      revision: Number(row.revision_number),
      timeZone: String(row.time_zone),
      validFrom: dateOnly(row.valid_from),
      validThrough:
        row.valid_through === null || row.valid_through === undefined
          ? null
          : dateOnly(row.valid_through),
      weeklyIntervals: json<BusinessCalendarRevision["weeklyIntervals"]>(row.weekly_intervals),
      dateOverrides: json<BusinessCalendarRevision["dateOverrides"]>(row.date_overrides),
      dstAlgorithmRef: json<BusinessCalendarRevision["dstAlgorithmRef"]>(row.dst_algorithm_ref),
      dstRules: json<BusinessCalendarRevision["dstRules"]>(row.dst_rules),
      sourceKind: String(row.source_kind) as BusinessCalendarRevision["sourceKind"],
      sourceRef: String(row.source_ref),
      sourceHash: String(row.source_hash) as BusinessCalendarRevision["sourceHash"],
      ownerPrincipalId: String(row.owner_principal_id),
      effectiveFrom: iso(row.effective_from),
      publishedAt: iso(row.published_at),
      publishedByPrincipalId: String(row.published_by),
      semanticHash: String(row.semantic_hash) as BusinessCalendarRevision["semanticHash"],
    });
  }
}

export class PostgresSlaTemporalClockLoader {
  readonly #clocks: SlaClockRepository;
  readonly #calendars: PostgresBusinessCalendarRevisionReader;

  constructor(private readonly source: DataSource) {
    this.#clocks = new SlaClockRepository(source);
    this.#calendars = new PostgresBusinessCalendarRevisionReader(source);
  }

  async loadClock(
    input: Extract<QueueTemporalDue, { kind: "SLA_CLOCK" }>,
  ): Promise<SlaTemporalClockContext | undefined> {
    const revisions = rowsOf(
      await this.source.query(
        `SELECT revision.public_transition,revision.target_business_seconds,revision.warning_thresholds
         FROM sla_clock_heads head
         JOIN sla_clock_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.sla_clock_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.sla_clock_id=$3`,
        [input.workspaceId, input.projectId, input.subjectId],
      ),
    );
    if (!revisions[0]) return undefined;
    const transition = json<SlaClockTransition>(revisions[0].public_transition);
    if (
      transition.workspaceId !== input.workspaceId ||
      transition.projectId !== input.projectId ||
      transition.slaClockId !== input.subjectId
    )
      throw new Error("SLA_TEMPORAL_CLOCK_SCOPE_MISMATCH");
    const calendar = await this.#calendars.read(input.workspaceId, transition.calendarRef);
    if (!calendar) throw new Error("SLA_TEMPORAL_CALENDAR_PIN_NOT_FOUND");
    const segments = await this.#clocks.segmentHistory(
      { kind: "PROJECT", workspaceId: input.workspaceId, projectId: input.projectId },
      input.subjectId,
    );
    return Object.freeze({
      transition,
      segments,
      calendar,
      target: Object.freeze({
        goal: transition.goal,
        targetBusinessSeconds:
          revisions[0].target_business_seconds === null
            ? null
            : Number(revisions[0].target_business_seconds),
        warningThresholds: Object.freeze(
          json<readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[]>(
            revisions[0].warning_thresholds,
          ).map((warning) => Object.freeze({ ...warning })),
        ),
      }),
    });
  }
}

export interface PostgresQueueTemporalHandlers {
  evaluateQueueEntry(
    input: Extract<QueueTemporalDue, { kind: "QUEUE_ENTRY" }>,
  ): Promise<QueueTemporalEvaluationResult>;
  evaluateSlaClock?(
    input: Extract<QueueTemporalDue, { kind: "SLA_CLOCK" }>,
  ): Promise<QueueTemporalEvaluationResult>;
  expireOrderOverride(
    input: Extract<QueueTemporalDue, { kind: "ORDER_OVERRIDE" }>,
  ): Promise<Readonly<{ changed: boolean }>>;
  expireExpedite(
    input: Extract<QueueTemporalDue, { kind: "EXPEDITE" }>,
  ): Promise<Readonly<{ changed: boolean }>>;
}

/** PostgreSQL due indexes are authoritative; the lease is only a crash-recoverable claim. */
export class PostgresQueueTemporalTransitionWorker {
  readonly #sweep: QueueTemporalTransitionSweep;

  constructor(
    private readonly source: DataSource,
    handlers: PostgresQueueTemporalHandlers,
    now: () => string = () => new Date().toISOString(),
    private readonly deploymentScope?: Readonly<{
      workspaceId: string;
      projectIds: readonly string[];
    }>,
  ) {
    if (deploymentScope && (!deploymentScope.workspaceId || !deploymentScope.projectIds.length))
      throw new Error("QUEUE_TEMPORAL_SCOPE_INVALID");
    this.#sweep = new QueueTemporalTransitionSweep(
      {
        claimDue: async (input) => await this.claimDue(input),
        evaluateQueueEntry: async (input) => await handlers.evaluateQueueEntry(input),
        ...(handlers.evaluateSlaClock
          ? {
              evaluateSlaClock: async (
                input: Parameters<
                  NonNullable<PostgresQueueTemporalHandlers["evaluateSlaClock"]>
                >[0],
              ) => await handlers.evaluateSlaClock!(input),
            }
          : {}),
        expireOrderOverride: async (input) => await handlers.expireOrderOverride(input),
        expireExpedite: async (input) => await handlers.expireExpedite(input),
        complete: async (item, next) => await this.complete(item, next),
        release: async (item) => await this.release(item),
      },
      now,
    );
  }

  async run(batchSize = 100, trigger: "STARTUP" | "PERIODIC" = "PERIODIC") {
    return await this.#sweep.run({ trigger, batchSize });
  }

  /** Compatibility entry point for the shared worker contribution. */
  async due(batchSize = 100) {
    return await this.run(batchSize, "PERIODIC");
  }

  private async claimDue(
    input: Readonly<{ dueBefore: string; batchSize: number }>,
  ): Promise<readonly QueueTemporalDue[]> {
    const leaseUntil = new Date(Date.parse(input.dueBefore) + 5 * 60_000).toISOString();
    const entries = rowsOf(
      await this.source.query(
        `WITH due AS (
         SELECT workspace_id,project_id,queue_entry_id,next_temporal_evaluation_at AS due_at
           FROM queue_entry_heads
          WHERE next_temporal_evaluation_at<=$1 AND suppressed_by_work_item_id IS NULL
            AND ($4::uuid IS NULL OR (workspace_id=$4 AND project_id=ANY($5::uuid[])))
          ORDER BY next_temporal_evaluation_at,workspace_id,project_id,queue_entry_id
          FOR UPDATE SKIP LOCKED LIMIT $2
       ), claimed AS (
         UPDATE queue_entry_heads head SET next_temporal_evaluation_at=$3
           FROM due WHERE head.workspace_id=due.workspace_id AND head.project_id=due.project_id AND head.queue_entry_id=due.queue_entry_id
         RETURNING head.workspace_id,head.project_id,head.queue_entry_id,due.due_at
       ) SELECT * FROM claimed ORDER BY due_at,workspace_id,project_id,queue_entry_id`,
        [
          input.dueBefore,
          input.batchSize,
          leaseUntil,
          this.deploymentScope?.workspaceId ?? null,
          this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
        ],
      ),
    );
    const claimed: QueueTemporalDue[] = entries.map((row) =>
      Object.freeze({
        kind: "QUEUE_ENTRY" as const,
        workspaceId: String(row.workspace_id),
        projectId: String(row.project_id),
        subjectId: String(row.queue_entry_id),
        dueAt: new Date(String(row.due_at)).toISOString(),
        claimToken: leaseUntil,
      }),
    );
    const remaining = input.batchSize - claimed.length;
    if (remaining > 0) {
      const overrides = rowsOf(
        await this.source.query(
          `SELECT override.workspace_id,override.project_id,override.work_item_id,override.order_scope_id,override.override_id,override.move_sequence,override.semantic_hash,override.expires_at
           FROM queue_order_overrides override
           JOIN queue_order_scope_heads scope ON scope.workspace_id=override.workspace_id AND scope.order_scope_id=override.order_scope_id
          WHERE scope.scope_kind='PROJECT' AND override.expires_at<=$1
            AND ($3::uuid IS NULL OR (override.workspace_id=$3 AND override.project_id=ANY($4::uuid[])))
            AND NOT EXISTS (
              SELECT 1 FROM queue_order_invalidation_revisions revision
               WHERE revision.workspace_id=override.workspace_id AND revision.project_id=override.project_id
                 AND revision.source_ref->>'sourceType'='QUEUE_ORDER_OVERRIDE_REVISION'
                 AND revision.source_ref->>'sourceId'=override.override_id::text
                 AND revision.reason_code='ORDER_OVERRIDE_EXPIRED'
            )
          ORDER BY override.expires_at,override.workspace_id,override.project_id,override.override_id
          FOR UPDATE OF override SKIP LOCKED LIMIT $2`,
          [
            input.dueBefore,
            remaining,
            this.deploymentScope?.workspaceId ?? null,
            this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
          ],
        ),
      );
      claimed.push(
        ...overrides.map((row) =>
          Object.freeze({
            kind: "ORDER_OVERRIDE" as const,
            workspaceId: String(row.workspace_id),
            projectId: String(row.project_id),
            subjectId: String(row.work_item_id),
            orderScopeId: String(row.order_scope_id),
            overrideId: String(row.override_id),
            semanticHash: String(row.semantic_hash),
            sourceVersion: Number(row.move_sequence),
            dueAt: new Date(String(row.expires_at)).toISOString(),
          }),
        ),
      );
    }
    const expediteRemaining = input.batchSize - claimed.length;
    if (expediteRemaining > 0) {
      const expedites = rowsOf(
        await this.source.query(
          `SELECT head.workspace_id,head.project_id,head.work_item_id,head.control_id,head.current_revision_id,
                head.resource_version,revision.revision_number,revision.semantic_hash,revision.expiry_at,revision.recorded_by
           FROM work_item_queue_control_heads head
           JOIN work_item_queue_control_revisions revision
             ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
            AND revision.control_revision_id=head.current_revision_id
          WHERE revision.service_class='EXPEDITE' AND revision.expiry_at<=$1
            AND ($3::uuid IS NULL OR (head.workspace_id=$3 AND head.project_id=ANY($4::uuid[])))
          ORDER BY revision.expiry_at,head.workspace_id,head.project_id,head.control_id
          FOR UPDATE OF head SKIP LOCKED LIMIT $2`,
          [
            input.dueBefore,
            expediteRemaining,
            this.deploymentScope?.workspaceId ?? null,
            this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
          ],
        ),
      );
      claimed.push(
        ...expedites.map((row) =>
          Object.freeze({
            kind: "EXPEDITE" as const,
            workspaceId: String(row.workspace_id),
            projectId: String(row.project_id),
            subjectId: String(row.work_item_id),
            dueAt: new Date(String(row.expiry_at)).toISOString(),
            controlId: String(row.control_id),
            controlRevisionId: String(row.current_revision_id),
            semanticHash: String(row.semantic_hash),
            sourceVersion: Number(row.revision_number),
            expectedControlVersion: Number(row.resource_version),
            recordedBy: String(row.recorded_by),
          }),
        ),
      );
    }
    const slaRemaining = input.batchSize - claimed.length;
    if (slaRemaining > 0) {
      const claimToken = crypto.randomUUID();
      const clocks = rowsOf(
        await this.source.query(
          `WITH due AS (
           SELECT workspace_id,project_id,sla_clock_id,next_temporal_evaluation_at AS due_at
             FROM sla_clock_heads
            WHERE next_temporal_evaluation_at<=$1
              AND ($5::uuid IS NULL OR (workspace_id=$5 AND project_id=ANY($6::uuid[])))
              AND (temporal_claimed_until IS NULL OR temporal_claimed_until<=$1)
            ORDER BY next_temporal_evaluation_at,workspace_id,project_id,sla_clock_id
            FOR UPDATE SKIP LOCKED LIMIT $2
         ), claimed AS (
           UPDATE sla_clock_heads head
              SET temporal_claim_token=$3,temporal_claimed_until=$4,updated_at=clock_timestamp()
             FROM due
            WHERE head.workspace_id=due.workspace_id AND head.project_id=due.project_id
              AND head.sla_clock_id=due.sla_clock_id
           RETURNING head.workspace_id,head.project_id,head.sla_clock_id,due.due_at
         ) SELECT * FROM claimed ORDER BY due_at,workspace_id,project_id,sla_clock_id`,
          [
            input.dueBefore,
            slaRemaining,
            claimToken,
            leaseUntil,
            this.deploymentScope?.workspaceId ?? null,
            this.deploymentScope ? [...this.deploymentScope.projectIds] : null,
          ],
        ),
      );
      claimed.push(
        ...clocks.map((row) =>
          Object.freeze({
            kind: "SLA_CLOCK" as const,
            workspaceId: String(row.workspace_id),
            projectId: String(row.project_id),
            subjectId: String(row.sla_clock_id),
            dueAt: new Date(String(row.due_at)).toISOString(),
            claimToken,
          }),
        ),
      );
    }
    return Object.freeze(claimed);
  }

  private async complete(
    item: QueueTemporalDue,
    nextEvaluationAt: string | undefined,
  ): Promise<void> {
    if (item.kind === "ORDER_OVERRIDE" || item.kind === "EXPEDITE") return;
    if (item.kind === "SLA_CLOCK") {
      await this.source.query(
        `UPDATE sla_clock_heads
            SET next_temporal_evaluation_at=$1,temporal_claim_token=NULL,temporal_claimed_until=NULL,updated_at=clock_timestamp()
          WHERE workspace_id=$2 AND project_id=$3 AND sla_clock_id=$4 AND temporal_claim_token=$5`,
        [
          nextEvaluationAt ?? null,
          item.workspaceId,
          item.projectId,
          item.subjectId,
          item.claimToken ?? null,
        ],
      );
      return;
    }
    const table = item.kind === "QUEUE_ENTRY" ? "queue_entry_heads" : "sla_clock_heads";
    const idColumn = item.kind === "QUEUE_ENTRY" ? "queue_entry_id" : "sla_clock_id";
    await this.source.query(
      `UPDATE ${table} SET next_temporal_evaluation_at=$1,updated_at=clock_timestamp()
        WHERE workspace_id=$2 AND project_id=$3 AND ${idColumn}=$4 AND next_temporal_evaluation_at=$5`,
      [
        nextEvaluationAt ?? null,
        item.workspaceId,
        item.projectId,
        item.subjectId,
        item.claimToken ?? item.dueAt,
      ],
    );
  }

  private async release(item: QueueTemporalDue): Promise<void> {
    if (item.kind === "ORDER_OVERRIDE" || item.kind === "EXPEDITE" || !item.claimToken) return;
    if (item.kind === "SLA_CLOCK") {
      await this.source.query(
        `UPDATE sla_clock_heads SET temporal_claim_token=NULL,temporal_claimed_until=NULL,updated_at=clock_timestamp()
          WHERE workspace_id=$1 AND project_id=$2 AND sla_clock_id=$3 AND temporal_claim_token=$4`,
        [item.workspaceId, item.projectId, item.subjectId, item.claimToken],
      );
      return;
    }
    const table = item.kind === "QUEUE_ENTRY" ? "queue_entry_heads" : "sla_clock_heads";
    const idColumn = item.kind === "QUEUE_ENTRY" ? "queue_entry_id" : "sla_clock_id";
    await this.source.query(
      `UPDATE ${table} SET next_temporal_evaluation_at=$1,updated_at=clock_timestamp()
        WHERE workspace_id=$2 AND project_id=$3 AND ${idColumn}=$4 AND next_temporal_evaluation_at=$5`,
      [item.dueAt, item.workspaceId, item.projectId, item.subjectId, item.claimToken],
    );
  }
}

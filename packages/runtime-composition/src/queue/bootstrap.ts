import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { CompleteOperationalObservation, QueuePolicyRevision } from "@awp/platform-core";
import {
  CapacityAdmissionRepository,
  TypeOrmNotificationIntentRepository,
} from "@awp/platform-persistence-typeorm";

import {
  type JiraCapacityReconciliationPort,
  JiraCapacityReconciliationRoute,
} from "../jira/reconciliation-jobs.ts";
import {
  PostgresAuthoritativeJiraCapacityReconciler,
  type PostgresAuthoritativeJiraCapacityReconciliationReceipt,
} from "./admission-service.ts";
import {
  appendProjectionEvent,
  createPostgresQueueProjectionCoordinator,
  createQueueFoundationRepositoryProviders,
} from "./composition.ts";
import {
  PostgresQueueProjectionRebuildStore,
  QueueProjectionRebuildCoordinator,
} from "./projection-rebuild.ts";
import { PostgresQueueProjectionWorker, slaThresholdEventEnvelope } from "./projection-worker.ts";
import { SlaThresholdNotificationService } from "./sla-notifications.ts";
import {
  PostgresQueueTemporalTransitionWorker,
  PostgresSlaTemporalClockLoader,
  SlaTemporalThresholdEvaluator,
} from "./temporal-transition-worker.ts";

const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

/** Fail-closed, read-only gate for switching a Workspace to ENFORCED policy. */
export class PostgresQueueEnforcedActivationGate {
  readonly #capacity: CapacityAdmissionRepository;

  constructor(source: DataSource) {
    this.#capacity = new CapacityAdmissionRepository(source);
  }

  async validate(
    input: Readonly<{ workspaceId: string; policy: QueuePolicyRevision; manager: EntityManager }>,
  ): Promise<boolean> {
    if (input.policy.mode !== "ENFORCED" || input.policy.workspaceId !== input.workspaceId)
      return false;
    const generations = rows(
      await input.manager.query(
        `SELECT generation_id,activated_at,
              EXISTS(SELECT 1 FROM queue_projection_generations pending
                WHERE pending.workspace_id=$1 AND pending.state IN ('BUILDING','VALIDATING')) AS has_pending
         FROM queue_projection_generations
        WHERE workspace_id=$1 AND state='ACTIVE'
        ORDER BY activated_at DESC LIMIT 1`,
        [input.workspaceId],
      ),
    );
    if (!generations[0] || Boolean(generations[0].has_pending)) return false;
    let capacity: Row;
    try {
      capacity = await this.#capacity.lockWorkspaceCapacity(
        { kind: "WORKSPACE", workspaceId: input.workspaceId },
        input.manager,
      );
    } catch {
      return false;
    }
    if (!new Set(["MEASURE_ONLY", "ENFORCED"]).has(String(capacity.state))) return false;
    const integrity = await this.#capacity.validateWorkspaceCapacity(
      { kind: "WORKSPACE", workspaceId: input.workspaceId },
      input.policy.publishedAt,
      input.manager,
      capacity,
    );
    if (!integrity.valid) return false;
    const projectionCoverage = rows(
      await input.manager.query(
        `SELECT count(*) FILTER (WHERE head.current_revision_id IS NULL OR head.reconciled_capacity_version<>$2)::integer AS stale_count
         FROM projects project
         LEFT JOIN capacity_scope_projection_heads head
           ON head.workspace_id=project.workspace_id AND head.project_id=project.id AND head.scope_kind='PROJECT'
        WHERE project.workspace_id=$1 AND project.state='ACTIVE'`,
        [input.workspaceId, Number(capacity.resource_version)],
      ),
    )[0];
    if (Number(projectionCoverage?.stale_count ?? 1) !== 0) return false;
    const facts = rows(
      await input.manager.query(
        `SELECT work_item.id AS work_item_id,work_item.project_id,binding.freshness_state,
              projection.authority_snapshot,projection.configuration_refs,claim.state AS claim_state
         FROM work_items work_item
         JOIN operational_bindings binding
           ON binding.workspace_id=work_item.workspace_id AND binding.project_id=work_item.project_id
          AND binding.id=work_item.operational_binding_id AND binding.work_item_id=work_item.id
         JOIN operational_projection_revisions projection
           ON projection.workspace_id=binding.workspace_id AND projection.project_id=binding.project_id
          AND projection.binding_id=binding.id AND projection.id=binding.current_projection_revision_id
         LEFT JOIN LATERAL (
           SELECT state FROM work_item_human_wip_claims current_claim
            WHERE current_claim.workspace_id=work_item.workspace_id AND current_claim.project_id=work_item.project_id
              AND current_claim.work_item_id=work_item.id
            ORDER BY revision_number DESC LIMIT 1
         ) claim ON true
        WHERE work_item.workspace_id=$1`,
        [input.workspaceId],
      ),
    );
    for (const fact of facts) {
      if (String(fact.freshness_state) !== "CURRENT") return false;
      const configuration = json<
        Readonly<{ mappingRef?: Readonly<{ id: string; version: number }> }>
      >(fact.configuration_refs);
      if (
        configuration.mappingRef?.id !== input.policy.statusMappingRef.sourceId ||
        configuration.mappingRef.version !== input.policy.statusMappingRef.sourceVersion
      )
        return false;
      const snapshot = json<CompleteOperationalObservation>(fact.authority_snapshot);
      const activeClaim = String(fact.claim_state ?? "") === "ACTIVE";
      if (snapshot.normalizedStatus === "DONE" || snapshot.normalizedStatus === "CANCELLED") {
        if (activeClaim) return false;
        continue;
      }
      if (
        !input.policy.externalActiveConsumesWip.includes(
          snapshot.normalizedStatus as "IN_PROGRESS" | "REVIEW" | "BLOCKED",
        )
      )
        continue;
      const releaseBlock =
        snapshot.normalizedStatus === "BLOCKED" &&
        input.policy.blockReasonRules.some(
          (rule) =>
            rule.reasonCode === snapshot.blockReason?.normalizedReasonCode &&
            rule.wipEffect === "RELEASE_WIP",
        );
      if (activeClaim === releaseBlock) return false;
    }
    return true;
  }
}

export interface QueueCapacityReconciliationCheckpointReceipt {
  readonly state: "RUNNING" | "BLOCKED" | "PASSED";
  readonly checkpointId: string;
  readonly cursorWorkItemId: string | null;
  readonly processedCount: number;
  readonly reconciledCount: number;
  readonly skippedCount: number;
  readonly failureCode?: string;
}

/** Durable, resumable current-state scan. It reconstructs no historical occupancy. */
export class PostgresQueueCapacityReconciliationBootstrap {
  readonly #route: JiraCapacityReconciliationRoute;
  readonly #capacity: CapacityAdmissionRepository;

  constructor(
    private readonly source: DataSource,
    reconciler?: JiraCapacityReconciliationPort,
  ) {
    this.#route = new JiraCapacityReconciliationRoute(
      reconciler ?? new PostgresAuthoritativeJiraCapacityReconciler(source),
    );
    this.#capacity = new CapacityAdmissionRepository(source);
  }

  async runPage(
    input: Readonly<{ workspaceId: string; pageSize?: number; at?: string }>,
  ): Promise<QueueCapacityReconciliationCheckpointReceipt> {
    const pageSize = input.pageSize ?? 100;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500)
      throw new Error("CAPACITY_RECONCILIATION_PAGE_SIZE_INVALID");
    const at = input.at ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(at))) throw new Error("CAPACITY_RECONCILIATION_TIME_INVALID");
    const prepared = await this.source.transaction("SERIALIZABLE", async (manager) => {
      const capacity = await this.#capacity.lockWorkspaceCapacity(
        { kind: "WORKSPACE", workspaceId: input.workspaceId },
        manager,
      );
      const generation = rows(
        await manager.query(
          "SELECT generation_id FROM queue_projection_generations WHERE workspace_id=$1 AND state='ACTIVE' ORDER BY activated_at DESC LIMIT 1 FOR SHARE",
          [input.workspaceId],
        ),
      )[0];
      if (!generation) throw new Error("CAPACITY_RECONCILIATION_QUEUE_PROJECTION_NOT_READY");
      const checkpointId = deterministicUuid(
        `capacity-reconciliation-checkpoint:${input.workspaceId}`,
      );
      const current = rows(
        await manager.query(
          "SELECT * FROM workspace_capacity_reconciliation_checkpoints WHERE workspace_id=$1 FOR UPDATE",
          [input.workspaceId],
        ),
      )[0];
      const policyRef = json<Readonly<Record<string, unknown>>>(capacity.policy_ref);
      const sameSource =
        current &&
        sha256(json(current.policy_ref) as JsonValue) === sha256(policyRef as JsonValue) &&
        String(current.projection_generation_id) === String(generation.generation_id);
      if (!sameSource) {
        await manager.query(
          `INSERT INTO workspace_capacity_reconciliation_checkpoints(
             checkpoint_id,workspace_id,policy_ref,projection_generation_id,state,cursor_work_item_id,
             subject_count,reconciled_count,skipped_count,failure_code,started_at,updated_at,validated_at
           ) VALUES($1,$2,$3,$4,'RUNNING',NULL,0,0,0,NULL,$5,$5,NULL)
           ON CONFLICT(workspace_id) DO UPDATE SET policy_ref=EXCLUDED.policy_ref,
             projection_generation_id=EXCLUDED.projection_generation_id,state='RUNNING',cursor_work_item_id=NULL,
             subject_count=0,reconciled_count=0,skipped_count=0,failure_code=NULL,
             started_at=EXCLUDED.started_at,updated_at=EXCLUDED.updated_at,validated_at=NULL`,
          [
            checkpointId,
            input.workspaceId,
            JSON.stringify(policyRef),
            generation.generation_id,
            at,
          ],
        );
      } else if (String(current.state) === "PASSED") {
        return Object.freeze({
          checkpointId: String(current.checkpoint_id),
          policyRef,
          generationId: String(generation.generation_id),
          cursor: current.cursor_work_item_id ? String(current.cursor_work_item_id) : null,
          previous: current,
          subjects: Object.freeze([]),
          alreadyPassed: true,
        });
      }
      const cursor =
        sameSource && current?.cursor_work_item_id ? String(current.cursor_work_item_id) : null;
      const subjects = rows(
        await manager.query(
          `SELECT id AS work_item_id,project_id FROM work_items
          WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid)
          ORDER BY id LIMIT $3`,
          [input.workspaceId, cursor, pageSize],
        ),
      ).map((row) =>
        Object.freeze({ workItemId: String(row.work_item_id), projectId: String(row.project_id) }),
      );
      return Object.freeze({
        checkpointId: sameSource ? String(current!.checkpoint_id) : checkpointId,
        policyRef,
        generationId: String(generation.generation_id),
        cursor,
        previous: sameSource ? current : undefined,
        subjects: Object.freeze(subjects),
        alreadyPassed: false,
      });
    });
    if (prepared.alreadyPassed)
      return Object.freeze({
        state: "PASSED",
        checkpointId: prepared.checkpointId,
        cursorWorkItemId: prepared.cursor,
        processedCount: 0,
        reconciledCount: Number(prepared.previous?.reconciled_count ?? 0),
        skippedCount: Number(prepared.previous?.skipped_count ?? 0),
      });
    const results = await this.#route.observe(
      prepared.subjects.map((subject) =>
        Object.freeze({
          workspaceId: input.workspaceId,
          projectId: subject.projectId,
          workItemId: subject.workItemId,
          decidedAt: at,
          correlationId: deterministicUuid(
            `capacity-reconciliation-correlation:${input.workspaceId}:${prepared.generationId}:${subject.workItemId}`,
          ),
          causationId: prepared.checkpointId,
        }),
      ),
    );
    const blocking = results.find(
      (
        result,
      ): result is Extract<
        PostgresAuthoritativeJiraCapacityReconciliationReceipt,
        { state: "SKIPPED" }
      > => result.state === "SKIPPED" && result.reasonCode !== "STATUS_NOT_CAPACITY_RELEVANT",
    );
    const reconciledCount = results.filter((result) => result.state === "RECONCILED").length;
    const skippedCount = results.length - reconciledCount;
    const finalPage = prepared.subjects.length < pageSize;
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const checkpoint = rows(
        await manager.query(
          "SELECT * FROM workspace_capacity_reconciliation_checkpoints WHERE workspace_id=$1 AND checkpoint_id=$2 FOR UPDATE",
          [input.workspaceId, prepared.checkpointId],
        ),
      )[0];
      if (
        !checkpoint ||
        String(checkpoint.projection_generation_id) !== prepared.generationId ||
        sha256(json(checkpoint.policy_ref) as JsonValue) !==
          sha256(prepared.policyRef as JsonValue) ||
        String(checkpoint.cursor_work_item_id ?? "") !== (prepared.cursor ?? "")
      )
        throw new Error("CAPACITY_RECONCILIATION_CHECKPOINT_STALE");
      if (blocking) {
        await manager.query(
          "UPDATE workspace_capacity_reconciliation_checkpoints SET state='BLOCKED',failure_code=$3,updated_at=$4 WHERE workspace_id=$1 AND checkpoint_id=$2",
          [input.workspaceId, prepared.checkpointId, blocking.reasonCode, at],
        );
        return Object.freeze({
          state: "BLOCKED",
          checkpointId: prepared.checkpointId,
          cursorWorkItemId: prepared.cursor,
          processedCount: results.length,
          reconciledCount: Number(checkpoint.reconciled_count),
          skippedCount: Number(checkpoint.skipped_count),
          failureCode: blocking.reasonCode,
        });
      }
      let valid = true;
      if (finalPage) {
        const capacity = await this.#capacity.lockWorkspaceCapacity(
          { kind: "WORKSPACE", workspaceId: input.workspaceId },
          manager,
        );
        valid = (
          await this.#capacity.validateWorkspaceCapacity(
            { kind: "WORKSPACE", workspaceId: input.workspaceId },
            at,
            manager,
            capacity,
          )
        ).valid;
      }
      const state =
        finalPage && valid
          ? ("PASSED" as const)
          : finalPage
            ? ("BLOCKED" as const)
            : ("RUNNING" as const);
      const failureCode = finalPage && !valid ? "CAPACITY_HEAD_VALIDATION_FAILED" : undefined;
      const nextCursor = prepared.subjects.at(-1)?.workItemId ?? prepared.cursor;
      await manager.query(
        `UPDATE workspace_capacity_reconciliation_checkpoints SET state=$3,cursor_work_item_id=$4,
           subject_count=subject_count+$5,reconciled_count=reconciled_count+$6,skipped_count=skipped_count+$7,
           failure_code=$8,updated_at=$9,validated_at=CASE WHEN $3='PASSED' THEN $9 ELSE NULL END
         WHERE workspace_id=$1 AND checkpoint_id=$2`,
        [
          input.workspaceId,
          prepared.checkpointId,
          state,
          nextCursor,
          results.length,
          reconciledCount,
          skippedCount,
          failureCode ?? null,
          at,
        ],
      );
      return Object.freeze({
        state,
        checkpointId: prepared.checkpointId,
        cursorWorkItemId: nextCursor,
        processedCount: results.length,
        reconciledCount: Number(checkpoint.reconciled_count) + reconciledCount,
        skippedCount: Number(checkpoint.skipped_count) + skippedCount,
        ...(failureCode ? { failureCode } : {}),
      });
    });
  }
}

export function createQueueFoundationWorkerRuntime(source: DataSource) {
  const repositories = createQueueFoundationRepositoryProviders(source);
  const coordinator = createPostgresQueueProjectionCoordinator(source, repositories);
  const rebuild = new QueueProjectionRebuildCoordinator(
    new PostgresQueueProjectionRebuildStore(source),
    coordinator,
  );
  const notificationIntents = new TypeOrmNotificationIntentRepository(source);
  const slaThresholdNotifications = new SlaThresholdNotificationService({
    createNotificationIntent: async (value) => await notificationIntents.create(value),
    appendThresholdEmission: async (input) =>
      await repositories.slaClock.appendThresholdEmission({
        ...input,
        afterAppend: async (manager) =>
          await appendProjectionEvent(
            manager,
            slaThresholdEventEnvelope({
              emission: input.payload as never,
            }),
          ),
      }),
  });
  const slaTemporalLoader = new PostgresSlaTemporalClockLoader(source);
  const slaTemporal = new SlaTemporalThresholdEvaluator(
    {
      loadClock: async (input) => await slaTemporalLoader.loadClock(input),
      notificationExpiresAt: (crossing) =>
        new Date(Date.parse(crossing.reachedAt) + 30 * 24 * 60 * 60_000).toISOString(),
    },
    slaThresholdNotifications,
  );
  const temporal = new PostgresQueueTemporalTransitionWorker(source, {
    evaluateQueueEntry: async ({ workspaceId, projectId, subjectId }) => {
      const result = await coordinator.evaluateTemporal({ workspaceId, projectId, subjectId });
      return Object.freeze({ changed: result.changed });
    },
    evaluateSlaClock: async (due) => await slaTemporal.evaluate(due),
    expireOrderOverride: async (due) => {
      const result = await repositories.orderInvalidation.appendProjectInvalidation({
        scope: { kind: "PROJECT", workspaceId: due.workspaceId, projectId: due.projectId },
        workItemId: due.subjectId,
        reasonCode: "ORDER_OVERRIDE_EXPIRED",
        sourceRef: Object.freeze({
          sourceType: "QUEUE_ORDER_OVERRIDE_REVISION",
          sourceId: due.overrideId,
          sourceVersion: due.sourceVersion,
          semanticHash: due.semanticHash,
        }),
        occurredAt: due.dueAt,
      });
      return Object.freeze({ changed: result.changed });
    },
    expireExpedite: async (due) => {
      const result = await repositories.control.transitionExpedite({
        scope: { kind: "PROJECT", workspaceId: due.workspaceId, projectId: due.projectId },
        workItemId: due.subjectId,
        controlId: due.controlId,
        revisionId: deterministicUuid(
          `queue-control-expedite-expiry:${due.controlRevisionId}:${due.sourceVersion}`,
        ),
        command: "EXPIRE",
        expectedControlVersion: due.expectedControlVersion,
        acceptedActionRef: Object.freeze({
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: due.controlRevisionId,
          sourceVersion: due.sourceVersion,
          semanticHash: due.semanticHash,
        }),
        actorId: due.recordedBy,
        reason: "EXPEDITE window expired",
        at: due.dueAt,
      });
      return Object.freeze({ changed: result.revisionRef !== undefined });
    },
  });
  return Object.freeze({
    repositories,
    coordinator,
    rebuild,
    projection: new PostgresQueueProjectionWorker(source, coordinator),
    temporal,
    slaTemporal,
    slaThresholdNotifications,
    enforcedActivationGate: new PostgresQueueEnforcedActivationGate(source),
    capacityReconciliation: new PostgresQueueCapacityReconciliationBootstrap(source),
    durableCursorAuthority: "PostgreSQL" as const,
  });
}

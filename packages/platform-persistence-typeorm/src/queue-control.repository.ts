import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  authorizedProjectSetHash,
  evaluateCapacityAdmission,
  type ResourceScope,
} from "@awp/platform-core";

import { CapacityAdmissionRepository } from "./capacity-admission.repository.ts";
import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export function canonicalOrderScopeMembership(projectIds: readonly string[]) {
  const normalized = Object.freeze([...new Set(projectIds)].sort());
  if (normalized.length === 0 || normalized.some((projectId) => !projectId))
    throw new Error("QUEUE_ORDER_SCOPE_MEMBERSHIP_INVALID");
  return Object.freeze({
    projectIds: normalized,
    authorizedProjectSetHash: authorizedProjectSetHash(normalized),
  });
}

export function selectAffectedOrderScopes(
  projectId: string,
  scopes: readonly Readonly<{ orderScopeId: string; projectIds: readonly string[] }>[],
): readonly string[] {
  return Object.freeze(
    scopes
      .filter(({ projectIds }) => projectIds.includes(projectId))
      .map(({ orderScopeId }) => orderScopeId)
      .sort(),
  );
}

export class QueueControlRepository extends ScopedRepositoryBase {
  async currentControl(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<Row | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      "SELECT h.resource_version,r.* FROM work_item_queue_control_heads h LEFT JOIN work_item_queue_control_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.control_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3",
      [workItemId],
    );
    return rows[0];
  }

  async controlHistory(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<readonly Row[]> {
    return await this.projectRows<Row>(
      scope,
      `SELECT r.* FROM work_item_queue_control_heads h
       JOIN work_item_queue_control_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.control_id=h.control_id
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3 ORDER BY r.revision_number`,
      [workItemId],
    );
  }

  async ensureControlHead(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      controlId: string;
      workItemId: string;
      createdAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<Readonly<{ controlId: string; resourceVersion: number; currentRevisionId?: string }>> {
    const run = async (manager: EntityManager) => {
      await manager.query(
        `INSERT INTO work_item_queue_control_heads(control_id,workspace_id,project_id,work_item_id,current_revision_id,resource_version,created_at,updated_at)
         VALUES($1,$2,$3,$4,NULL,0,$5,$5) ON CONFLICT(workspace_id,project_id,work_item_id) DO NOTHING`,
        [
          input.controlId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          input.createdAt,
        ],
      );
      const values = (await manager.query(
        "SELECT control_id,current_revision_id,resource_version FROM work_item_queue_control_heads WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
        [input.scope.workspaceId, input.scope.projectId, input.workItemId],
      )) as readonly Row[];
      const value = values[0];
      if (!value) throw new Error("QUEUE_CONTROL_HEAD_CREATE_FAILED");
      return Object.freeze({
        controlId: String(value.control_id),
        resourceVersion: Number(value.resource_version),
        ...(value.current_revision_id
          ? { currentRevisionId: String(value.current_revision_id) }
          : {}),
      });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  async appendControlRevision(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      controlId: string;
      revisionId: string;
      workItemId: string;
      expectedResourceVersion: number;
      expectedQueueEntry: Readonly<{
        queueEntryId: string;
        revision: number;
        semanticHash: string;
        inputFingerprint: string;
      }>;
      expectedOperationalProjectionRef: Readonly<{
        sourceType: string;
        sourceId: string;
        sourceVersion: number | string;
        semanticHash: string;
      }>;
      expectedQaSourceSetHash: string;
      triageAssessmentRef?: Readonly<{
        sourceType: string;
        sourceId: string;
        sourceVersion: number | string;
        semanticHash: string;
      }>;
      previousRevisionId?: string;
      serviceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
      planningValues: unknown;
      acceptedSourceRefs: readonly unknown[];
      dependencySourceSetHash: string;
      expiryAt?: string;
      acceptedActionRef: unknown;
      reason: string;
      semanticHash: string;
      recordedAt: string;
      recordedBy: string;
    }>,
    executor?: EntityManager,
  ): Promise<number> {
    const run = async (manager: EntityManager) => {
      await this.ensureControlHead(
        {
          scope: input.scope,
          controlId: input.controlId,
          workItemId: input.workItemId,
          createdAt: input.recordedAt,
        },
        manager,
      );
      const heads = (await manager.query(
        "SELECT current_revision_id,resource_version FROM work_item_queue_control_heads WHERE workspace_id=$1 AND project_id=$2 AND control_id=$3 FOR UPDATE",
        [input.scope.workspaceId, input.scope.projectId, input.controlId],
      )) as Row[];
      const head = heads[0];
      if (
        !head ||
        Number(head.resource_version) !== input.expectedResourceVersion ||
        (head.current_revision_id ?? undefined) !== input.previousRevisionId
      ) {
        throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
      }
      const queueRows = (await manager.query(
        `SELECT h.queue_entry_id,r.revision_number,r.semantic_hash,r.input_fingerprint,r.source_refs
           FROM queue_entry_heads h JOIN queue_entry_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.queue_entry_revision_id=h.current_revision_id
          WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3 AND h.suppressed_by_work_item_id IS NULL FOR SHARE OF h,r`,
        [input.scope.workspaceId, input.scope.projectId, input.workItemId],
      )) as readonly Row[];
      const queue = queueRows[0];
      if (
        !queue ||
        String(queue.queue_entry_id) !== input.expectedQueueEntry.queueEntryId ||
        Number(queue.revision_number) !== input.expectedQueueEntry.revision ||
        queue.semantic_hash !== input.expectedQueueEntry.semanticHash ||
        queue.input_fingerprint !== input.expectedQueueEntry.inputFingerprint
      )
        throw new Error("QUEUE_CONTROL_QUEUE_ENTRY_CONFLICT");
      const sourceRefs = (
        typeof queue.source_refs === "string" ? JSON.parse(queue.source_refs) : queue.source_refs
      ) as readonly Readonly<Record<string, unknown>>[];
      const operational = sourceRefs.find(
        ({ sourceType }) => sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION",
      );
      const qa = sourceRefs.find(({ sourceType }) => sourceType === "QA_QUEUE_FACT_REVISION");
      if (
        !operational ||
        sha256(operational as JsonValue) !==
          sha256(input.expectedOperationalProjectionRef as JsonValue) ||
        !qa ||
        qa.semanticHash !== input.expectedQaSourceSetHash
      )
        throw new Error("QUEUE_CONTROL_SOURCE_DRIFT");
      if (input.triageAssessmentRef) {
        const assessmentRows = (await manager.query(
          `SELECT content_hash,state,expires_at FROM qa_triage_assessments
            WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR SHARE`,
          [
            input.scope.workspaceId,
            input.scope.projectId,
            `${input.triageAssessmentRef.sourceId}:r${input.triageAssessmentRef.sourceVersion}`,
          ],
        )) as readonly Row[];
        const assessment = assessmentRows[0];
        if (
          !assessment ||
          assessment.content_hash !== input.triageAssessmentRef.semanticHash ||
          assessment.state !== "CURRENT" ||
          Date.parse(String(assessment.expires_at)) <= Date.parse(input.recordedAt)
        )
          throw new Error("QUEUE_CONTROL_TRIAGE_ASSESSMENT_STALE");
      }
      const revision = input.expectedResourceVersion + 1;
      await manager.query(
        "INSERT INTO work_item_queue_control_revisions(control_revision_id,control_id,workspace_id,project_id,revision_number,previous_revision_id,service_class,planning_values,accepted_source_refs,dependency_source_set_hash,expiry_at,accepted_action_ref,reason,semantic_hash,recorded_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          input.revisionId,
          input.controlId,
          input.scope.workspaceId,
          input.scope.projectId,
          revision,
          input.previousRevisionId ?? null,
          input.serviceClass,
          JSON.stringify(input.planningValues),
          JSON.stringify(input.acceptedSourceRefs),
          input.dependencySourceSetHash,
          input.expiryAt ?? null,
          JSON.stringify(input.acceptedActionRef),
          input.reason,
          input.semanticHash,
          input.recordedAt,
          input.recordedBy,
        ],
      );
      await manager.query(
        "UPDATE work_item_queue_control_heads SET current_revision_id=$4,resource_version=resource_version+1,updated_at=$5 WHERE workspace_id=$1 AND project_id=$2 AND control_id=$3 AND resource_version=$6",
        [
          input.scope.workspaceId,
          input.scope.projectId,
          input.controlId,
          input.revisionId,
          input.recordedAt,
          input.expectedResourceVersion,
        ],
      );
      return revision;
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  /** Dedicated capacity-first transition used only for exact EXPEDITE set/clear/expiry effects. */
  async transitionExpedite(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      workItemId: string;
      controlId: string;
      revisionId: string;
      command: "SET" | "CLEAR" | "EXPIRE";
      expectedControlVersion: number;
      acceptedActionRef: Readonly<Record<string, unknown>>;
      actorId: string;
      reason: string;
      at: string;
      reviewAt?: string;
      expiresAt?: string;
      allowCapacityOverride?: boolean;
      emitCapacityEvent?: boolean;
    }>,
    executor?: EntityManager,
  ): Promise<
    Readonly<{
      outcome:
        "ADMITTED" | "ADMITTED_WITH_EXACT_OVERRIDE" | "NON_DISCRETIONARY_APPLIED" | "NO_CHANGE";
      revisionRef?: Readonly<{
        sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION";
        sourceId: string;
        sourceVersion: number;
        semanticHash: `sha256:${string}`;
      }>;
      capacityChanged: boolean;
    }>
  > {
    const run = async (manager: EntityManager) => {
      if (
        !Number.isFinite(Date.parse(input.at)) ||
        !input.reason.trim() ||
        input.expectedControlVersion < 0
      )
        throw new Error("EXPEDITE_TRANSITION_INPUT_INVALID");
      if (
        input.command === "SET" &&
        (!input.reviewAt ||
          !input.expiresAt ||
          Date.parse(input.expiresAt) <= Date.parse(input.at) ||
          Date.parse(input.reviewAt) < Date.parse(input.at) ||
          Date.parse(input.reviewAt) > Date.parse(input.expiresAt))
      )
        throw new Error("EXPEDITE_WINDOW_INVALID");
      const capacityRepository = new CapacityAdmissionRepository(this.source);
      const capacity = await capacityRepository.lockWorkspaceCapacity(
        { kind: "WORKSPACE", workspaceId: input.scope.workspaceId },
        manager,
      );
      await this.ensureControlHead(
        {
          scope: input.scope,
          controlId: input.controlId,
          workItemId: input.workItemId,
          createdAt: input.at,
        },
        manager,
      );
      const currentRows = (await manager.query(
        `SELECT head.current_revision_id,head.resource_version,revision.revision_number,revision.service_class,
                revision.planning_values,revision.accepted_source_refs,revision.dependency_source_set_hash,revision.expiry_at
           FROM work_item_queue_control_heads head
           LEFT JOIN work_item_queue_control_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.control_revision_id=head.current_revision_id
          WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.control_id=$3 AND head.work_item_id=$4 FOR UPDATE OF head`,
        [input.scope.workspaceId, input.scope.projectId, input.controlId, input.workItemId],
      )) as readonly Row[];
      const current = currentRows[0];
      if (!current) throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
      const targetHasExpedite = String(current.service_class ?? "STANDARD") === "EXPEDITE";
      // A concurrent expiry may already have advanced this exact revision. Treat
      // that case as an idempotent completion, but never expire a newer EXPEDITE.
      if (Number(current.resource_version) !== input.expectedControlVersion) {
        if (input.command === "EXPIRE" && !targetHasExpedite)
          return Object.freeze({ outcome: "NO_CHANGE" as const, capacityChanged: false });
        throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
      }
      if (
        input.command === "EXPIRE" &&
        (!targetHasExpedite ||
          !current.expiry_at ||
          Date.parse(String(current.expiry_at)) > Date.parse(input.at))
      ) {
        return Object.freeze({ outcome: "NO_CHANGE" as const, capacityChanged: false });
      }
      const policyRef =
        typeof capacity.policy_ref === "string"
          ? (JSON.parse(capacity.policy_ref) as Readonly<Record<string, unknown>>)
          : (capacity.policy_ref as Readonly<Record<string, unknown>>);
      const policyRows = (await manager.query(
        "SELECT mode,workspace_human_wip_limit,active_expedite_limit FROM workspace_queue_policy_revisions WHERE workspace_id=$1 AND policy_revision_id=$2 AND revision_number=$3 AND semantic_hash=$4",
        [
          input.scope.workspaceId,
          policyRef.sourceId,
          policyRef.sourceVersion,
          policyRef.semanticHash,
        ],
      )) as readonly Row[];
      const policy = policyRows[0];
      if (!policy || String(policy.mode) !== String(capacity.state))
        throw new Error("CAPACITY_POLICY_PIN_STALE");
      const activityKind =
        input.command === "SET"
          ? ("SET_EXPEDITE" as const)
          : input.command === "CLEAR"
            ? ("CLEAR_EXPEDITE" as const)
            : ("EXPIRE_EXPEDITE" as const);
      const evaluation = evaluateCapacityAdmission({
        policyMode: String(policy.mode) as "MEASURE_ONLY" | "ENFORCED",
        activityKind,
        current: {
          humanCommittedCount: Number(capacity.human_committed_count),
          activeExpediteCount: Number(capacity.active_expedite_count),
        },
        workspaceHumanWipLimit:
          policy.workspace_human_wip_limit === null
            ? null
            : Number(policy.workspace_human_wip_limit),
        activeExpediteLimit:
          policy.active_expedite_limit === null ? null : Number(policy.active_expedite_limit),
        targetHasClaim: false,
        targetHasReservation: false,
        targetHasExpedite,
        ...(input.allowCapacityOverride
          ? {
              exactOverride: {
                actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
                effectKind: "ALLOW_EXPEDITE_CAPACITY",
              } as const,
            }
          : {}),
      });
      if (evaluation.outcome === "DENIED") throw new Error("EXPEDITE_CAPACITY_DENIED");
      if (evaluation.mutationKind === "NO_CHANGE")
        return Object.freeze({ outcome: "NO_CHANGE" as const, capacityChanged: false });
      const revision = input.expectedControlVersion + 1;
      const serviceClass = input.command === "SET" ? ("EXPEDITE" as const) : ("STANDARD" as const);
      const planningValues =
        current.planning_values ??
        Object.freeze({
          risk: "UNKNOWN",
          businessImpact: "UNKNOWN",
          dependencyReadiness: "UNKNOWN",
          effortRange: Object.freeze({ kind: "UNKNOWN" }),
        });
      const acceptedEffect =
        input.command === "SET"
          ? Object.freeze({
              kind: "SET_EXPEDITE",
              beforeServiceClass: String(current.service_class ?? "STANDARD"),
              afterServiceClass: "EXPEDITE",
              reviewAt: input.reviewAt,
              expiresAt: input.expiresAt,
            })
          : Object.freeze({
              kind: input.command === "CLEAR" ? "CLEAR_EXPEDITE" : "EXPIRE_EXPEDITE",
              beforeServiceClass: "EXPEDITE",
              afterServiceClass: "STANDARD",
              ...(input.command === "EXPIRE" ? { expiredAt: input.at } : {}),
            });
      const semanticBody = Object.freeze({
        revisionId: input.revisionId,
        controlId: input.controlId,
        revision,
        ...(current.current_revision_id
          ? { previousRevisionId: String(current.current_revision_id) }
          : {}),
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        workItemId: input.workItemId,
        serviceClass,
        planningValues,
        acceptedEffect,
        acceptedSourceRefs: current.accepted_source_refs ?? [],
        dependencySourceSetHash: String(current.dependency_source_set_hash ?? sha256([])),
        acceptedActionRef: input.acceptedActionRef,
        reason: input.reason,
        recordedAt: input.at,
        recordedBy: input.actorId,
      });
      const semanticHash = sha256(semanticBody as unknown as JsonValue);
      await manager.query(
        "INSERT INTO work_item_queue_control_revisions(control_revision_id,control_id,workspace_id,project_id,revision_number,previous_revision_id,service_class,planning_values,accepted_source_refs,dependency_source_set_hash,expiry_at,accepted_action_ref,reason,semantic_hash,recorded_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          input.revisionId,
          input.controlId,
          input.scope.workspaceId,
          input.scope.projectId,
          revision,
          current.current_revision_id ?? null,
          serviceClass,
          JSON.stringify(planningValues),
          typeof current.accepted_source_refs === "string"
            ? current.accepted_source_refs
            : JSON.stringify(current.accepted_source_refs ?? []),
          String(current.dependency_source_set_hash ?? sha256([])),
          input.command === "SET" ? input.expiresAt : null,
          JSON.stringify(input.acceptedActionRef),
          input.reason,
          semanticHash,
          input.at,
          input.actorId,
        ],
      );
      const advanced = (await manager.query(
        "UPDATE work_item_queue_control_heads SET current_revision_id=$4,resource_version=resource_version+1,updated_at=$5 WHERE workspace_id=$1 AND project_id=$2 AND control_id=$3 AND resource_version=$6 RETURNING resource_version",
        [
          input.scope.workspaceId,
          input.scope.projectId,
          input.controlId,
          input.revisionId,
          input.at,
          input.expectedControlVersion,
        ],
      )) as readonly Row[];
      if (!advanced[0]) throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
      const reconciled = await capacityRepository.reconcileWorkspaceCapacity(
        { kind: "WORKSPACE", workspaceId: input.scope.workspaceId },
        input.at,
        manager,
        capacity,
      );
      const transitionKind =
        input.command === "SET"
          ? "EXPEDITE_SET"
          : input.command === "CLEAR"
            ? "EXPEDITE_CLEARED"
            : "EXPEDITE_EXPIRED";
      const causationId =
        typeof input.acceptedActionRef.sourceId === "string"
          ? input.acceptedActionRef.sourceId
          : input.revisionId;
      const actor = Object.freeze({
        kind: input.command === "EXPIRE" ? ("SERVICE" as const) : ("HUMAN" as const),
        principalId: input.actorId,
        ...(input.command === "EXPIRE" ? { serviceKey: "worker.queue-temporal" } : {}),
      });
      const eventId = deterministicUuid(`queue-control-changed:${input.revisionId}`);
      const payload = Object.freeze({
        schemaVersion: "queue-control-changed@1.0.0",
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        workItemId: input.workItemId,
        controlRevisionRef: Object.freeze({
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: input.revisionId,
          sourceVersion: revision,
          semanticHash,
        }),
        transitionKind,
        occurredAt: input.at,
      });
      const envelope = Object.freeze({
        envelopeVersion: 1,
        eventId,
        eventType: "queue.control.changed",
        occurredAt: input.at,
        recordedAt: input.at,
        producer: input.command === "EXPIRE" ? "worker.queue-temporal" : "queue.control",
        producerVersion: "1.0.0",
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        entityType: "work-item",
        entityId: input.workItemId,
        entityVersion: revision,
        correlationId: deterministicUuid(`queue-control-correlation:${input.revisionId}`),
        causationId,
        actor,
        dataClassificationKey: "INTERNAL",
        payloadVersion: 1,
        payloadSchemaRef: Object.freeze({
          id: "urn:awp:schemas:006:queue-control-changed:v1",
          version: 1,
          digest: sha256(payload as unknown as JsonValue),
        }),
        payload,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'queue.control.changed',$4,$5,'READY',$6) ON CONFLICT(id) DO NOTHING",
        [
          eventId,
          input.scope.workspaceId,
          input.scope.projectId,
          JSON.stringify(envelope),
          sha256(envelope as unknown as JsonValue),
          input.at,
        ],
      );
      if (reconciled.changed && input.emitCapacityEvent !== false) {
        const occupancyId = deterministicUuid(`capacity-occupancy-expedite:${input.revisionId}`);
        const occupancyPayload = Object.freeze({
          schemaVersion: "capacity-occupancy-changed@1.0.0",
          workspaceId: input.scope.workspaceId,
          projectId: input.scope.projectId,
          causeRef: payload.controlRevisionRef,
          reconciledAt: input.at,
        });
        const occupancy = Object.freeze({
          ...envelope,
          eventId: occupancyId,
          eventType: "capacity.occupancy.changed",
          entityType: "capacity",
          entityId: input.workItemId,
          payloadSchemaRef: Object.freeze({
            id: "urn:awp:schemas:006:capacity-occupancy-changed:v1",
            version: 1,
            digest: sha256(occupancyPayload as unknown as JsonValue),
          }),
          payload: occupancyPayload,
        });
        await manager.query(
          "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'capacity.occupancy.changed',$4,$5,'READY',$6) ON CONFLICT(id) DO NOTHING",
          [
            occupancyId,
            input.scope.workspaceId,
            input.scope.projectId,
            JSON.stringify(occupancy),
            sha256(occupancy as unknown as JsonValue),
            input.at,
          ],
        );
      }
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'queue.control.expedite','SUCCEEDED',$6,$7,$8,$9,'INTERNAL',$10)",
        [
          deterministicUuid(`queue-control-expedite-audit:${input.revisionId}`),
          input.scope.workspaceId,
          input.scope.projectId,
          input.at,
          JSON.stringify(actor),
          transitionKind,
          envelope.correlationId,
          causationId,
          JSON.stringify({ acceptedActionRef: input.acceptedActionRef }),
          JSON.stringify({
            controlRevisionRef: payload.controlRevisionRef,
            capacityChanged: reconciled.changed,
          }),
        ],
      );
      return Object.freeze({
        outcome: evaluation.outcome as
          "ADMITTED" | "ADMITTED_WITH_EXACT_OVERRIDE" | "NON_DISCRETIONARY_APPLIED",
        revisionRef: Object.freeze({
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION" as const,
          sourceId: input.revisionId,
          sourceVersion: revision,
          semanticHash,
        }),
        capacityChanged: reconciled.changed,
      });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  async currentOrderScope(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "WORKSPACE" }>;
      scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
      projectId?: string;
      projectIds: readonly string[];
      currentBaseVisibleSetHash: string;
    }>,
  ): Promise<
    Readonly<{
      orderScopeId?: string;
      resourceVersion: number;
      queueEpoch: number;
      baseVisibleSetHash: string;
    }>
  > {
    const membership = canonicalOrderScopeMembership(input.projectIds);
    const rows = (await this.source.query(
      input.scopeKind === "PROJECT"
        ? "SELECT order_scope_id,resource_version,queue_epoch,base_visible_set_hash FROM queue_order_scope_heads WHERE workspace_id=$1 AND scope_kind='PROJECT' AND project_id=$2"
        : "SELECT order_scope_id,resource_version,queue_epoch,base_visible_set_hash FROM queue_order_scope_heads WHERE workspace_id=$1 AND scope_kind='AUTHORIZED_PORTFOLIO' AND authorized_project_set_hash=$2",
      [
        input.scope.workspaceId,
        input.scopeKind === "PROJECT" ? input.projectId : membership.authorizedProjectSetHash,
      ],
    )) as readonly Row[];
    const row = rows[0];
    return row
      ? Object.freeze({
          orderScopeId: String(row.order_scope_id),
          resourceVersion: Number(row.resource_version),
          queueEpoch: Number(row.queue_epoch),
          baseVisibleSetHash: String(row.base_visible_set_hash),
        })
      : Object.freeze({
          resourceVersion: 0,
          queueEpoch: 1,
          baseVisibleSetHash: input.currentBaseVisibleSetHash,
        });
  }

  async ensureOrderScope(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "WORKSPACE" }>;
      orderScopeId: string;
      scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
      projectId?: string;
      projectIds: readonly string[];
      baseVisibleSetHash: string;
      createdAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<
    Readonly<{
      orderScopeId: string;
      resourceVersion: number;
      queueEpoch: number;
      currentSequence: number;
    }>
  > {
    const run = async (manager: EntityManager) => {
      const membership = canonicalOrderScopeMembership(input.projectIds);
      if (
        (input.scopeKind === "PROJECT" &&
          (input.projectId === undefined ||
            membership.projectIds.length !== 1 ||
            membership.projectIds[0] !== input.projectId)) ||
        (input.scopeKind === "AUTHORIZED_PORTFOLIO" && input.projectId !== undefined)
      )
        throw new Error("QUEUE_ORDER_SCOPE_KIND_INVALID");
      await manager.query(
        `INSERT INTO queue_order_scope_heads(order_scope_id,workspace_id,scope_kind,project_id,authorized_project_set_hash,current_revision,resource_version,queue_epoch,base_visible_set_hash,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,0,0,1,$6,$7,$7) ON CONFLICT DO NOTHING`,
        [
          input.orderScopeId,
          input.scope.workspaceId,
          input.scopeKind,
          input.projectId ?? null,
          membership.authorizedProjectSetHash,
          input.baseVisibleSetHash,
          input.createdAt,
        ],
      );
      const heads = (await manager.query(
        input.scopeKind === "PROJECT"
          ? "SELECT * FROM queue_order_scope_heads WHERE workspace_id=$1 AND scope_kind='PROJECT' AND project_id=$2 FOR UPDATE"
          : "SELECT * FROM queue_order_scope_heads WHERE workspace_id=$1 AND scope_kind='AUTHORIZED_PORTFOLIO' AND authorized_project_set_hash=$2 FOR UPDATE",
        [
          input.scope.workspaceId,
          input.scopeKind === "PROJECT" ? input.projectId : membership.authorizedProjectSetHash,
        ],
      )) as readonly Row[];
      const head = heads[0];
      if (!head || String(head.order_scope_id) !== input.orderScopeId)
        throw new Error("QUEUE_ORDER_SCOPE_ID_CONFLICT");
      const existing = (await manager.query(
        'SELECT project_id FROM queue_order_scope_projects WHERE workspace_id=$1 AND order_scope_id=$2 ORDER BY project_id COLLATE "C"',
        [input.scope.workspaceId, input.orderScopeId],
      )) as readonly Row[];
      if (existing.length === 0)
        for (const projectId of membership.projectIds)
          await manager.query(
            "INSERT INTO queue_order_scope_projects(workspace_id,order_scope_id,project_id) VALUES($1,$2,$3)",
            [input.scope.workspaceId, input.orderScopeId, projectId],
          );
      const persisted =
        existing.length > 0
          ? existing.map(({ project_id }) => String(project_id))
          : membership.projectIds;
      if (authorizedProjectSetHash(persisted) !== membership.authorizedProjectSetHash)
        throw new Error("QUEUE_ORDER_SCOPE_MEMBERSHIP_HASH_MISMATCH");
      return Object.freeze({
        orderScopeId: input.orderScopeId,
        resourceVersion: Number(head.resource_version),
        queueEpoch: Number(head.queue_epoch),
        currentSequence: Number(head.current_revision),
      });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  async appendOrderOverride(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "WORKSPACE" }>;
      orderScopeId: string;
      overrideId: string;
      projectId: string;
      workItemId: string;
      placement: "FIRST" | "LAST" | "BEFORE" | "AFTER";
      anchorProjectId?: string;
      anchorWorkItemId?: string;
      expectedResourceVersion: number;
      expectedQueueEpoch: number;
      expectedBaseVisibleSetHash: string;
      actionCandidateRef: unknown;
      semanticHash: string;
      effectiveAt: string;
      expiresAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<Readonly<{ moveSequence: number; resourceVersion: number }>> {
    const run = async (manager: EntityManager) => {
      const rows = (await manager.query(
        "SELECT current_revision,resource_version,queue_epoch,base_visible_set_hash FROM queue_order_scope_heads WHERE workspace_id=$1 AND order_scope_id=$2 FOR UPDATE",
        [input.scope.workspaceId, input.orderScopeId],
      )) as readonly Row[];
      const head = rows[0];
      if (
        !head ||
        Number(head.resource_version) !== input.expectedResourceVersion ||
        Number(head.queue_epoch) !== input.expectedQueueEpoch ||
        head.base_visible_set_hash !== input.expectedBaseVisibleSetHash
      )
        throw new Error("QUEUE_ORDER_SCOPE_CAS_CONFLICT");
      const moveSequence = Number(head.current_revision) + 1;
      await manager.query(
        "INSERT INTO queue_order_overrides(override_id,workspace_id,project_id,order_scope_id,work_item_id,move_sequence,placement,anchor_project_id,anchor_work_item_id,queue_epoch,base_visible_set_hash,action_candidate_ref,semantic_hash,effective_at,expires_at,superseded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL)",
        [
          input.overrideId,
          input.scope.workspaceId,
          input.projectId,
          input.orderScopeId,
          input.workItemId,
          moveSequence,
          input.placement,
          input.anchorProjectId ?? null,
          input.anchorWorkItemId ?? null,
          input.expectedQueueEpoch,
          input.expectedBaseVisibleSetHash,
          JSON.stringify(input.actionCandidateRef),
          input.semanticHash,
          input.effectiveAt,
          input.expiresAt,
        ],
      );
      const moved = (await manager.query(
        "UPDATE queue_order_scope_heads SET current_revision=$3,resource_version=resource_version+1,updated_at=$4 WHERE workspace_id=$1 AND order_scope_id=$2 AND resource_version=$5 RETURNING resource_version",
        [
          input.scope.workspaceId,
          input.orderScopeId,
          moveSequence,
          input.effectiveAt,
          input.expectedResourceVersion,
        ],
      )) as readonly Row[];
      if (!moved[0]) throw new Error("QUEUE_ORDER_SCOPE_CAS_CONFLICT");
      return Object.freeze({ moveSequence, resourceVersion: Number(moved[0].resource_version) });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  async orderOverrideHistory(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    orderScopeId: string,
  ): Promise<readonly Row[]> {
    return await this.workspaceRows<Row>(
      scope,
      "SELECT * FROM queue_order_overrides WHERE workspace_id=$1 AND order_scope_id=$2 ORDER BY move_sequence,override_id",
      [orderScopeId],
    );
  }

  async reverseMembershipOrderScopes(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    projectId: string,
  ): Promise<readonly string[]> {
    const values = await this.workspaceRows<Row>(
      scope,
      "SELECT order_scope_id FROM queue_order_scope_projects WHERE workspace_id=$1 AND project_id=$2 ORDER BY order_scope_id",
      [projectId],
    );
    return Object.freeze(values.map(({ order_scope_id }) => String(order_scope_id)));
  }

  /** Advances only already-materialized heads containing the changed Project. */
  async reconcileOrderScopeBaseSets(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "WORKSPACE" }>;
      changedProjectId: string;
      resolved: readonly Readonly<{ orderScopeId: string; baseVisibleSetHash: string }>[];
      occurredAt: string;
    }>,
  ): Promise<
    readonly Readonly<{ orderScopeId: string; resourceVersion: number; queueEpoch: number }>[]
  > {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const memberships = (await manager.query(
        "SELECT order_scope_id FROM queue_order_scope_projects WHERE workspace_id=$1 AND project_id=$2 ORDER BY order_scope_id FOR SHARE",
        [input.scope.workspaceId, input.changedProjectId],
      )) as readonly Row[];
      const allowed = new Set(memberships.map(({ order_scope_id }) => String(order_scope_id)));
      if (
        input.resolved.some(
          ({ orderScopeId, baseVisibleSetHash }) =>
            !allowed.has(orderScopeId) || !/^sha256:[a-f0-9]{64}$/u.test(baseVisibleSetHash),
        )
      ) {
        throw new Error("QUEUE_ORDER_RECONCILIATION_SCOPE_INVALID");
      }
      const unique = new Set(input.resolved.map(({ orderScopeId }) => orderScopeId));
      if (unique.size !== input.resolved.length)
        throw new Error("QUEUE_ORDER_RECONCILIATION_DUPLICATE");
      const advanced: Readonly<{
        orderScopeId: string;
        resourceVersion: number;
        queueEpoch: number;
      }>[] = [];
      for (const resolution of [...input.resolved].sort((left, right) =>
        left.orderScopeId.localeCompare(right.orderScopeId),
      )) {
        const rows = (await manager.query(
          `UPDATE queue_order_scope_heads
              SET base_visible_set_hash=$3,resource_version=resource_version+1,queue_epoch=queue_epoch+1,updated_at=$4
            WHERE workspace_id=$1 AND order_scope_id=$2 AND base_visible_set_hash<>$3
            RETURNING resource_version,queue_epoch`,
          [
            input.scope.workspaceId,
            resolution.orderScopeId,
            resolution.baseVisibleSetHash,
            input.occurredAt,
          ],
        )) as readonly Row[];
        if (rows[0])
          advanced.push(
            Object.freeze({
              orderScopeId: resolution.orderScopeId,
              resourceVersion: Number(rows[0].resource_version),
              queueEpoch: Number(rows[0].queue_epoch),
            }),
          );
      }
      return Object.freeze(advanced);
    });
  }
}

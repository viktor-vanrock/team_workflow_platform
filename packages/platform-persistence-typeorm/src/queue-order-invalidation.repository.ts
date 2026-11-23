import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ResourceScope } from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
const rowsOf = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export function createQueueOrderInvalidation(
  input: Readonly<{
    scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
    workspaceId: string;
    projectId: string;
    workItemId: string;
    invalidationId: string;
    version: number;
    reasonCode:
      | "ORDER_OVERRIDE_ACCEPTED"
      | "ORDER_OVERRIDE_EXPIRED"
      | "ORDER_OVERRIDE_SUPERSEDED"
      | "BASE_VISIBLE_SET_CHANGED";
    occurredAt: string;
  }>,
) {
  if (input.scopeKind === "AUTHORIZED_PORTFOLIO") return undefined;
  const body = Object.freeze({
    schemaVersion: "queue-order-view-invalidated@1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    reasonCode: input.reasonCode,
    occurredAt: input.occurredAt,
  });
  const payload = Object.freeze({
    ...body,
    invalidationRef: Object.freeze({
      id: input.invalidationId,
      version: input.version,
      semanticHash: sha256(body as JsonValue),
    }),
  });
  return Object.freeze({
    eventType: "queue.order.changed" as const,
    entityId: input.workItemId,
    entityVersion: input.version,
    payload,
  });
}

export class QueueOrderInvalidationRepository extends ScopedRepositoryBase {
  async currentInvalidation(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<Row | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      "SELECT h.resource_version,r.* FROM queue_order_invalidation_heads h LEFT JOIN queue_order_invalidation_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.invalidation_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3",
      [workItemId],
    );
    return rows[0];
  }

  async activeOverrides(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    orderScopeId: string,
    asOf: string,
  ): Promise<readonly Row[]> {
    return await this.workspaceRows<Row>(
      scope,
      `WITH latest AS (
         SELECT DISTINCT ON (work_item_id) * FROM queue_order_overrides
          WHERE workspace_id=$1 AND order_scope_id=$2 AND effective_at<=$3
          ORDER BY work_item_id,move_sequence DESC
       ) SELECT * FROM latest WHERE expires_at>$3 ORDER BY move_sequence,override_id`,
      [orderScopeId, asOf],
    );
  }

  async appendProjectInvalidation(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      workItemId: string;
      reasonCode:
        | "ORDER_OVERRIDE_ACCEPTED"
        | "ORDER_OVERRIDE_EXPIRED"
        | "ORDER_OVERRIDE_SUPERSEDED"
        | "BASE_VISIBLE_SET_CHANGED";
      sourceRef: Readonly<{
        sourceType: string;
        sourceId: string;
        sourceVersion: number;
        semanticHash: string;
      }>;
      occurredAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<
    Readonly<{ changed: boolean; event?: ReturnType<typeof createQueueOrderInvalidation> }>
  > {
    const run = async (manager: EntityManager) => {
      const invalidationId = deterministicUuid(
        `queue-order-invalidation:${input.scope.workspaceId}:${input.scope.projectId}:${input.workItemId}`,
      );
      await manager.query(
        `INSERT INTO queue_order_invalidation_heads(invalidation_id,workspace_id,project_id,work_item_id,current_revision_id,resource_version,created_at,updated_at)
         VALUES($1,$2,$3,$4,NULL,0,$5,$5) ON CONFLICT(workspace_id,project_id,work_item_id) DO NOTHING`,
        [
          invalidationId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          input.occurredAt,
        ],
      );
      const heads = rowsOf(
        await manager.query(
          "SELECT invalidation_id,current_revision_id,resource_version FROM queue_order_invalidation_heads WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
          [input.scope.workspaceId, input.scope.projectId, input.workItemId],
        ),
      );
      const head = heads[0];
      if (!head) throw new Error("QUEUE_ORDER_INVALIDATION_HEAD_MISSING");
      const duplicate = rowsOf(
        await manager.query(
          "SELECT invalidation_revision_id FROM queue_order_invalidation_revisions WHERE workspace_id=$1 AND project_id=$2 AND invalidation_id=$3 AND reason_code=$4 AND source_ref=$5::jsonb LIMIT 1",
          [
            input.scope.workspaceId,
            input.scope.projectId,
            head.invalidation_id,
            input.reasonCode,
            JSON.stringify(input.sourceRef),
          ],
        ),
      );
      if (duplicate.length > 0) return Object.freeze({ changed: false as const });
      const version = Number(head.resource_version) + 1;
      const revisionId = deterministicUuid(
        `queue-order-invalidation-revision:${head.invalidation_id}:${version}:${input.reasonCode}:${input.sourceRef.sourceId}:${input.sourceRef.semanticHash}`,
      );
      const event = createQueueOrderInvalidation({
        scopeKind: "PROJECT",
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        workItemId: input.workItemId,
        invalidationId: revisionId,
        version,
        reasonCode: input.reasonCode,
        occurredAt: input.occurredAt,
      });
      if (!event) throw new Error("QUEUE_ORDER_PROJECT_INVALIDATION_REQUIRED");
      await manager.query(
        `INSERT INTO queue_order_invalidation_revisions(invalidation_revision_id,invalidation_id,workspace_id,project_id,revision_number,previous_revision_id,reason_code,source_ref,occurred_at,semantic_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          revisionId,
          head.invalidation_id,
          input.scope.workspaceId,
          input.scope.projectId,
          version,
          head.current_revision_id ?? null,
          input.reasonCode,
          JSON.stringify(input.sourceRef),
          input.occurredAt,
          event.payload.invalidationRef.semanticHash,
        ],
      );
      const advanced = rowsOf(
        await manager.query(
          `UPDATE queue_order_invalidation_heads SET current_revision_id=$4,resource_version=resource_version+1,updated_at=$5
          WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND resource_version=$6 RETURNING resource_version`,
          [
            input.scope.workspaceId,
            input.scope.projectId,
            input.workItemId,
            revisionId,
            input.occurredAt,
            head.resource_version,
          ],
        ),
      );
      if (advanced.length !== 1) throw new Error("QUEUE_ORDER_INVALIDATION_CAS_CONFLICT");
      const eventId = deterministicUuid(`queue-order-changed-event:${revisionId}`);
      const envelope = Object.freeze({
        envelopeVersion: 1,
        eventId,
        eventType: event.eventType,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
        producer: "worker.queue-temporal",
        producerVersion: "1.0.0",
        workspaceId: input.scope.workspaceId,
        projectId: input.scope.projectId,
        entityType: "queue-order-invalidation",
        entityId: event.entityId,
        entityVersion: event.entityVersion,
        correlationId: deterministicUuid(`queue-order-invalidation-correlation:${revisionId}`),
        causationId: input.sourceRef.sourceId,
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: invalidationId,
          serviceKey: "worker.queue-temporal",
        }),
        dataClassificationKey: "INTERNAL",
        payloadVersion: 1,
        payloadSchemaRef: Object.freeze({
          id: "urn:awp:schemas:006:queue-order-view-invalidated:v1",
          version: 1,
          digest: event.payload.invalidationRef.semanticHash,
        }),
        payload: event.payload,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7) ON CONFLICT(id) DO NOTHING",
        [
          eventId,
          input.scope.workspaceId,
          input.scope.projectId,
          event.eventType,
          JSON.stringify(envelope),
          sha256(envelope as unknown as JsonValue),
          input.occurredAt,
        ],
      );
      return Object.freeze({ changed: true as const, event });
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }
}

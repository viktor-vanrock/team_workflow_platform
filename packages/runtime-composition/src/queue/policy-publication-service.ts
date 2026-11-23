import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";
import {
  type ActorReference,
  type AuthorizationBasisRef,
  type BusinessCalendarRevision,
  projectQueuePolicyFacet,
  projectQueuePolicyNeutralView,
  type QueuePolicyRevision,
} from "@awp/platform-core";
import { QueuePolicyRepository } from "@awp/platform-persistence-typeorm";

import { PostgresQueueEnforcedActivationGate } from "./bootstrap.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const stableUuid = (identity: string): string => {
  const hex = sha256(identity).slice(7).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export interface QueuePolicyPublicationPorts {
  authorize(
    input: Readonly<{
      workspaceId: string;
      actor: ActorReference;
      permission: "queue.calendar.publish" | "queue.policy.publish";
    }>,
  ): Promise<Readonly<{ basis: AuthorizationBasisRef; classificationKey: string }> | undefined>;
  validateEnforcedActivation?(
    input: Readonly<{ workspaceId: string; policy: QueuePolicyRevision; manager: EntityManager }>,
  ): Promise<boolean>;
}

export interface QueuePublicationContext {
  readonly workspaceId: string;
  readonly requestKey: string;
  readonly expectedHeaderVersion: number;
  readonly actor: Extract<ActorReference, { kind: "HUMAN" }>;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface QueuePublicationReceipt {
  readonly state: "PUBLISHED";
  readonly operation: "PUBLISH_CALENDAR" | "PUBLISH_POLICY";
  readonly publishedRevisionRef: Readonly<{
    id: string;
    version: number;
    semanticHash: Sha256Digest;
  }>;
  readonly replayed: boolean;
}

export class QueuePolicyPublicationService {
  readonly #defaultActivationGate: PostgresQueueEnforcedActivationGate;

  constructor(
    private readonly source: DataSource,
    private readonly ports: QueuePolicyPublicationPorts,
  ) {
    this.#defaultActivationGate = new PostgresQueueEnforcedActivationGate(source);
  }

  async publishCalendar(
    input: QueuePublicationContext &
      Readonly<{ calendar: BusinessCalendarRevision; calendarRevisionId: string }>,
  ): Promise<QueuePublicationReceipt> {
    const authorization = await this.ports.authorize({
      workspaceId: input.workspaceId,
      actor: input.actor,
      permission: "queue.calendar.publish",
    });
    if (!authorization) throw new Error("QUEUE_CONFIGURATION_NOT_FOUND");
    const ref = Object.freeze({
      id: input.calendarRevisionId,
      version: input.calendar.revision,
      semanticHash: input.calendar.semanticHash,
    });
    return await this.publishUnit({
      context: input,
      operation: "PUBLISH_CALENDAR",
      requestValue: {
        calendar: input.calendar,
        calendarRevisionId: input.calendarRevisionId,
      } as unknown as JsonValue,
      authorization,
      ref,
      apply: async (manager) => {
        await new QueuePolicyRepository(this.source).publishBusinessCalendar(
          { kind: "WORKSPACE", workspaceId: input.workspaceId },
          input.calendar,
          input.calendarRevisionId,
          input.expectedHeaderVersion,
          manager,
        );
      },
    });
  }

  async publishPolicy(
    input: QueuePublicationContext &
      Readonly<{
        policy: QueuePolicyRevision;
        calendar: BusinessCalendarRevision;
        policyRevisionId: string;
      }>,
  ): Promise<QueuePublicationReceipt> {
    const authorization = await this.ports.authorize({
      workspaceId: input.workspaceId,
      actor: input.actor,
      permission: "queue.policy.publish",
    });
    if (!authorization) throw new Error("QUEUE_CONFIGURATION_NOT_FOUND");
    const ref = Object.freeze({
      id: input.policyRevisionId,
      version: input.policy.revision,
      semanticHash: input.policy.semanticHash,
    });
    return await this.publishUnit({
      context: input,
      operation: "PUBLISH_POLICY",
      requestValue: {
        policy: input.policy,
        policyRevisionId: input.policyRevisionId,
      } as unknown as JsonValue,
      authorization,
      ref,
      apply: async (manager) => {
        if (input.policy.mode === "ENFORCED") {
          const validate = this.ports.validateEnforcedActivation
            ? this.ports.validateEnforcedActivation.bind(this.ports)
            : this.#defaultActivationGate.validate.bind(this.#defaultActivationGate);
          if (!(await validate({ workspaceId: input.workspaceId, policy: input.policy, manager })))
            throw new Error("QUEUE_POLICY_ENFORCED_ACTIVATION_GATE_FAILED");
        }
        const repository = new QueuePolicyRepository(this.source);
        await repository.publishQueuePolicy(
          { kind: "WORKSPACE", workspaceId: input.workspaceId },
          input.policy,
          input.calendar,
          input.policyRevisionId,
          input.expectedHeaderVersion,
          manager,
        );
        const projectRows = rows(
          await manager.query(
            'SELECT id FROM projects WHERE workspace_id=$1 ORDER BY id COLLATE "C"',
            [input.workspaceId],
          ),
        );
        const projectIds = projectRows.map(({ id }) => String(id));
        if (input.policy.projectEntries.some(({ projectId }) => !projectIds.includes(projectId)))
          throw new Error("QUEUE_POLICY_PROJECT_NOT_FOUND");
        const viewId = stableUuid(
          `queue-policy-view:${input.workspaceId}:${input.policy.policyKey}`,
        );
        await repository.ensureNeutralViewHead(
          {
            workspaceId: input.workspaceId,
            policyViewId: viewId,
            policyKey: input.policy.policyKey,
            recordedAt: input.policy.publishedAt,
          },
          manager,
        );
        const view = projectQueuePolicyNeutralView(input.policy, {
          id: viewId,
          version: input.policy.revision,
        });
        await repository.appendNeutralView(
          { kind: "WORKSPACE", workspaceId: input.workspaceId },
          view,
          input.policyRevisionId,
          input.policy.revision,
          input.policy.publishedAt,
          stableUuid(
            `queue-policy-view-revision:${viewId}:${input.policy.revision}:${view.policyViewRef.semanticHash}`,
          ),
          manager,
        );
        for (const projectId of projectIds) {
          const facetId = stableUuid(
            `queue-policy-facet:${input.workspaceId}:${projectId}:${input.policy.policyKey}`,
          );
          await repository.ensureProjectFacetHead(
            {
              workspaceId: input.workspaceId,
              projectId,
              policyFacetId: facetId,
              policyKey: input.policy.policyKey,
              recordedAt: input.policy.publishedAt,
            },
            manager,
          );
          const facet = projectQueuePolicyFacet(input.policy, projectId, {
            id: facetId,
            version: input.policy.revision,
          });
          await repository.appendProjectFacet(
            { kind: "PROJECT", workspaceId: input.workspaceId, projectId },
            facet,
            input.policyRevisionId,
            input.policy.revision,
            input.policy.publishedAt,
            stableUuid(
              `queue-policy-facet-revision:${facetId}:${input.policy.revision}:${facet.policyFacetRef.semanticHash}`,
            ),
            manager,
          );
        }
        const policyRef = Object.freeze({
          sourceType: "WORKSPACE_QUEUE_POLICY_REVISION",
          sourceId: input.policyRevisionId,
          sourceVersion: input.policy.revision,
          semanticHash: input.policy.semanticHash,
        });
        const emptySetHash = sha256([]);
        await manager.query(
          `INSERT INTO workspace_capacity_heads(
           capacity_head_id,workspace_id,current_revision,resource_version,policy_ref,state,
           human_occupied_count,review_reserved_count,human_committed_count,forced_external_count,active_expedite_count,
           claim_set_hash,reservation_set_hash,expedite_set_hash,created_at,updated_at
         ) VALUES($1,$2,0,1,$3,$4,0,0,0,0,0,$5,$5,$5,$6,$6)
         ON CONFLICT(workspace_id) DO UPDATE SET
           current_revision=workspace_capacity_heads.current_revision+1,
           resource_version=workspace_capacity_heads.resource_version+1,
           policy_ref=EXCLUDED.policy_ref,state=EXCLUDED.state,updated_at=EXCLUDED.updated_at`,
          [
            stableUuid(`workspace-capacity-head:${input.workspaceId}`),
            input.workspaceId,
            JSON.stringify(policyRef),
            input.policy.mode,
            emptySetHash,
            input.policy.publishedAt,
          ],
        );
      },
    });
  }

  private async publishUnit(
    input: Readonly<{
      context: QueuePublicationContext;
      operation: QueuePublicationReceipt["operation"];
      requestValue: JsonValue;
      authorization: Readonly<{ basis: AuthorizationBasisRef; classificationKey: string }>;
      ref: QueuePublicationReceipt["publishedRevisionRef"];
      apply(manager: EntityManager): Promise<void>;
    }>,
  ): Promise<QueuePublicationReceipt> {
    if (
      !/^[A-Za-z0-9._:-]{16,200}$/u.test(input.context.requestKey) ||
      !Number.isSafeInteger(input.context.expectedHeaderVersion) ||
      input.context.expectedHeaderVersion < 0
    ) {
      throw new Error("QUEUE_CONFIGURATION_REQUEST_INVALID");
    }
    const keyHash = sha256(input.context.requestKey);
    const requestHash = sha256({
      operation: input.operation,
      expectedHeaderVersion: input.context.expectedHeaderVersion,
      value: input.requestValue,
    } as JsonValue);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const existingRows = rows(
        await manager.query(
          "SELECT request_hash,outcome,published_revision_ref FROM workspace_queue_configuration_requests WHERE workspace_id=$1 AND actor_principal_id=$2 AND operation=$3 AND idempotency_key_hash=$4 FOR UPDATE",
          [input.context.workspaceId, input.context.actor.principalId, input.operation, keyHash],
        ),
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new Error("QUEUE_CONFIGURATION_IDEMPOTENCY_CONFLICT");
        if (existing.outcome !== "PUBLISHED" || !existing.published_revision_ref)
          throw new Error("QUEUE_CONFIGURATION_REQUEST_IN_PROGRESS");
        return Object.freeze({
          state: "PUBLISHED",
          operation: input.operation,
          publishedRevisionRef: json<QueuePublicationReceipt["publishedRevisionRef"]>(
            existing.published_revision_ref,
          ),
          replayed: true,
        });
      }
      await manager.query(
        "INSERT INTO workspace_queue_configuration_requests(workspace_id,actor_principal_id,operation,idempotency_key_hash,request_hash,expected_header_version,draft_semantic_hash,authorization_basis_hash,outcome,published_revision_ref,audit_ref,created_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',NULL,NULL,$9,NULL)",
        [
          input.context.workspaceId,
          input.context.actor.principalId,
          input.operation,
          keyHash,
          requestHash,
          input.context.expectedHeaderVersion,
          input.ref.semanticHash,
          sha256(input.authorization.basis as unknown as JsonValue),
          new Date().toISOString(),
        ],
      );
      await input.apply(manager);
      const auditId = stableUuid(
        `queue-configuration-audit:${input.context.workspaceId}:${input.operation}:${keyHash}`,
      );
      const recordedAt = new Date().toISOString();
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,NULL,$3,$4,$5,'SUCCEEDED','QUEUE_CONFIGURATION_PUBLISHED',$6,$7,$8,$9,$10)",
        [
          auditId,
          input.context.workspaceId,
          recordedAt,
          JSON.stringify(input.context.actor),
          input.operation === "PUBLISH_POLICY" ? "queue.policy.publish" : "queue.calendar.publish",
          input.context.correlationId,
          input.context.causationId,
          JSON.stringify(input.authorization.basis),
          input.authorization.classificationKey,
          JSON.stringify({ publishedRevisionRef: input.ref, requestHash }),
        ],
      );
      const updated = rows(
        await manager.query(
          "UPDATE workspace_queue_configuration_requests SET outcome='PUBLISHED',published_revision_ref=$5,audit_ref=$6,completed_at=$7 WHERE workspace_id=$1 AND actor_principal_id=$2 AND operation=$3 AND idempotency_key_hash=$4 AND outcome='PENDING' RETURNING outcome",
          [
            input.context.workspaceId,
            input.context.actor.principalId,
            input.operation,
            keyHash,
            JSON.stringify(input.ref),
            JSON.stringify({ id: auditId }),
            recordedAt,
          ],
        ),
      );
      if (!updated[0]) throw new Error("QUEUE_CONFIGURATION_CAS_CONFLICT");
      return Object.freeze({
        state: "PUBLISHED",
        operation: input.operation,
        publishedRevisionRef: input.ref,
        replayed: false,
      });
    });
  }
}

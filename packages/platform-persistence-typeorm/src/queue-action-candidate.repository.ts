import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertQueueActionConsumedResult,
  assertQueueActionPair,
  type QueueActionPair,
  type QueueActionPairPort,
  type ResourceScope,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class QueueActionCandidateRepository implements QueueActionPairPort {
  constructor(private readonly source: DataSource) {}

  async getQueueActionPair(
    workspaceId: string,
    projectId: string,
    actionId: string,
  ): Promise<QueueActionPair | undefined> {
    const scope: Extract<ResourceScope, { kind: "PROJECT" }> = {
      kind: "PROJECT",
      workspaceId,
      projectId,
    };
    return await this.scopedPair(scope, actionId);
  }

  async scopedPair(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    actionId: string,
    executor?: EntityManager,
  ): Promise<QueueActionPair | undefined> {
    const rows = (await (executor ?? this.source).query(
      "SELECT * FROM queue_action_candidates WHERE workspace_id=$1 AND project_id=$2 AND action_id=$3",
      [scope.workspaceId, scope.projectId, actionId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const pair: QueueActionPair = {
      actionId: String(row.action_id),
      candidateSchemaId: String(row.public_schema_id) as QueueActionPair["candidateSchemaId"],
      candidateSchemaVersion: Number(row.public_schema_version) as 1,
      candidate: parse(row.public_candidate),
      publicIntentHash: String(row.public_intent_hash) as QueueActionPair["publicIntentHash"],
      witnessSchemaId: String(row.private_schema_id) as QueueActionPair["witnessSchemaId"],
      witnessSchemaVersion: Number(row.private_schema_version) as 1,
      witness: parse(row.private_witness),
      actionHash: String(row.action_hash) as QueueActionPair["actionHash"],
    };
    assertQueueActionPair(pair);
    return Object.freeze(pair);
  }

  async saveQueueActionPair(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      pair: QueueActionPair;
      initiatorId: string;
      initiatorAuthorizationBasis: JsonValue;
      initiatorAuthorizationBasisHash: string;
      createdAt: string;
    }>,
    executor?: EntityManager,
  ): Promise<
    Readonly<{
      state: "PENDING_APPROVAL" | "COMPLETED";
      replayed: boolean;
      resultRef?: Readonly<Record<string, unknown>>;
    }>
  > {
    assertQueueActionPair(input.pair);
    const { pair } = input;
    if (
      pair.candidate.target.workspaceId !== input.scope.workspaceId ||
      pair.candidate.target.projectId !== input.scope.projectId ||
      pair.candidate.scope.workspaceId !== input.scope.workspaceId ||
      sha256(input.initiatorAuthorizationBasis) !== input.initiatorAuthorizationBasisHash
    ) {
      throw new Error("QUEUE_ACTION_PERSISTENCE_SCOPE_OR_BASIS_MISMATCH");
    }
    const effect = pair.candidate.requestedEffect as Readonly<Record<string, unknown>>;
    const terminalNoOp =
      pair.candidate.actionKind === "QUEUE_ORDER_OVERRIDE" &&
      effect.kind === "ANCHOR_UNAVAILABLE_NO_OP";
    const resultRef = terminalNoOp
      ? Object.freeze({
          sourceType: "QUEUE_ACTION_CANDIDATE" as const,
          sourceId: pair.actionId,
          sourceVersion: 1,
          semanticHash: pair.publicIntentHash,
        })
      : undefined;
    if (terminalNoOp) assertQueueActionConsumedResult(pair, { resultRef });
    let replayed = false;
    const run = async (manager: EntityManager) => {
      const existing = (await manager.query(
        "SELECT public_intent_hash,action_hash,initiator_authorization_basis_hash FROM queue_action_candidates WHERE workspace_id=$1 AND project_id=$2 AND action_id=$3 FOR UPDATE",
        [input.scope.workspaceId, input.scope.projectId, pair.actionId],
      )) as readonly Row[];
      if (existing[0]) {
        if (
          existing[0].public_intent_hash !== pair.publicIntentHash ||
          existing[0].action_hash !== pair.actionHash ||
          existing[0].initiator_authorization_basis_hash !== input.initiatorAuthorizationBasisHash
        ) {
          throw new Error("QUEUE_ACTION_IDEMPOTENCY_CONFLICT");
        }
        replayed = true;
        return;
      }
      await manager.query(
        "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,result,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)",
        [
          pair.actionId,
          input.scope.workspaceId,
          input.scope.projectId,
          pair.candidate.actionKind,
          JSON.stringify({
            schemaRef: { id: pair.candidateSchemaId, version: pair.candidateSchemaVersion },
            candidate: pair.candidate,
            privateWitnessRef: {
              id: pair.actionId,
              version: pair.witnessSchemaVersion,
              semanticHash: pair.actionHash,
            },
            initiatorId: input.initiatorId,
          }),
          pair.publicIntentHash,
          terminalNoOp ? "COMPLETED" : "PENDING_APPROVAL",
          resultRef ? JSON.stringify({ resultRef }) : null,
          input.createdAt,
        ],
      );
      await manager.query(
        "INSERT INTO queue_action_candidates(action_id,workspace_id,project_id,action_kind,public_schema_id,public_schema_version,public_candidate,public_intent_hash,private_schema_id,private_schema_version,private_witness,action_hash,initiator_authorization_basis,initiator_authorization_basis_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          pair.actionId,
          input.scope.workspaceId,
          input.scope.projectId,
          pair.candidate.actionKind,
          pair.candidateSchemaId,
          pair.candidateSchemaVersion,
          JSON.stringify(pair.candidate),
          pair.publicIntentHash,
          pair.witnessSchemaId,
          pair.witnessSchemaVersion,
          JSON.stringify(pair.witness),
          pair.actionHash,
          JSON.stringify(input.initiatorAuthorizationBasis),
          input.initiatorAuthorizationBasisHash,
          pair.candidate.expiresAt ?? null,
          input.createdAt,
        ],
      );
    };
    if (executor) await run(executor);
    else await this.source.transaction("SERIALIZABLE", run);
    return Object.freeze({
      state: terminalNoOp ? ("COMPLETED" as const) : ("PENDING_APPROVAL" as const),
      replayed,
      ...(resultRef ? { resultRef } : {}),
    });
  }
}

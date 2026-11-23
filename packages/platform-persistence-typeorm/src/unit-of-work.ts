import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type {
  ClientRequestIdempotencyRecord,
  ClientRequestIdentity,
  CommandGatewayUnitOfWork,
  ConnectorCommand,
  GatewayCommit,
} from "@awp/platform-core";

import { TypeOrmCommandRepository } from "./command.repository.ts";
import { TypeOrmIdempotencyRepository } from "./idempotency.repository.ts";

export interface TypeOrmGatewayCommit extends GatewayCommit {
  readonly mutate?: (manager: EntityManager) => Promise<void>;
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

export class TypeOrmUnitOfWork implements CommandGatewayUnitOfWork {
  readonly #commands: TypeOrmCommandRepository;
  readonly #idempotency: TypeOrmIdempotencyRepository;

  constructor(
    private readonly source: DataSource,
    private readonly transaction?: EntityManager,
  ) {
    if (transaction && !transaction.queryRunner?.isTransactionActive)
      throw new Error("GATEWAY_ACTIVE_TRANSACTION_REQUIRED");
    this.#commands = new TypeOrmCommandRepository(source);
    this.#idempotency = new TypeOrmIdempotencyRepository(source);
  }

  async inTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (this.transaction) {
      if (!this.transaction.queryRunner?.isTransactionActive)
        throw new Error("GATEWAY_ACTIVE_TRANSACTION_REQUIRED");
      return await work(this.transaction);
    }
    return await this.source.transaction("SERIALIZABLE", work);
  }

  async find(identity: ClientRequestIdentity): Promise<ClientRequestIdempotencyRecord | undefined> {
    return await this.#idempotency.find(identity, this.transaction);
  }

  async command(
    workspaceId: string,
    projectId: string,
    id: string,
  ): Promise<ConnectorCommand | undefined> {
    return await this.#commands.get(workspaceId, projectId, id, this.transaction);
  }

  async commit(value: GatewayCommit): Promise<void> {
    await this.commitGateway(value);
  }

  async commitGateway(value: TypeOrmGatewayCommit): Promise<void> {
    try {
      await this.inTransaction(async (manager) => {
        if (value.mutate) {
          await value.mutate(manager);
        }

        const command = value.command;
        await this.#commands.insert(command, manager);
        await this.#idempotency.claim(value.idempotency, manager);

        if (value.approval) {
          const approval = value.approval;
          await manager.query(
            "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13)",
            [
              approval.id,
              approval.workspaceId,
              approval.projectId,
              approval.action.actionKind,
              approval.action.actionId,
              JSON.stringify(approval),
              approval.subjectHash,
              approval.decisionStatus,
              approval.effectAuthorizationStatus,
              approval.initiatorId,
              approval.expiresAt,
              approval.resourceVersion,
              approval.createdAt,
            ],
          );
        }

        await manager.query(
          "INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,attempts,envelope_hash,created_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,0,$6,$5)",
          [
            command.id,
            command.workspaceId,
            command.projectId,
            command.outboxStatus,
            command.createdAt,
            sha256({
              commandId: command.id,
              workspaceId: command.workspaceId,
              projectId: command.projectId,
              correlationId: command.correlationId,
              causationId: command.causationId,
            } as JsonValue),
          ],
        );
        await manager.query(
          "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,'ACCEPTED','COMMAND_ACCEPTED',$6,$7,$8,$9,$10)",
          [
            command.workspaceId,
            command.projectId,
            command.createdAt,
            JSON.stringify(command.actor),
            command.commandType,
            command.correlationId,
            command.causationId,
            JSON.stringify(command.initialAuthorizationBasis),
            command.dataClassificationKey,
            JSON.stringify({ commandId: command.id }),
          ],
        );
      });
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new Error("IDEMPOTENCY_CONCURRENT_CLAIM", { cause: error });
      }
      throw error;
    }
  }
}

import type { DataSource, EntityManager } from "typeorm";

import type { ConnectorCommand } from "@awp/platform-core";

type Row = Record<string, unknown>;
type QueryExecutor = Pick<EntityManager, "query">;

function parse<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function asDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(code);
  }
  return value;
}

function returned(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object") {
      const structured = value as Readonly<{
        records?: unknown;
        raw?: unknown;
      }>;
      if (Array.isArray(structured.records)) return returned(structured.records);
      if (Array.isArray(structured.raw)) return returned(structured.raw);
    }
    return [];
  }
  if (Array.isArray(value[0])) return returned(value[0]);
  return value.filter(
    (item): item is Row => item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

interface StoredCommandMetadata {
  readonly replayAuthorization?: Readonly<{ decisionId: string; expiresAt: string | Date }>;
  readonly commandType: string;
  readonly logicalRole: string;
  readonly targetHash: string;
  readonly payloadHash: string;
  readonly expectedExternalState: unknown;
  readonly clientRequestKey: string;
  readonly dataClassificationKey: string;
  readonly initialAuthorizationBasis: ConnectorCommand["initialAuthorizationBasis"];
  readonly initialAuthorizationBasisHash: string;
  readonly source: ConnectorCommand["source"];
  readonly recoveryPolicy?: ConnectorCommand["recoveryPolicy"];
  readonly status: ConnectorCommand["status"];
  readonly effectAuthorizationStatus: ConnectorCommand["effectAuthorizationStatus"];
  readonly outboxStatus: ConnectorCommand["outboxStatus"];
  readonly approvalId?: string;
  readonly effectInvocationStartedAt?: string | Date;
  readonly effectGateDecision?: ConnectorCommand["effectGateDecision"];
  readonly effectGateReasonCode?: string;
  readonly effectGateEvaluatedAt?: string | Date;
  readonly effectAuthorizationBasis?: ConnectorCommand["effectAuthorizationBasis"];
  readonly effectAuthorizationBasisHash?: string;
  readonly executionLeaseExpiresAt?: string | Date;
  readonly attemptCount: number;
  readonly createdAt: string | Date;
  readonly updatedAt: string | Date;
}

interface StoredCommandPayload {
  readonly value: unknown;
  readonly metadata: StoredCommandMetadata;
}

function storedPayload(command: ConnectorCommand): StoredCommandPayload {
  return {
    value: command.payload,
    metadata: {
      ...(command.replayAuthorization ? { replayAuthorization: command.replayAuthorization } : {}),
      commandType: command.commandType,
      logicalRole: command.capability.logicalRole,
      targetHash: command.targetHash,
      payloadHash: command.payloadHash,
      expectedExternalState: command.expectedExternalState,
      clientRequestKey: command.clientRequestKey,
      dataClassificationKey: command.dataClassificationKey,
      initialAuthorizationBasis: command.initialAuthorizationBasis,
      initialAuthorizationBasisHash: command.initialAuthorizationBasisHash,
      source: command.source,
      ...(command.recoveryPolicy ? { recoveryPolicy: command.recoveryPolicy } : {}),
      status: command.status,
      effectAuthorizationStatus: command.effectAuthorizationStatus,
      outboxStatus: command.outboxStatus,
      ...(command.approvalId ? { approvalId: command.approvalId } : {}),
      ...(command.effectInvocationStartedAt
        ? { effectInvocationStartedAt: command.effectInvocationStartedAt }
        : {}),
      ...(command.effectGateDecision ? { effectGateDecision: command.effectGateDecision } : {}),
      ...(command.effectGateReasonCode
        ? { effectGateReasonCode: command.effectGateReasonCode }
        : {}),
      ...(command.effectGateEvaluatedAt
        ? { effectGateEvaluatedAt: command.effectGateEvaluatedAt }
        : {}),
      ...(command.effectAuthorizationBasis
        ? { effectAuthorizationBasis: command.effectAuthorizationBasis }
        : {}),
      ...(command.effectAuthorizationBasisHash
        ? { effectAuthorizationBasisHash: command.effectAuthorizationBasisHash }
        : {}),
      ...(command.executionLeaseExpiresAt
        ? { executionLeaseExpiresAt: command.executionLeaseExpiresAt }
        : {}),
      attemptCount: command.attemptCount,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
    },
  };
}

export class TypeOrmCommandRepository {
  constructor(private readonly source: DataSource) {}

  async insert(
    command: ConnectorCommand,
    manager: QueryExecutor = this.source.manager,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
      [
        command.id,
        command.workspaceId,
        command.projectId,
        JSON.stringify(command.actor),
        command.capability.key,
        command.capability.exactContractVersion,
        command.capability.operation,
        JSON.stringify(command.target),
        JSON.stringify(storedPayload(command)),
        JSON.stringify(command.bindingRef),
        JSON.stringify(command.profileRef),
        command.effectIdempotencyKey,
        command.status,
        command.terminalResult ? JSON.stringify(command.terminalResult) : null,
        command.correlationId,
        command.causationId,
        command.rowVersion,
        command.createdAt,
      ],
    );
  }

  async get(
    workspaceId: string,
    projectId: string,
    id: string,
    manager: QueryExecutor = this.source.manager,
  ): Promise<ConnectorCommand | undefined> {
    const result = (await manager.query(
      "SELECT * FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, id],
    )) as Row[];
    const row = result[0];
    if (!row) return undefined;

    const payload = parse<StoredCommandPayload>(row.payload);
    const metadata = payload.metadata;
    return {
      id: String(row.id),
      workspaceId,
      projectId,
      actor: parse(row.actor),
      commandType: metadata.commandType,
      capability: {
        key: String(row.capability_key),
        exactContractVersion: String(row.capability_version),
        operation: String(row.operation),
        logicalRole: requiredString(metadata.logicalRole, "COMMAND_LOGICAL_ROLE_MISSING"),
      },
      target: parse(row.target),
      targetHash: metadata.targetHash,
      payload: payload.value,
      payloadHash: metadata.payloadHash,
      expectedExternalState: metadata.expectedExternalState,
      bindingRef: parse(row.binding_ref),
      profileRef: parse(row.profile_ref),
      clientRequestKey: metadata.clientRequestKey,
      effectIdempotencyKey: String(row.effect_idempotency_key),
      dataClassificationKey: metadata.dataClassificationKey,
      initialAuthorizationBasis: metadata.initialAuthorizationBasis,
      initialAuthorizationBasisHash: metadata.initialAuthorizationBasisHash,
      correlationId: String(row.correlation_id),
      causationId: String(row.causation_id),
      source: metadata.source,
      ...(metadata.recoveryPolicy ? { recoveryPolicy: metadata.recoveryPolicy } : {}),
      status: String(row.state) as ConnectorCommand["status"],
      effectAuthorizationStatus: metadata.effectAuthorizationStatus,
      outboxStatus: metadata.outboxStatus,
      ...(metadata.approvalId ? { approvalId: metadata.approvalId } : {}),
      ...(metadata.effectInvocationStartedAt
        ? {
            effectInvocationStartedAt: asDate(metadata.effectInvocationStartedAt),
          }
        : {}),
      ...(metadata.effectGateDecision ? { effectGateDecision: metadata.effectGateDecision } : {}),
      ...(metadata.effectGateReasonCode
        ? { effectGateReasonCode: metadata.effectGateReasonCode }
        : {}),
      ...(metadata.effectGateEvaluatedAt
        ? {
            effectGateEvaluatedAt: asDate(metadata.effectGateEvaluatedAt),
          }
        : {}),
      ...(metadata.effectAuthorizationBasis
        ? { effectAuthorizationBasis: metadata.effectAuthorizationBasis }
        : {}),
      ...(metadata.effectAuthorizationBasisHash
        ? {
            effectAuthorizationBasisHash: metadata.effectAuthorizationBasisHash,
          }
        : {}),
      ...(metadata.executionLeaseExpiresAt
        ? {
            executionLeaseExpiresAt: asDate(metadata.executionLeaseExpiresAt),
          }
        : {}),
      ...(row.result ? { terminalResult: parse(row.result) } : {}),
      attemptCount: metadata.attemptCount,
      createdAt: asDate(row.created_at),
      updatedAt: asDate(metadata.updatedAt),
      rowVersion: Number(row.row_version),
      ...(metadata.replayAuthorization
        ? {
            replayAuthorization: {
              decisionId: metadata.replayAuthorization.decisionId,
              expiresAt: asDate(metadata.replayAuthorization.expiresAt),
            },
          }
        : {}),
    };
  }

  async save(
    command: ConnectorCommand,
    expectedVersion: number,
    manager: QueryExecutor = this.source.manager,
  ): Promise<void> {
    const result = returned(
      await manager.query(
        "UPDATE connector_commands SET state=$4,result=$5,payload=$6,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$7 RETURNING id",
        [
          command.workspaceId,
          command.projectId,
          command.id,
          command.status,
          command.terminalResult ? JSON.stringify(command.terminalResult) : null,
          JSON.stringify(storedPayload(command)),
          expectedVersion,
        ],
      ),
    );
    if (result.length !== 1) throw new Error("COMMAND_CAS_CONFLICT");
  }
}

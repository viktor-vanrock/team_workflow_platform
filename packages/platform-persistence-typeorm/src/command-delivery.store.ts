import type { DataSource, EntityManager } from "typeorm";

import {
  type AuthorizationBasisRef,
  type ConnectorCommand,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";

import { TypeOrmCommandRepository } from "./command.repository.ts";
import {
  type ClaimedCommandOutboxRecord,
  type CommandOutboxState,
  TypeOrmCommandOutboxRepository,
} from "./command-outbox.repository.ts";

type Row = Record<string, unknown>;
type QueryExecutor = Pick<EntityManager, "query">;

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

interface LockedOutbox {
  readonly id: string;
  readonly state: CommandOutboxState;
  readonly leaseUntil?: Date;
}

export interface CommandDeliveryScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
}

export interface ClaimedCommandDelivery {
  readonly outbox: ClaimedCommandOutboxRecord;
  readonly command: ConnectorCommand;
}

export interface CommandEffectGateEvidence {
  readonly evaluatedAt: Date;
  readonly authorizationBasis: AuthorizationBasisRef;
  readonly authorizationBasisHash: string;
}

/** Identifies the exact durable command execution attempt allowed to finish. */
export interface CommandExecutionFence {
  readonly attemptCount: number;
  readonly leaseExpiresAt: Date;
}

export type CommandConfirmationMutation = (
  manager: EntityManager,
  command: ConnectorCommand,
) => Promise<void>;

type CommandDeliveryReference = CommandDeliveryScope | ClaimedCommandOutboxRecord;

function isClaim(value: CommandDeliveryReference): value is ClaimedCommandOutboxRecord {
  return "id" in value && "leaseUntil" in value;
}

function scopeOf(value: CommandDeliveryReference): CommandDeliveryScope {
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    commandId: value.commandId,
  };
}

function assertDate(value: Date, code: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
}

function asDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function assertLeaseMs(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error("COMMAND_EXECUTION_LEASE_INVALID");
  }
}

function assertAttemptCount(attemptCount: number): void {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error("COMMAND_EXECUTION_FENCE_INVALID");
  }
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("COMMAND_RECOVERY_LIMIT_INVALID");
  }
}

/**
 * Transactional PostgreSQL worker API. PostgreSQL owns the delivery envelope,
 * every lifecycle transition and every recovery decision.
 */
export class TypeOrmCommandDeliveryStore {
  readonly #commands: TypeOrmCommandRepository;
  readonly #outbox: TypeOrmCommandOutboxRepository;

  constructor(private readonly source: DataSource) {
    this.#commands = new TypeOrmCommandRepository(source);
    this.#outbox = new TypeOrmCommandOutboxRepository(source);
  }

  async claim(
    now: Date,
    leaseUntil: Date,
    limit = 50,
    capabilityKeys?: readonly string[],
    scope?: Readonly<{
      workspaceId: string;
      projectIds: readonly string[];
      operations: readonly string[];
    }>,
  ): Promise<readonly ClaimedCommandDelivery[]> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const claims = await this.#outbox.claimInTransaction(
        manager,
        now,
        leaseUntil,
        limit,
        capabilityKeys,
        scope,
      );
      const deliveries: ClaimedCommandDelivery[] = [];
      for (const outbox of claims) {
        const command = await this.#mustLoad(scopeOf(outbox), manager);
        if (!new Set(["QUEUED", "RETRY_SCHEDULED"]).has(command.status)) {
          throw new Error("COMMAND_OUTBOX_NOT_DELIVERABLE");
        }
        if (!new Set(["READY", "LEASED", "ENQUEUED"]).has(command.outboxStatus)) {
          throw new Error("COMMAND_OUTBOX_STATE_CONFLICT");
        }
        const claimedCommand = await this.#transition(manager, command, {
          status: command.status === "RETRY_SCHEDULED" ? "QUEUED" : command.status,
          outboxStatus: "LEASED",
          updatedAt: now,
        });
        deliveries.push(Object.freeze({ outbox, command: claimedCommand }));
      }
      return Object.freeze(deliveries);
    });
  }

  async load(scope: CommandDeliveryScope): Promise<ConnectorCommand | undefined> {
    return await this.#commands.get(scope.workspaceId, scope.projectId, scope.commandId);
  }

  async loadClaimed(claim: ClaimedCommandOutboxRecord): Promise<ConnectorCommand> {
    return await this.source.transaction("REPEATABLE READ", async (manager) => {
      const persisted = await this.#outbox.get(claim, manager);
      if (
        persisted?.state !== "LEASED" ||
        !persisted.leaseUntil ||
        persisted.leaseUntil.getTime() !== claim.leaseUntil.getTime()
      ) {
        throw new Error("COMMAND_OUTBOX_LEASE_CONFLICT");
      }
      const command = await this.#mustLoad(scopeOf(claim), manager);
      if (command.outboxStatus !== "LEASED") {
        throw new Error("COMMAND_OUTBOX_STATE_CONFLICT");
      }
      return command;
    });
  }

  async acknowledgeEnqueued(
    claim: ClaimedCommandOutboxRecord,
    now: Date,
    nextRepublishAt: Date,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    if (nextRepublishAt <= now) {
      throw new Error("COMMAND_OUTBOX_VISIBILITY_INVALID");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await this.#outbox.acknowledgeEnqueued(claim, nextRepublishAt, manager);
      const command = await this.#mustLoad(scopeOf(claim), manager);
      if (command.status !== "QUEUED" || command.outboxStatus !== "LEASED") {
        throw new Error("COMMAND_OUTBOX_STATE_CONFLICT");
      }
      return await this.#transition(manager, command, {
        outboxStatus: "ENQUEUED",
        updatedAt: now,
      });
    });
  }

  async release(
    claim: ClaimedCommandOutboxRecord,
    now: Date,
    availableAt: Date = now,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await this.#outbox.release(claim, availableAt, manager);
      const command = await this.#mustLoad(scopeOf(claim), manager);
      if (command.status !== "QUEUED" || command.outboxStatus !== "LEASED") {
        throw new Error("COMMAND_OUTBOX_STATE_CONFLICT");
      }
      return await this.#transition(manager, command, {
        outboxStatus: "READY",
        updatedAt: now,
      });
    });
  }

  /** Atomically claims durable execution and acknowledges the delivery row. */
  async markDispatched(
    reference: CommandDeliveryReference,
    now: Date,
    leaseMs: number,
    gate?: CommandEffectGateEvidence,
    onInvocationStarted?: CommandConfirmationMutation,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    assertLeaseMs(leaseMs);
    const executionLeaseExpiresAt = new Date(now.getTime() + leaseMs);
    assertDate(executionLeaseExpiresAt, "COMMAND_EXECUTION_LEASE_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, reference);
      const expectedOutboxState = isClaim(reference) ? "LEASED" : "ENQUEUED";
      if (outbox.state !== expectedOutboxState) {
        throw new Error("COMMAND_OUTBOX_STATE_CONFLICT");
      }
      if (isClaim(reference) && outbox.leaseUntil?.getTime() !== reference.leaseUntil.getTime()) {
        throw new Error("COMMAND_OUTBOX_LEASE_CONFLICT");
      }

      const command = await this.#mustLoad(scopeOf(reference), manager);
      if (command.status !== "QUEUED" || command.outboxStatus !== expectedOutboxState) {
        throw new Error("COMMAND_DELIVERY_STATE_CONFLICT");
      }
      if (!new Set(["NOT_REQUIRED", "CONSUMED"]).has(command.effectAuthorizationStatus)) {
        throw new Error("COMMAND_EFFECT_AUTHORIZATION_NOT_CONSUMED");
      }
      if (command.effectGateDecision !== undefined && command.effectGateDecision !== "ALLOWED") {
        throw new Error("COMMAND_EFFECT_GATE_NOT_ALLOWED");
      }

      // Pack guards and the Core attempt must commit together, before provider I/O.
      if (
        command.replayAuthorization &&
        (!command.replayAuthorization.decisionId ||
          !Number.isFinite(command.replayAuthorization.expiresAt.getTime()) ||
          command.replayAuthorization.expiresAt <= now)
      )
        throw new Error("COMMAND_REPLAY_AUTHORIZATION_EXPIRED");
      await onInvocationStarted?.(manager, command);

      await this.#updateOutbox(manager, outbox.id, scopeOf(reference), "ACKNOWLEDGED");
      return await this.#transition(manager, command, {
        status: "DISPATCHED",
        outboxStatus: "ACKNOWLEDGED",
        effectInvocationStartedAt: command.effectInvocationStartedAt ?? now,
        effectGateDecision: "ALLOWED",
        effectGateEvaluatedAt: gate?.evaluatedAt ?? command.effectGateEvaluatedAt ?? now,
        effectAuthorizationBasis:
          gate?.authorizationBasis ??
          command.effectAuthorizationBasis ??
          command.initialAuthorizationBasis,
        effectAuthorizationBasisHash:
          gate?.authorizationBasisHash ??
          command.effectAuthorizationBasisHash ??
          command.initialAuthorizationBasisHash,
        executionLeaseExpiresAt,
        attemptCount: command.attemptCount + 1,
        updatedAt: now,
      });
    });
  }

  async confirm(
    scope: CommandDeliveryScope,
    result: unknown,
    now: Date,
  ): Promise<ConnectorCommand> {
    return await this.confirmWith(scope, result, now, async () => {});
  }

  async confirmWith(
    scope: CommandDeliveryScope,
    result: unknown,
    now: Date,
    mutate: CommandConfirmationMutation,
    fence?: CommandExecutionFence,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    if (fence) {
      assertAttemptCount(fence.attemptCount);
      assertDate(fence.leaseExpiresAt, "COMMAND_EXECUTION_LEASE_INVALID");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        outbox.state !== "ACKNOWLEDGED" ||
        command.status !== "DISPATCHED" ||
        command.outboxStatus !== "ACKNOWLEDGED"
      ) {
        throw new Error("COMMAND_CONFIRMATION_STATE_CONFLICT");
      }
      if (
        fence &&
        (command.attemptCount !== fence.attemptCount ||
          !command.executionLeaseExpiresAt ||
          command.executionLeaseExpiresAt.getTime() !== fence.leaseExpiresAt.getTime() ||
          command.executionLeaseExpiresAt <= now)
      ) {
        throw new Error("COMMAND_EXECUTION_FENCE_REJECTED");
      }
      await mutate(manager, command);
      await this.#updateOutbox(manager, outbox.id, scope, "ACKNOWLEDGED");
      return await this.#transition(manager, command, {
        status: "CONFIRMED",
        outboxStatus: "ACKNOWLEDGED",
        terminalResult: { outcome: "SUCCEEDED", receipt: result },
        executionLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    });
  }

  async fail(
    scope: CommandDeliveryScope,
    code: string,
    now: Date,
    mutate?: CommandConfirmationMutation,
    fence?: CommandExecutionFence,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    if (code.length === 0) throw new Error("COMMAND_FAILURE_CODE_REQUIRED");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        outbox.state !== "ACKNOWLEDGED" ||
        command.status !== "DISPATCHED" ||
        command.outboxStatus !== "ACKNOWLEDGED"
      ) {
        throw new Error("COMMAND_FAILURE_STATE_CONFLICT");
      }
      if (
        fence &&
        (command.attemptCount !== fence.attemptCount ||
          !command.executionLeaseExpiresAt ||
          command.executionLeaseExpiresAt.getTime() !== fence.leaseExpiresAt.getTime() ||
          command.executionLeaseExpiresAt <= now)
      )
        throw new Error("COMMAND_EXECUTION_FENCE_REJECTED");
      await mutate?.(manager, command);
      await this.#updateOutbox(manager, outbox.id, scope, "DEAD");
      return await this.#transition(manager, command, {
        status: "FAILED",
        outboxStatus: "DEAD",
        terminalResult: { outcome: "FAILED", code },
        executionLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    });
  }

  /** Terminal policy denial before invocation; never manufactures an effect marker. */
  async failUndispatched(
    scope: CommandDeliveryScope,
    code: string,
    now: Date,
    mutate: CommandConfirmationMutation,
  ): Promise<ConnectorCommand> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code)) throw new Error("COMMAND_FAILURE_CODE_REQUIRED");
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        command.status !== "QUEUED" ||
        command.effectInvocationStartedAt ||
        command.outboxStatus !== "ENQUEUED" ||
        outbox.state !== "ENQUEUED" ||
        !["NOT_REQUIRED", "CONSUMED"].includes(command.effectAuthorizationStatus)
      )
        throw new Error("COMMAND_FAILURE_STATE_CONFLICT");
      await mutate(manager, command);
      await this.#updateOutbox(manager, outbox.id, scope, "DEAD");
      return this.#transition(manager, command, {
        status: "FAILED",
        outboxStatus: "DEAD",
        terminalResult: { outcome: "FAILED", code },
        executionLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    });
  }

  async recover(scope: CommandDeliveryScope, now: Date): Promise<ConnectorCommand | undefined> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        command.status !== "DISPATCHED" ||
        !command.executionLeaseExpiresAt ||
        command.executionLeaseExpiresAt > now
      ) {
        return undefined;
      }
      if (outbox.state !== "ACKNOWLEDGED" || command.outboxStatus !== "ACKNOWLEDGED") {
        throw new Error("COMMAND_RECOVERY_STATE_CONFLICT");
      }
      return await this.#recoverLocked(manager, outbox.id, command, now);
    });
  }

  /** Renews a fence for read-back only; it never returns an effect to the write queue. */
  async claimConfirmation(
    scope: CommandDeliveryScope,
    now: Date,
    leaseMs: number,
  ): Promise<ConnectorCommand | undefined> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    assertLeaseMs(leaseMs);
    const executionLeaseExpiresAt = new Date(now.getTime() + leaseMs);
    assertDate(executionLeaseExpiresAt, "COMMAND_EXECUTION_LEASE_INVALID");
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        command.status !== "DISPATCHED" ||
        !command.executionLeaseExpiresAt ||
        command.executionLeaseExpiresAt > now
      )
        return undefined;
      if (
        command.recoveryPolicy !== "LOOKUP_REQUIRED" ||
        !command.effectInvocationStartedAt ||
        command.outboxStatus !== "ACKNOWLEDGED" ||
        outbox.state !== "ACKNOWLEDGED"
      )
        throw new Error("COMMAND_CONFIRMATION_RECOVERY_DENIED");
      return this.#transition(manager, command, {
        executionLeaseExpiresAt,
        attemptCount: command.attemptCount + 1,
        updatedAt: now,
      });
    });
  }

  /** Terminal lookup-only quarantine under the same outbox→command locks as dispatch. */
  async quarantineExpiredConfirmation(
    scope: CommandDeliveryScope,
    code: string,
    now: Date,
    policy: Readonly<{ maximumAttempts: number; maximumElapsedMs: number }>,
  ): Promise<ConnectorCommand | undefined> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    if (
      !/^[A-Z][A-Z0-9_]{0,127}$/u.test(code) ||
      !Number.isSafeInteger(policy.maximumAttempts) ||
      policy.maximumAttempts < 1 ||
      policy.maximumAttempts > 100 ||
      !Number.isSafeInteger(policy.maximumElapsedMs) ||
      policy.maximumElapsedMs < 1 ||
      policy.maximumElapsedMs > 604_800_000
    )
      throw new Error("COMMAND_CONFIRMATION_QUARANTINE_POLICY_INVALID");
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const outbox = await this.#lockOutbox(manager, scope);
      const command = await this.#mustLoad(scope, manager);
      if (
        command.status !== "DISPATCHED" ||
        command.outboxStatus !== "ACKNOWLEDGED" ||
        outbox.state !== "ACKNOWLEDGED" ||
        command.recoveryPolicy !== "LOOKUP_REQUIRED" ||
        !command.effectInvocationStartedAt ||
        !command.executionLeaseExpiresAt
      )
        throw new Error("COMMAND_CONFIRMATION_RECOVERY_DENIED");
      if (
        command.executionLeaseExpiresAt > now ||
        (command.attemptCount < policy.maximumAttempts &&
          now.getTime() - command.effectInvocationStartedAt.getTime() < policy.maximumElapsedMs)
      )
        return undefined;
      await this.#updateOutbox(manager, outbox.id, scope, "DEAD");
      return this.#transition(manager, command, {
        status: "FAILED",
        outboxStatus: "DEAD",
        terminalResult: { outcome: "FAILED", code },
        executionLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    });
  }

  async recoverExpired(
    now: Date,
    limit = 50,
    scope?: Readonly<{
      workspaceId: string;
      projectIds: readonly string[];
      operations: readonly string[];
    }>,
  ): Promise<readonly CommandDeliveryScope[]> {
    assertDate(now, "COMMAND_DELIVERY_TIME_INVALID");
    assertLimit(limit);
    if (scope && (!scope.workspaceId || !scope.projectIds.length || !scope.operations.length))
      throw new Error("COMMAND_OUTBOX_SCOPE_FILTER_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        `SELECT c.workspace_id,c.project_id,c.id AS command_id,o.id AS outbox_id
           FROM connector_commands c
           JOIN command_outbox o
             ON o.workspace_id=c.workspace_id
            AND o.project_id=c.project_id
            AND o.command_id=c.id
          WHERE c.state='DISPATCHED'
            AND o.state='ACKNOWLEDGED'
            AND ($3::uuid IS NULL OR (c.workspace_id=$3 AND c.project_id=ANY($4::uuid[]) AND c.operation=ANY($5::text[])))
            AND NULLIF(c.payload #>> '{metadata,executionLeaseExpiresAt}','')::timestamptz<=$1
            AND (NULLIF(c.payload #>> '{metadata,effectInvocationStartedAt}','') IS NULL
              OR COALESCE(c.payload #>> '{metadata,recoveryPolicy}','SAFE_RETRY') NOT IN ('LOOKUP_REQUIRED','NONE_AMBIGUOUS'))
          ORDER BY NULLIF(c.payload #>> '{metadata,executionLeaseExpiresAt}','')::timestamptz,c.id
          FOR UPDATE OF c,o SKIP LOCKED
          LIMIT $2`,
        [
          now,
          limit,
          scope?.workspaceId ?? null,
          scope ? [...scope.projectIds] : null,
          scope ? [...scope.operations] : null,
        ],
      )) as Row[];
      const recovered: CommandDeliveryScope[] = [];
      for (const row of rows) {
        const scope: CommandDeliveryScope = {
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          commandId: String(row.command_id),
        };
        const command = await this.#mustLoad(scope, manager);
        if (
          command.status !== "DISPATCHED" ||
          !command.executionLeaseExpiresAt ||
          command.executionLeaseExpiresAt > now
        ) {
          continue;
        }
        const result = await this.#recoverLocked(manager, String(row.outbox_id), command, now);
        if (result) recovered.push(Object.freeze(scope));
      }
      return Object.freeze(recovered);
    });
  }

  async #recoverLocked(
    manager: QueryExecutor,
    outboxId: string,
    command: ConnectorCommand,
    now: Date,
  ): Promise<ConnectorCommand | undefined> {
    const lookupOnly =
      command.recoveryPolicy === "LOOKUP_REQUIRED" || command.recoveryPolicy === "NONE_AMBIGUOUS";
    if (command.effectInvocationStartedAt && lookupOnly) return undefined;
    await this.#updateOutbox(
      manager,
      outboxId,
      {
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        commandId: command.id,
      },
      "READY",
      now,
    );
    return await this.#transition(manager, command, {
      status: "RETRY_SCHEDULED",
      outboxStatus: "READY",
      executionLeaseExpiresAt: undefined,
      updatedAt: now,
    });
  }

  async #lockOutbox(
    manager: QueryExecutor,
    reference: CommandDeliveryReference,
  ): Promise<LockedOutbox> {
    const rows = isClaim(reference)
      ? ((await manager.query(
          `SELECT id,state,lease_until
             FROM command_outbox
            WHERE id=$1 AND command_id=$2 AND workspace_id=$3 AND project_id=$4
            FOR UPDATE`,
          [reference.id, reference.commandId, reference.workspaceId, reference.projectId],
        )) as Row[])
      : ((await manager.query(
          `SELECT id,state,lease_until
             FROM command_outbox
            WHERE command_id=$1 AND workspace_id=$2 AND project_id=$3
            FOR UPDATE`,
          [reference.commandId, reference.workspaceId, reference.projectId],
        )) as Row[]);
    if (rows.length !== 1) throw new Error("COMMAND_OUTBOX_SCOPE_CONFLICT");
    const row = rows[0]!;
    return {
      id: String(row.id),
      state: String(row.state) as CommandOutboxState,
      ...(row.lease_until ? { leaseUntil: asDate(row.lease_until) } : {}),
    };
  }

  async #updateOutbox(
    manager: QueryExecutor,
    outboxId: string,
    scope: CommandDeliveryScope,
    state: CommandOutboxState,
    availableAt?: Date,
  ): Promise<void> {
    const rows = returned(
      await manager.query(
        `UPDATE command_outbox
          SET state=$5,
              available_at=COALESCE($6,available_at),
              lease_until=NULL,
              next_republish_at=NULL
        WHERE id=$1 AND command_id=$2 AND workspace_id=$3 AND project_id=$4
        RETURNING id`,
        [outboxId, scope.commandId, scope.workspaceId, scope.projectId, state, availableAt ?? null],
      ),
    );
    if (rows.length !== 1) throw new Error("COMMAND_OUTBOX_SCOPE_CONFLICT");
  }

  async #mustLoad(scope: CommandDeliveryScope, manager: QueryExecutor): Promise<ConnectorCommand> {
    const command = await this.#commands.get(
      scope.workspaceId,
      scope.projectId,
      scope.commandId,
      manager,
    );
    if (!command) throw new Error("COMMAND_NOT_FOUND");
    return command;
  }

  async #transition(
    manager: QueryExecutor,
    command: ConnectorCommand,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<ConnectorCommand> {
    const next = {
      ...command,
      ...patch,
      rowVersion: command.rowVersion + 1,
    } as ConnectorCommand;
    validateConnectorCommandSnapshot(next);
    await this.#commands.save(next, command.rowVersion, manager);
    return await this.#mustLoad(
      {
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        commandId: command.id,
      },
      manager,
    );
  }
}

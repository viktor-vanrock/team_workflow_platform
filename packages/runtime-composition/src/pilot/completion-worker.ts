import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createQaTypeOrmCompletionConfirmationHook,
  qaAggregateSnapshotHash,
  type QaContentHash,
} from "@awp/competency-qa/node";
import { type CompleteOperationalObservation, type ConnectorCommand } from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandRepository,
  TypeOrmOperationalAuthorityRepository,
} from "@awp/platform-persistence-typeorm";

import type { DurableQaCompletionRuntime, QaCompletionAuthority } from "./completion-runtime.ts";

export interface QaCompletionEffectConfirmation {
  readonly effectId: string;
  readonly observation: CompleteOperationalObservation;
  readonly completionSummaryReceipt: Readonly<{ id: string; contentHash: QaContentHash }>;
}
export type QaCompletionEffectLookup =
  | Readonly<{ state: "FOUND"; confirmation: QaCompletionEffectConfirmation }>
  | Readonly<{ state: "ABSENT" | "UNKNOWN" | "MULTIPLE" }>;
/** The selected provider adapter owns marker lookup and summary/transition sub-effects. */
export interface QaCompletionEffectPort {
  execute(command: ConnectorCommand): Promise<QaCompletionEffectConfirmation>;
  lookup(command: ConnectorCommand): Promise<QaCompletionEffectLookup>;
}
export interface QaCompletionWorkerPorts {
  initiator(command: ConnectorCommand): QaCompletionAuthority;
  /** Must check the current service grant, scoped pins and effect policy at transport use. */
  authorize(command: ConnectorCommand, purpose: "READ" | "WRITE"): Promise<void>;
  resolve(command: ConnectorCommand): Promise<QaCompletionEffectPort>;
}
type Row = Record<string, unknown>;
const invalid = () => new Error("QA_COMPLETION_WORKER_CONFIRMATION_INVALID");
const equalRef = (a: unknown, b: unknown) => {
  const left = a as { id?: string; version?: number } | undefined;
  const right = b as typeof left;
  return !!left?.id && left.id === right?.id && left.version === right.version;
};

/** Only the initial fenced attempt may write. Expired attempts can only read back the same effect. */
export class DurableQaCompletionWorker {
  private readonly delivery: TypeOrmCommandDeliveryStore;
  constructor(
    private readonly source: DataSource,
    private readonly runtime: DurableQaCompletionRuntime,
    private readonly ports: QaCompletionWorkerPorts,
    private readonly clock = () => new Date(),
    private readonly leaseMs = 30_000,
    private readonly confirmationPolicy: Readonly<{
      maximumAttempts: number;
      maximumElapsedMs: number;
    }> = { maximumAttempts: 6, maximumElapsedMs: 300_000 },
  ) {
    if (
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < 1 ||
      leaseMs > 300_000 ||
      !Number.isSafeInteger(confirmationPolicy.maximumAttempts) ||
      confirmationPolicy.maximumAttempts < 1 ||
      confirmationPolicy.maximumAttempts > 20 ||
      !Number.isSafeInteger(confirmationPolicy.maximumElapsedMs) ||
      confirmationPolicy.maximumElapsedMs < leaseMs ||
      confirmationPolicy.maximumElapsedMs > 604_800_000
    )
      throw new Error("QA_COMPLETION_WORKER_LEASE_INVALID");
    this.delivery = new TypeOrmCommandDeliveryStore(source);
  }
  async run(scope: CommandDeliveryScope) {
    const command = await this.load(scope);
    if (
      command.status !== "QUEUED" ||
      command.outboxStatus !== "ENQUEUED" ||
      command.attemptCount !== 0 ||
      command.effectInvocationStartedAt
    )
      throw new Error("QA_COMPLETION_WORKER_INITIAL_ATTEMPT_REQUIRED");
    await this.ports.authorize(command, "WRITE");
    const provider = await this.ports.resolve(command);
    const dispatched = await this.runtime.dispatch(
      this.ports.initiator(command),
      scope,
      this.clock(),
      this.leaseMs,
    );
    try {
      await this.ports.authorize(dispatched, "WRITE");
      const confirmation = await provider.execute(dispatched);
      await this.ports.authorize(dispatched, "READ");
      return await this.confirm(scope, dispatched, confirmation, "COMMAND_CONFIRMATION");
    } catch {
      return { state: "LOOKUP_REQUIRED" as const, commandId: command.id };
    }
  }
  async recover(scope: CommandDeliveryScope) {
    const command = await this.load(scope);
    await this.ports.authorize(command, "READ");
    if (command.status !== "DISPATCHED" || command.outboxStatus !== "ACKNOWLEDGED")
      return { state: "NOT_DUE" as const, commandId: command.id };
    const now = this.clock();
    const quarantined = await this.delivery.quarantineExpiredConfirmation(
      scope,
      "QA_COMPLETION_EFFECT_UNRESOLVED",
      now,
      this.confirmationPolicy,
    );
    if (quarantined)
      return {
        state: "QUARANTINED" as const,
        commandId: command.id,
        reason: "CONFIRMATION_BUDGET_EXHAUSTED" as const,
      };
    const provider = await this.ports.resolve(command);
    const claimed = await this.delivery.claimConfirmation(scope, now, this.leaseMs);
    if (!claimed) return { state: "NOT_DUE" as const, commandId: command.id };
    try {
      await this.ports.authorize(claimed, "READ");
      const lookup = await provider.lookup(claimed);
      if (lookup.state !== "FOUND")
        return { state: "LOOKUP_REQUIRED" as const, commandId: command.id, reason: lookup.state };
      await this.ports.authorize(claimed, "READ");
      return await this.confirm(scope, claimed, lookup.confirmation, "RECONCILIATION_READ");
    } catch {
      return {
        state: "LOOKUP_REQUIRED" as const,
        commandId: command.id,
        reason: "UNAVAILABLE" as const,
      };
    }
  }
  private async load(scope: CommandDeliveryScope) {
    const command = await new TypeOrmCommandRepository(this.source).get(
      scope.workspaceId,
      scope.projectId,
      scope.commandId,
    );
    if (
      !command ||
      command.commandType !== "qa.completion.done" ||
      command.capability.key !== "operational-work-item" ||
      command.capability.exactContractVersion !== "1.0.0" ||
      command.capability.operation !== "request.transition" ||
      command.recoveryPolicy !== "LOOKUP_REQUIRED" ||
      !command.source.sourceWorkItemId ||
      command.actor.kind !== "HUMAN"
    )
      throw new Error("QA_COMPLETION_WORKER_COMMAND_DENIED");
    return command;
  }
  private async confirm(
    scope: CommandDeliveryScope,
    command: ConnectorCommand,
    confirmation: QaCompletionEffectConfirmation,
    expectedSource: "COMMAND_CONFIRMATION" | "RECONCILIATION_READ",
  ) {
    const observation = confirmation.observation;
    const target = command.target as Row;
    const expected = command.expectedExternalState as {
      configurationChain?: readonly {
        profileRef: unknown;
        mappingRef: unknown;
        connectionRef: unknown;
      }[];
    };
    const chain = expected.configurationChain?.[0];
    if (
      expected.configurationChain?.length !== 1 ||
      !chain ||
      confirmation.effectId !== command.effectIdempotencyKey ||
      observation.externalEntityId !== target.externalEntityId ||
      observation.normalizedStatus !== "DONE" ||
      !equalRef(observation.profileRef, chain.profileRef) ||
      !equalRef(observation.mappingRef, chain.mappingRef) ||
      !equalRef(observation.connectionRef, chain.connectionRef) ||
      observation.source !== expectedSource ||
      !observation.rawStatus.id ||
      !observation.rawStatus.name ||
      !observation.requester.externalPrincipalId ||
      !observation.externalDisplayKey ||
      !observation.adapterFamily ||
      !observation.adapterContractVersion ||
      !confirmation.completionSummaryReceipt.id ||
      !/^sha256:[a-f0-9]{64}$/u.test(confirmation.completionSummaryReceipt.contentHash) ||
      confirmation.completionSummaryReceipt.contentHash !==
        (command.payload as { completionSummary?: { contentHash?: unknown } }).completionSummary
          ?.contentHash ||
      !/^sha256:[a-f0-9]{64}$/u.test(observation.authorityFieldsHash) ||
      !observation.externalRevisionToken ||
      !command.effectInvocationStartedAt ||
      !Number.isFinite(Date.parse(observation.observedAt)) ||
      !Number.isFinite(Date.parse(observation.providerUpdatedAt)) ||
      Date.parse(observation.providerUpdatedAt) > Date.parse(observation.observedAt) ||
      Date.parse(observation.observedAt) < command.effectInvocationStartedAt.getTime() ||
      Date.parse(observation.observedAt) > this.clock().getTime() ||
      !command.executionLeaseExpiresAt
    )
      throw invalid();
    const result = {
      operation: "request.transition",
      normalizedStatus: "DONE",
      externalEntityId: observation.externalEntityId,
      effectId: confirmation.effectId,
      rawExternalState: observation.rawStatus.name,
      externalVersion: observation.externalRevisionToken,
      observedAt: observation.observedAt,
      completionSummaryReceipt: confirmation.completionSummaryReceipt,
    };
    await this.delivery.confirmWith(
      scope,
      result,
      this.clock(),
      async (manager, current) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `qa-request:${current.workspaceId}:${current.projectId}:${current.source.sourceWorkItemId}`,
        ]);
        const [binding] = (await manager.query(
          "SELECT b.* FROM work_items w JOIN operational_bindings b ON b.id=w.operational_binding_id AND b.workspace_id=w.workspace_id AND b.project_id=w.project_id AND b.work_item_id=w.id WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3 FOR UPDATE OF w,b",
          [scope.workspaceId, scope.projectId, current.source.sourceWorkItemId],
        )) as Row[];
        if (
          !binding ||
          binding.external_entity_id !== observation.externalEntityId ||
          binding.external_entity_type !== "REQUEST" ||
          !equalRef(binding.project_integration_binding_ref, current.bindingRef) ||
          !equalRef(binding.connector_profile_ref, observation.profileRef) ||
          !equalRef(binding.mapping_ref, observation.mappingRef) ||
          !equalRef(binding.connection_ref, observation.connectionRef) ||
          binding.adapter_family !== observation.adapterFamily ||
          binding.adapter_contract_version !== observation.adapterContractVersion
        )
          throw invalid();
        const reduced = await new TypeOrmOperationalAuthorityRepository(
          this.source,
        ).reduceObservation(
          manager,
          {
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            bindingId: String(binding.id),
          },
          observation,
          qaAggregateSnapshotHash(observation as never),
          current.correlationId,
          current.causationId,
        );
        if (
          !["APPLIED", "DUPLICATE"].includes(reduced.disposition) ||
          reduced.projection?.normalizedStatus !== "DONE"
        )
          throw invalid();
        const hook = createQaTypeOrmCompletionConfirmationHook();
        const delta = await hook.apply(
          {
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            commandId: current.id,
            effectIdempotencyKey: current.effectIdempotencyKey,
            capabilityKey: current.capability.key,
            capabilityVersion: current.capability.exactContractVersion,
            operation: current.capability.operation,
            result,
            source: current.source,
            bindingRef: current.bindingRef,
            profileRefs: [current.profileRef],
            correlationId: current.correlationId,
            causationId: current.causationId,
          },
          {
            native: manager,
            transactionId: randomUUID(),
            contributionKey: hook.key,
            idempotencyKey: `${current.id}:confirmation:${hook.key}`,
          },
        );
        await manager.query(
          "UPDATE work_items SET normalized_status='DONE',row_version=row_version+1,updated_at=$4 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [
            scope.workspaceId,
            scope.projectId,
            current.source.sourceWorkItemId,
            observation.observedAt,
          ],
        );
        await this.persistDelta(manager, current, delta);
      },
      { attemptCount: command.attemptCount, leaseExpiresAt: command.executionLeaseExpiresAt },
    );
    return { state: "CONFIRMED" as const, commandId: command.id };
  }
  private async persistDelta(
    manager: EntityManager,
    command: ConnectorCommand,
    delta: Awaited<
      ReturnType<ReturnType<typeof createQaTypeOrmCompletionConfirmationHook>["apply"]>
    >,
  ) {
    for (const event of delta.events ?? [])
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
        [
          randomUUID(),
          command.workspaceId,
          command.projectId,
          event.eventType,
          event.payload,
          qaAggregateSnapshotHash(event.payload as never),
        ],
      );
    for (const audit of delta.audit ?? [])
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          randomUUID(),
          command.workspaceId,
          command.projectId,
          command.actor,
          audit.action,
          audit.outcome,
          audit.reasonCode,
          command.correlationId,
          command.causationId,
          command.effectAuthorizationBasis ?? command.initialAuthorizationBasis,
          command.dataClassificationKey,
          { values: audit.attributes ?? {}, versionRefs: [] },
        ],
      );
  }
}

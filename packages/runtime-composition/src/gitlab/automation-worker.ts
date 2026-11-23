import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import { type QaScope, TypeOrmAutomationExecutionRepository } from "@awp/competency-qa/node";
import {
  gitLabPipelineTargetCommitment,
  type GitLabPipelineTriggerError,
} from "@awp/connector-gitlab";
import {
  type GitLabEffectReconciliationRecord,
  gitLabEffectRecoveryMode,
  TypeOrmGitLabEffectRepository,
} from "@awp/connector-gitlab-persistence-typeorm";
import type {
  PipelineLookupRequest,
  PipelineTriggerReceipt,
  PipelineTriggerRequest,
  TestExecutorPort,
  TrustedConnectorExactReference,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand } from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  TypeOrmCommandDeliveryStore,
} from "@awp/platform-persistence-typeorm";

import {
  assertGitLabEffectLookup,
  assertGitLabEffectReceipt,
} from "../pilot/effect-confirmation.ts";
import { assertPilotWorkerEffect, type PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import {
  type GitLabAutomationObservability,
  recordGitLabAutomationPhase,
} from "./observability.ts";

export const gitLabAutomationWorkerCapabilityKeys = Object.freeze([
  "test-executor.trigger-status",
] as const);

export interface GitLabAutomationWorkerMaterialization {
  readonly port: Pick<TestExecutorPort, "trigger" | "lookup">;
  readonly context: TrustedConnectorOperationContext;
  readonly connectionHeaderId: string;
  readonly connectionRef: TrustedConnectorExactReference;
  readonly profileRef: TrustedConnectorExactReference;
  readonly numericProjectId: number;
  readonly exactRef: string;
  readonly expectedCommitSha: string;
  readonly lookupConsistencyWindowMs: number;
  readonly lookupIntervalMs: number;
}

export interface GitLabAutomationWorkerAuthority {
  materialize(command: ConnectorCommand): Promise<GitLabAutomationWorkerMaterialization>;
}

export interface GitLabAutomationWorkerStep {
  run(): Promise<unknown>;
}
export interface GitLabAutomationWorkerSteps {
  readonly recovery: GitLabAutomationWorkerStep;
  readonly dispatcher: GitLabAutomationWorkerStep;
  readonly commands: GitLabAutomationWorkerStep;
}

export type GitLabAutomationWorkerOutcome = "IDLE" | "DEFERRED" | "CONFIRMED" | "AMBIGUOUS";

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function scopeOf(command: ConnectorCommand): CommandDeliveryScope {
  return Object.freeze({
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    commandId: command.id,
  });
}

function triggerRequest(command: ConnectorCommand): PipelineTriggerRequest {
  const request = command.payload as Partial<PipelineTriggerRequest>;
  if (
    command.capability.key !== "test-executor.trigger-status" ||
    command.capability.operation !== "pipeline.trigger" ||
    request.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "pipeline.trigger" ||
    typeof request.automationAttemptId !== "string" ||
    typeof request.triggerRequestHash !== "string" ||
    typeof request.effectMarkerHash !== "string" ||
    request.effectMarkerHash !== sha256(command.effectIdempotencyKey as unknown as JsonValue) ||
    command.payloadHash !== sha256(command.payload as JsonValue)
  )
    throw new Error("GITLAB_AUTOMATION_COMMAND_INVALID");
  return request as PipelineTriggerRequest;
}

function assertMaterialization(
  command: ConnectorCommand,
  value: GitLabAutomationWorkerMaterialization,
): void {
  const pin = value.context.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
  )[0];
  if (
    value.context.scope.kind !== "PROJECT" ||
    value.context.scope.workspaceId !== command.workspaceId ||
    value.context.scope.projectId !== command.projectId ||
    value.context.actor.kind !== "SERVICE" ||
    value.context.effectIdempotencyKey !== command.effectIdempotencyKey ||
    value.context.profileRef.id !== command.profileRef.id ||
    value.context.profileRef.version !== command.profileRef.version ||
    !pin ||
    pin.connectionRef.id !== value.connectionHeaderId ||
    pin.connectionRef.contentHash !== value.connectionRef.contentHash ||
    value.profileRef.id !== command.profileRef.id ||
    value.profileRef.version !== command.profileRef.version ||
    !Number.isSafeInteger(value.numericProjectId) ||
    value.numericProjectId < 1 ||
    !value.exactRef ||
    !/^[a-f0-9]{40}$/u.test(value.expectedCommitSha) ||
    !Number.isSafeInteger(value.lookupConsistencyWindowMs) ||
    value.lookupConsistencyWindowMs < 1_000 ||
    value.lookupConsistencyWindowMs > 15 * 60_000 ||
    !Number.isSafeInteger(value.lookupIntervalMs) ||
    value.lookupIntervalMs < 100 ||
    value.lookupIntervalMs > value.lookupConsistencyWindowMs
  )
    throw new Error("GITLAB_AUTOMATION_AUTHORITY_INVALID");
}

function claimInput(
  command: ConnectorCommand,
  request: PipelineTriggerRequest,
  materialized: GitLabAutomationWorkerMaterialization,
): Parameters<TypeOrmGitLabEffectRepository["claim"]>[0] {
  const start = command.createdAt;
  const end = new Date(start.getTime() + materialized.lookupConsistencyWindowMs);
  return Object.freeze({
    effectReconciliationId: deterministicUuid(
      `gitlab-automation-effect:${command.effectIdempotencyKey}`,
    ),
    workspaceId: command.workspaceId,
    commandId: command.id,
    effectId: command.effectIdempotencyKey,
    connectionHeaderId: materialized.connectionHeaderId,
    connectionRef: Object.freeze({
      id: materialized.connectionRef.id,
      version: materialized.connectionRef.version,
      contentHash: materialized.connectionRef.contentHash,
    }),
    profileRef: Object.freeze({
      id: materialized.profileRef.id,
      version: materialized.profileRef.version,
      contentHash: materialized.profileRef.contentHash,
    }),
    numericProjectId: materialized.numericProjectId,
    exactRefHash: sha256(materialized.exactRef as unknown as JsonValue),
    expectedCommitSha: materialized.expectedCommitSha,
    triggerRequestHash: request.triggerRequestHash,
    payloadHash: command.payloadHash,
    markerHash: request.effectMarkerHash,
    creationWindowStart: start.toISOString(),
    creationWindowEnd: end.toISOString(),
    createdAt: command.createdAt.toISOString(),
  });
}

function authorityScope(record: GitLabEffectReconciliationRecord) {
  return Object.freeze({
    workspaceId: record.workspaceId,
    connectionHeaderId: record.connectionHeaderId,
    numericProjectId: record.numericProjectId,
  });
}

function lookupRequest(
  record: GitLabEffectReconciliationRecord,
  request: PipelineTriggerRequest,
  materialized: GitLabAutomationWorkerMaterialization,
): PipelineLookupRequest {
  return Object.freeze({
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.lookup",
    automationAttemptId: request.automationAttemptId,
    effectMarkerHash: request.effectMarkerHash,
    expectedTargetCommitment: gitLabPipelineTargetCommitment(
      materialized.exactRef,
      materialized.expectedCommitSha,
    ),
    windowStart: record.creationWindowStart,
    windowEnd: record.creationWindowEnd,
    triggerRequestHash: request.triggerRequestHash,
  });
}

function failureCode(error: unknown): string {
  const typed = error as Partial<GitLabPipelineTriggerError>;
  return typeof typed.code === "string" && typed.code.length > 0
    ? typed.code
    : error instanceof Error
      ? error.message
      : "GITLAB_AUTOMATION_TRIGGER_FAILED";
}

export class TypeOrmGitLabAutomationWorker {
  readonly #delivery: TypeOrmCommandDeliveryStore;
  readonly #effects: TypeOrmGitLabEffectRepository;
  readonly #published: CommandDeliveryScope[] = [];

  constructor(
    private readonly source: DataSource,
    private readonly authority: GitLabAutomationWorkerAuthority,
    private readonly observability?: GitLabAutomationObservability,
    private readonly pilotGuard?: PilotCommandEffectGuard,
    private readonly pilotGuardRequired = false,
  ) {
    this.#delivery = new TypeOrmCommandDeliveryStore(source);
    this.#effects = new TypeOrmGitLabEffectRepository(source);
  }

  async dispatch(now = new Date()): Promise<number> {
    const claims = await this.#delivery.claim(
      now,
      new Date(now.getTime() + 15_000),
      20,
      gitLabAutomationWorkerCapabilityKeys,
    );
    for (const claim of claims) {
      const command = await this.#delivery.acknowledgeEnqueued(
        claim.outbox,
        now,
        new Date(now.getTime() + 15_000),
      );
      this.#published.push(scopeOf(command));
      recordGitLabAutomationPhase(this.observability, {
        phase: "QUEUE",
        outcome: "ENQUEUED",
        correlationId: command.correlationId,
        causationId: command.causationId,
      });
    }
    return claims.length;
  }

  async work(now = new Date()): Promise<GitLabAutomationWorkerOutcome> {
    const scope = this.#published.shift();
    return scope ? await this.execute(scope, now) : "IDLE";
  }

  async execute(
    scope: CommandDeliveryScope,
    now = new Date(),
  ): Promise<GitLabAutomationWorkerOutcome> {
    let command = await this.#delivery.load(scope);
    if (!command) throw new Error("GITLAB_AUTOMATION_COMMAND_NOT_FOUND");
    if (command.status === "FAILED") return "AMBIGUOUS";
    const request = triggerRequest(command);
    const materialized = await this.authority.materialize(command);
    assertMaterialization(command, materialized);
    let effect = (await this.#effects.claim(claimInput(command, request, materialized))).record;

    if (command.status === "CONFIRMED") {
      if (effect.state === "ONE_FOUND" && effect.externalPipelineId && effect.receiptHash) {
        await this.#effects.confirm(authorityScope(effect), effect.effectId, {
          expectedResourceVersion: effect.resourceVersion,
          externalPipelineId: effect.externalPipelineId,
          receiptHash: effect.receiptHash,
          confirmedAt: now.toISOString(),
        });
      }
      return "CONFIRMED";
    }

    if (command.status === "QUEUED") {
      await assertPilotWorkerEffect(command, this.pilotGuard, this.pilotGuardRequired);
      if (gitLabEffectRecoveryMode(effect) === "TERMINAL") {
        const dispatched = await this.#delivery.markDispatched(scope, now, 30_000);
        await this.#delivery.fail(scopeOf(dispatched), "GITLAB_AUTOMATION_EFFECT_AMBIGUOUS", now);
        return "AMBIGUOUS";
      }
      const dispatched = await this.#delivery.markDispatched(
        scope,
        now,
        30_000,
        undefined,
        async (manager) => {
          effect = await new TypeOrmGitLabEffectRepository(manager).markInvocationStarted(
            authorityScope(effect),
            effect.effectId,
            {
              expectedResourceVersion: effect.resourceVersion,
              startedAt: now.toISOString(),
            },
          );
        },
      );
      try {
        await assertPilotWorkerEffect(dispatched, this.pilotGuard, this.pilotGuardRequired);
        const receipt = await materialized.port.trigger(materialized.context, request);
        return await this.#acceptReceipt(dispatched, effect, receipt, now, "DIRECT_TRIGGER");
      } catch (error) {
        effect = await this.#lookupOnly(effect, now);
        return await this.#reconcile(
          dispatched,
          effect,
          request,
          materialized,
          now,
          failureCode(error),
        );
      }
    }

    if (command.status !== "DISPATCHED") throw new Error("GITLAB_AUTOMATION_COMMAND_STATE_INVALID");
    if (effect.nextRetryAt && Date.parse(effect.nextRetryAt) > now.getTime()) return "DEFERRED";
    const claimed = await this.#delivery.claimConfirmation(scope, now, 30_000);
    if (!claimed) return "DEFERRED";
    command = claimed;
    if (effect.effectInvocationStartedAt === undefined) {
      if (!command.effectInvocationStartedAt)
        throw new Error("GITLAB_AUTOMATION_CORE_MARKER_MISSING");
      effect = await this.#effects.markInvocationStarted(authorityScope(effect), effect.effectId, {
        expectedResourceVersion: effect.resourceVersion,
        startedAt: command.effectInvocationStartedAt.toISOString(),
      });
    }
    if (gitLabEffectRecoveryMode(effect) === "TERMINAL") {
      await this.#delivery.fail(scope, "GITLAB_AUTOMATION_EFFECT_AMBIGUOUS", now);
      return "AMBIGUOUS";
    }
    if (effect.state === "CONFIRMED")
      return await this.#reconcile(
        command,
        effect,
        request,
        materialized,
        now,
        "GITLAB_AUTOMATION_CONFIRMATION_RECOVERY",
      );
    effect = await this.#lookupOnly(effect, now);
    return await this.#reconcile(
      command,
      effect,
      request,
      materialized,
      now,
      "GITLAB_AUTOMATION_LOOKUP_RECOVERY",
    );
  }

  async recover(now = new Date(), limit = 50): Promise<number> {
    await this.#delivery.recoverExpired(now, limit);
    const due = await this.#effects.due(now, Math.min(limit, 100));
    let settled = 0;
    for (const effect of due) {
      const rows = (await this.source.query(
        "SELECT project_id FROM connector_commands WHERE workspace_id=$1 AND id=$2",
        [effect.workspaceId, effect.commandId],
      )) as readonly Readonly<{ project_id: string }>[];
      const row = rows[0];
      if (!row) continue;
      try {
        const outcome = await this.execute(
          Object.freeze({
            workspaceId: effect.workspaceId,
            projectId: row.project_id,
            commandId: effect.commandId,
          }),
          now,
        );
        if (outcome === "CONFIRMED" || outcome === "AMBIGUOUS") settled += 1;
      } catch (error) {
        console.error(
          "GITLAB_AUTOMATION_RECONCILIATION_DEFERRED",
          effect.commandId,
          failureCode(error),
        );
      }
    }
    return settled;
  }

  async #lookupOnly(
    effect: GitLabEffectReconciliationRecord,
    now: Date,
  ): Promise<GitLabEffectReconciliationRecord> {
    if (
      effect.state === "LOOKUP_REQUIRED" ||
      effect.state === "ONE_FOUND" ||
      effect.state === "CONFIRMED"
    )
      return effect;
    return await this.#effects.markLookupRequired(authorityScope(effect), effect.effectId, {
      expectedResourceVersion: effect.resourceVersion,
      lookupQueryHash: sha256({
        effectId: effect.effectId,
        markerHash: effect.markerHash,
        windowStart: effect.creationWindowStart,
        windowEnd: effect.creationWindowEnd,
      } as JsonValue),
      updatedAt: now.toISOString(),
    });
  }

  async #reconcile(
    command: ConnectorCommand,
    effect: GitLabEffectReconciliationRecord,
    request: PipelineTriggerRequest,
    materialized: GitLabAutomationWorkerMaterialization,
    now: Date,
    reason: string,
  ): Promise<GitLabAutomationWorkerOutcome> {
    const lookup = lookupRequest(effect, request, materialized);
    let result;
    try {
      result = await materialized.port.lookup(materialized.context, lookup);
      assertGitLabEffectLookup(lookup, result);
      if (result.outcome === "EXACT_ONE") assertGitLabEffectReceipt(effect, result.receipt, now);
    } catch (error) {
      const invalid =
        error instanceof Error &&
        ["GITLAB_EFFECT_CONFIRMATION_INVALID", "GITLAB_EFFECT_LOOKUP_INVALID"].includes(
          error.message,
        );
      const final = invalid || now.getTime() >= Date.parse(effect.creationWindowEnd);
      const input = {
        expectedResourceVersion: effect.resourceVersion,
        observedAt: now.toISOString(),
        ...(final
          ? {}
          : {
              nextLookupAt: new Date(
                Math.min(
                  Date.parse(effect.creationWindowEnd),
                  now.getTime() + materialized.lookupIntervalMs,
                ),
              ).toISOString(),
            }),
      };
      if (!final) {
        await this.#effects.settleUnresolved(authorityScope(effect), effect.effectId, input);
        return "DEFERRED";
      }
      await this.#delivery.fail(
        scopeOf(command),
        invalid ? "GITLAB_AUTOMATION_CONFIRMATION_INVALID" : "GITLAB_AUTOMATION_LOOKUP_UNAVAILABLE",
        now,
        async (manager) => {
          await new TypeOrmGitLabEffectRepository(manager).settleUnresolved(
            authorityScope(effect),
            effect.effectId,
            input,
          );
        },
        this.#fence(command),
      );
      return "AMBIGUOUS";
    }
    if (result.outcome === "EXACT_ONE")
      return await this.#acceptReceipt(command, effect, result.receipt, now, "LOOKUP");

    const final =
      result.outcome === "MULTIPLE" || now.getTime() >= Date.parse(effect.creationWindowEnd);
    const nextLookupAt = new Date(
      Math.min(Date.parse(effect.creationWindowEnd), now.getTime() + materialized.lookupIntervalMs),
    );
    const observation = {
      expectedResourceVersion: effect.resourceVersion,
      effectLookupObservationId: deterministicUuid(
        `gitlab-automation-lookup:${effect.effectId}:${effect.resourceVersion}:${result.consistencyEvidenceHash}`,
      ),
      lookupQueryHash: sha256(lookup as unknown as JsonValue),
      observedWindowStart: result.observedWindow.start,
      observedWindowEnd: result.observedWindow.end,
      outcome: result.outcome,
      matchCommitmentHashes: result.outcome === "MULTIPLE" ? result.matchCommitmentHashes : [],
      observationHash: sha256({
        reason,
        evidence: result.consistencyEvidenceHash,
        effectVersion: effect.resourceVersion,
      } as JsonValue),
      observedAt: now.toISOString(),
      final,
      ...(final ? {} : { nextLookupAt: nextLookupAt.toISOString() }),
    };
    if (!final) {
      await this.#effects.recordLookup(authorityScope(effect), effect.effectId, observation);
      return "DEFERRED";
    }
    await this.#delivery.fail(
      scopeOf(command),
      result.outcome === "ZERO"
        ? "GITLAB_AUTOMATION_LOOKUP_ZERO_AMBIGUOUS"
        : "GITLAB_AUTOMATION_LOOKUP_MULTIPLE_AMBIGUOUS",
      now,
      async (manager) => {
        await new TypeOrmGitLabEffectRepository(manager).recordLookup(
          authorityScope(effect),
          effect.effectId,
          observation,
        );
      },
      this.#fence(command),
    );
    recordGitLabAutomationPhase(this.observability, {
      phase: "AMBIGUITY",
      outcome: result.outcome === "ZERO" ? "ZERO_FOUND" : "MULTIPLE_FOUND",
      reasonCode: result.outcome === "ZERO" ? "LOOKUP_ZERO" : "LOOKUP_MULTIPLE",
      correlationId: command.correlationId,
      causationId: command.causationId,
    });
    return "AMBIGUOUS";
  }

  #fence(command: ConnectorCommand) {
    if (!command.executionLeaseExpiresAt)
      throw new Error("GITLAB_AUTOMATION_EXECUTION_FENCE_REQUIRED");
    return { attemptCount: command.attemptCount, leaseExpiresAt: command.executionLeaseExpiresAt };
  }

  async #acceptReceipt(
    command: ConnectorCommand,
    effect: GitLabEffectReconciliationRecord,
    receipt: PipelineTriggerReceipt,
    now: Date,
    source: "DIRECT_TRIGGER" | "LOOKUP",
  ): Promise<GitLabAutomationWorkerOutcome> {
    assertGitLabEffectReceipt(effect, receipt, now);
    await this.#delivery.confirmWith(
      scopeOf(command),
      receipt,
      now,
      async (manager) => {
        const effects = new TypeOrmGitLabEffectRepository(manager);
        let found = effect;
        if (effect.state !== "ONE_FOUND" && effect.state !== "CONFIRMED") {
          found = await effects.recordLookup(authorityScope(effect), effect.effectId, {
            expectedResourceVersion: effect.resourceVersion,
            effectLookupObservationId: deterministicUuid(
              `gitlab-automation-receipt:${effect.effectId}:${effect.resourceVersion}:${receipt.observationHash}`,
            ),
            lookupQueryHash: sha256({
              source,
              effectId: effect.effectId,
              receiptHash: receipt.observationHash,
            } as JsonValue),
            observedWindowStart: effect.creationWindowStart,
            observedWindowEnd: effect.creationWindowEnd,
            outcome: "EXACT_ONE",
            externalPipelineId: receipt.externalPipelineId,
            receiptHash: receipt.observationHash,
            matchCommitmentHashes: Object.freeze([sha256(receipt as unknown as JsonValue)]),
            observationHash: sha256({
              source,
              receiptHash: receipt.observationHash,
              effectVersion: effect.resourceVersion,
            } as JsonValue),
            observedAt: now.toISOString(),
            final: true,
          });
        } else if (
          found.externalPipelineId !== receipt.externalPipelineId ||
          found.receiptHash !== receipt.observationHash
        ) {
          throw new Error("GITLAB_AUTOMATION_EXACT_RECEIPT_CONFLICT");
        }
        const qaScope: QaScope = { workspaceId: command.workspaceId, projectId: command.projectId };
        await new TypeOrmAutomationExecutionRepository(manager).attachAutomationTriggerReceipt(
          manager,
          qaScope,
          (command.payload as PipelineTriggerRequest).automationAttemptId,
          receipt,
          now.toISOString(),
        );
        if (found.state !== "CONFIRMED")
          await effects.confirm(authorityScope(found), found.effectId, {
            expectedResourceVersion: found.resourceVersion,
            externalPipelineId: receipt.externalPipelineId,
            receiptHash: receipt.observationHash,
            confirmedAt: now.toISOString(),
          });
      },
      this.#fence(command),
    );
    recordGitLabAutomationPhase(this.observability, {
      phase: "TRIGGER",
      outcome: "CONFIRMED",
      correlationId: command.correlationId,
      causationId: command.causationId,
    });
    return "CONFIRMED";
  }
}

export function createGitLabAutomationWorkerSteps(
  source: DataSource,
  authority: GitLabAutomationWorkerAuthority,
  observability?: GitLabAutomationObservability,
  pilotGuard?: PilotCommandEffectGuard,
  pilotGuardRequired = false,
): GitLabAutomationWorkerSteps {
  const runtime = new TypeOrmGitLabAutomationWorker(
    source,
    authority,
    observability,
    pilotGuard,
    pilotGuardRequired,
  );
  return Object.freeze({
    recovery: Object.freeze({ run: async () => await runtime.recover() }),
    dispatcher: Object.freeze({ run: async () => await runtime.dispatch() }),
    commands: Object.freeze({ run: async () => await runtime.work() }),
  });
}

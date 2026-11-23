import { createHash, randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import type { QaOperationalRequestCreateResult } from "@awp/competency-qa/node";
import { JiraTransportError } from "@awp/connector-jira";
import {
  JiraEffectRepository,
  PersistentJiraRequestCreatePort,
  PersistentJiraRequestSubEffectStore,
  TypeOrmJiraAuthoritativeReadOutboxRepository,
} from "@awp/connector-jira-persistence-typeorm";
import type {
  ConnectorRuntimeContext,
  OperationalRequestCreateInput,
  OperationalWorkItemTarget,
} from "@awp/connector-sdk";
import type { ConnectorCommand } from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  TypeOrmCommandDeliveryStore,
} from "@awp/platform-persistence-typeorm";

import { isQaJiraLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import { jiraEffectQuarantineReason } from "../pilot/effect-confirmation.ts";
import { assertPilotWorkerEffect, type PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { qaUs1OperationalRoute } from "../qa/operational-composition.ts";
import { CapabilityCommandRouter, defineWorkerContribution } from "../worker/contributions.ts";
import { JiraBoundRefreshScheduler } from "./bound-refresh-scheduler.ts";
import { QaJiraOperationalActionService } from "./qa-action-service.ts";
import {
  materializeQaJiraRequestConfirmation,
  resolveAndPinQaJiraCommand,
} from "./qa-command-materializer.ts";
import { QaJiraDefectPublicationService } from "./qa-defect-service.ts";
import { QaJiraLocalImportService } from "./qa-import-service.ts";
import {
  createQaJiraPinnedOperationalBrokerMap,
  createQaJiraPinnedRequestCreatePort,
} from "./qa-operational-broker.ts";
import { revalidateQaJiraRequestCreateEffect } from "./qa-worker-effect-gate.ts";

export const qaJiraWorkerCapabilityKeys = Object.freeze(["operational-work-item"] as const);

export interface QaJiraWorkerStep {
  run(): Promise<unknown>;
}

export interface QaJiraLocalWorkerSteps {
  readonly recovery: QaJiraWorkerStep;
  readonly dispatcher: QaJiraWorkerStep;
  readonly commands: QaJiraWorkerStep;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function deliveryScope(command: ConnectorCommand): CommandDeliveryScope {
  return Object.freeze({
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    commandId: command.id,
  });
}

function runtimeContext(command: ConnectorCommand): ConnectorRuntimeContext {
  const context: ConnectorRuntimeContext = {
    scope: {
      kind: "PROJECT" as const,
      workspaceId: command.workspaceId,
      projectId: command.projectId,
    },
    actor: {
      kind: "SERVICE" as const,
      principalId: deterministicUuid("worker.qa-jira-local"),
      serviceKey: "worker.qa-jira-local",
    },
    correlationId: command.correlationId,
    causationId: command.causationId,
    effectIdempotencyKey: command.effectIdempotencyKey,
    profileRef: command.profileRef,
    classification: { key: command.dataClassificationKey, rank: 10 },
    signal: new AbortController().signal,
  };
  return Object.freeze(context);
}

class QaJiraLocalWorkerRuntime {
  readonly #delivery: TypeOrmCommandDeliveryStore;
  readonly #effects: JiraEffectRepository;
  readonly #webhookOutbox: TypeOrmJiraAuthoritativeReadOutboxRepository;
  readonly #effectLeaseOwner = randomUUID();
  readonly #webhookLeaseOwner = randomUUID();
  readonly #refreshScheduler;
  readonly #imports;
  readonly #actions;
  readonly #defects;
  readonly #published: CommandDeliveryScope[] = [];
  readonly #router = new CapabilityCommandRouter([
    defineWorkerContribution({
      key: "qa-jira",
      capabilityKeys: qaJiraWorkerCapabilityKeys,
      recovery: Object.freeze({ markedEffectPolicy: "LOOKUP_ONLY" }),
      handle: async (command) => command,
    }),
  ]);

  constructor(
    private readonly source: DataSource,
    private readonly environment: RuntimeEnvironment,
    private readonly pilotGuard?: PilotCommandEffectGuard,
  ) {
    this.#delivery = new TypeOrmCommandDeliveryStore(source);
    this.#effects = new JiraEffectRepository(source);
    this.#webhookOutbox = new TypeOrmJiraAuthoritativeReadOutboxRepository(source);
    this.#refreshScheduler = new JiraBoundRefreshScheduler(source, environment.mockHubUrl!);
    this.#imports = new QaJiraLocalImportService(source, environment);
    this.#actions = new QaJiraOperationalActionService(source, environment);
    this.#defects = new QaJiraDefectPublicationService(source, environment);
  }

  async recover(): Promise<number> {
    const now = new Date();
    const [commands, webhookReads, scheduled] = await Promise.all([
      this.#delivery.recoverExpired(now, 50),
      this.#webhookOutbox.recoverExpired(now, 50),
      this.#refreshScheduler.run(now),
    ]);
    return commands.length + webhookReads + scheduled;
  }

  async dispatch(): Promise<number> {
    const now = new Date();
    const claims = await this.#delivery.claim(
      now,
      new Date(now.getTime() + 15_000),
      20,
      qaJiraWorkerCapabilityKeys,
    );
    for (const claim of claims) {
      const command = await this.#delivery.acknowledgeEnqueued(
        claim.outbox,
        now,
        new Date(now.getTime() + 15_000),
      );
      this.#published.push(deliveryScope(command));
    }
    return claims.length;
  }

  async work(): Promise<number> {
    // Give inbound status changes a turn even while outbound commands are queued.
    const reads = await this.#workWebhookInvalidation();
    const scope = this.#published.shift();
    if (!scope) return reads;
    const queued = await this.#delivery.load(scope);
    if (!queued) throw new Error("QA_JIRA_WORKER_COMMAND_NOT_FOUND");
    let dispatchedAttempt: ConnectorCommand | undefined;
    try {
      const command = (await this.#router.route(queued)) as ConnectorCommand;
      await assertPilotWorkerEffect(
        command,
        this.pilotGuard,
        this.environment.profile === "non-local" || this.environment.deployment !== undefined,
      );
      if (command.capability.operation === "defect.create") {
        const gate = await this.#defects.revalidate(command);
        const dispatched = await this.#delivery.markDispatched(
          scope,
          gate.evaluatedAt,
          30_000,
          gate,
        );
        await assertPilotWorkerEffect(
          dispatched,
          this.pilotGuard,
          this.environment.profile === "non-local" || this.environment.deployment !== undefined,
        );
        await this.#defects.execute(dispatched, gate.configuration, this.#delivery);
        return 1;
      }
      if (command.capability.operation !== "request.create") {
        const gate = await this.#actions.revalidate(command);
        const dispatched = await this.#delivery.markDispatched(
          scope,
          gate.evaluatedAt,
          30_000,
          gate,
        );
        await assertPilotWorkerEffect(
          dispatched,
          this.pilotGuard,
          this.environment.profile === "non-local" || this.environment.deployment !== undefined,
        );
        await this.#actions.execute(dispatched);
        return 1;
      }
      const pins = await resolveAndPinQaJiraCommand(this.source, command, this.environment);
      const evaluatedAt = new Date();
      const gate = await revalidateQaJiraRequestCreateEffect(
        this.source,
        command,
        pins,
        evaluatedAt,
      );
      const dispatched = await this.#delivery.markDispatched(scope, evaluatedAt, 30_000, gate);
      dispatchedAttempt = dispatched;
      await this.#effects.ensure({
        id: deterministicUuid(`jira-effect:${dispatched.effectIdempotencyKey}`),
        commandId: dispatched.id,
        effectId: dispatched.effectIdempotencyKey,
        connectionRef: Object.freeze({ ...pins.connectionRef }),
        profileRef: Object.freeze({ ...pins.profileRef }),
        operation: dispatched.capability.operation,
        targetHash: dispatched.targetHash,
        payloadHash: dispatched.payloadHash,
        marker: dispatched.effectIdempotencyKey,
        now: evaluatedAt,
      });
      if (!dispatched.executionLeaseExpiresAt)
        throw new Error("QA_JIRA_COMMAND_EXECUTION_LEASE_REQUIRED");
      const effectClaim = await this.#effects.claim(
        dispatched.effectIdempotencyKey,
        `${this.#effectLeaseOwner}:${dispatched.attemptCount}`,
        new Date(),
        dispatched.executionLeaseExpiresAt,
      );
      const broker = createQaJiraPinnedOperationalBrokerMap(pins, fetch, {
        port: new PersistentJiraRequestCreatePort(
          createQaJiraPinnedRequestCreatePort(pins),
          this.#effects,
          effectClaim,
        ),
        receipts: new PersistentJiraRequestSubEffectStore(this.#effects, effectClaim),
      });
      await assertPilotWorkerEffect(
        dispatched,
        this.pilotGuard,
        this.environment.profile === "non-local" || this.environment.deployment !== undefined,
      );
      const result = await broker[qaUs1OperationalRoute].invoke(
        runtimeContext(dispatched),
        dispatched.target as OperationalWorkItemTarget,
        dispatched.payload as OperationalRequestCreateInput,
      );
      await this.#delivery.confirmWith(
        scope,
        result,
        new Date(),
        async (manager, current) =>
          await materializeQaJiraRequestConfirmation(
            this.source,
            manager,
            current,
            result as QaOperationalRequestCreateResult,
            pins,
          ),
        Object.freeze({
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt,
        }),
      );
      return 1;
    } catch (error) {
      const current = await this.#delivery.load(scope);
      if (
        current?.status === "DISPATCHED" &&
        current.capability.operation === "request.create" &&
        dispatchedAttempt?.executionLeaseExpiresAt &&
        current.attemptCount === dispatchedAttempt.attemptCount &&
        current.executionLeaseExpiresAt?.getTime() ===
          dispatchedAttempt.executionLeaseExpiresAt.getTime()
      ) {
        const effect = await this.#effects.byEffectId(current.effectIdempotencyKey);
        const reason = effect && jiraEffectQuarantineReason(effect.state);
        if (reason) {
          await this.#delivery.fail(scope, reason, new Date(), undefined, {
            attemptCount: dispatchedAttempt.attemptCount,
            leaseExpiresAt: dispatchedAttempt.executionLeaseExpiresAt,
          });
          return 1;
        }
      }
      // A DISPATCHED command remains leased and is recovered durably. The
      // next execution begins with Jira marker lookup, so crash-after-effect
      // converges by authoritative read-back instead of creating twice.
      console.error("QA_JIRA_COMMAND_ATTEMPT_DEFERRED", scope.commandId, error);
      return 0;
    }
  }

  async #workWebhookInvalidation(): Promise<number> {
    const claimedAt = new Date();
    const claim = await this.#webhookOutbox.claim(
      claimedAt,
      new Date(claimedAt.getTime() + 30_000),
      this.#webhookLeaseOwner,
    );
    if (!claim) return 0;
    let bound: Readonly<Record<string, unknown>> | undefined;
    try {
      const job = json<
        Readonly<{
          kind?: "IMPORT_DISCOVERY" | "BOUND_REFRESH" | "BOUND_POLL";
          connectionId: string;
          externalEntityId?: string;
          receiptIdentity?: string;
          runId?: string;
          cursorId?: string;
        }>
      >(claim.envelope);
      if (job.kind === "IMPORT_DISCOVERY") {
        if (!job.runId || !job.cursorId) throw new Error("JIRA_IMPORT_RECONCILIATION_JOB_INVALID");
        await this.#imports.reconcileImportDiscovery({
          workspaceId: claim.workspaceId,
          projectId: claim.projectId,
          connectionId: job.connectionId,
          runId: job.runId,
          cursorId: job.cursorId,
        });
        await this.#webhookOutbox.complete(claim, new Date(), async () => undefined);
        return 1;
      }
      if (job.kind === "BOUND_REFRESH") {
        if (!job.runId || !job.cursorId) throw new Error("JIRA_BOUND_REFRESH_JOB_INVALID");
        await this.#actions.reconcileBoundRefresh({
          workspaceId: claim.workspaceId,
          projectId: claim.projectId,
          runId: job.runId,
          cursorId: job.cursorId,
        });
        await this.#webhookOutbox.complete(claim, new Date(), async () => undefined);
        return 1;
      }
      if (!job.externalEntityId || !job.receiptIdentity)
        throw new Error("JIRA_WEBHOOK_AUTHORITATIVE_READ_JOB_INVALID");
      const externalEntityId = job.externalEntityId;
      const receiptIdentity = job.receiptIdentity;
      const bindings = (await this.source.query(
        "SELECT b.*,p.authority_snapshot FROM operational_bindings b LEFT JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.connection_header_id=$3 AND b.external_entity_type='REQUEST' AND b.external_entity_id=$4",
        [claim.workspaceId, claim.projectId, job.connectionId, externalEntityId],
      )) as readonly Readonly<Record<string, unknown>>[];
      const binding = bindings[0];
      bound = binding;
      if (!binding) {
        if (job.kind !== "BOUND_POLL")
          await this.#imports.importExternalIssue({
            workspaceId: claim.workspaceId,
            projectId: claim.projectId,
            connectionId: job.connectionId,
            externalEntityId,
            receiptIdentity,
            source: "WEBHOOK",
          });
        await this.#webhookOutbox.complete(claim, new Date(), async () => undefined);
        return 1;
      }
      const observation = await this.#actions.observeBinding(
        binding,
        job.kind === "BOUND_POLL" ? "RECONCILIATION_READ" : "WEBHOOK_READ",
        deterministicUuid(`jira-observation:${receiptIdentity}:${claim.attemptCount}`),
      );
      await this.#webhookOutbox.complete(claim, new Date(), async (manager) => {
        await this.#actions.applyBindingObservation(
          manager,
          binding,
          observation,
          deterministicUuid(`${receiptIdentity}:correlation`),
          deterministicUuid(`${receiptIdentity}:causation`),
        );
      });
      return 1;
    } catch (error) {
      const mappingRequired =
        error instanceof Error && error.message === "JIRA_ACTION_STATUS_MAPPING_REQUIRED";
      const reasonCode = mappingRequired
        ? "JIRA_STATUS_MAPPING_REQUIRED"
        : "JIRA_AUTHORITATIVE_READ_FAILED";
      const retryAt = new Date(
        Date.now() +
          Math.max(
            Math.min(60_000, 5_000 * 2 ** Math.min(claim.attemptCount - 1, 4)),
            error instanceof JiraTransportError ? (error.retryAfterSeconds ?? 0) * 1_000 : 0,
          ),
      );
      await this.#webhookOutbox.release(claim, retryAt, async (manager) => {
        if (!bound) return;
        await manager.query(
          "UPDATE operational_bindings SET sync_state=$4,freshness_state='STALE',last_error_code=$5,updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND last_observed_at IS NOT DISTINCT FROM $6::timestamptz",
          [
            claim.workspaceId,
            claim.projectId,
            bound.id,
            mappingRequired ? "MAPPING_REQUIRED" : "ERROR",
            reasonCode,
            bound.last_observed_at,
          ],
        );
      });
      console.error("QA_JIRA_WEBHOOK_READ_DEFERRED", claim.id, reasonCode);
      return 0;
    }
  }
}

export function createQaJiraLocalWorkerSteps(
  source: DataSource,
  environment: RuntimeEnvironment,
  pilotGuard?: PilotCommandEffectGuard,
): QaJiraLocalWorkerSteps {
  if (!isQaJiraLocalComposition(environment.composition))
    throw new Error("QA_JIRA_LOCAL_WORKER_COMPOSITION_REQUIRED");
  const runtime = new QaJiraLocalWorkerRuntime(source, environment, pilotGuard);
  return Object.freeze({
    recovery: Object.freeze({ run: async () => await runtime.recover() }),
    dispatcher: Object.freeze({ run: async () => await runtime.dispatch() }),
    commands: Object.freeze({ run: async () => await runtime.work() }),
  });
}

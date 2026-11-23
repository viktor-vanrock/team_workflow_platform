import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  automationLaunchCommitments,
  buildQaAutomationAttemptCreatedEvent,
  currentAutomationLaunchConfirmation,
  prepareHumanAutomationLaunch,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaAutomationAttemptRecord,
  type QaAutomationLaunchConfirmation,
  type QaAutomationLaunchSubject,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
  type QaServiceActor,
  TypeOrmAutomationExecutionRepository,
} from "@awp/competency-qa/node";
import type { PipelineTriggerRequest } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand, ProjectEffectGuardPort } from "@awp/platform-core";
import {
  TypeOrmCommandRepository,
  TypeOrmIdempotencyRepository,
} from "@awp/platform-persistence-typeorm";

import { TypeOrmProjectEffectGuard } from "../onboarding/project-effect-guard.ts";
import { PostgresCapacityAdmissionBinder } from "../queue/admission-service.ts";
import {
  type GitLabAutomationObservability,
  recordGitLabAutomationPhase,
} from "./observability.ts";

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export interface GitLabAutomationLaunchAuthorizationInput {
  readonly scope: QaScope;
  readonly sessionId: string;
  readonly actor: QaHumanActor;
  readonly authorizationBasis: QaAuthorizationBasis;
  readonly authorizationBasisHash: QaContentHash;
  readonly subject: QaAutomationLaunchSubject;
}

export interface GitLabAutomationLaunchServiceOptions {
  readonly executingService: QaServiceActor;
  readonly authorize: (
    manager: EntityManager,
    input: GitLabAutomationLaunchAuthorizationInput,
  ) => Promise<void>;
  readonly observability?: GitLabAutomationObservability;
  readonly assertFullQaCurrent?: (
    manager: EntityManager,
    subject: QaAutomationLaunchSubject,
  ) => Promise<void>;
  readonly effectGuard?: ProjectEffectGuardPort;
}

export interface GitLabAutomationLaunchInput {
  readonly scope: QaScope;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly ifMatch: number;
  readonly ifMatchSemanticHash?: QaContentHash;
  readonly confirmation: QaAutomationLaunchConfirmation;
  readonly actor: QaHumanActor;
  readonly authorizationBasis: QaAuthorizationBasis;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly launchedAt: string;
}

export interface GitLabAutomationLaunchResult {
  readonly replayed: boolean;
  readonly attempt: QaAutomationAttemptRecord;
}

function triggerRequest(
  input: Readonly<{
    subject: QaAutomationLaunchSubject;
    attemptId: string;
    launchRequestCommitment: QaContentHash;
    effectMarkerHash: QaContentHash;
  }>,
): PipelineTriggerRequest {
  const body = Object.freeze({
    schemaVersion: "test-executor.trigger-status@1.0.0" as const,
    messageType: "REQUEST" as const,
    operation: "pipeline.trigger" as const,
    testSessionId: input.subject.testSessionId,
    automationAttemptId: input.attemptId,
    launchRequestCommitment: input.launchRequestCommitment,
    targetSnapshotRef: input.subject.targetSnapshotRef,
    targetSnapshotHash: input.subject.targetSnapshotHash,
    suiteBindingRef: input.subject.suiteBindingRef,
    suiteBindingHash: input.subject.suiteBindingRef.contentHash,
    acceptedParameters: input.subject.targetSnapshot.suite.acceptedParameters as Readonly<
      Record<string, JsonValue>
    >,
    parameterSetHash: input.subject.parameterSetHash,
    effectMarkerHash: input.effectMarkerHash,
  });
  return Object.freeze({ ...body, triggerRequestHash: sha256(body as unknown as JsonValue) });
}

function commandFor(
  input: Readonly<{
    subject: QaAutomationLaunchSubject;
    prepared: ReturnType<typeof prepareHumanAutomationLaunch>;
    actor: QaHumanActor;
    authorizationBasis: QaAuthorizationBasis;
    authorizationBasisHash: QaContentHash;
    correlationId: string;
    causationId: string;
    launchedAt: string;
  }>,
): ConnectorCommand {
  const testExecutionPins = input.subject.targetSnapshot.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
  );
  const pin = testExecutionPins[0];
  if (testExecutionPins.length !== 1 || !pin)
    throw new QaDomainError("QA_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
  const payload = triggerRequest({
    subject: input.subject,
    attemptId: input.prepared.attempt.automationAttemptId,
    launchRequestCommitment: input.prepared.commitments.requestHash,
    effectMarkerHash: input.prepared.commitments.effectKeyHash,
  });
  const target = Object.freeze({
    kind: "QA_AUTOMATION_ATTEMPT",
    testSessionId: input.subject.testSessionId,
    automationAttemptId: input.prepared.attempt.automationAttemptId,
    targetSnapshotHash: input.subject.targetSnapshotHash,
    configurationPinSetHash: input.subject.configurationPinSetHash,
  });
  const at = new Date(input.launchedAt);
  if (Number.isNaN(at.getTime())) throw new QaDomainError("QA_AUTOMATION_LAUNCH_TIME_INVALID");
  return Object.freeze({
    id: input.prepared.attempt.connectorCommandId,
    workspaceId: input.subject.workspaceId,
    projectId: input.subject.projectId,
    actor: input.actor,
    commandType: "qa.automation.pipeline.trigger",
    capability: Object.freeze({
      key: "test-executor.trigger-status",
      exactContractVersion: "1.0.0",
      operation: "pipeline.trigger",
      logicalRole: "TEST_EXECUTION",
    }),
    target,
    targetHash: sha256(target as unknown as JsonValue),
    payload,
    payloadHash: sha256(payload as unknown as JsonValue),
    expectedExternalState: Object.freeze({
      mode: "LOOKUP_BY_EXACT_EFFECT_MARKER",
      effectMarkerHash: input.prepared.commitments.effectKeyHash,
    }),
    bindingRef: pin.projectIntegrationBindingRef,
    profileRef: pin.profileRef,
    clientRequestKey: input.prepared.commitments.requestKeyHash,
    effectIdempotencyKey: input.prepared.commitments.effectIdempotencyKey,
    dataClassificationKey: "INTERNAL",
    initialAuthorizationBasis: input.authorizationBasis,
    initialAuthorizationBasisHash: input.authorizationBasisHash,
    correlationId: input.correlationId,
    causationId: input.causationId,
    source: Object.freeze({ sourceWorkItemId: input.subject.workItemId }),
    recoveryPolicy: "LOOKUP_REQUIRED",
    status: "QUEUED",
    effectAuthorizationStatus: "NOT_REQUIRED",
    outboxStatus: "READY",
    attemptCount: 0,
    createdAt: at,
    updatedAt: at,
    rowVersion: 1,
  });
}

export class TypeOrmGitLabAutomationLaunchService {
  readonly #repository: TypeOrmAutomationExecutionRepository;

  constructor(
    private readonly source: DataSource,
    private readonly options: GitLabAutomationLaunchServiceOptions,
  ) {
    this.#repository = new TypeOrmAutomationExecutionRepository(source);
  }

  async currentConfirmation(
    scope: QaScope,
    sessionId: string,
  ): Promise<QaAutomationLaunchConfirmation> {
    return currentAutomationLaunchConfirmation(
      await this.#repository.currentLaunchSubject(scope, sessionId),
    );
  }

  async launch(input: GitLabAutomationLaunchInput): Promise<GitLabAutomationLaunchResult> {
    const observedStartedAt = this.options.observability?.now().getTime();
    if (
      input.scope.workspaceId.length === 0 ||
      input.scope.projectId.length === 0 ||
      input.sessionId.length === 0
    ) {
      throw new QaDomainError("QA_AUTOMATION_LAUNCH_SCOPE_INVALID");
    }
    const parsedLaunchTime = new Date(input.launchedAt);
    if (Number.isNaN(parsedLaunchTime.getTime()))
      throw new QaDomainError("QA_AUTOMATION_LAUNCH_TIME_INVALID");
    parsedLaunchTime.setUTCMilliseconds(0);
    const launchedAt = parsedLaunchTime.toISOString();
    try {
      const result = await this.#repository.withLaunchTransaction(
        input.scope,
        input.sessionId,
        async (manager, repository, subject) => {
          if (
            subject.workspaceId !== input.scope.workspaceId ||
            subject.projectId !== input.scope.projectId ||
            subject.testSessionId !== input.sessionId
          ) {
            throw new QaDomainError("QA_AUTOMATION_LAUNCH_SCOPE_MISMATCH");
          }
          await (
            this.options.effectGuard ?? new TypeOrmProjectEffectGuard(manager)
          ).assertEffectsAllowed(input.scope);
          await this.options.assertFullQaCurrent?.(manager, subject);
          await this.options.authorize(
            manager,
            Object.freeze({
              scope: input.scope,
              sessionId: input.sessionId,
              actor: input.actor,
              authorizationBasis: input.authorizationBasis,
              authorizationBasisHash: input.authorizationBasisHash,
              subject,
            }),
          );
          const commitments = automationLaunchCommitments({
            subject,
            idempotencyKey: input.idempotencyKey,
            confirmation: input.confirmation,
          });
          const existing = await repository.launchClaim(
            input.scope,
            input.sessionId,
            commitments.requestKeyHash,
          );
          if (existing) {
            if (
              existing.requestHash !== commitments.requestHash ||
              existing.confirmationHash !== commitments.confirmationHash ||
              existing.confirmedSessionResourceVersion !== input.ifMatch
            ) {
              throw new QaDomainError("QA_AUTOMATION_LAUNCH_IDEMPOTENCY_CONFLICT");
            }
            const attempt = await repository.automationAttempt(input.scope, existing.attemptId);
            if (!attempt) throw new QaDomainError("QA_AUTOMATION_LAUNCH_REPLAY_INCOMPLETE");
            return Object.freeze({ replayed: true, attempt });
          }

          if (input.ifMatchSemanticHash) {
            const sessionRows = (await manager.query(
              "SELECT content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
              [input.scope.workspaceId, input.scope.projectId, input.sessionId],
            )) as readonly Readonly<{ content: unknown }>[];
            const sessionRow = (Array.isArray(sessionRows[0]) ? sessionRows[0] : sessionRows)[0] as
              Readonly<{ content: unknown }> | undefined;
            const content =
              sessionRow &&
              (typeof sessionRow.content === "string"
                ? (JSON.parse(sessionRow.content) as unknown)
                : sessionRow.content);
            if (
              !content ||
              qaAggregateSnapshotHash(content as never) !== input.ifMatchSemanticHash
            ) {
              throw new QaDomainError("QA_AUTOMATION_SESSION_ETAG_STALE");
            }
          }

          const identity = `${input.scope.workspaceId}:${input.scope.projectId}:${input.sessionId}:${commitments.requestKeyHash}:${commitments.requestHash}`;
          const launchRequestId = deterministicUuid(`qa-automation-launch:${identity}`);
          const automationAttemptId = deterministicUuid(`qa-automation-attempt:${identity}`);
          const connectorCommandId = deterministicUuid(`qa-automation-command:${identity}`);
          const previousAttempts = await repository.automationAttempts(
            input.scope,
            input.sessionId,
          );
          if (input.confirmation.reason === "HUMAN_RERUN") {
            const frozen = await repository.reviewFreeze(
              input.scope,
              input.sessionId,
              subject.planItemId,
            );
            if (frozen)
              throw new QaDomainError(
                "QA_PLAN_ITEM_EXECUTION_CLOSED_REVIEW_FROZEN_LINKED_SESSION_REQUIRED",
              );
          }
          const prepared = prepareHumanAutomationLaunch({
            subject,
            idempotencyKey: input.idempotencyKey,
            ifMatch: input.ifMatch,
            confirmation: input.confirmation,
            actor: input.actor,
            executingService: this.options.executingService,
            authorizationBasis: input.authorizationBasis,
            authorizationBasisHash: input.authorizationBasisHash,
            previousAttempts,
            launchRequestId,
            automationAttemptId,
            connectorCommandId,
            correlationId: input.correlationId,
            causationId: input.causationId,
            launchedAt,
          });
          const capacityHead = (
            (await manager.query(
              "SELECT capacity_head_id FROM workspace_capacity_heads WHERE workspace_id=$1",
              [input.scope.workspaceId],
            )) as readonly unknown[]
          )[0];
          if (capacityHead) {
            const projectionRows = (await manager.query(
              `SELECT revision.control_facet,revision.operational_facet,revision.qa_facet,revision.policy_facet_ref,revision.source_set_hash
             FROM queue_entry_heads head
             JOIN queue_entry_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.queue_entry_revision_id=head.current_revision_id
            WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 AND head.suppressed_by_work_item_id IS NULL`,
              [input.scope.workspaceId, input.scope.projectId, subject.workItemId],
            )) as readonly Readonly<Record<string, unknown>>[];
            const projection = (
              Array.isArray(projectionRows[0]) ? projectionRows[0] : projectionRows
            )[0] as Readonly<Record<string, unknown>> | undefined;
            if (!projection)
              throw new QaDomainError("QUEUE_ENTRY_REQUIRED_FOR_AUTOMATION_ADMISSION");
            const parse = <T>(value: unknown): T =>
              typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
            const control = parse<Readonly<Record<string, JsonValue>>>(projection.control_facet);
            const operational = parse<Readonly<Record<string, JsonValue>>>(
              projection.operational_facet,
            );
            const qa = parse<Readonly<Record<string, JsonValue>>>(projection.qa_facet);
            const policyFacetRef = parse<
              Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>
            >(projection.policy_facet_ref);
            if (operational.state !== "KNOWN" || !operational.projectionRef)
              throw new QaDomainError(
                "CONFIRMED_OPERATIONAL_PROJECTION_REQUIRED_FOR_AUTOMATION_ADMISSION",
              );
            const sessionRows = (await manager.query(
              "SELECT resource_version,content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
              [input.scope.workspaceId, input.scope.projectId, input.sessionId],
            )) as readonly Readonly<Record<string, unknown>>[];
            const sessionRow = (Array.isArray(sessionRows[0]) ? sessionRows[0] : sessionRows)[0] as
              Readonly<Record<string, unknown>> | undefined;
            if (!sessionRow) throw new QaDomainError("QA_AUTOMATED_SESSION_NOT_FOUND");
            const sessionContent = parse<Readonly<Record<string, JsonValue>>>(sessionRow.content);
            const nextSessionContent =
              input.confirmation.reason === "INITIAL"
                ? Object.freeze({
                    ...sessionContent,
                    state: "RUNNING",
                    executionActivity: "TRIGGER_PENDING",
                    resourceVersion: subject.sessionResourceVersion + 1,
                    startedAt: launchedAt,
                    startedBy: input.actor,
                    lastTransitionActor: input.actor,
                  })
                : sessionContent;
            const authorizationScopeWitnessHash = sha256({
              workspaceId: input.scope.workspaceId,
              projectId: input.scope.projectId,
              requiredPermission: "qa.automation.session.plan",
              classificationDecision: "AUTHORIZED",
            } as JsonValue);
            const binder = new PostgresCapacityAdmissionBinder(this.source, {
              reauthorize: async (transaction, admission) => {
                const authorized = (await transaction.query(
                  `SELECT 1 FROM workspace_memberships membership
                 JOIN projects project ON project.workspace_id=membership.workspace_id AND project.id=$3 AND project.state='ACTIVE'
                WHERE membership.workspace_id=$1 AND membership.principal_id=$2 AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
                  AND EXISTS(SELECT 1 FROM project_entitlements entitlement
                    WHERE entitlement.workspace_id=$1 AND entitlement.project_id=$3 AND entitlement.principal_id=$2
                      AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL)`,
                  [admission.workspaceId, admission.principalId, admission.projectId],
                )) as readonly unknown[];
                return authorized.length === 1;
              },
            });
            const admission = await binder.admitInTransaction(manager, {
              workspaceId: input.scope.workspaceId,
              projectId: input.scope.projectId,
              workItemId: subject.workItemId,
              sessionId: input.sessionId,
              principalId: input.actor.principalId,
              requestKey: `automation:${input.idempotencyKey}`,
              activityKind: "AUTOMATED_SESSION_LAUNCH",
              actor: { kind: "HUMAN", principalId: input.actor.principalId },
              authorizationScopeWitnessHash,
              expectedState: Object.freeze({
                policyFacetRef,
                expectedQueueControlVersion: Number(control.resourceVersion ?? 0),
                operationalProjectionRef: operational.projectionRef as Readonly<
                  Record<string, JsonValue>
                >,
                qaSourceSetHash: String(
                  (qa.factsRef as Readonly<Record<string, JsonValue>> | undefined)?.semanticHash ??
                    projection.source_set_hash,
                ) as `sha256:${string}`,
                sessionRef: Object.freeze({
                  sourceType: "QA_TEST_SESSION_REVISION",
                  sourceId: input.sessionId,
                  sourceVersion: subject.sessionResourceVersion,
                  semanticHash: sha256(sessionContent as JsonValue),
                }),
              }),
              committedSessionRef: Object.freeze({
                sourceType: "QA_TEST_SESSION_REVISION",
                sourceId: input.sessionId,
                sourceVersion:
                  input.confirmation.reason === "INITIAL"
                    ? subject.sessionResourceVersion + 1
                    : subject.sessionResourceVersion,
                semanticHash: sha256(nextSessionContent as JsonValue),
              }),
              authorizedScopeSnapshotRef: Object.freeze({
                id: deterministicUuid(
                  `authorized-capacity-scope:${input.scope.workspaceId}:${input.scope.projectId}:${authorizationScopeWitnessHash}`,
                ),
                version: 1,
                semanticHash: authorizationScopeWitnessHash,
              }),
              reservationExpiresAt: new Date(
                Date.parse(launchedAt) + 24 * 60 * 60 * 1000,
              ).toISOString(),
              decidedAt: launchedAt,
              correlationId: input.correlationId,
              causationId: input.causationId,
            });
            if (admission.outcome === "DENIED")
              return Object.freeze({ capacityDenied: true as const, outcome: admission.outcome });
          }
          const command = commandFor({
            subject,
            prepared,
            actor: input.actor,
            authorizationBasis: input.authorizationBasis,
            authorizationBasisHash: input.authorizationBasisHash,
            correlationId: input.correlationId,
            causationId: input.causationId,
            launchedAt,
          });
          await new TypeOrmCommandRepository(this.source).insert(command, manager);
          await new TypeOrmIdempotencyRepository(this.source).claim(
            {
              workspaceId: input.scope.workspaceId,
              projectId: input.scope.projectId,
              actorId: input.actor.principalId,
              operation: "qa.automation.launch",
              clientKey: prepared.commitments.requestKeyHash,
              requestHash: prepared.commitments.requestHash,
              commandId: command.id,
              createdAt: command.createdAt,
            },
            manager,
          );
          await repository.persistAcceptedLaunch({
            manager,
            prepared,
            initiatingActor: input.actor,
          });

          const commandOutboxId = deterministicUuid(`qa-automation-command-outbox:${identity}`);
          await manager.query(
            `
INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,attempts,envelope_hash,created_at)
VALUES($1,$2,$3,$4,'READY',$5,0,$6,$5)`,
            [
              commandOutboxId,
              command.id,
              command.workspaceId,
              command.projectId,
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
          const eventId = deterministicUuid(`qa-automation-attempt-event:${identity}`);
          const event = buildQaAutomationAttemptCreatedEvent({
            context: Object.freeze({
              actor: input.actor,
              scope: Object.freeze({ kind: "PROJECT" as const, ...input.scope }),
              correlationId: input.correlationId,
              causationId: input.causationId,
              authorizationBasis: input.authorizationBasis,
            }),
            eventId,
            attempt: prepared.attempt,
          });
          await manager.query(
            `
INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
VALUES($1,$2,$3,'qa.automation-attempt.created',$4,$5,'READY',$6)`,
            [
              eventId,
              input.scope.workspaceId,
              input.scope.projectId,
              JSON.stringify(event),
              qaAggregateSnapshotHash(event as never),
              command.createdAt,
            ],
          );
          await manager.query(
            `
INSERT INTO audit_events(
  id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,
  authorization_basis,classification_key,attributes
) VALUES($1,$2,$3,$4,$5,'qa.automation.launch','SUCCEEDED','HUMAN_CONFIRMED_NO_SECOND_APPROVAL',$6,$7,$8,'INTERNAL',$9)`,
            [
              deterministicUuid(`qa-automation-launch-audit:${identity}`),
              input.scope.workspaceId,
              input.scope.projectId,
              command.createdAt,
              JSON.stringify(input.actor),
              input.correlationId,
              input.causationId,
              JSON.stringify(input.authorizationBasis),
              JSON.stringify({
                attemptId: prepared.attempt.automationAttemptId,
                sessionId: input.sessionId,
                requestHash: prepared.commitments.requestHash,
                confirmationHash: prepared.commitments.confirmationHash,
                connectorCommandId: command.id,
              }),
            ],
          );
          return Object.freeze({ replayed: false, attempt: prepared.attempt });
        },
      );
      if ("capacityDenied" in result) throw new QaDomainError("QA_AUTOMATION_CAPACITY_DENIED");
      const durationMs =
        observedStartedAt === undefined
          ? undefined
          : Math.max(0, this.options.observability!.now().getTime() - observedStartedAt);
      recordGitLabAutomationPhase(this.options.observability, {
        phase: "LAUNCH",
        outcome: result.replayed ? "REPLAYED" : "ACCEPTED",
        ...(durationMs === undefined ? {} : { durationMs }),
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
      if (durationMs !== undefined)
        this.options.observability!.observeSlo("LAUNCH_ACKNOWLEDGEMENT", durationMs);
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (/AUTH|POLICY|SCOPE|ENTITLEMENT|FORBIDDEN/iu.test(code)) {
        recordGitLabAutomationPhase(this.options.observability, {
          phase: "POLICY_DENIAL",
          outcome: "DENIED",
          reasonCode: code.includes("SCOPE") ? "SCOPE_DENIED" : "POLICY_DENIED",
          correlationId: input.correlationId,
          causationId: input.causationId,
        });
      }
      throw error;
    }
  }
}

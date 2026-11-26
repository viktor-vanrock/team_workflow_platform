import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import type { JsonValue } from "@awp/platform-contracts";

import type { QaAutomationRetryEvaluation } from "../application/automation-retry-policy.ts";
import {
  buildQaAutomationAttemptCreatedEvent,
  buildQaAutomationRetryDecidedEvent,
  type QaDomainEventEnvelope,
} from "../application/domain-events.ts";
import type {
  QaAutomationCoreArtifactReferenceRegistration,
  QaAutomationResultSyncPreparation,
} from "../application/sync-automation-result.ts";
import {
  appendAutomationAttemptStatus,
  createAutomationAttemptRecord,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptStatusRevision,
} from "../domain/automation-attempt.ts";
import type {
  EvidenceSignatureEnvelope,
  QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";
import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaContentHash,
  QaDomainError,
  type QaServiceActor,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import type { QaAutomatedTargetSnapshot } from "../domain/snapshots.ts";
import { TypeOrmAutomationExecutionRepository } from "./automation-execution.repository.ts";
import { EvidenceSigningUnitOfWork } from "./evidence-signing.uow.ts";

export async function persistAutomatedSignedEvidenceV2(
  source: Readonly<{ query(sql: string, parameters?: readonly unknown[]): Promise<unknown> }>,
  manifest: QaEvidenceManifestRevisionV2,
  signature: EvidenceSignatureEnvelope,
  expectedSessionVersion: number,
): Promise<void> {
  await new EvidenceSigningUnitOfWork(source).commit(manifest, signature, expectedSessionVersion);
}

function rows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function jsonHash(value: unknown): QaContentHash {
  return qaAggregateSnapshotHash(value as JsonValue);
}

async function appendOutboxEvent(
  manager: EntityManager,
  event: QaDomainEventEnvelope<Readonly<Record<string, unknown>>>,
): Promise<void> {
  await manager.query(
    `
INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
VALUES($1,$2,$3,$4,$5,$6,'READY',$7)`,
    [
      event.eventId,
      event.workspaceId,
      event.projectId,
      event.eventType,
      JSON.stringify(event),
      jsonHash(event),
      event.recordedAt,
    ],
  );
}

async function insertArtifactReference(
  manager: EntityManager,
  artifact: QaAutomationCoreArtifactReferenceRegistration,
): Promise<void> {
  await manager.query(
    `
INSERT INTO artifact_references(
  id,workspace_id,project_id,owner_entity_type,owner_entity_id,artifact_kind,storage_provider_kind,
  opaque_locator,object_version_or_etag,file_name,media_type,size_bytes,checksum_algorithm,checksum,
  classification_key,availability,created_by,created_at,expires_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      artifact.id,
      artifact.workspaceId,
      artifact.projectId,
      artifact.owner.entityType,
      artifact.owner.entityId,
      artifact.artifactKind,
      artifact.storage.providerKind,
      artifact.storage.opaqueLocator,
      artifact.storage.objectVersionOrEtag,
      artifact.fileName,
      artifact.mediaType,
      artifact.sizeBytes,
      artifact.checksum.algorithm,
      artifact.checksum.value,
      artifact.classification.key,
      artifact.availability,
      artifact.createdBy,
      artifact.createdAt,
      artifact.expiresAt,
    ],
  );
}

async function insertTerminalResult(
  manager: EntityManager,
  prepared: QaAutomationResultSyncPreparation,
): Promise<void> {
  const result = prepared.result;
  const target = result.target;
  await manager.query(
    `
INSERT INTO qa_automation_attempt_results(
  result_id,workspace_id,project_id,attempt_id,attempt_no,normalization_kind,result_schema_ref,
  result_schema_digest,observed_result_schema_ref,observed_result_schema_digest,technical_outcome,
  infrastructure_error_code,cancellation_reason_code,synthetic_reason_code,external_pipeline_id,
  external_job_ids,commit_sha,build_ref,merge_request_ref,environment_ref,suite_ref,queued_at,started_at,
  completed_at,duration_ms,artifact_descriptor_set_hash,artifact_sync_state,source_result_artifact_ref,
  normalization_report,received_at,content,content_hash
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NULL,NULL,
  $22,$23,$24,$25,$26,$27,$28,$29,$30
)`,
    [
      result.automationAttemptResultId,
      result.workspaceId,
      result.projectId,
      result.automationAttemptId,
      prepared.attempt.attemptNo,
      result.normalizationKind,
      JSON.stringify(result.resultSchemaRef),
      result.resultSchemaRef.digest,
      result.observedResultSchemaRef === undefined
        ? null
        : JSON.stringify(result.observedResultSchemaRef),
      result.observedResultSchemaRef?.digest ?? null,
      result.outcome,
      result.infrastructureCode ?? null,
      result.cancellationReasonCode ?? null,
      result.syntheticReasonCode ?? null,
      result.externalPipelineId ?? null,
      JSON.stringify(result.externalJobIds),
      target?.commitSha ?? null,
      target?.buildRef ?? null,
      target?.type === "MERGE_REQUEST" ? target.mergeRequestRef : null,
      result.environmentRef,
      JSON.stringify({ suiteKey: result.suiteKey }),
      result.terminalAt,
      result.durationMs ?? null,
      result.artifactDescriptorSetHash,
      result.artifactSyncState,
      result.sourceResultArtifactRef ?? null,
      JSON.stringify(result.normalizationReport),
      result.recordedAt,
      JSON.stringify(result),
      result.contentHash,
    ],
  );
}

async function insertArtifactMemberships(
  manager: EntityManager,
  prepared: QaAutomationResultSyncPreparation,
): Promise<void> {
  for (const membership of prepared.artifactMemberships) {
    await manager.query(
      `
INSERT INTO qa_automation_artifact_memberships(
  membership_id,workspace_id,project_id,work_item_id,session_id,attempt_id,result_id,
  artifact_descriptor_set_hash,ordinal,artifact_reference_id,external_authority_hash,external_pipeline_id,
  external_job_id,logical_path,external_descriptor_hash,checksum,checksum_source,size_bytes,media_type,
  artifact_kind,classification_key,source_profile_ref,source_profile_content_hash,retention_policy_ref,
  availability_at_result,opaque_locator_hash,expires_at,registered_at,correlation_id,causation_id,content_hash
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
  $25,$26,$27,$28,$29,$30,$31
)`,
      [
        membership.membershipId,
        membership.workspaceId,
        membership.projectId,
        membership.workItemId,
        membership.testSessionId,
        membership.automationAttemptId,
        membership.automationAttemptResultId,
        membership.artifactDescriptorSetHash,
        membership.ordinal,
        membership.artifactReferenceId,
        membership.externalAuthorityHash,
        membership.externalPipelineId,
        membership.externalJobId,
        membership.logicalPath,
        membership.externalDescriptorHash,
        membership.checksum,
        membership.checksumSource,
        membership.sizeBytes,
        membership.mediaType,
        membership.artifactKind,
        membership.classificationKey,
        JSON.stringify(membership.sourceProfileRef),
        membership.sourceProfileContentHash,
        membership.retentionPolicyRef,
        membership.availabilityAtResult,
        membership.opaqueLocatorHash,
        membership.expiresAt,
        membership.registeredAt,
        membership.correlationId,
        membership.causationId,
        membership.contentHash,
      ],
    );
  }
}

export interface QaAutomationResultPersistenceReceipt {
  readonly replayed: boolean;
  readonly attemptId: string;
  readonly resultId: string;
  readonly terminalStatusRevisionId: string;
  readonly sessionState: "REVIEW_REQUIRED";
  readonly sessionResourceVersion: number;
}

export interface QaAutomationRetryLaunchRequestRecord {
  readonly launchRequestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly requestKeyHash: QaContentHash;
  readonly requestHash: QaContentHash;
  readonly origin: "AUTO_INFRA_RETRY";
  readonly decision: "ACCEPTED";
  readonly attemptId: string;
  readonly connectorCommandId: string;
  readonly effectIdempotencyKey: string;
  readonly initiatorKind: "SERVICE";
  readonly initiatorPrincipalId: string;
  readonly causalHumanPrincipalId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly contentHash: QaContentHash;
}

export interface QaAutomationRetryCoreCommandRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: QaServiceActor;
  readonly target: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly bindingRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly storedPayload: Readonly<Record<string, unknown>>;
}

export interface QaAutomationRetryPersistencePreparation {
  readonly launchRequest?: QaAutomationRetryLaunchRequestRecord;
  readonly attempt?: QaAutomationAttemptRecord;
  readonly statuses?: readonly [
    QaAutomationAttemptStatusRevision,
    QaAutomationAttemptStatusRevision,
  ];
  readonly command?: QaAutomationRetryCoreCommandRecord;
  readonly events: readonly QaDomainEventEnvelope<Readonly<Record<string, unknown>>>[];
}

export interface QaAutomationRetryPersistenceInput {
  readonly context: QaWorkspaceContext;
  readonly evaluation: QaAutomationRetryEvaluation;
  readonly predecessor: QaAutomationAttemptRecord;
  readonly previousAttempts: readonly QaAutomationAttemptRecord[];
  readonly targetSnapshot: QaAutomatedTargetSnapshot;
  readonly executingService: QaServiceActor;
  readonly causalAuthorizationBasis: QaAuthorizationBasis;
}

export function prepareQaAutomationRetryPersistence(
  input: QaAutomationRetryPersistenceInput,
): QaAutomationRetryPersistencePreparation {
  const decision = input.evaluation.decision;
  if (
    input.context.scope.kind !== "PROJECT" ||
    input.context.scope.workspaceId !== input.predecessor.workspaceId ||
    input.context.scope.projectId !== input.predecessor.projectId ||
    input.context.actor.kind !== "SERVICE" ||
    input.context.actor.principalId !== input.executingService.principalId ||
    input.executingService.principalId !== decision.decidedById ||
    decision.automationAttemptId !== input.predecessor.automationAttemptId ||
    decision.automationAttemptResultId !== input.predecessor.terminalResultId ||
    input.predecessor.currentStatus !== "TERMINAL" ||
    input.targetSnapshot.snapshotHash !== input.predecessor.targetSnapshotHash ||
    input.targetSnapshot.configurationPinSetHash !== input.predecessor.configurationPinSetHash ||
    jsonHash(input.causalAuthorizationBasis) !== input.predecessor.authorizationBasisHash ||
    Number.isNaN(Date.parse(decision.decidedAt))
  )
    throw new QaDomainError("QA_AUTOMATION_RETRY_PERSISTENCE_INPUT_INVALID");

  const retryEvent = buildQaAutomationRetryDecidedEvent({
    context: input.context,
    eventId: deterministicUuid(`event:retry:${decision.retryDecisionId}:${decision.contentHash}`),
    decision,
  });
  const successor = input.evaluation.successor;
  if (decision.decision !== "SCHEDULED") {
    if (successor !== undefined)
      throw new QaDomainError("QA_AUTOMATION_RETRY_SUCCESSOR_UNEXPECTED");
    return Object.freeze({ events: Object.freeze([retryEvent]) });
  }
  if (
    successor === undefined ||
    decision.successorAttemptId !== successor.automationAttemptId ||
    decision.successorLaunchRequestId !== successor.launchRequestId ||
    successor.predecessorAttemptId !== input.predecessor.automationAttemptId ||
    successor.rootAttemptId !== input.predecessor.rootAttemptId ||
    successor.attemptNo !== input.predecessor.attemptNo + 1 ||
    successor.causalHumanId !== input.predecessor.initiatingHumanId ||
    successor.causalAuthorizationBasisHash !== input.predecessor.authorizationBasisHash
  )
    throw new QaDomainError("QA_AUTOMATION_RETRY_SUCCESSOR_INVALID");

  const testExecutionPins = input.targetSnapshot.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
  );
  const pin = testExecutionPins[0];
  if (testExecutionPins.length !== 1 || !pin)
    throw new QaDomainError("QA_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
  const requestKeyHash = jsonHash(successor.idempotencyKey);
  const requestHash = jsonHash({
    workspaceId: input.predecessor.workspaceId,
    projectId: input.predecessor.projectId,
    testSessionId: input.predecessor.testSessionId,
    planItemId: input.predecessor.planItemId,
    predecessorAttemptId: input.predecessor.automationAttemptId,
    predecessorResultId: decision.automationAttemptResultId,
    policyHash: decision.policyHash,
    targetSnapshotHash: input.predecessor.targetSnapshotHash,
    parameterSetHash: input.predecessor.parameterSetHash,
  });
  const connectorCommandId = deterministicUuid(
    `qa-automation-auto-retry-command:${decision.retryDecisionId}`,
  );
  const externalAuthorityHash = jsonHash({
    targetSnapshotHash: input.predecessor.targetSnapshotHash,
    suiteBindingHash: input.predecessor.suiteBindingHash,
    configurationPinSetHash: input.predecessor.configurationPinSetHash,
  });
  const created = createAutomationAttemptRecord({
    automationAttemptId: successor.automationAttemptId,
    workspaceId: input.predecessor.workspaceId,
    projectId: input.predecessor.projectId,
    workItemId: input.predecessor.workItemId,
    testSessionId: input.predecessor.testSessionId,
    planItemId: input.predecessor.planItemId,
    reason: "AUTO_INFRA_RETRY",
    predecessorAttemptId: input.predecessor.automationAttemptId,
    launchRequestId: successor.launchRequestId,
    requestKeyHash,
    requestHash,
    targetSnapshotRef: input.predecessor.targetSnapshotRef,
    targetSnapshotHash: input.predecessor.targetSnapshotHash,
    scopeSnapshotHash: input.predecessor.scopeSnapshotHash,
    suiteBindingRef: input.predecessor.suiteBindingRef,
    suiteBindingHash: input.predecessor.suiteBindingHash,
    parameterSetHash: input.predecessor.parameterSetHash,
    configurationPins: input.predecessor.configurationPins,
    configurationPinSetHash: input.predecessor.configurationPinSetHash,
    resultSchemaRef: input.predecessor.resultSchemaRef,
    artifactPolicyRef: input.predecessor.artifactPolicyRef,
    artifactPolicyHash: input.predecessor.artifactPolicyHash,
    retryPolicyRef: input.predecessor.retryPolicyRef,
    retryPolicyHash: input.predecessor.retryPolicyHash,
    quarantinePolicyRef: input.predecessor.quarantinePolicyRef,
    quarantinePolicyHash: input.predecessor.quarantinePolicyHash,
    connectorCommandId,
    effectKeyHash: successor.effectKeyHash,
    initiatingHumanId: successor.causalHumanId,
    executingServiceId: input.executingService.principalId,
    authorizationBasisHash: successor.causalAuthorizationBasisHash,
    createdAt: decision.decidedAt,
    correlationId: decision.correlationId,
    causationId: decision.causationId,
    externalAuthorityHash,
    previousAttempts: input.previousAttempts,
  });
  const pending = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
    statusRevisionId: `${successor.automationAttemptId}:status:2`,
    status: "TRIGGER_PENDING",
    providerStatus: "NOT_OBSERVED",
    providerRevisionToken: "trigger-pending:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: `core-command:${connectorCommandId}`,
    sourceReceiptHash: jsonHash({ connectorCommandId, state: "QUEUED" }),
    observedAt: decision.decidedAt,
    recordedAt: decision.decidedAt,
  });
  const launchBody = Object.freeze({
    launchRequestId: successor.launchRequestId,
    workspaceId: input.predecessor.workspaceId,
    projectId: input.predecessor.projectId,
    workItemId: input.predecessor.workItemId,
    testSessionId: input.predecessor.testSessionId,
    planItemId: input.predecessor.planItemId,
    requestKeyHash,
    requestHash,
    origin: "AUTO_INFRA_RETRY" as const,
    decision: "ACCEPTED" as const,
    attemptId: successor.automationAttemptId,
    connectorCommandId,
    effectIdempotencyKey: successor.effectIdempotencyKey,
    initiatorKind: "SERVICE" as const,
    initiatorPrincipalId: input.executingService.principalId,
    causalHumanPrincipalId: successor.causalHumanId,
    authorizationBasisHash: successor.causalAuthorizationBasisHash,
    correlationId: decision.correlationId,
    causationId: decision.causationId,
    createdAt: decision.decidedAt,
  });
  const launchRequest = Object.freeze({ ...launchBody, contentHash: jsonHash(launchBody) });
  const target = Object.freeze({
    kind: "QA_AUTOMATION_ATTEMPT",
    testSessionId: input.predecessor.testSessionId,
    automationAttemptId: successor.automationAttemptId,
    targetSnapshotHash: input.predecessor.targetSnapshotHash,
    configurationPinSetHash: input.predecessor.configurationPinSetHash,
  });
  const requestBody = Object.freeze({
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.trigger",
    testSessionId: input.predecessor.testSessionId,
    automationAttemptId: successor.automationAttemptId,
    launchRequestCommitment: requestHash,
    targetSnapshotRef: input.predecessor.targetSnapshotRef,
    targetSnapshotHash: input.predecessor.targetSnapshotHash,
    suiteBindingRef: input.predecessor.suiteBindingRef,
    suiteBindingHash: input.predecessor.suiteBindingHash,
    acceptedParameters: input.targetSnapshot.suite.acceptedParameters,
    parameterSetHash: input.predecessor.parameterSetHash,
    effectMarkerHash: successor.effectKeyHash,
  });
  const payload = Object.freeze({ ...requestBody, triggerRequestHash: jsonHash(requestBody) });
  const storedPayload = Object.freeze({
    value: payload,
    metadata: Object.freeze({
      commandType: "qa.automation.pipeline.trigger",
      logicalRole: "TEST_EXECUTION",
      targetHash: jsonHash(target),
      payloadHash: jsonHash(payload),
      expectedExternalState: Object.freeze({
        mode: "LOOKUP_BY_EXACT_EFFECT_MARKER",
        effectMarkerHash: successor.effectKeyHash,
      }),
      clientRequestKey: requestKeyHash,
      dataClassificationKey: "INTERNAL",
      initialAuthorizationBasis: input.causalAuthorizationBasis,
      initialAuthorizationBasisHash: successor.causalAuthorizationBasisHash,
      source: Object.freeze({
        sourceWorkItemId: input.predecessor.workItemId,
        causalHumanPrincipalId: successor.causalHumanId,
      }),
      recoveryPolicy: "LOOKUP_REQUIRED",
      status: "QUEUED",
      effectAuthorizationStatus: "NOT_REQUIRED",
      outboxStatus: "READY",
      attemptCount: 0,
      createdAt: decision.decidedAt,
      updatedAt: decision.decidedAt,
    }),
  });
  const command = Object.freeze({
    id: connectorCommandId,
    workspaceId: input.predecessor.workspaceId,
    projectId: input.predecessor.projectId,
    actor: input.executingService,
    target,
    payload,
    bindingRef: pin.projectIntegrationBindingRef,
    profileRef: pin.profileRef,
    effectIdempotencyKey: successor.effectIdempotencyKey,
    correlationId: decision.correlationId,
    causationId: decision.causationId,
    createdAt: decision.decidedAt,
    storedPayload,
  });
  const attemptEvent = buildQaAutomationAttemptCreatedEvent({
    context: input.context,
    eventId: deterministicUuid(
      `event:attempt-created:${successor.automationAttemptId}:${pending.attempt.identityContentHash}`,
    ),
    attempt: pending.attempt,
  });
  return Object.freeze({
    launchRequest,
    attempt: pending.attempt,
    statuses: Object.freeze([created.initialStatus, pending.revision] as const),
    command,
    events: Object.freeze([retryEvent, attemptEvent]),
  });
}

async function insertRetryDecision(
  manager: EntityManager,
  evaluation: QaAutomationRetryEvaluation,
): Promise<void> {
  const decision = evaluation.decision;
  await manager.query(
    `
INSERT INTO qa_automation_retry_decisions(
  retry_decision_id,workspace_id,project_id,attempt_id,attempt_result_id,decision,reason_code,retry_policy_ref,
  retry_policy_content_hash,infrastructure_code,automatic_retry_budget,automatic_retry_ordinal,successor_attempt_id,
  successor_launch_request_id,authorization_recheck_hash,decided_by_kind,decided_by_principal_id,decided_at,
  correlation_id,causation_id,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'SERVICE',$16,$17,$18,$19,$20)`,
    [
      decision.retryDecisionId,
      decision.workspaceId,
      decision.projectId,
      decision.automationAttemptId,
      decision.automationAttemptResultId,
      decision.decision,
      decision.reasonCode,
      decision.policyRef,
      decision.policyHash,
      decision.infrastructureCode ?? null,
      decision.automaticRetryBudget,
      decision.automaticRetryOrdinal ?? null,
      decision.successorAttemptId ?? null,
      decision.successorLaunchRequestId ?? null,
      decision.authorizationRecheckHash,
      decision.decidedById,
      decision.decidedAt,
      decision.correlationId,
      decision.causationId,
      decision.contentHash,
    ],
  );
}

async function insertRetrySuccessor(
  manager: EntityManager,
  prepared: Required<
    Pick<
      QaAutomationRetryPersistencePreparation,
      "launchRequest" | "attempt" | "statuses" | "command"
    >
  >,
): Promise<void> {
  const { command, launchRequest: launch, attempt } = prepared;
  if (
    !validUuid(command.id) ||
    !validUuid(command.correlationId) ||
    !validUuid(command.causationId)
  ) {
    throw new QaDomainError("QA_AUTOMATION_RETRY_COMMAND_ID_INVALID");
  }
  await manager.query(
    `
INSERT INTO connector_commands(
  id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,
  profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,row_version,created_at
) VALUES($1,$2,$3,$4,'test-executor.trigger-status','1.0.0','pipeline.trigger',$5,$6,$7,$8,$9,'QUEUED',NULL,$10,$11,1,$12)`,
    [
      command.id,
      command.workspaceId,
      command.projectId,
      JSON.stringify(command.actor),
      JSON.stringify(command.target),
      JSON.stringify(command.storedPayload),
      JSON.stringify(command.bindingRef),
      JSON.stringify(command.profileRef),
      command.effectIdempotencyKey,
      command.correlationId,
      command.causationId,
      command.createdAt,
    ],
  );
  await manager.query(
    `
INSERT INTO qa_automation_launch_requests(
  launch_request_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,request_key_hash,request_hash,
  confirmation_hash,confirmed_session_resource_version,confirmed_at,origin,decision,attempt_id,connector_command_id,
  effect_idempotency_key,rejection_reason_code,initiator_kind,initiator_principal_id,causal_human_principal_id,
  authorization_basis_hash,correlation_id,causation_id,created_at,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,'AUTO_INFRA_RETRY','ACCEPTED',$9,$10,$11,NULL,'SERVICE',$12,$13,$14,$15,$16,$17,$18)`,
    [
      launch.launchRequestId,
      launch.workspaceId,
      launch.projectId,
      launch.workItemId,
      launch.testSessionId,
      launch.planItemId,
      launch.requestKeyHash,
      launch.requestHash,
      launch.attemptId,
      launch.connectorCommandId,
      launch.effectIdempotencyKey,
      launch.initiatorPrincipalId,
      launch.causalHumanPrincipalId,
      launch.authorizationBasisHash,
      launch.correlationId,
      launch.causationId,
      launch.createdAt,
      launch.contentHash,
    ],
  );
  await manager.query(
    `
INSERT INTO qa_attempt_identities(
  attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,mode,attempt_no,
  target_snapshot_hash,scope_snapshot_hash,trigger_kind,initiator_kind,initiator_principal_id,
  authorization_basis_hash,correlation_id,causation_id,created_at,identity_content_hash
) VALUES($1,$2,$3,$4,$5,$6,'AUTOMATED',$7,$8,$9,'AUTO_INFRA_RETRY','SERVICE',$10,$11,$12,$13,$14,$15)`,
    [
      attempt.automationAttemptId,
      attempt.workspaceId,
      attempt.projectId,
      attempt.workItemId,
      attempt.testSessionId,
      attempt.planItemId,
      attempt.attemptNo,
      attempt.targetSnapshotHash,
      attempt.scopeSnapshotHash,
      command.actor.principalId,
      attempt.authorizationBasisHash,
      attempt.correlationId,
      attempt.causationId,
      attempt.createdAt,
      attempt.identityContentHash,
    ],
  );
  await manager.query(
    `
INSERT INTO qa_automation_attempts(
  attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_no,launch_request_id,
  root_attempt_id,predecessor_attempt_id,lineage_kind,request_key_hash,request_hash,suite_binding_id,
  suite_binding_version,suite_binding_content_hash,target_snapshot_ref,target_snapshot_hash,scope_snapshot_hash,
  parameter_set_hash,configuration_pin_set_hash,result_schema_ref,result_schema_digest,artifact_policy_ref,
  artifact_policy_content_hash,retry_policy_ref,retry_policy_content_hash,quarantine_policy_ref,
  quarantine_policy_content_hash,connector_command_id,effect_idempotency_key,initiating_human_principal_id,
  executing_service_principal_id,authorization_basis_hash,current_status_revision_id,current_status_revision_no,
  current_status,terminal_result_id,resource_version,created_at,correlation_id,causation_id,identity_content_hash
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'AUTO_INFRA_RETRY',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
  $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,NULL,$37,$38,$39,$40,$41
)`,
    [
      attempt.automationAttemptId,
      attempt.workspaceId,
      attempt.projectId,
      attempt.workItemId,
      attempt.testSessionId,
      attempt.planItemId,
      attempt.attemptNo,
      attempt.launchRequestId,
      attempt.rootAttemptId,
      attempt.predecessorAttemptId,
      attempt.requestKeyHash,
      attempt.requestHash,
      attempt.suiteBindingRef.id,
      attempt.suiteBindingRef.version,
      attempt.suiteBindingHash,
      attempt.targetSnapshotRef,
      attempt.targetSnapshotHash,
      attempt.scopeSnapshotHash,
      attempt.parameterSetHash,
      attempt.configurationPinSetHash,
      JSON.stringify(attempt.resultSchemaRef),
      attempt.resultSchemaRef.digest,
      attempt.artifactPolicyRef,
      attempt.artifactPolicyHash,
      attempt.retryPolicyRef,
      attempt.retryPolicyHash,
      attempt.quarantinePolicyRef,
      attempt.quarantinePolicyHash,
      attempt.connectorCommandId,
      command.effectIdempotencyKey,
      attempt.initiatingHumanId,
      attempt.executingServiceId,
      attempt.authorizationBasisHash,
      attempt.currentStatusRevisionId,
      attempt.currentStatusRevisionNo,
      attempt.currentStatus,
      attempt.resourceVersion,
      attempt.createdAt,
      attempt.correlationId,
      attempt.causationId,
      attempt.identityContentHash,
    ],
  );
  const repository = new TypeOrmAutomationExecutionRepository(manager);
  for (const status of prepared.statuses) await repository.insertStatusRevision(manager, status);
  await manager.query(
    `
INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,attempts,envelope_hash,created_at)
VALUES($1,$2,$3,$4,'READY',$5,0,$6,$5)`,
    [
      deterministicUuid(`qa-automation-auto-retry-command-outbox:${command.id}`),
      command.id,
      command.workspaceId,
      command.projectId,
      command.createdAt,
      jsonHash({
        commandId: command.id,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        correlationId: command.correlationId,
        causationId: command.causationId,
      }),
    ],
  );
}

export interface QaAutomationRetryPersistenceReceipt {
  readonly replayed: boolean;
  readonly retryDecisionId: string;
  readonly successorAttemptId?: string;
  readonly connectorCommandId?: string;
}

export interface QaAutomationResultCapacityHook {
  /** Runs inside the same SERIALIZABLE result transaction before evidence and Session mutations. */
  apply(
    manager: EntityManager,
    input: Readonly<{
      prepared: QaAutomationResultSyncPreparation;
      currentAttempt: QaAutomationAttemptRecord;
    }>,
  ): Promise<void>;
}

/** Optional server-owned admission for retry commands, executed inside the creation transaction. */
export interface QaAutomationRetryCommandAdmission {
  persist(manager: EntityManager, command: QaAutomationRetryCoreCommandRecord): Promise<void>;
  assertReplay(manager: EntityManager, command: QaAutomationRetryCoreCommandRecord): Promise<void>;
}

export class TypeOrmAutomationResultEvidenceUnitOfWork {
  readonly #repository: TypeOrmAutomationExecutionRepository;

  constructor(
    source: DataSource,
    private readonly capacity?: QaAutomationResultCapacityHook,
    private readonly retryAdmission?: QaAutomationRetryCommandAdmission,
  ) {
    this.#repository = new TypeOrmAutomationExecutionRepository(source);
  }

  async persistTerminalResult(
    prepared: QaAutomationResultSyncPreparation,
  ): Promise<QaAutomationResultPersistenceReceipt> {
    const scope = Object.freeze({
      workspaceId: prepared.attempt.workspaceId,
      projectId: prepared.attempt.projectId,
    });
    return await this.#repository.withAutomationAttemptTransaction(
      scope,
      prepared.attempt.automationAttemptId,
      async (manager, repository) => {
        const existing = await repository.terminalResult(
          scope,
          prepared.attempt.automationAttemptId,
        );
        if (existing !== undefined) {
          if (
            String(existing.content_hash) !== prepared.result.contentHash ||
            String(existing.result_id) !== prepared.result.automationAttemptResultId
          ) {
            throw new QaDomainError("QA_AUTOMATION_TERMINAL_RESULT_CONFLICT");
          }
          const persistedAttempt = await repository.automationAttempt(
            scope,
            prepared.attempt.automationAttemptId,
          );
          if (persistedAttempt?.terminalResultId !== prepared.result.automationAttemptResultId) {
            throw new QaDomainError("QA_AUTOMATION_TERMINAL_REPLAY_INCOMPLETE");
          }
          const session = rows<Readonly<{ state: string; resource_version: string | number }>>(
            await manager.query(
              `
SELECT state,resource_version FROM qa_test_sessions
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3`,
              [scope.workspaceId, scope.projectId, persistedAttempt.testSessionId],
            ),
          )[0];
          if (!session || session.state !== "REVIEW_REQUIRED")
            throw new QaDomainError("QA_AUTOMATION_SESSION_STICKY_REVIEW_REQUIRED");
          return Object.freeze({
            replayed: true,
            attemptId: persistedAttempt.automationAttemptId,
            resultId: prepared.result.automationAttemptResultId,
            terminalStatusRevisionId: persistedAttempt.currentStatusRevisionId,
            sessionState: "REVIEW_REQUIRED" as const,
            sessionResourceVersion: Number(session.resource_version),
          });
        }
        const current = await repository.automationAttempt(
          scope,
          prepared.attempt.automationAttemptId,
        );
        if (
          current === undefined ||
          current.currentStatus !== "RUNNING" ||
          current.currentStatusRevisionNo + 1 !== prepared.terminalStatus.revisionNo ||
          current.resourceVersion + 1 !== prepared.attempt.resourceVersion ||
          prepared.attempt.currentStatus !== "TERMINAL" ||
          prepared.attempt.terminalResultId !== prepared.result.automationAttemptResultId
        )
          throw new QaDomainError("QA_AUTOMATION_TERMINAL_RESULT_CAS_CONFLICT");

        await this.capacity?.apply(manager, Object.freeze({ prepared, currentAttempt: current }));

        for (const artifact of prepared.artifactReferences)
          await insertArtifactReference(manager, artifact);
        await insertTerminalResult(manager, prepared);
        await insertArtifactMemberships(manager, prepared);
        await repository.insertStatusRevision(manager, prepared.terminalStatus);
        const updated = rows<unknown>(
          await manager.query(
            `
UPDATE qa_automation_attempts
SET current_status_revision_id=$4,current_status_revision_no=$5,current_status='TERMINAL',terminal_result_id=$6,resource_version=$7
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3 AND current_status='RUNNING'
  AND current_status_revision_id=$8 AND current_status_revision_no=$9 AND resource_version=$10
RETURNING attempt_id`,
            [
              scope.workspaceId,
              scope.projectId,
              current.automationAttemptId,
              prepared.attempt.currentStatusRevisionId,
              prepared.attempt.currentStatusRevisionNo,
              prepared.result.automationAttemptResultId,
              prepared.attempt.resourceVersion,
              current.currentStatusRevisionId,
              current.currentStatusRevisionNo,
              current.resourceVersion,
            ],
          ),
        );
        if (updated.length !== 1)
          throw new QaDomainError("QA_AUTOMATION_TERMINAL_RESULT_CAS_CONFLICT");

        let sessionResourceVersion: number;
        if (prepared.session.changed) {
          const sessionRows = rows<Readonly<{ resource_version: string | number }>>(
            await manager.query(
              `
UPDATE qa_test_sessions
SET state='REVIEW_REQUIRED',resource_version=resource_version+1,
    content=content||jsonb_build_object('state','REVIEW_REQUIRED','resourceVersion',resource_version+1)
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED' AND state='RUNNING'
  AND resource_version=$4
RETURNING resource_version`,
              [
                scope.workspaceId,
                scope.projectId,
                current.testSessionId,
                prepared.session.resourceVersion - 1,
              ],
            ),
          );
          if (sessionRows.length !== 1)
            throw new QaDomainError("QA_AUTOMATION_SESSION_RESULT_CAS_CONFLICT");
          sessionResourceVersion = Number(sessionRows[0]!.resource_version);
        } else {
          const session = rows<Readonly<{ state: string; resource_version: string | number }>>(
            await manager.query(
              `
SELECT state,resource_version FROM qa_test_sessions
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED'`,
              [scope.workspaceId, scope.projectId, current.testSessionId],
            ),
          )[0];
          if (
            !session ||
            session.state !== "REVIEW_REQUIRED" ||
            Number(session.resource_version) !== prepared.session.resourceVersion
          ) {
            throw new QaDomainError("QA_AUTOMATION_SESSION_STICKY_REVIEW_REQUIRED");
          }
          sessionResourceVersion = Number(session.resource_version);
        }
        for (const event of prepared.events) await appendOutboxEvent(manager, event);
        return Object.freeze({
          replayed: false,
          attemptId: current.automationAttemptId,
          resultId: prepared.result.automationAttemptResultId,
          terminalStatusRevisionId: prepared.terminalStatus.statusRevisionId,
          sessionState: "REVIEW_REQUIRED" as const,
          sessionResourceVersion,
        });
      },
    );
  }

  async persistRetryEvaluation(
    input: QaAutomationRetryPersistenceInput,
  ): Promise<QaAutomationRetryPersistenceReceipt> {
    const prepared = prepareQaAutomationRetryPersistence(input);
    const decision = input.evaluation.decision;
    const scope = Object.freeze({
      workspaceId: decision.workspaceId,
      projectId: decision.projectId,
    });
    return await this.#repository.withAutomationAttemptTransaction(
      scope,
      decision.automationAttemptId,
      async (manager, repository) => {
        const existing = await repository.retryDecision(scope, decision.automationAttemptId);
        if (existing !== undefined) {
          if (
            String(existing.content_hash) !== decision.contentHash ||
            String(existing.retry_decision_id) !== decision.retryDecisionId ||
            (prepared.attempt &&
              String(existing.successor_attempt_id) !== prepared.attempt.automationAttemptId) ||
            (!prepared.attempt &&
              existing.successor_attempt_id !== null &&
              existing.successor_attempt_id !== undefined)
          ) {
            throw new QaDomainError("QA_AUTOMATION_RETRY_DECISION_CONFLICT");
          }
          if (prepared.command && this.retryAdmission)
            await this.retryAdmission.assertReplay(manager, prepared.command);
          return Object.freeze({
            replayed: true,
            retryDecisionId: decision.retryDecisionId,
            ...(existing.successor_attempt_id
              ? { successorAttemptId: String(existing.successor_attempt_id) }
              : {}),
            ...(prepared.command ? { connectorCommandId: prepared.command.id } : {}),
          });
        }
        const predecessor = await repository.automationAttempt(scope, decision.automationAttemptId);
        if (
          predecessor === undefined ||
          predecessor.currentStatus !== "TERMINAL" ||
          predecessor.terminalResultId !== decision.automationAttemptResultId ||
          predecessor.identityContentHash !== input.predecessor.identityContentHash
        )
          throw new QaDomainError("QA_AUTOMATION_RETRY_PREDECESSOR_STALE");
        const session = rows<Readonly<{ state: string }>>(
          await manager.query(
            `
SELECT state FROM qa_test_sessions
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED'`,
            [scope.workspaceId, scope.projectId, predecessor.testSessionId],
          ),
        )[0];
        if (!session || session.state !== "REVIEW_REQUIRED")
          throw new QaDomainError("QA_AUTOMATION_SESSION_STICKY_REVIEW_REQUIRED");

        if (decision.decision === "SCHEDULED") {
          if (
            !prepared.launchRequest ||
            !prepared.attempt ||
            !prepared.statuses ||
            !prepared.command
          ) {
            throw new QaDomainError("QA_AUTOMATION_RETRY_SUCCESSOR_MISSING");
          }
          await insertRetrySuccessor(manager, {
            launchRequest: prepared.launchRequest,
            attempt: prepared.attempt,
            statuses: prepared.statuses,
            command: prepared.command,
          });
          if (this.retryAdmission) await this.retryAdmission.persist(manager, prepared.command);
        }
        await insertRetryDecision(manager, input.evaluation);
        for (const event of prepared.events) await appendOutboxEvent(manager, event);
        return Object.freeze({
          replayed: false,
          retryDecisionId: decision.retryDecisionId,
          ...(prepared.attempt ? { successorAttemptId: prepared.attempt.automationAttemptId } : {}),
          ...(prepared.command ? { connectorCommandId: prepared.command.id } : {}),
        });
      },
    );
  }
}

import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaServiceActor,
} from "./primitives.ts";
import type { QaAutomatedConfigurationPin } from "./snapshots.ts";

export type QaAttemptMode = "MANUAL" | "AUTOMATED";
export type QaAttemptTriggerKind =
  "HUMAN_MANUAL" | "HUMAN_LAUNCH" | "HUMAN_RERUN" | "AUTO_INFRA_RETRY";
export type QaAutomationTechnicalResult =
  "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
export type QaAttemptInitiator = QaHumanActor | QaServiceActor;

function hash(value: unknown): value is QaContentHash {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function timestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export type QaAutomationAttemptReason = "INITIAL" | "HUMAN_RERUN" | "AUTO_INFRA_RETRY";
export type QaAutomationAttemptStatus = "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL";
export type QaAutomationProviderStatus =
  | "NOT_OBSERVED"
  | "CREATED"
  | "WAITING_FOR_RESOURCE"
  | "PREPARING"
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELED"
  | "SKIPPED"
  | "MANUAL"
  | "SCHEDULED"
  | "UNKNOWN";
export type QaAutomationStatusSource =
  "COMMAND_RECEIPT" | "WEBHOOK_SIGNAL" | "POLL_READ" | "RECONCILIATION_READ" | "SYNTHETIC_FAILURE";
export type QaAutomationNormalizationKind = "SCHEMA_VALIDATED" | "SYNTHETIC_INCOMPLETE";
export type QaAutomationNormalizationIssueCode =
  | "TRIGGER_AMBIGUOUS"
  | "PIPELINE_IDENTITY_MISSING"
  | "RESULT_MISSING"
  | "RESULT_TOO_LARGE"
  | "RESULT_SCHEMA_UNKNOWN"
  | "RESULT_SCHEMA_DRIFT"
  | "RESULT_SCOPE_MISMATCH"
  | "RESULT_TARGET_MISMATCH"
  | "ARTIFACT_CHECKSUM_MISMATCH"
  | "ARTIFACT_EXPIRED"
  | "PROVIDER_STATUS_UNKNOWN";
export type QaAutomationArtifactSyncState = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "EXPIRED";

export type QaAutomationResultTarget =
  | Readonly<{
      type: "MERGE_REQUEST";
      mergeRequestRef: string;
      commitSha: string;
      buildRef?: string;
    }>
  | Readonly<{ type: "COMMIT"; commitSha: string; buildRef?: string }>
  | Readonly<{ type: "BUILD"; buildRef: string; commitSha: string }>;

export interface QaAutomationAttemptResult {
  readonly schemaVersion: "automation-attempt-result@1.0.0";
  readonly automationAttemptResultId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly automationAttemptId: string;
  readonly normalizationKind: QaAutomationNormalizationKind;
  readonly outcome: QaAutomationTechnicalResult;
  readonly resultSchemaRef: Readonly<{ id: string; version: number; digest: QaContentHash }>;
  readonly observedResultSchemaRef?: Readonly<{
    id: string;
    version: number;
    digest: QaContentHash;
  }>;
  readonly sourceResultArtifactRef?: string;
  readonly normalizationReport: Readonly<{
    status: "VALID" | "INVALID" | "MISSING";
    issueCodes: readonly QaAutomationNormalizationIssueCode[];
    reportHash: QaContentHash;
  }>;
  readonly normalizedResultHash: QaContentHash;
  readonly externalPipelineId?: string;
  readonly externalJobIds: readonly string[];
  readonly target?: QaAutomationResultTarget;
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly durationMs?: number;
  readonly infrastructureCode?: string;
  readonly cancellationReasonCode?: string;
  readonly syntheticReasonCode?: QaAutomationNormalizationIssueCode;
  readonly artifactDescriptorSetHash: QaContentHash;
  readonly artifactSyncState: QaAutomationArtifactSyncState;
  readonly terminalAt: string;
  readonly recordedAt: string;
  readonly contentHash: QaContentHash;
}

export type CreateQaAutomationAttemptResultInput = Omit<
  QaAutomationAttemptResult,
  | "schemaVersion"
  | "normalizationReport"
  | "normalizedResultHash"
  | "externalJobIds"
  | "contentHash"
> &
  Readonly<{
    readonly externalJobIds?: readonly string[];
    readonly normalizationStatus: "VALID" | "INVALID" | "MISSING";
    readonly normalizationIssueCodes: readonly QaAutomationNormalizationIssueCode[];
  }>;

const technicalOutcomes = new Set<QaAutomationTechnicalResult>([
  "PASS",
  "ASSERTION_FAILED",
  "INFRA_FAILED",
  "TIMEOUT",
  "CANCELLED",
  "INCOMPLETE",
]);
const normalizationIssues = new Set<QaAutomationNormalizationIssueCode>([
  "TRIGGER_AMBIGUOUS",
  "PIPELINE_IDENTITY_MISSING",
  "RESULT_MISSING",
  "RESULT_TOO_LARGE",
  "RESULT_SCHEMA_UNKNOWN",
  "RESULT_SCHEMA_DRIFT",
  "RESULT_SCOPE_MISMATCH",
  "RESULT_TARGET_MISMATCH",
  "ARTIFACT_CHECKSUM_MISMATCH",
  "ARTIFACT_EXPIRED",
  "PROVIDER_STATUS_UNKNOWN",
]);

function validResultTarget(value: QaAutomationResultTarget | undefined): boolean {
  if (!value || !/^[a-f0-9]{40}$/u.test(value.commitSha)) return false;
  if (value.type === "MERGE_REQUEST") return nonEmpty(value.mergeRequestRef);
  if (value.type === "BUILD") return nonEmpty(value.buildRef);
  return value.type === "COMMIT";
}

export function createQaAutomationAttemptResult(
  input: CreateQaAutomationAttemptResultInput,
): QaAutomationAttemptResult {
  const issues = Object.freeze([...new Set(input.normalizationIssueCodes)].sort());
  const validated = input.normalizationKind === "SCHEMA_VALIDATED";
  const schemaDrift =
    input.syntheticReasonCode === "RESULT_SCHEMA_UNKNOWN" ||
    input.syntheticReasonCode === "RESULT_SCHEMA_DRIFT";
  if (
    [
      input.automationAttemptResultId,
      input.workspaceId,
      input.projectId,
      input.automationAttemptId,
      input.resultSchemaRef.id,
      input.suiteKey,
      input.environmentRef,
    ].some((value) => !nonEmpty(value)) ||
    !technicalOutcomes.has(input.outcome) ||
    !Number.isSafeInteger(input.resultSchemaRef.version) ||
    input.resultSchemaRef.version < 1 ||
    !hash(input.resultSchemaRef.digest) ||
    !hash(input.artifactDescriptorSetHash) ||
    !timestamp(input.terminalAt) ||
    !timestamp(input.recordedAt) ||
    Date.parse(input.recordedAt) < Date.parse(input.terminalAt) ||
    issues.some((issue) => !normalizationIssues.has(issue)) ||
    (input.infrastructureCode !== undefined &&
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.infrastructureCode)) ||
    (input.cancellationReasonCode !== undefined &&
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.cancellationReasonCode)) ||
    (input.outcome === "CANCELLED") !== (input.cancellationReasonCode !== undefined) ||
    (["PASS", "ASSERTION_FAILED", "TIMEOUT", "CANCELLED"].includes(input.outcome) &&
      input.infrastructureCode !== undefined)
  )
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_RESULT_INVALID");
  if (validated) {
    if (
      input.normalizationStatus !== "VALID" ||
      issues.length !== 0 ||
      input.outcome === "INCOMPLETE" ||
      !input.sourceResultArtifactRef ||
      !input.externalPipelineId ||
      (input.externalJobIds?.length ?? 0) < 1 ||
      !validResultTarget(input.target) ||
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs! < 0 ||
      input.syntheticReasonCode !== undefined ||
      input.observedResultSchemaRef !== undefined
    )
      throw new QaDomainError("QA_AUTOMATION_SCHEMA_VALIDATED_RESULT_INVALID");
  } else if (
    input.outcome !== "INCOMPLETE" ||
    input.normalizationStatus === "VALID" ||
    issues.length < 1 ||
    input.syntheticReasonCode === undefined ||
    !issues.includes(input.syntheticReasonCode) ||
    (schemaDrift && (!input.observedResultSchemaRef || !input.sourceResultArtifactRef))
  )
    throw new QaDomainError("QA_AUTOMATION_SYNTHETIC_RESULT_INVALID");
  if (
    input.observedResultSchemaRef &&
    (!nonEmpty(input.observedResultSchemaRef.id) ||
      input.observedResultSchemaRef.version < 1 ||
      !hash(input.observedResultSchemaRef.digest))
  ) {
    throw new QaDomainError("QA_AUTOMATION_OBSERVED_RESULT_SCHEMA_INVALID");
  }
  const reportBody = deepFreeze({ status: input.normalizationStatus, issueCodes: issues });
  const normalizationReport = deepFreeze({
    ...reportBody,
    reportHash: qaAggregateSnapshotHash(reportBody as never),
  });
  const normalizedResultHash = qaAggregateSnapshotHash({
    normalizationKind: input.normalizationKind,
    outcome: input.outcome,
    resultSchemaRef: input.resultSchemaRef,
    ...(input.observedResultSchemaRef
      ? { observedResultSchemaRef: input.observedResultSchemaRef }
      : {}),
    ...(input.externalPipelineId ? { externalPipelineId: input.externalPipelineId } : {}),
    externalJobIds: input.externalJobIds ?? [],
    ...(input.target ? { target: input.target } : {}),
    suiteKey: input.suiteKey,
    environmentRef: input.environmentRef,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.infrastructureCode ? { infrastructureCode: input.infrastructureCode } : {}),
    ...(input.cancellationReasonCode
      ? { cancellationReasonCode: input.cancellationReasonCode }
      : {}),
    ...(input.syntheticReasonCode ? { syntheticReasonCode: input.syntheticReasonCode } : {}),
    normalizationReport,
  } as never);
  const {
    normalizationStatus: ignoredStatus,
    normalizationIssueCodes: ignoredIssues,
    ...raw
  } = input;
  void ignoredStatus;
  void ignoredIssues;
  const body = deepFreeze({
    schemaVersion: "automation-attempt-result@1.0.0" as const,
    ...structuredClone(raw),
    externalJobIds: Object.freeze([...(input.externalJobIds ?? [])]),
    normalizationReport,
    normalizedResultHash,
  });
  return deepFreeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export interface QaAutomationLaunchConfirmation {
  readonly reason: Extract<QaAutomationAttemptReason, "INITIAL" | "HUMAN_RERUN">;
  readonly targetSnapshotHash: QaContentHash;
  readonly suiteBindingHash: QaContentHash;
  readonly configurationPinSetHash: QaContentHash;
  readonly sessionResourceVersion: number;
  readonly actionHash: QaContentHash;
  readonly confirmationHash: QaContentHash;
}

type QaAutomationLaunchConfirmationInput = Omit<
  QaAutomationLaunchConfirmation,
  "actionHash" | "confirmationHash"
>;

function launchAction(
  input: QaAutomationLaunchConfirmationInput,
): Readonly<QaAutomationLaunchConfirmationInput> {
  return deepFreeze({
    reason: input.reason,
    targetSnapshotHash: input.targetSnapshotHash,
    suiteBindingHash: input.suiteBindingHash,
    configurationPinSetHash: input.configurationPinSetHash,
    sessionResourceVersion: input.sessionResourceVersion,
  });
}

export function createAutomationLaunchConfirmation(
  input: QaAutomationLaunchConfirmationInput,
): QaAutomationLaunchConfirmation {
  if (
    ![input.targetSnapshotHash, input.suiteBindingHash, input.configurationPinSetHash].every(
      hash,
    ) ||
    !Number.isSafeInteger(input.sessionResourceVersion) ||
    input.sessionResourceVersion < 1
  )
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_CONFIRMATION_INVALID");
  const action = launchAction(input);
  const actionHash = qaAggregateSnapshotHash(action as never);
  return deepFreeze({
    ...action,
    actionHash,
    confirmationHash: qaAggregateSnapshotHash({ ...action, actionHash } as never),
  });
}

export interface QaAutomationLaunchCommitments {
  readonly requestKeyHash: QaContentHash;
  readonly requestHash: QaContentHash;
  readonly confirmationHash: QaContentHash;
  readonly effectIdempotencyKey: string;
  readonly effectKeyHash: QaContentHash;
}

export function createAutomationLaunchCommitments(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    testSessionId: string;
    planItemId: string;
    parameterSetHash: QaContentHash;
    idempotencyKey: string;
    confirmation: QaAutomationLaunchConfirmation;
  }>,
): QaAutomationLaunchCommitments {
  if (
    [input.workspaceId, input.projectId, input.testSessionId, input.planItemId].some(
      (value) => !nonEmpty(value),
    ) ||
    !hash(input.parameterSetHash) ||
    input.idempotencyKey.trim().length < 1 ||
    input.idempotencyKey.length > 256
  )
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_REQUEST_INVALID");
  const expected = createAutomationLaunchConfirmation(input.confirmation);
  if (
    expected.actionHash !== input.confirmation.actionHash ||
    expected.confirmationHash !== input.confirmation.confirmationHash
  ) {
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
  }
  const requestKeyHash = qaAggregateSnapshotHash(input.idempotencyKey as never);
  const requestHash = qaAggregateSnapshotHash({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    testSessionId: input.testSessionId,
    planItemId: input.planItemId,
    parameterSetHash: input.parameterSetHash,
    confirmation: expected,
  } as never);
  const effectIdentity = qaAggregateSnapshotHash({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    testSessionId: input.testSessionId,
    requestKeyHash,
    requestHash,
  } as never);
  const effectIdempotencyKey = `qa:automation:${effectIdentity.slice("sha256:".length)}`;
  return deepFreeze({
    requestKeyHash,
    requestHash,
    confirmationHash: expected.confirmationHash,
    effectIdempotencyKey,
    effectKeyHash: qaAggregateSnapshotHash(effectIdempotencyKey as never),
  });
}

export interface QaAutomationAttemptRecord {
  readonly schemaVersion: "automation-attempt@1.0.0";
  readonly automationAttemptId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly reason: QaAutomationAttemptReason;
  readonly rootAttemptId: string;
  readonly predecessorAttemptId?: string;
  readonly launchRequestId: string;
  readonly requestKeyHash: QaContentHash;
  readonly requestHash: QaContentHash;
  readonly targetSnapshotRef: string;
  readonly targetSnapshotHash: QaContentHash;
  readonly scopeSnapshotHash: QaContentHash;
  readonly suiteBindingRef: Readonly<{ id: string; version: number }>;
  readonly suiteBindingHash: QaContentHash;
  readonly parameterSetHash: QaContentHash;
  readonly configurationPins: readonly QaAutomatedConfigurationPin[];
  readonly configurationPinSetHash: QaContentHash;
  readonly resultSchemaRef: Readonly<{ id: string; version: number; digest: QaContentHash }>;
  readonly artifactPolicyRef: string;
  readonly artifactPolicyHash: QaContentHash;
  readonly retryPolicyRef: string;
  readonly retryPolicyHash: QaContentHash;
  readonly quarantinePolicyRef: string;
  readonly quarantinePolicyHash: QaContentHash;
  readonly connectorCommandId: string;
  readonly effectKeyHash: QaContentHash;
  readonly initiatingHumanId: string;
  readonly executingServiceId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly currentStatusRevisionId: string;
  readonly currentStatusRevisionNo: number;
  readonly currentStatus: QaAutomationAttemptStatus;
  readonly terminalResultId?: string;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly identityContentHash: QaContentHash;
}

export interface QaAutomationAttemptStatusRevision {
  readonly schemaVersion: "automation-attempt-status-revision@1.0.0";
  readonly statusRevisionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly automationAttemptId: string;
  readonly revisionNo: number;
  readonly previousRevisionId?: string;
  readonly previousStateHash?: QaContentHash;
  readonly status: QaAutomationAttemptStatus;
  readonly externalAuthorityHash: QaContentHash;
  readonly externalPipelineId?: string;
  readonly externalJobIds: readonly string[];
  readonly providerStatus: QaAutomationProviderStatus;
  readonly providerRevisionToken: string;
  readonly providerUpdatedAt?: string;
  readonly source: QaAutomationStatusSource;
  readonly sourceReceiptRef: string;
  readonly sourceReceiptHash: QaContentHash;
  readonly terminalResultId?: string;
  readonly terminalResultHash?: QaContentHash;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly observationHash: QaContentHash;
}

type QaAutomationAttemptRecordInput = Omit<
  QaAutomationAttemptRecord,
  | "schemaVersion"
  | "attemptNo"
  | "rootAttemptId"
  | "currentStatusRevisionId"
  | "currentStatusRevisionNo"
  | "currentStatus"
  | "terminalResultId"
  | "resourceVersion"
  | "identityContentHash"
> &
  Readonly<{
    externalAuthorityHash: QaContentHash;
    previousAttempts: readonly QaAutomationAttemptRecord[];
  }>;

function assertAttemptInput(input: QaAutomationAttemptRecordInput): void {
  const textValues = [
    input.automationAttemptId,
    input.workspaceId,
    input.projectId,
    input.workItemId,
    input.testSessionId,
    input.planItemId,
    input.launchRequestId,
    input.targetSnapshotRef,
    input.suiteBindingRef.id,
    input.resultSchemaRef.id,
    input.artifactPolicyRef,
    input.retryPolicyRef,
    input.quarantinePolicyRef,
    input.connectorCommandId,
    input.initiatingHumanId,
    input.executingServiceId,
    input.correlationId,
    input.causationId,
  ];
  const hashes = [
    input.requestKeyHash,
    input.requestHash,
    input.targetSnapshotHash,
    input.scopeSnapshotHash,
    input.suiteBindingHash,
    input.parameterSetHash,
    input.configurationPinSetHash,
    input.resultSchemaRef.digest,
    input.artifactPolicyHash,
    input.retryPolicyHash,
    input.quarantinePolicyHash,
    input.effectKeyHash,
    input.authorizationBasisHash,
    input.externalAuthorityHash,
  ];
  if (
    textValues.some((value) => !nonEmpty(value)) ||
    hashes.some((value) => !hash(value)) ||
    !Number.isSafeInteger(input.suiteBindingRef.version) ||
    input.suiteBindingRef.version < 1 ||
    !Number.isSafeInteger(input.resultSchemaRef.version) ||
    input.resultSchemaRef.version < 1 ||
    input.configurationPins.length !== 3 ||
    !timestamp(input.createdAt)
  )
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_IDENTITY_INVALID");
}

export function createAutomationAttemptRecord(input: QaAutomationAttemptRecordInput): Readonly<{
  attempt: QaAutomationAttemptRecord;
  initialStatus: QaAutomationAttemptStatusRevision;
}> {
  assertAttemptInput(input);
  const previous = [...input.previousAttempts].sort(
    (left, right) => left.attemptNo - right.attemptNo,
  );
  if (
    previous.some(
      (attempt, index) =>
        attempt.attemptNo !== index + 1 ||
        attempt.workspaceId !== input.workspaceId ||
        attempt.projectId !== input.projectId ||
        attempt.workItemId !== input.workItemId ||
        attempt.testSessionId !== input.testSessionId ||
        attempt.planItemId !== input.planItemId,
    )
  )
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_SEQUENCE_NOT_CONTIGUOUS");

  const attemptNo = previous.length + 1;
  const predecessor = previous.at(-1);
  if (
    (input.reason === "INITIAL" && (attemptNo !== 1 || input.predecessorAttemptId !== undefined)) ||
    (input.reason !== "INITIAL" &&
      (attemptNo === 1 || input.predecessorAttemptId !== predecessor?.automationAttemptId))
  )
    throw new QaDomainError(
      input.reason === "INITIAL"
        ? "QA_AUTOMATION_ATTEMPT_LINEAGE_INVALID"
        : "QA_AUTOMATION_ATTEMPT_PREDECESSOR_INVALID",
    );

  const { previousAttempts: ignoredPrevious, externalAuthorityHash, ...rawIdentity } = input;
  void ignoredPrevious;
  const immutableIdentity = deepFreeze({
    schemaVersion: "automation-attempt@1.0.0" as const,
    ...structuredClone(rawIdentity),
    attemptNo,
    rootAttemptId: predecessor?.rootAttemptId ?? input.automationAttemptId,
  });
  const identityContentHash = qaAggregateSnapshotHash(immutableIdentity as never);
  const initialBody = deepFreeze({
    schemaVersion: "automation-attempt-status-revision@1.0.0" as const,
    statusRevisionId: `${input.automationAttemptId}:status:1`,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    automationAttemptId: input.automationAttemptId,
    revisionNo: 1,
    status: "CREATED" as const,
    externalAuthorityHash,
    externalJobIds: Object.freeze([] as string[]),
    providerStatus: "NOT_OBSERVED" as const,
    providerRevisionToken: "created:1",
    source: "COMMAND_RECEIPT" as const,
    sourceReceiptRef: `core-command:${input.connectorCommandId}`,
    sourceReceiptHash: qaAggregateSnapshotHash({
      connectorCommandId: input.connectorCommandId,
      state: "CREATED",
    } as never),
    observedAt: input.createdAt,
    recordedAt: input.createdAt,
  });
  const initialStatus = deepFreeze({
    ...initialBody,
    observationHash: qaAggregateSnapshotHash(initialBody as never),
  });
  const attempt = deepFreeze({
    ...immutableIdentity,
    currentStatusRevisionId: initialStatus.statusRevisionId,
    currentStatusRevisionNo: 1,
    currentStatus: "CREATED" as const,
    resourceVersion: 1,
    identityContentHash,
  });
  return deepFreeze({ attempt, initialStatus });
}

type AppendAutomationAttemptStatusInput = Omit<
  QaAutomationAttemptStatusRevision,
  | "schemaVersion"
  | "workspaceId"
  | "projectId"
  | "automationAttemptId"
  | "revisionNo"
  | "previousRevisionId"
  | "previousStateHash"
  | "externalAuthorityHash"
  | "externalJobIds"
  | "observationHash"
> &
  Readonly<{ externalJobIds?: readonly string[] }>;

const legalStatusTransitions: Readonly<
  Record<QaAutomationAttemptStatus, readonly QaAutomationAttemptStatus[]>
> = Object.freeze({
  CREATED: Object.freeze(["TRIGGER_PENDING"] as const),
  TRIGGER_PENDING: Object.freeze(["RUNNING", "TERMINAL"] as const),
  RUNNING: Object.freeze(["TERMINAL"] as const),
  TERMINAL: Object.freeze([] as const),
});

export function appendAutomationAttemptStatus(
  attempt: QaAutomationAttemptRecord,
  previous: QaAutomationAttemptStatusRevision,
  input: AppendAutomationAttemptStatusInput,
): Readonly<{ attempt: QaAutomationAttemptRecord; revision: QaAutomationAttemptStatusRevision }> {
  if (
    previous.workspaceId !== attempt.workspaceId ||
    previous.projectId !== attempt.projectId ||
    previous.automationAttemptId !== attempt.automationAttemptId ||
    previous.statusRevisionId !== attempt.currentStatusRevisionId ||
    previous.revisionNo !== attempt.currentStatusRevisionNo ||
    previous.status !== attempt.currentStatus
  )
    throw new QaDomainError("QA_AUTOMATION_STATUS_HEAD_MISMATCH");
  if (!legalStatusTransitions[previous.status].includes(input.status))
    throw new QaDomainError("QA_AUTOMATION_STATUS_TRANSITION_INVALID");
  if (
    !nonEmpty(input.statusRevisionId) ||
    !nonEmpty(input.providerRevisionToken) ||
    !nonEmpty(input.sourceReceiptRef) ||
    !hash(input.sourceReceiptHash) ||
    !timestamp(input.observedAt) ||
    !timestamp(input.recordedAt) ||
    (input.providerUpdatedAt !== undefined && !timestamp(input.providerUpdatedAt)) ||
    (input.externalPipelineId !== undefined && !nonEmpty(input.externalPipelineId)) ||
    (input.externalJobIds?.length ?? 0) > 64 ||
    (input.status === "TERMINAL") !==
      (input.terminalResultId !== undefined && input.terminalResultHash !== undefined) ||
    (input.terminalResultHash !== undefined && !hash(input.terminalResultHash))
  )
    throw new QaDomainError("QA_AUTOMATION_STATUS_REVISION_INVALID");

  const revisionBody = deepFreeze({
    schemaVersion: "automation-attempt-status-revision@1.0.0" as const,
    ...structuredClone(input),
    workspaceId: attempt.workspaceId,
    projectId: attempt.projectId,
    automationAttemptId: attempt.automationAttemptId,
    revisionNo: previous.revisionNo + 1,
    previousRevisionId: previous.statusRevisionId,
    previousStateHash: previous.observationHash,
    externalAuthorityHash: previous.externalAuthorityHash,
    externalJobIds: Object.freeze([...(input.externalJobIds ?? [])]),
  });
  const revision = deepFreeze({
    ...revisionBody,
    observationHash: qaAggregateSnapshotHash(revisionBody as never),
  });
  const nextAttempt = deepFreeze({
    ...attempt,
    currentStatusRevisionId: revision.statusRevisionId,
    currentStatusRevisionNo: revision.revisionNo,
    currentStatus: revision.status,
    ...(revision.terminalResultId === undefined
      ? {}
      : { terminalResultId: revision.terminalResultId }),
    resourceVersion: attempt.resourceVersion + 1,
  });
  return deepFreeze({ attempt: nextAttempt, revision });
}

export interface QaAttemptIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly mode: QaAttemptMode;
  readonly attemptNo: number;
  readonly targetSnapshotHash: QaContentHash;
  readonly scopeSnapshotHash: QaContentHash;
  readonly triggerKind: QaAttemptTriggerKind;
  readonly initiator: QaAttemptInitiator;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly identityContentHash: QaContentHash;
}

export type CreateQaAttemptIdentityInput = Omit<
  QaAttemptIdentity,
  "attemptNo" | "identityContentHash"
> &
  Readonly<{
    previousAttemptNumbers: readonly number[];
  }>;

export function createQaAttemptIdentity(input: CreateQaAttemptIdentityInput): QaAttemptIdentity {
  const previous = [...input.previousAttemptNumbers].sort((left, right) => left - right);
  if (previous.some((number, index) => !Number.isInteger(number) || number !== index + 1)) {
    throw new QaDomainError("QA_ATTEMPT_SEQUENCE_NOT_CONTIGUOUS");
  }
  if (
    !input.id ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !input.sessionId ||
    !input.planItemId ||
    !hash(input.targetSnapshotHash) ||
    !hash(input.scopeSnapshotHash) ||
    !hash(input.authorizationBasisHash) ||
    !input.correlationId ||
    !input.causationId ||
    !input.createdAt
  )
    throw new QaDomainError("QA_ATTEMPT_IDENTITY_INVALID");

  const humanTrigger =
    input.triggerKind === "HUMAN_MANUAL" ||
    input.triggerKind === "HUMAN_LAUNCH" ||
    input.triggerKind === "HUMAN_RERUN";
  if (
    (input.mode === "MANUAL" &&
      (input.triggerKind !== "HUMAN_MANUAL" || input.initiator.kind !== "HUMAN")) ||
    (input.mode === "AUTOMATED" && input.triggerKind === "HUMAN_MANUAL") ||
    (humanTrigger && input.initiator.kind !== "HUMAN") ||
    (input.triggerKind === "AUTO_INFRA_RETRY" && input.initiator.kind !== "SERVICE")
  )
    throw new QaDomainError("QA_ATTEMPT_INITIATOR_INVALID");

  const { previousAttemptNumbers: ignoredPreviousAttemptNumbers, ...identityInput } = input;
  void ignoredPreviousAttemptNumbers;
  const body = {
    ...structuredClone(identityInput),
    attemptNo: previous.length + 1,
  };
  return deepFreeze({
    ...body,
    identityContentHash: qaAggregateSnapshotHash(body as never),
  });
}

export interface QaAutomationAttempt {
  readonly identity: QaAttemptIdentity & Readonly<{ mode: "AUTOMATED" }>;
  readonly state: "EXECUTING" | "REVIEW_REQUIRED" | "COMPLETED";
  readonly terminalResultId?: string;
  readonly terminalResult?: QaAutomationTechnicalResult;
  readonly terminalObservedAt?: string;
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
}

export function createAutomationAttempt(identity: QaAttemptIdentity): QaAutomationAttempt {
  if (identity.mode !== "AUTOMATED")
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_IDENTITY_REQUIRED");
  return deepFreeze({
    identity: structuredClone(identity) as QaAttemptIdentity & { mode: "AUTOMATED" },
    state: "EXECUTING",
  });
}

export function recordAutomationTerminalResult(
  attempt: QaAutomationAttempt,
  input: Readonly<{
    resultId: string;
    result: QaAutomationTechnicalResult;
    observedAt: string;
  }>,
): QaAutomationAttempt {
  if (attempt.terminalResultId !== undefined || attempt.state !== "EXECUTING") {
    throw new QaDomainError("QA_AUTOMATION_TERMINAL_RESULT_ALREADY_RECORDED");
  }
  if (!input.resultId || !input.observedAt)
    throw new QaDomainError("QA_AUTOMATION_TERMINAL_RESULT_INVALID");
  return deepFreeze({
    ...attempt,
    state: "REVIEW_REQUIRED",
    terminalResultId: input.resultId,
    terminalResult: input.result,
    terminalObservedAt: input.observedAt,
  });
}

export function completeAutomationAttemptReview(
  attempt: QaAutomationAttempt,
  actor: QaAttemptInitiator,
  reviewedAt: string,
): QaAutomationAttempt {
  if (attempt.state !== "REVIEW_REQUIRED" || attempt.terminalResultId === undefined) {
    throw new QaDomainError("QA_AUTOMATION_REVIEW_NOT_READY");
  }
  if (actor.kind !== "HUMAN") throw new QaDomainError("QA_AUTOMATION_HUMAN_REVIEW_REQUIRED");
  if (!reviewedAt) throw new QaDomainError("QA_AUTOMATION_REVIEW_INVALID");
  return deepFreeze({
    ...attempt,
    state: "COMPLETED",
    reviewedBy: actor.principalId,
    reviewedAt,
  });
}

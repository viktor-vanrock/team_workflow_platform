import {
  appendAutomationAttemptStatus,
  createAutomationAttemptRecord,
  createAutomationLaunchCommitments,
  createAutomationLaunchConfirmation,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptStatusRevision,
  type QaAutomationLaunchCommitments,
  type QaAutomationLaunchConfirmation,
} from "../domain/automation-attempt.ts";
import {
  assertQaVerifiedHuman,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaServiceActor,
} from "../domain/primitives.ts";
import type { QaAutomatedTargetSnapshot } from "../domain/snapshots.ts";
import {
  assertAutomatedSessionPlanningAllowed,
  type AutomatedSessionPlanningGuardInput,
} from "./plan-automated-session.ts";

export async function executeGuardedAutomationLaunch<TResult>(
  input: AutomatedSessionPlanningGuardInput,
  invokeProvider: () => Promise<TResult>,
): Promise<TResult> {
  assertAutomatedSessionPlanningAllowed(input);
  return await invokeProvider();
}

export interface QaAutomationLaunchSubject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly sessionState:
    "READY" | "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED" | "BLOCKED" | "CANCELLED";
  readonly planItemState: string;
  readonly sessionResourceVersion: number;
  readonly targetSnapshotRef: string;
  readonly targetSnapshotHash: QaContentHash;
  readonly scopeSnapshotHash: QaContentHash;
  readonly suiteBindingRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly parameterSetHash: QaContentHash;
  readonly configurationPinSetHash: QaContentHash;
  readonly targetSnapshot: QaAutomatedTargetSnapshot;
}

export interface QaAcceptedAutomationLaunchRequest {
  readonly launchRequestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly requestKeyHash: QaContentHash;
  readonly requestHash: QaContentHash;
  readonly confirmationHash: QaContentHash;
  readonly confirmedSessionResourceVersion: number;
  readonly confirmedAt: string;
  readonly origin: "HUMAN_LAUNCH" | "HUMAN_RERUN";
  readonly decision: "ACCEPTED";
  readonly attemptId: string;
  readonly connectorCommandId: string;
  readonly effectIdempotencyKey: string;
  readonly initiatorKind: "HUMAN";
  readonly initiatorPrincipalId: string;
  readonly causalHumanPrincipalId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly contentHash: QaContentHash;
}

export interface PreparedHumanAutomationLaunch {
  readonly launchRequest: QaAcceptedAutomationLaunchRequest;
  readonly commitments: QaAutomationLaunchCommitments;
  readonly attempt: QaAutomationAttemptRecord;
  readonly statuses: readonly [
    QaAutomationAttemptStatusRevision,
    QaAutomationAttemptStatusRevision,
  ];
}

export function currentAutomationLaunchConfirmation(
  subject: QaAutomationLaunchSubject,
): QaAutomationLaunchConfirmation {
  const reason =
    subject.sessionState === "READY"
      ? "INITIAL"
      : subject.sessionState === "REVIEW_REQUIRED"
        ? "HUMAN_RERUN"
        : undefined;
  if (!reason || subject.planItemState === "TERMINAL")
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_STATE_INVALID");
  return createAutomationLaunchConfirmation({
    reason,
    targetSnapshotHash: subject.targetSnapshotHash,
    suiteBindingHash: subject.suiteBindingRef.contentHash,
    configurationPinSetHash: subject.configurationPinSetHash,
    sessionResourceVersion: subject.sessionResourceVersion,
  });
}

function exactConfirmation(
  left: QaAutomationLaunchConfirmation,
  right: QaAutomationLaunchConfirmation,
): boolean {
  return (
    left.reason === right.reason &&
    left.targetSnapshotHash === right.targetSnapshotHash &&
    left.suiteBindingHash === right.suiteBindingHash &&
    left.configurationPinSetHash === right.configurationPinSetHash &&
    left.sessionResourceVersion === right.sessionResourceVersion &&
    left.actionHash === right.actionHash &&
    left.confirmationHash === right.confirmationHash
  );
}

function policyRef(ref: Readonly<{ id: string; version: number }>): string {
  return `${ref.id}@${ref.version}`;
}

export function automationLaunchCommitments(
  input: Readonly<{
    subject: QaAutomationLaunchSubject;
    idempotencyKey: string;
    confirmation: QaAutomationLaunchConfirmation;
  }>,
): QaAutomationLaunchCommitments {
  return createAutomationLaunchCommitments({
    workspaceId: input.subject.workspaceId,
    projectId: input.subject.projectId,
    testSessionId: input.subject.testSessionId,
    planItemId: input.subject.planItemId,
    parameterSetHash: input.subject.parameterSetHash,
    idempotencyKey: input.idempotencyKey,
    confirmation: input.confirmation,
  });
}

export function prepareHumanAutomationLaunch(
  input: Readonly<{
    subject: QaAutomationLaunchSubject;
    idempotencyKey: string;
    ifMatch: number;
    confirmation: QaAutomationLaunchConfirmation;
    actor: QaHumanActor;
    executingService: QaServiceActor;
    authorizationBasis: QaAuthorizationBasis;
    authorizationBasisHash: QaContentHash;
    previousAttempts: readonly QaAutomationAttemptRecord[];
    launchRequestId: string;
    automationAttemptId: string;
    connectorCommandId: string;
    correlationId: string;
    causationId: string;
    launchedAt: string;
  }>,
): PreparedHumanAutomationLaunch {
  const actor = assertQaVerifiedHuman({
    actor: input.actor,
    scope: {
      kind: "PROJECT",
      workspaceId: input.subject.workspaceId,
      projectId: input.subject.projectId,
    },
    correlationId: input.correlationId,
    causationId: input.causationId,
    authorizationBasis: input.authorizationBasis,
  });
  if (
    input.executingService.kind !== "SERVICE" ||
    input.executingService.principalId.length === 0 ||
    input.executingService.serviceKey.length === 0 ||
    input.authorizationBasisHash !== qaAggregateSnapshotHash(input.authorizationBasis as never)
  )
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_AUTHORIZATION_INVALID");
  const expected = currentAutomationLaunchConfirmation(input.subject);
  if (input.ifMatch !== input.subject.sessionResourceVersion)
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_STALE_VERSION");
  if (!exactConfirmation(expected, input.confirmation))
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
  if (
    input.subject.targetSnapshot.snapshotHash !== input.subject.targetSnapshotHash ||
    input.subject.targetSnapshot.configurationPinSetHash !==
      input.subject.configurationPinSetHash ||
    input.subject.targetSnapshot.suite.suiteBindingHash !==
      input.subject.suiteBindingRef.contentHash ||
    input.subject.targetSnapshot.suite.parametersHash !== input.subject.parameterSetHash
  ) {
    throw new QaDomainError("QA_AUTOMATION_LAUNCH_SUBJECT_MISMATCH");
  }
  const commitments = automationLaunchCommitments(input);
  const reason = input.confirmation.reason;
  const predecessorAttemptId = input.previousAttempts.at(-1)?.automationAttemptId;
  if (reason === "HUMAN_RERUN" && predecessorAttemptId === undefined) {
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_PREDECESSOR_INVALID");
  }
  if (reason === "HUMAN_RERUN") {
    if (input.subject.sessionState !== "REVIEW_REQUIRED")
      throw new QaDomainError("QA_AUTOMATION_HUMAN_RERUN_STATE_INVALID");
    if (input.previousAttempts.some(({ currentStatus }) => currentStatus !== "TERMINAL"))
      throw new QaDomainError("QA_AUTOMATION_HUMAN_RERUN_ATTEMPT_UNSETTLED");
    if (
      input.previousAttempts.some(
        ({ requestKeyHash }) => requestKeyHash === commitments.requestKeyHash,
      )
    ) {
      throw new QaDomainError("QA_AUTOMATION_HUMAN_RERUN_FRESH_REQUEST_KEY_REQUIRED");
    }
  }
  const externalAuthorityHash = qaAggregateSnapshotHash({
    targetSnapshotHash: input.subject.targetSnapshotHash,
    suiteBindingHash: input.subject.suiteBindingRef.contentHash,
    configurationPinSetHash: input.subject.configurationPinSetHash,
  } as never);
  const created = createAutomationAttemptRecord({
    automationAttemptId: input.automationAttemptId,
    workspaceId: input.subject.workspaceId,
    projectId: input.subject.projectId,
    workItemId: input.subject.workItemId,
    testSessionId: input.subject.testSessionId,
    planItemId: input.subject.planItemId,
    reason,
    ...(reason === "INITIAL" ? {} : { predecessorAttemptId: predecessorAttemptId! }),
    launchRequestId: input.launchRequestId,
    requestKeyHash: commitments.requestKeyHash,
    requestHash: commitments.requestHash,
    targetSnapshotRef: input.subject.targetSnapshotRef,
    targetSnapshotHash: input.subject.targetSnapshotHash,
    scopeSnapshotHash: input.subject.scopeSnapshotHash,
    suiteBindingRef: Object.freeze({
      id: input.subject.suiteBindingRef.id,
      version: input.subject.suiteBindingRef.version,
    }),
    suiteBindingHash: input.subject.suiteBindingRef.contentHash,
    parameterSetHash: input.subject.parameterSetHash,
    configurationPins: input.subject.targetSnapshot.configurationPins,
    configurationPinSetHash: input.subject.configurationPinSetHash,
    resultSchemaRef: Object.freeze({
      id: input.subject.targetSnapshot.executionPolicies.resultSchemaRef.id,
      version: input.subject.targetSnapshot.executionPolicies.resultSchemaRef.version,
      digest: input.subject.targetSnapshot.executionPolicies.resultSchemaRef.contentHash,
    }),
    artifactPolicyRef: policyRef(input.subject.targetSnapshot.executionPolicies.artifactPolicyRef),
    artifactPolicyHash:
      input.subject.targetSnapshot.executionPolicies.artifactPolicyRef.contentHash,
    retryPolicyRef: policyRef(input.subject.targetSnapshot.executionPolicies.retryPolicyRef),
    retryPolicyHash: input.subject.targetSnapshot.executionPolicies.retryPolicyRef.contentHash,
    quarantinePolicyRef: policyRef(
      input.subject.targetSnapshot.executionPolicies.quarantinePolicyRef,
    ),
    quarantinePolicyHash:
      input.subject.targetSnapshot.executionPolicies.quarantinePolicyRef.contentHash,
    connectorCommandId: input.connectorCommandId,
    effectKeyHash: commitments.effectKeyHash,
    initiatingHumanId: actor.principalId,
    executingServiceId: input.executingService.principalId,
    authorizationBasisHash: input.authorizationBasisHash,
    createdAt: input.launchedAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
    externalAuthorityHash,
    previousAttempts: input.previousAttempts,
  });
  const pending = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
    statusRevisionId: `${input.automationAttemptId}:status:2`,
    status: "TRIGGER_PENDING",
    providerStatus: "NOT_OBSERVED",
    providerRevisionToken: "trigger-pending:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: `core-command:${input.connectorCommandId}`,
    sourceReceiptHash: qaAggregateSnapshotHash({
      connectorCommandId: input.connectorCommandId,
      state: "QUEUED",
    } as never),
    observedAt: input.launchedAt,
    recordedAt: input.launchedAt,
  });
  const launchBody = Object.freeze({
    launchRequestId: input.launchRequestId,
    workspaceId: input.subject.workspaceId,
    projectId: input.subject.projectId,
    workItemId: input.subject.workItemId,
    testSessionId: input.subject.testSessionId,
    planItemId: input.subject.planItemId,
    requestKeyHash: commitments.requestKeyHash,
    requestHash: commitments.requestHash,
    confirmationHash: commitments.confirmationHash,
    confirmedSessionResourceVersion: input.confirmation.sessionResourceVersion,
    confirmedAt: input.launchedAt,
    origin: reason === "INITIAL" ? ("HUMAN_LAUNCH" as const) : ("HUMAN_RERUN" as const),
    decision: "ACCEPTED" as const,
    attemptId: pending.attempt.automationAttemptId,
    connectorCommandId: input.connectorCommandId,
    effectIdempotencyKey: commitments.effectIdempotencyKey,
    initiatorKind: "HUMAN" as const,
    initiatorPrincipalId: actor.principalId,
    causalHumanPrincipalId: actor.principalId,
    authorizationBasisHash: input.authorizationBasisHash,
    correlationId: input.correlationId,
    causationId: input.causationId,
    createdAt: input.launchedAt,
  });
  return Object.freeze({
    launchRequest: Object.freeze({
      ...launchBody,
      contentHash: qaAggregateSnapshotHash(launchBody as never),
    }),
    commitments,
    attempt: pending.attempt,
    statuses: Object.freeze([created.initialStatus, pending.revision] as const),
  });
}

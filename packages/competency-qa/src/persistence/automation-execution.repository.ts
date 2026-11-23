import type { DataSource, EntityManager } from "typeorm";

import type {
  PreparedHumanAutomationLaunch,
  QaAcceptedAutomationLaunchRequest,
  QaAutomationLaunchSubject,
} from "../application/trigger-automation.ts";
import {
  appendAutomationAttemptStatus,
  type QaAttemptMode,
  type QaAttemptTriggerKind,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptStatusRevision,
} from "../domain/automation-attempt.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "../domain/primitives.ts";
import type { QaAutomatedTargetSnapshot } from "../domain/snapshots.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

function rows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export interface QaAttemptIdentityRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly mode: QaAttemptMode;
  readonly attemptNo: number;
  readonly targetSnapshotHash: QaContentHash;
  readonly scopeSnapshotHash: QaContentHash;
  readonly triggerKind: QaAttemptTriggerKind;
  readonly initiatorKind: "HUMAN" | "SERVICE";
  readonly initiatorPrincipalId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly identityContentHash: QaContentHash;
}

export type QaAttemptDetailRecord = Readonly<{
  identity: QaAttemptIdentityRecord;
  detail: Readonly<Record<string, unknown>>;
}>;

export interface QaAutomationLaunchClaimRecord {
  readonly launchRequestId: string;
  readonly testSessionId: string;
  readonly requestKeyHash: QaContentHash;
  readonly requestHash: QaContentHash;
  readonly confirmationHash: QaContentHash;
  readonly confirmedSessionResourceVersion: number;
  readonly attemptId: string;
  readonly connectorCommandId: string;
  readonly effectIdempotencyKey: string;
  readonly initiatorPrincipalId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly createdAt: string;
}

export interface QaAutomationTriggerReceiptProjection {
  readonly externalPipelineId: string;
  readonly observedState: "QUEUED" | "RUNNING" | "TERMINAL";
  readonly providerCreatedAt: string;
  readonly observedAt: string;
  readonly observationHash: QaContentHash;
}

type TransactionalSource = QaQueryExecutor & Pick<DataSource, "transaction">;

function transactional(source: QaQueryExecutor): source is TransactionalSource {
  return (
    "transaction" in source && typeof (source as Partial<DataSource>).transaction === "function"
  );
}

function retryableTransactionConflict(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as Readonly<{
    code?: unknown;
    driverError?: Readonly<{ code?: unknown }>;
  }>;
  const code = String(candidate.code ?? candidate.driverError?.code ?? "");
  return code === "40001" || code === "40P01";
}

async function withBoundedTransactionRetry<T>(work: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!retryableTransactionConflict(error) || attempt === maxAttempts) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export class TypeOrmAutomationExecutionRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async identity(scope: QaScope, attemptId: string): Promise<QaAttemptIdentityRecord | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT attempt_id AS id,work_item_id AS "workItemId",session_id AS "sessionId",plan_item_id AS "planItemId",
       mode,attempt_no AS "attemptNo",target_snapshot_hash AS "targetSnapshotHash",scope_snapshot_hash AS "scopeSnapshotHash",
       trigger_kind AS "triggerKind",initiator_kind AS "initiatorKind",initiator_principal_id AS "initiatorPrincipalId",
       authorization_basis_hash AS "authorizationBasisHash",correlation_id AS "correlationId",causation_id AS "causationId",
       created_at AS "createdAt",identity_content_hash AS "identityContentHash"
FROM qa_attempt_identities WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return found[0] === undefined ? undefined : this.#identity(found[0]);
  }

  async attempts(scope: QaScope, sessionId: string): Promise<readonly QaAttemptIdentityRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT attempt_id AS id,work_item_id AS "workItemId",session_id AS "sessionId",plan_item_id AS "planItemId",
       mode,attempt_no AS "attemptNo",target_snapshot_hash AS "targetSnapshotHash",scope_snapshot_hash AS "scopeSnapshotHash",
       trigger_kind AS "triggerKind",initiator_kind AS "initiatorKind",initiator_principal_id AS "initiatorPrincipalId",
       authorization_basis_hash AS "authorizationBasisHash",correlation_id AS "correlationId",causation_id AS "causationId",
       created_at AS "createdAt",identity_content_hash AS "identityContentHash"
FROM qa_attempt_identities WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3
ORDER BY plan_item_id,attempt_no`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(found.map((row) => this.#identity(row)));
  }

  async currentLaunchSubject(
    scope: QaScope,
    sessionId: string,
  ): Promise<QaAutomationLaunchSubject> {
    return await this.#launchSubject(this.source, scope, sessionId, false);
  }

  async withLaunchTransaction<T>(
    scope: QaScope,
    sessionId: string,
    work: (
      manager: EntityManager,
      repository: TypeOrmAutomationExecutionRepository,
      subject: QaAutomationLaunchSubject,
    ) => Promise<T>,
  ): Promise<T> {
    const source = this.source;
    if (!transactional(source))
      throw new QaDomainError("QA_AUTOMATION_TRANSACTION_SOURCE_REQUIRED");
    return await withBoundedTransactionRetry(
      async () =>
        await source.transaction("SERIALIZABLE", async (manager) => {
          await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `qa-automation-launch:${scope.workspaceId}:${scope.projectId}:${sessionId}`,
          ]);
          await manager.query(
            "SELECT capacity_head_id FROM workspace_capacity_heads WHERE workspace_id=$1 FOR UPDATE",
            [scope.workspaceId],
          );
          const initial = rows<Record<string, unknown>>(
            await manager.query(
              `
SELECT work_item_id FROM qa_test_sessions
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3`,
              [scope.workspaceId, scope.projectId, sessionId],
            ),
          );
          if (!initial[0]) throw new QaDomainError("QA_AUTOMATED_SESSION_NOT_FOUND");
          await manager.query(
            "SELECT control_id FROM work_item_queue_control_heads WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
            [scope.workspaceId, scope.projectId, String(initial[0].work_item_id)],
          );
          const extension = rows<Record<string, unknown>>(
            await manager.query(
              `
SELECT extension_id FROM qa_request_extensions
WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
FOR UPDATE`,
              [scope.workspaceId, scope.projectId, String(initial[0].work_item_id)],
            ),
          );
          if (!extension[0]) throw new QaDomainError("QA_AUTOMATION_REQUEST_EXTENSION_NOT_FOUND");
          const repository = new TypeOrmAutomationExecutionRepository(manager);
          const subject = await repository.#launchSubject(manager, scope, sessionId, true);
          return await work(manager, repository, subject);
        }),
    );
  }

  async withAutomationAttemptTransaction<T>(
    scope: QaScope,
    attemptId: string,
    work: (manager: EntityManager, repository: TypeOrmAutomationExecutionRepository) => Promise<T>,
  ): Promise<T> {
    const source = this.source;
    if (!transactional(source))
      throw new QaDomainError("QA_AUTOMATION_TRANSACTION_SOURCE_REQUIRED");
    return await withBoundedTransactionRetry(
      async () =>
        await source.transaction("SERIALIZABLE", async (manager) => {
          await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `qa-automation-attempt:${scope.workspaceId}:${scope.projectId}:${attemptId}`,
          ]);
          await manager.query(
            "SELECT capacity_head_id FROM workspace_capacity_heads WHERE workspace_id=$1 FOR UPDATE",
            [scope.workspaceId],
          );
          const target = rows<Record<string, unknown>>(
            await manager.query(
              "SELECT work_item_id FROM qa_automation_attempts WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3",
              [scope.workspaceId, scope.projectId, attemptId],
            ),
          );
          if (!target[0]) throw new QaDomainError("QA_AUTOMATION_ATTEMPT_NOT_FOUND");
          await manager.query(
            "SELECT control_id FROM work_item_queue_control_heads WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
            [scope.workspaceId, scope.projectId, String(target[0].work_item_id)],
          );
          const locked = rows<Record<string, unknown>>(
            await manager.query(
              `
SELECT attempt.attempt_id
FROM qa_automation_attempts attempt
JOIN qa_test_sessions session ON session.session_id=attempt.session_id
  AND session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.attempt_id=$3
FOR UPDATE OF attempt,session`,
              [scope.workspaceId, scope.projectId, attemptId],
            ),
          );
          if (locked.length !== 1) throw new QaDomainError("QA_AUTOMATION_ATTEMPT_NOT_FOUND");
          return await work(manager, new TypeOrmAutomationExecutionRepository(manager));
        }),
    );
  }

  async launchClaim(
    scope: QaScope,
    sessionId: string,
    requestKeyHash: QaContentHash,
  ): Promise<QaAutomationLaunchClaimRecord | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT launch_request_id,session_id,request_key_hash,request_hash,confirmation_hash,
       confirmed_session_resource_version,attempt_id,connector_command_id,effect_idempotency_key,
       initiator_principal_id,authorization_basis_hash,created_at
FROM qa_automation_launch_requests
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND request_key_hash=$4`,
        [scope.workspaceId, scope.projectId, sessionId, requestKeyHash],
      ),
    );
    const row = found[0];
    return row === undefined
      ? undefined
      : Object.freeze({
          launchRequestId: String(row.launch_request_id),
          testSessionId: String(row.session_id),
          requestKeyHash: String(row.request_key_hash) as QaContentHash,
          requestHash: String(row.request_hash) as QaContentHash,
          confirmationHash: String(row.confirmation_hash) as QaContentHash,
          confirmedSessionResourceVersion: Number(row.confirmed_session_resource_version),
          attemptId: String(row.attempt_id),
          connectorCommandId: String(row.connector_command_id),
          effectIdempotencyKey: String(row.effect_idempotency_key),
          initiatorPrincipalId: String(row.initiator_principal_id),
          authorizationBasisHash: String(row.authorization_basis_hash) as QaContentHash,
          createdAt: new Date(String(row.created_at)).toISOString(),
        });
  }

  async automationAttempt(
    scope: QaScope,
    attemptId: string,
  ): Promise<QaAutomationAttemptRecord | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT attempt.*,session.target_snapshot
FROM qa_automation_attempts attempt
JOIN qa_test_sessions session ON session.session_id=attempt.session_id
  AND session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.attempt_id=$3`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return found[0] === undefined ? undefined : this.#automationAttempt(found[0]);
  }

  async automationAttempts(
    scope: QaScope,
    sessionId: string,
  ): Promise<readonly QaAutomationAttemptRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT attempt.*,session.target_snapshot
FROM qa_automation_attempts attempt
JOIN qa_test_sessions session ON session.session_id=attempt.session_id
  AND session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.session_id=$3
ORDER BY attempt.plan_item_id,attempt.attempt_no`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(found.map((row) => this.#automationAttempt(row)));
  }

  async automationStatusHistory(
    scope: QaScope,
    attemptId: string,
  ): Promise<readonly QaAutomationAttemptStatusRevision[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_attempt_status_revisions
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3 ORDER BY revision_no`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return Object.freeze(found.map((row) => this.#automationStatus(row)));
  }

  async attachAutomationTriggerReceipt(
    manager: EntityManager,
    scope: QaScope,
    attemptId: string,
    receipt: QaAutomationTriggerReceiptProjection,
    recordedAt: string,
  ): Promise<QaAutomationAttemptRecord> {
    const repository = new TypeOrmAutomationExecutionRepository(manager);
    const attempt = await repository.automationAttempt(scope, attemptId);
    if (!attempt) throw new QaDomainError("QA_AUTOMATION_ATTEMPT_NOT_FOUND");
    if (attempt.currentStatus === "RUNNING") {
      const history = await repository.automationStatusHistory(scope, attemptId);
      const head = history.at(-1);
      if (
        head?.externalPipelineId === receipt.externalPipelineId &&
        head.sourceReceiptHash === receipt.observationHash
      )
        return attempt;
      throw new QaDomainError("QA_AUTOMATION_TRIGGER_RECEIPT_CONFLICT");
    }
    if (attempt.currentStatus !== "TRIGGER_PENDING")
      throw new QaDomainError("QA_AUTOMATION_TRIGGER_RECEIPT_STATE_INVALID");
    const history = await repository.automationStatusHistory(scope, attemptId);
    const previous = history.at(-1);
    if (!previous) throw new QaDomainError("QA_AUTOMATION_STATUS_HEAD_MISSING");
    const next = appendAutomationAttemptStatus(attempt, previous, {
      statusRevisionId: `${attempt.automationAttemptId}:status:${previous.revisionNo + 1}`,
      status: "RUNNING",
      externalPipelineId: receipt.externalPipelineId,
      providerStatus:
        receipt.observedState === "QUEUED"
          ? "PENDING"
          : receipt.observedState === "RUNNING"
            ? "RUNNING"
            : "UNKNOWN",
      providerRevisionToken: receipt.observationHash,
      providerUpdatedAt: receipt.providerCreatedAt,
      source: "COMMAND_RECEIPT",
      sourceReceiptRef: `gitlab-pipeline:${receipt.externalPipelineId}`,
      sourceReceiptHash: receipt.observationHash,
      observedAt: receipt.observedAt,
      recordedAt,
    });
    await repository.insertStatusRevision(manager, next.revision);
    const updated = rows<Record<string, unknown>>(
      await manager.query(
        `
UPDATE qa_automation_attempts
SET current_status_revision_id=$4,current_status_revision_no=$5,current_status=$6,
    terminal_result_id=NULL,resource_version=$7
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3 AND resource_version=$8
RETURNING attempt_id`,
        [
          scope.workspaceId,
          scope.projectId,
          attemptId,
          next.attempt.currentStatusRevisionId,
          next.attempt.currentStatusRevisionNo,
          next.attempt.currentStatus,
          next.attempt.resourceVersion,
          attempt.resourceVersion,
        ],
      ),
    );
    if (updated.length !== 1) throw new QaDomainError("QA_AUTOMATION_ATTEMPT_HEAD_CAS_CONFLICT");
    return next.attempt;
  }

  async persistAcceptedLaunch(
    input: Readonly<{
      manager: EntityManager;
      prepared: PreparedHumanAutomationLaunch;
      initiatingActor: QaHumanActor;
    }>,
  ): Promise<void> {
    const launch = input.prepared.launchRequest;
    const attempt = input.prepared.attempt;
    await this.#insertLaunchRequest(input.manager, launch);
    await input.manager.query(
      `
INSERT INTO qa_attempt_identities(
  attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,mode,attempt_no,
  target_snapshot_hash,scope_snapshot_hash,trigger_kind,initiator_kind,initiator_principal_id,
  authorization_basis_hash,correlation_id,causation_id,created_at,identity_content_hash
) VALUES($1,$2,$3,$4,$5,$6,'AUTOMATED',$7,$8,$9,$10,'HUMAN',$11,$12,$13,$14,$15,$16)`,
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
        attempt.reason === "INITIAL" ? "HUMAN_LAUNCH" : attempt.reason,
        attempt.initiatingHumanId,
        attempt.authorizationBasisHash,
        attempt.correlationId,
        attempt.causationId,
        attempt.createdAt,
        attempt.identityContentHash,
      ],
    );
    await input.manager.query(
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
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,NULL,$38,$39,$40,$41,$42)`,
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
        attempt.predecessorAttemptId ?? null,
        attempt.reason,
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
        launch.effectIdempotencyKey,
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
    for (const status of input.prepared.statuses)
      await this.insertStatusRevision(input.manager, status);
    if (attempt.reason === "INITIAL") {
      const nextSessionContent = Object.freeze({
        state: "RUNNING",
        executionActivity: "TRIGGER_PENDING",
        resourceVersion: launch.confirmedSessionResourceVersion + 1,
        startedAt: launch.createdAt,
        startedBy: input.initiatingActor,
        lastTransitionActor: input.initiatingActor,
      });
      const updated = rows<Record<string, unknown>>(
        await input.manager.query(
          `
UPDATE qa_test_sessions
SET state='RUNNING',started_at=$4,resource_version=resource_version+1,content=content || $5::jsonb
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED' AND state='READY'
  AND resource_version=$6
RETURNING session_id`,
          [
            attempt.workspaceId,
            attempt.projectId,
            attempt.testSessionId,
            launch.createdAt,
            JSON.stringify(nextSessionContent),
            launch.confirmedSessionResourceVersion,
          ],
        ),
      );
      if (updated.length !== 1) throw new QaDomainError("QA_AUTOMATION_LAUNCH_STALE_VERSION");
    }
  }

  async detail(scope: QaScope, attemptId: string): Promise<QaAttemptDetailRecord | undefined> {
    const identity = await this.identity(scope, attemptId);
    if (identity === undefined) return undefined;
    const table = identity.mode === "MANUAL" ? "qa_manual_attempts" : "qa_automation_attempts";
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `SELECT * FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    const row = found[0];
    return row === undefined
      ? undefined
      : Object.freeze({ identity, detail: Object.freeze({ ...row }) });
  }

  async launchRequest(
    scope: QaScope,
    launchRequestId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    return await this.#one(
      scope,
      "qa_automation_launch_requests",
      "launch_request_id",
      launchRequestId,
    );
  }

  async statusHistory(
    scope: QaScope,
    attemptId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_attempt_status_revisions
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3 ORDER BY revision_no`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({
          ...row,
          content: json(row.content),
          external_job_ids: json(row.external_job_ids),
        }),
      ),
    );
  }

  async #launchSubject(
    executor: QaQueryExecutor,
    scope: QaScope,
    sessionId: string,
    lock: boolean,
  ): Promise<QaAutomationLaunchSubject> {
    const found = rows<Record<string, unknown>>(
      await executor.query(
        `
SELECT session.workspace_id,session.project_id,session.work_item_id,session.session_id,session.state AS session_state,
       session.resource_version,session.target_snapshot,session.target_hash,session.scope_hash,
       session.automation_suite_binding_id,session.automation_suite_binding_version,
       session.automation_suite_binding_content_hash,session.automation_configuration_pin_set_hash,
       session.automation_parameter_set_hash,session.content AS session_content,
       item.plan_item_id,item.state AS plan_item_state,suite.state AS suite_state
FROM qa_test_sessions session
JOIN qa_plan_items item ON item.session_id=session.session_id
  AND item.workspace_id=session.workspace_id AND item.project_id=session.project_id
JOIN qa_automation_suite_binding_versions suite
  ON suite.suite_binding_id=session.automation_suite_binding_id
  AND suite.version=session.automation_suite_binding_version
  AND suite.content_hash=session.automation_suite_binding_content_hash
WHERE session.workspace_id=$1 AND session.project_id=$2 AND session.session_id=$3 AND session.mode='AUTOMATED'
${lock ? "FOR UPDATE OF session,item" : ""}`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    if (found.length !== 1)
      throw new QaDomainError(
        found.length === 0
          ? "QA_AUTOMATED_SESSION_NOT_FOUND"
          : "QA_AUTOMATED_SESSION_PLAN_ITEM_INVALID",
      );
    const row = found[0]!;
    if (String(row.suite_state) !== "PUBLISHED")
      throw new QaDomainError("QA_AUTOMATION_SUITE_REVOKED");
    const targetSnapshot = json<QaAutomatedTargetSnapshot>(row.target_snapshot);
    const sessionContent = json<Readonly<{ targetSnapshotRef?: string }>>(row.session_content);
    return Object.freeze({
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      workItemId: String(row.work_item_id),
      testSessionId: String(row.session_id),
      planItemId: String(row.plan_item_id),
      sessionState: String(row.session_state) as QaAutomationLaunchSubject["sessionState"],
      planItemState: String(row.plan_item_state),
      sessionResourceVersion: Number(row.resource_version),
      targetSnapshotRef: sessionContent.targetSnapshotRef ?? `qa-target-snapshot:${sessionId}:v1`,
      targetSnapshotHash: String(row.target_hash) as QaContentHash,
      scopeSnapshotHash: String(row.scope_hash) as QaContentHash,
      suiteBindingRef: Object.freeze({
        id: String(row.automation_suite_binding_id),
        version: Number(row.automation_suite_binding_version),
        contentHash: String(row.automation_suite_binding_content_hash) as QaContentHash,
      }),
      parameterSetHash: String(row.automation_parameter_set_hash) as QaContentHash,
      configurationPinSetHash: String(row.automation_configuration_pin_set_hash) as QaContentHash,
      targetSnapshot,
    });
  }

  async #insertLaunchRequest(
    manager: EntityManager,
    launch: QaAcceptedAutomationLaunchRequest,
  ): Promise<void> {
    await manager.query(
      `
INSERT INTO qa_automation_launch_requests(
  launch_request_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,request_key_hash,request_hash,
  confirmation_hash,confirmed_session_resource_version,confirmed_at,origin,decision,attempt_id,connector_command_id,
  effect_idempotency_key,rejection_reason_code,initiator_kind,initiator_principal_id,causal_human_principal_id,
  authorization_basis_hash,correlation_id,causation_id,created_at,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACCEPTED',$13,$14,$15,NULL,'HUMAN',$16,$17,$18,$19,$20,$21,$22)`,
      [
        launch.launchRequestId,
        launch.workspaceId,
        launch.projectId,
        launch.workItemId,
        launch.testSessionId,
        launch.planItemId,
        launch.requestKeyHash,
        launch.requestHash,
        launch.confirmationHash,
        launch.confirmedSessionResourceVersion,
        launch.confirmedAt,
        launch.origin,
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
  }

  async insertStatusRevision(
    manager: EntityManager,
    status: QaAutomationAttemptStatusRevision,
  ): Promise<void> {
    await manager.query(
      `
INSERT INTO qa_automation_attempt_status_revisions(
  status_revision_id,workspace_id,project_id,attempt_id,revision_no,previous_revision_id,previous_state_hash,
  state,external_authority_hash,external_pipeline_id,external_job_ids,provider_status,provider_revision_token,
  provider_updated_at,source_kind,source_receipt_ref,source_receipt_hash,result_id,result_content_hash,
  observed_at,recorded_at,content,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        status.statusRevisionId,
        status.workspaceId,
        status.projectId,
        status.automationAttemptId,
        status.revisionNo,
        status.previousRevisionId ?? null,
        status.previousStateHash ?? null,
        status.status,
        status.externalAuthorityHash,
        status.externalPipelineId ?? null,
        JSON.stringify(status.externalJobIds),
        status.providerStatus,
        status.providerRevisionToken,
        status.providerUpdatedAt ?? null,
        status.source,
        status.sourceReceiptRef,
        status.sourceReceiptHash,
        status.terminalResultId ?? null,
        status.terminalResultHash ?? null,
        status.observedAt,
        status.recordedAt,
        JSON.stringify(status),
        status.observationHash,
      ],
    );
  }

  #automationAttempt(row: Record<string, unknown>): QaAutomationAttemptRecord {
    const target = json<QaAutomatedTargetSnapshot>(row.target_snapshot);
    const resultSchemaRef = json<Readonly<{ id: string; version: number; digest?: QaContentHash }>>(
      row.result_schema_ref,
    );
    return Object.freeze({
      schemaVersion: "automation-attempt@1.0.0",
      automationAttemptId: String(row.attempt_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      workItemId: String(row.work_item_id),
      testSessionId: String(row.session_id),
      planItemId: String(row.plan_item_id),
      attemptNo: Number(row.attempt_no),
      reason: String(row.lineage_kind) as QaAutomationAttemptRecord["reason"],
      rootAttemptId: String(row.root_attempt_id),
      ...(row.predecessor_attempt_id === null || row.predecessor_attempt_id === undefined
        ? {}
        : { predecessorAttemptId: String(row.predecessor_attempt_id) }),
      launchRequestId: String(row.launch_request_id),
      requestKeyHash: String(row.request_key_hash) as QaContentHash,
      requestHash: String(row.request_hash) as QaContentHash,
      targetSnapshotRef: String(row.target_snapshot_ref),
      targetSnapshotHash: String(row.target_snapshot_hash) as QaContentHash,
      scopeSnapshotHash: String(row.scope_snapshot_hash) as QaContentHash,
      suiteBindingRef: Object.freeze({
        id: String(row.suite_binding_id),
        version: Number(row.suite_binding_version),
      }),
      suiteBindingHash: String(row.suite_binding_content_hash) as QaContentHash,
      parameterSetHash: String(row.parameter_set_hash) as QaContentHash,
      configurationPins: Object.freeze([...target.configurationPins]),
      configurationPinSetHash: String(row.configuration_pin_set_hash) as QaContentHash,
      resultSchemaRef: Object.freeze({
        id: resultSchemaRef.id,
        version: resultSchemaRef.version,
        digest: (resultSchemaRef.digest ?? String(row.result_schema_digest)) as QaContentHash,
      }),
      artifactPolicyRef: String(row.artifact_policy_ref),
      artifactPolicyHash: String(row.artifact_policy_content_hash) as QaContentHash,
      retryPolicyRef: String(row.retry_policy_ref),
      retryPolicyHash: String(row.retry_policy_content_hash) as QaContentHash,
      quarantinePolicyRef: String(row.quarantine_policy_ref),
      quarantinePolicyHash: String(row.quarantine_policy_content_hash) as QaContentHash,
      connectorCommandId: String(row.connector_command_id),
      effectKeyHash: qaAggregateSnapshotHash(String(row.effect_idempotency_key) as never),
      initiatingHumanId: String(row.initiating_human_principal_id),
      executingServiceId: String(row.executing_service_principal_id),
      authorizationBasisHash: String(row.authorization_basis_hash) as QaContentHash,
      currentStatusRevisionId: String(row.current_status_revision_id),
      currentStatusRevisionNo: Number(row.current_status_revision_no),
      currentStatus: String(row.current_status) as QaAutomationAttemptRecord["currentStatus"],
      ...(row.terminal_result_id === null || row.terminal_result_id === undefined
        ? {}
        : { terminalResultId: String(row.terminal_result_id) }),
      resourceVersion: Number(row.resource_version),
      createdAt: new Date(String(row.created_at)).toISOString(),
      correlationId: String(row.correlation_id),
      causationId: String(row.causation_id),
      identityContentHash: String(row.identity_content_hash) as QaContentHash,
    });
  }

  #automationStatus(row: Record<string, unknown>): QaAutomationAttemptStatusRevision {
    return Object.freeze({
      schemaVersion: "automation-attempt-status-revision@1.0.0",
      statusRevisionId: String(row.status_revision_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      automationAttemptId: String(row.attempt_id),
      revisionNo: Number(row.revision_no),
      ...(row.previous_revision_id === null || row.previous_revision_id === undefined
        ? {}
        : { previousRevisionId: String(row.previous_revision_id) }),
      ...(row.previous_state_hash === null || row.previous_state_hash === undefined
        ? {}
        : { previousStateHash: String(row.previous_state_hash) as QaContentHash }),
      status: String(row.state) as QaAutomationAttemptStatusRevision["status"],
      externalAuthorityHash: String(row.external_authority_hash) as QaContentHash,
      ...(row.external_pipeline_id === null || row.external_pipeline_id === undefined
        ? {}
        : { externalPipelineId: String(row.external_pipeline_id) }),
      externalJobIds: Object.freeze([...json<readonly string[]>(row.external_job_ids)]),
      providerStatus: String(
        row.provider_status,
      ) as QaAutomationAttemptStatusRevision["providerStatus"],
      providerRevisionToken: String(row.provider_revision_token),
      ...(row.provider_updated_at === null || row.provider_updated_at === undefined
        ? {}
        : { providerUpdatedAt: new Date(String(row.provider_updated_at)).toISOString() }),
      source: String(row.source_kind) as QaAutomationAttemptStatusRevision["source"],
      sourceReceiptRef: String(row.source_receipt_ref),
      sourceReceiptHash: String(row.source_receipt_hash) as QaContentHash,
      ...(row.result_id === null || row.result_id === undefined
        ? {}
        : { terminalResultId: String(row.result_id) }),
      ...(row.result_content_hash === null || row.result_content_hash === undefined
        ? {}
        : { terminalResultHash: String(row.result_content_hash) as QaContentHash }),
      observedAt: new Date(String(row.observed_at)).toISOString(),
      recordedAt: new Date(String(row.recorded_at)).toISOString(),
      observationHash: String(row.content_hash) as QaContentHash,
    });
  }

  async terminalResult(
    scope: QaScope,
    attemptId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_attempt_results
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    const row = found[0];
    return row === undefined
      ? undefined
      : Object.freeze({
          ...row,
          content: json(row.content),
          external_job_ids: json(row.external_job_ids),
          result_schema_ref: json(row.result_schema_ref),
          normalization_report: json(row.normalization_report),
          suite_ref: json(row.suite_ref),
        });
  }

  async retryDecision(
    scope: QaScope,
    attemptId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_retry_decisions
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return found[0] === undefined ? undefined : Object.freeze({ ...found[0] });
  }

  async artifactMemberships(
    scope: QaScope,
    attemptId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_artifact_memberships
WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3 ORDER BY ordinal`,
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({ ...row, source_profile_ref: json(row.source_profile_ref) }),
      ),
    );
  }

  async reviewFreeze(
    scope: QaScope,
    sessionId: string,
    planItemId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM qa_automation_review_freezes
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4`,
        [scope.workspaceId, scope.projectId, sessionId, planItemId],
      ),
    );
    return found[0] === undefined ? undefined : Object.freeze({ ...found[0] });
  }

  async #one(
    scope: QaScope,
    table: "qa_automation_launch_requests",
    idColumn: "launch_request_id",
    id: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `SELECT * FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND ${idColumn}=$3`,
        [scope.workspaceId, scope.projectId, id],
      ),
    );
    return found[0] === undefined ? undefined : Object.freeze({ ...found[0] });
  }

  #identity(row: Record<string, unknown>): QaAttemptIdentityRecord {
    return Object.freeze({
      id: String(row.id),
      workItemId: String(row.workItemId),
      sessionId: String(row.sessionId),
      planItemId: String(row.planItemId),
      mode: String(row.mode) as QaAttemptMode,
      attemptNo: Number(row.attemptNo),
      targetSnapshotHash: String(row.targetSnapshotHash) as QaContentHash,
      scopeSnapshotHash: String(row.scopeSnapshotHash) as QaContentHash,
      triggerKind: String(row.triggerKind) as QaAttemptTriggerKind,
      initiatorKind: String(row.initiatorKind) as "HUMAN" | "SERVICE",
      initiatorPrincipalId: String(row.initiatorPrincipalId),
      authorizationBasisHash: String(row.authorizationBasisHash) as QaContentHash,
      correlationId: String(row.correlationId),
      causationId: String(row.causationId),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      identityContentHash: String(row.identityContentHash) as QaContentHash,
    });
  }
}

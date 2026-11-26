import type { DataSource } from "typeorm";

import {
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptResult,
  type QaAutomationAttemptStatusRevision,
  type QaAutomationRetryDecision,
  type QaScope,
  TypeOrmAutomationExecutionRepository,
} from "@awp/competency-qa/node";

import {
  type GitLabAutomationLaunchInput,
  type GitLabAutomationLaunchServiceOptions,
  TypeOrmGitLabAutomationLaunchService,
} from "./automation-launch-service.ts";
import {
  type QaAutomationAttemptOperationalProjection,
  TypeOrmGitLabOperationalHealth,
} from "./operational-health.ts";

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export interface QaAutomationAttemptExecutionProjection {
  readonly state: "QUEUED" | "DISPATCHED" | "CONFIRMED" | "AMBIGUOUS" | "FAILED";
  readonly reasonCode?: string;
}

export interface QaAutomationAttemptProjection {
  readonly automationAttemptId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly reason: QaAutomationAttemptRecord["reason"];
  readonly rootAttemptId: string;
  readonly predecessorAttemptId?: string;
  readonly currentStatus: QaAutomationAttemptRecord["currentStatus"];
  readonly currentStatusRevisionNo: number;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly execution: QaAutomationAttemptExecutionProjection;
}

export interface QaAutomationArtifactDescriptorProjection {
  readonly schemaVersion: "automation-artifact-descriptor@1.0.0";
  readonly artifactReferenceId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly automationAttemptId: string;
  readonly automationAttemptResultId: string;
  readonly ordinal: number;
  readonly externalAuthorityHash: string;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly logicalPath: string;
  readonly externalDescriptorHash: string;
  readonly artifactKind: "RESULT" | "REPORT" | "LOG" | "SCREENSHOT" | "TRACE" | "OTHER";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly checksumSource: "MACHINE_RESULT_MANIFEST" | "CONNECTOR_CONTENT_SHA256";
  readonly classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly sourceProfileRef: Readonly<{ id: string; version: number }>;
  readonly sourceProfileHash: string;
  readonly retentionPolicyRef: string;
  readonly availabilityAtResult: "AVAILABLE" | "MISSING" | "EXPIRED" | "CHECKSUM_MISMATCH";
  readonly opaqueLocatorHash: string;
  readonly expiresAt: string;
  readonly registeredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly descriptorContentHash: string;
}

export interface QaAutomationAttemptConfigurationPinProjection {
  readonly logicalRole: "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE";
  readonly capabilityKey:
    "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read";
  readonly exactContractVersion: "1.0.0";
  readonly operations: readonly (
    | "merge-request.read"
    | "commit.read"
    | "build.read"
    | "pipeline.trigger"
    | "pipeline.read"
    | "pipeline.lookup"
    | "artifact.metadata"
    | "artifact.stream"
  )[];
  readonly operationSetHash: string;
  readonly projectIntegrationBindingRef: Readonly<{ id: string; version: number }>;
  readonly projectIntegrationBindingHash: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly profileHash: string;
  readonly connectionRef: Readonly<{ id: string; version: number }>;
  readonly connectionHash: string;
  readonly validationReportId: string;
  readonly validationEvidenceHash: string;
}

export type QaAutomationAttemptDetailProjection = Omit<
  QaAutomationAttemptRecord,
  "configurationPins"
> &
  Readonly<{
    configurationPins: readonly QaAutomationAttemptConfigurationPinProjection[];
  }>;

export type GitLabAutomationAttemptQueryOptions = GitLabAutomationLaunchServiceOptions;

export class TypeOrmGitLabAutomationAttemptQuery {
  readonly #attempts: TypeOrmAutomationExecutionRepository;
  readonly #launches: TypeOrmGitLabAutomationLaunchService | undefined;
  readonly #health: TypeOrmGitLabOperationalHealth;

  constructor(
    private readonly source: DataSource,
    options?: GitLabAutomationAttemptQueryOptions,
  ) {
    this.#attempts = new TypeOrmAutomationExecutionRepository(source);
    this.#launches = options
      ? new TypeOrmGitLabAutomationLaunchService(source, options)
      : undefined;
    this.#health = new TypeOrmGitLabOperationalHealth(source);
  }

  async launchConfirmation(scope: QaScope, sessionId: string) {
    if (!this.#launches) throw new Error("GITLAB_AUTOMATION_LAUNCH_NOT_CONFIGURED");
    const confirmation = await this.#launches.currentConfirmation(scope, sessionId);
    return Object.freeze({
      confirmation,
      sessionResourceVersion: confirmation.sessionResourceVersion,
    });
  }

  async launch(
    input: GitLabAutomationLaunchInput,
  ): Promise<Readonly<{ created: boolean; attempt: QaAutomationAttemptProjection }>> {
    if (!this.#launches) throw new Error("GITLAB_AUTOMATION_LAUNCH_NOT_CONFIGURED");
    const result = await this.#launches.launch(input);
    return Object.freeze({
      created: !result.replayed,
      attempt: await this.#project(result.attempt),
    });
  }

  async list(scope: QaScope, sessionId: string): Promise<readonly QaAutomationAttemptProjection[]> {
    const attempts = await this.#attempts.automationAttempts(scope, sessionId);
    return Object.freeze(
      await Promise.all(attempts.map(async (attempt) => await this.#project(attempt))),
    );
  }

  async operationalHealth(
    scope: QaScope,
    sessionId: string,
  ): Promise<QaAutomationAttemptOperationalProjection | undefined> {
    if ((await this.sessionResourceVersion(scope, sessionId)) === undefined) return undefined;
    const attempts = await this.#attempts.automationAttempts(scope, sessionId);
    const latest = [...attempts].sort((left, right) => right.attemptNo - left.attemptNo)[0];
    if (latest === undefined) {
      const health = await this.#health.current(scope);
      return Object.freeze({ ...health, executionActivity: "IDLE" });
    }
    return await this.#health.attempt(scope, latest.automationAttemptId);
  }

  async attemptOperationalHealth(
    scope: QaScope,
    sessionId: string,
    attemptId: string,
  ): Promise<QaAutomationAttemptOperationalProjection | undefined> {
    const attempt = await this.#attempts.automationAttempt(scope, attemptId);
    if (!attempt || attempt.testSessionId !== sessionId) return undefined;
    return await this.#health.attempt(scope, attemptId);
  }

  async detail(
    scope: QaScope,
    sessionId: string,
    attemptId: string,
  ): Promise<QaAutomationAttemptDetailProjection | undefined> {
    const attempt = await this.#attempts.automationAttempt(scope, attemptId);
    if (!attempt || attempt.testSessionId !== sessionId) return undefined;
    return Object.freeze({
      ...attempt,
      configurationPins: Object.freeze(
        attempt.configurationPins.map((pin) =>
          Object.freeze({
            logicalRole: pin.logicalRole,
            capabilityKey: pin.capabilityKey,
            exactContractVersion: pin.exactContractVersion,
            operations:
              pin.logicalRole === "SOURCE_CONTEXT"
                ? Object.freeze(["merge-request.read", "commit.read", "build.read"] as const)
                : pin.logicalRole === "TEST_EXECUTION"
                  ? Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"] as const)
                  : Object.freeze(["artifact.metadata", "artifact.stream"] as const),
            operationSetHash: pin.operationSetHash,
            projectIntegrationBindingRef: Object.freeze({
              id: pin.projectIntegrationBindingRef.id,
              version: pin.projectIntegrationBindingRef.version,
            }),
            projectIntegrationBindingHash: pin.projectIntegrationBindingRef.contentHash,
            profileRef: Object.freeze({ id: pin.profileRef.id, version: pin.profileRef.version }),
            profileHash: pin.profileRef.contentHash,
            connectionRef: Object.freeze({
              id: pin.connectionRef.id,
              version: pin.connectionRef.version,
            }),
            connectionHash: pin.connectionRef.contentHash,
            validationReportId: pin.validationReportRef.id,
            validationEvidenceHash: pin.validationReportRef.contentHash,
          }),
        ),
      ),
    });
  }

  async statusHistory(
    scope: QaScope,
    sessionId: string,
    attemptId: string,
  ): Promise<readonly QaAutomationAttemptStatusRevision[] | undefined> {
    const attempt = await this.#attempts.automationAttempt(scope, attemptId);
    if (!attempt || attempt.testSessionId !== sessionId) return undefined;
    return await this.#attempts.automationStatusHistory(scope, attemptId);
  }

  async result(
    scope: QaScope,
    sessionId: string,
    attemptId: string,
  ): Promise<QaAutomationAttemptResult | undefined> {
    const attempt = await this.#attempts.automationAttempt(scope, attemptId);
    if (!attempt || attempt.testSessionId !== sessionId) return undefined;
    const row = await this.#attempts.terminalResult(scope, attemptId);
    return row === undefined
      ? undefined
      : Object.freeze(structuredClone(row.content as QaAutomationAttemptResult));
  }

  async retryDecision(
    scope: QaScope,
    sessionId: string,
    attemptId: string,
  ): Promise<QaAutomationRetryDecision | undefined> {
    const attempt = await this.#attempts.automationAttempt(scope, attemptId);
    if (!attempt || attempt.testSessionId !== sessionId) return undefined;
    const row = await this.#attempts.retryDecision(scope, attemptId);
    if (row === undefined) return undefined;
    return Object.freeze({
      schemaVersion: "automation-retry-decision@1.0.0",
      retryDecisionId: String(row.retry_decision_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      automationAttemptId: String(row.attempt_id),
      automationAttemptResultId: String(row.attempt_result_id),
      decision: String(row.decision) as QaAutomationRetryDecision["decision"],
      policyRef: String(row.retry_policy_ref),
      policyHash: String(row.retry_policy_content_hash) as QaAutomationRetryDecision["policyHash"],
      automaticRetryBudget: 1,
      ...(row.infrastructure_code === null || row.infrastructure_code === undefined
        ? {}
        : { infrastructureCode: String(row.infrastructure_code) }),
      reasonCode: String(row.reason_code) as QaAutomationRetryDecision["reasonCode"],
      ...(row.automatic_retry_ordinal === null || row.automatic_retry_ordinal === undefined
        ? {}
        : { automaticRetryOrdinal: 1 as const }),
      ...(row.successor_attempt_id === null || row.successor_attempt_id === undefined
        ? {}
        : { successorAttemptId: String(row.successor_attempt_id) }),
      ...(row.successor_launch_request_id === null || row.successor_launch_request_id === undefined
        ? {}
        : { successorLaunchRequestId: String(row.successor_launch_request_id) }),
      authorizationRecheckHash: String(
        row.authorization_recheck_hash,
      ) as QaAutomationRetryDecision["authorizationRecheckHash"],
      decidedByKind: "SERVICE",
      decidedById: String(row.decided_by_principal_id),
      decidedAt: new Date(String(row.decided_at)).toISOString(),
      correlationId: String(row.correlation_id),
      causationId: String(row.causation_id),
      contentHash: String(row.content_hash) as QaAutomationRetryDecision["contentHash"],
    });
  }

  async sessionArtifacts(
    scope: QaScope,
    sessionId: string,
    classificationCeiling: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED",
  ): Promise<readonly QaAutomationArtifactDescriptorProjection[] | undefined> {
    if ((await this.sessionResourceVersion(scope, sessionId)) === undefined) return undefined;
    const rows = (await this.source.query(
      `
SELECT membership.*
FROM qa_automation_artifact_memberships membership
JOIN qa_automation_attempts attempt
  ON attempt.workspace_id=membership.workspace_id AND attempt.project_id=membership.project_id
 AND attempt.attempt_id=membership.attempt_id AND attempt.session_id=membership.session_id
JOIN artifact_references artifact
  ON artifact.workspace_id=membership.workspace_id AND artifact.project_id=membership.project_id
 AND artifact.id=membership.artifact_reference_id
 AND artifact.owner_entity_type='AUTOMATION_ATTEMPT' AND artifact.owner_entity_id::text=membership.attempt_id
JOIN classification_catalog classification ON classification.key=membership.classification_key
JOIN classification_catalog ceiling ON ceiling.key=$4
WHERE membership.workspace_id=$1 AND membership.project_id=$2 AND membership.session_id=$3
  AND classification.rank<=ceiling.rank
ORDER BY attempt.attempt_no,membership.ordinal`,
      [scope.workspaceId, scope.projectId, sessionId, classificationCeiling],
    )) as readonly Readonly<Record<string, unknown>>[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          schemaVersion: "automation-artifact-descriptor@1.0.0" as const,
          artifactReferenceId: String(row.artifact_reference_id),
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          testSessionId: String(row.session_id),
          automationAttemptId: String(row.attempt_id),
          automationAttemptResultId: String(row.result_id),
          ordinal: Number(row.ordinal),
          externalAuthorityHash: String(row.external_authority_hash),
          externalPipelineId: String(row.external_pipeline_id),
          externalJobId: String(row.external_job_id),
          logicalPath: String(row.logical_path),
          externalDescriptorHash: String(row.external_descriptor_hash),
          artifactKind: String(
            row.artifact_kind,
          ) as QaAutomationArtifactDescriptorProjection["artifactKind"],
          mediaType: String(row.media_type),
          byteSize: Number(row.size_bytes),
          checksum: String(row.checksum),
          checksumSource: String(
            row.checksum_source,
          ) as QaAutomationArtifactDescriptorProjection["checksumSource"],
          classification: String(
            row.classification_key,
          ) as QaAutomationArtifactDescriptorProjection["classification"],
          sourceProfileRef: Object.freeze(
            json<{ id: string; version: number }>(row.source_profile_ref),
          ),
          sourceProfileHash: String(row.source_profile_content_hash),
          retentionPolicyRef: String(row.retention_policy_ref),
          availabilityAtResult: String(
            row.availability_at_result,
          ) as QaAutomationArtifactDescriptorProjection["availabilityAtResult"],
          opaqueLocatorHash: String(row.opaque_locator_hash),
          expiresAt: new Date(String(row.expires_at)).toISOString(),
          registeredAt: new Date(String(row.registered_at)).toISOString(),
          correlationId: String(row.correlation_id),
          causationId: String(row.causation_id),
          descriptorContentHash: String(row.content_hash),
        }),
      ),
    );
  }

  async sessionResourceVersion(scope: QaScope, sessionId: string): Promise<number | undefined> {
    const rows = (await this.source.query(
      "SELECT resource_version FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='AUTOMATED'",
      [scope.workspaceId, scope.projectId, sessionId],
    )) as readonly Readonly<{ resource_version: number | string }>[];
    return rows[0] === undefined ? undefined : Number(rows[0].resource_version);
  }

  async #project(attempt: QaAutomationAttemptRecord): Promise<QaAutomationAttemptProjection> {
    const rows = (await this.source.query(
      `
SELECT command.state AS command_state,command.result,effect.state AS effect_state
FROM connector_commands command
LEFT JOIN gitlab_effect_reconciliations effect ON effect.workspace_id=command.workspace_id AND effect.command_id=command.id
WHERE command.workspace_id=$1 AND command.project_id=$2 AND command.id=$3`,
      [attempt.workspaceId, attempt.projectId, attempt.connectorCommandId],
    )) as readonly Readonly<Record<string, unknown>>[];
    const row = rows[0];
    if (!row) throw new Error("QA_AUTOMATION_ATTEMPT_COMMAND_NOT_FOUND");
    const effectState =
      row.effect_state === null || row.effect_state === undefined
        ? undefined
        : String(row.effect_state);
    const commandState = String(row.command_state);
    const executionState: QaAutomationAttemptExecutionProjection["state"] =
      effectState === "AMBIGUOUS"
        ? "AMBIGUOUS"
        : commandState === "CONFIRMED"
          ? "CONFIRMED"
          : commandState === "DISPATCHED"
            ? "DISPATCHED"
            : commandState === "FAILED"
              ? "FAILED"
              : "QUEUED";
    const terminal =
      row.result === null || row.result === undefined
        ? undefined
        : json<Readonly<{ code?: string }>>(row.result);
    return Object.freeze({
      automationAttemptId: attempt.automationAttemptId,
      testSessionId: attempt.testSessionId,
      planItemId: attempt.planItemId,
      attemptNo: attempt.attemptNo,
      reason: attempt.reason,
      rootAttemptId: attempt.rootAttemptId,
      ...(attempt.predecessorAttemptId === undefined
        ? {}
        : { predecessorAttemptId: attempt.predecessorAttemptId }),
      currentStatus: attempt.currentStatus,
      currentStatusRevisionNo: attempt.currentStatusRevisionNo,
      resourceVersion: attempt.resourceVersion,
      createdAt: attempt.createdAt,
      execution: Object.freeze({
        state: executionState,
        ...(terminal?.code === undefined ? {} : { reasonCode: terminal.code }),
      }),
    });
  }
}

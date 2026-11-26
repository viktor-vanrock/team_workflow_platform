import type { DataSource, EntityManager } from "typeorm";

import {
  decideQaAutomationRetry,
  prepareQaAutomationResultSync,
  type QaAuthorizationBasis,
  type QaAutomatedTargetSnapshot,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptResult,
  type QaAutomationResultPersistenceReceipt,
  type QaAutomationResultSyncPreparation,
  type QaAutomationRetryAuthority,
  type QaAutomationRetryCommandAdmission,
  type QaAutomationRetryPersistenceInput,
  type QaAutomationRetryPersistenceReceipt,
  type QaAutomationRetryPolicy,
  type QaDomainEventEnvelope,
  type QaServiceActor,
  type QaWorkspaceContext,
  TypeOrmAutomationExecutionRepository,
  TypeOrmAutomationResultEvidenceUnitOfWork,
} from "@awp/competency-qa/node";
import {
  designContractRegistry,
  type JsonValue,
  type SchemaReference,
  sha256,
} from "@awp/platform-contracts";

import { PostgresCapacityAdmissionBinder } from "../queue/admission-service.ts";
import {
  type GitLabAutomationObservability,
  recordGitLabAutomationPhase,
} from "./observability.ts";

export type GitLabAutomationTerminalFacts = Parameters<typeof prepareQaAutomationResultSync>[0];

export interface GitLabAutomationRetrySnapshot {
  readonly policy: QaAutomationRetryPolicy;
  readonly authority: QaAutomationRetryAuthority;
  readonly executingService: QaServiceActor;
  readonly causalAuthorizationBasis: QaAuthorizationBasis;
  readonly decidedAt: string;
}

export interface GitLabAutomationResultSyncRequest {
  readonly facts: GitLabAutomationTerminalFacts;
  /** Complete immutable lineage ending in facts.attempt. */
  readonly lineage: readonly QaAutomationAttemptRecord[];
  readonly retry: GitLabAutomationRetrySnapshot;
}

export interface GitLabAutomationResultSyncReceipt {
  readonly prepared: QaAutomationResultSyncPreparation;
  readonly result: QaAutomationResultPersistenceReceipt;
  readonly retry: QaAutomationRetryPersistenceReceipt;
}

export interface GitLabAutomationResultPersistence {
  persistTerminalResult(
    prepared: QaAutomationResultSyncPreparation,
  ): Promise<QaAutomationResultPersistenceReceipt>;
  persistRetryEvaluation(
    input: QaAutomationRetryPersistenceInput,
  ): Promise<QaAutomationRetryPersistenceReceipt>;
}

function terminalLineage(
  lineage: readonly QaAutomationAttemptRecord[],
  prepared: QaAutomationResultSyncPreparation,
): readonly QaAutomationAttemptRecord[] {
  const ordered = [...lineage].sort((left, right) => left.attemptNo - right.attemptNo);
  const currentIndex = ordered.findIndex(
    ({ automationAttemptId }) => automationAttemptId === prepared.attempt.automationAttemptId,
  );
  if (
    currentIndex !== ordered.length - 1 ||
    currentIndex < 0 ||
    ordered.some((attempt, index) => attempt.attemptNo !== index + 1)
  )
    throw new Error("GITLAB_RESULT_SYNC_LINEAGE_INVALID");
  ordered[currentIndex] = prepared.attempt;
  return Object.freeze(ordered);
}

function assertSameScope(prepared: QaAutomationResultSyncPreparation): void {
  const { workspaceId, projectId, automationAttemptId } = prepared.attempt;
  if (
    prepared.artifactReferences.some(
      (artifact) =>
        artifact.workspaceId !== workspaceId ||
        artifact.projectId !== projectId ||
        artifact.owner.entityType !== "AUTOMATION_ATTEMPT" ||
        artifact.owner.entityId !== automationAttemptId,
    )
  )
    throw new Error("GITLAB_RESULT_SYNC_ARTIFACT_SCOPE_INVALID");
}

/**
 * Runtime assembly boundary: consumes only provider-neutral normalized facts,
 * delegates canonical preparation to QA, and persists result/retry through the
 * QA-owned transactional unit of work. No GitLab DTO becomes domain truth.
 */
export class GitLabAutomationResultSyncConsumer {
  constructor(
    private readonly persistence: GitLabAutomationResultPersistence,
    private readonly observability?: GitLabAutomationObservability,
    private readonly verifyRecovery?: (
      input: Readonly<{
        attempt: QaAutomationAttemptRecord;
        result: QaAutomationAttemptResult;
        lineage: readonly QaAutomationAttemptRecord[];
        targetSnapshot: QaAutomatedTargetSnapshot;
      }>,
    ) => Promise<boolean>,
  ) {}

  async consume(
    input: GitLabAutomationResultSyncRequest,
  ): Promise<GitLabAutomationResultSyncReceipt> {
    const prepared = prepareQaAutomationResultSync(input.facts);
    assertSameScope(prepared);
    const lineage = terminalLineage(input.lineage, prepared);
    const evaluation = decideQaAutomationRetry({
      attempt: prepared.attempt,
      result: prepared.result,
      lineage,
      policy: input.retry.policy,
      authority: input.retry.authority,
      decidedBy: input.retry.executingService,
      decidedAt: input.retry.decidedAt,
      correlationId: input.facts.context.correlationId,
      causationId: input.facts.context.causationId,
    });
    const result = await this.persistence.persistTerminalResult(prepared);
    const retry = await this.persistence.persistRetryEvaluation({
      context: input.facts.context,
      evaluation,
      predecessor: prepared.attempt,
      previousAttempts: lineage,
      targetSnapshot: input.facts.targetSnapshot,
      executingService: input.retry.executingService,
      causalAuthorizationBasis: input.retry.causalAuthorizationBasis,
    });
    recordGitLabAutomationPhase(this.observability, {
      phase: "RESULT",
      outcome: "COMPLETED",
      correlationId: input.facts.context.correlationId,
      causationId: input.facts.context.causationId,
    });
    if (evaluation.decision.decision === "SCHEDULED") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "RETRY",
        outcome: "SCHEDULED",
        reasonCode: "INFRA_RETRY",
        correlationId: input.facts.context.correlationId,
        causationId: input.facts.context.causationId,
      });
    } else if (evaluation.decision.decision === "DENIED") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "POLICY_DENIAL",
        outcome: "DENIED",
        reasonCode: "POLICY_DENIED",
        correlationId: input.facts.context.correlationId,
        causationId: input.facts.context.causationId,
      });
    }
    return Object.freeze({ prepared, result, retry });
  }

  /** Resume after result commit when the process stopped before recording the retry decision. */
  async resumeRetry(
    input: Readonly<{
      context: QaWorkspaceContext;
      attempt: QaAutomationAttemptRecord;
      result: QaAutomationAttemptResult;
      lineage: readonly QaAutomationAttemptRecord[];
      targetSnapshot: QaAutomatedTargetSnapshot;
      retry: GitLabAutomationRetrySnapshot;
    }>,
  ): Promise<QaAutomationRetryPersistenceReceipt> {
    const { context, attempt, result, targetSnapshot, retry } = input;
    const { snapshotHash, ...snapshotBody } = targetSnapshot;
    const { contentHash, ...resultBody } = result;
    const ordered = [...input.lineage].sort((left, right) => left.attemptNo - right.attemptNo);
    if (
      context.scope.kind !== "PROJECT" ||
      context.scope.workspaceId !== attempt.workspaceId ||
      context.scope.projectId !== attempt.projectId ||
      context.actor.kind !== "SERVICE" ||
      context.actor.principalId !== attempt.executingServiceId ||
      retry.executingService.principalId !== attempt.executingServiceId ||
      attempt.currentStatus !== "TERMINAL" ||
      attempt.terminalResultId !== result.automationAttemptResultId ||
      result.workspaceId !== attempt.workspaceId ||
      result.projectId !== attempt.projectId ||
      result.automationAttemptId !== attempt.automationAttemptId ||
      targetSnapshot.snapshotHash !== attempt.targetSnapshotHash ||
      targetSnapshot.testSessionId !== attempt.testSessionId ||
      sha256(snapshotBody as unknown as JsonValue) !== snapshotHash ||
      sha256(resultBody as unknown as JsonValue) !== contentHash ||
      ordered.at(-1)?.automationAttemptId !== attempt.automationAttemptId ||
      ordered.some(
        (item, index) =>
          item.attemptNo !== index + 1 ||
          item.workspaceId !== attempt.workspaceId ||
          item.projectId !== attempt.projectId ||
          item.testSessionId !== attempt.testSessionId ||
          item.planItemId !== attempt.planItemId,
      )
    )
      throw new Error("GITLAB_RESULT_RETRY_RECOVERY_INVALID");
    if (
      !this.verifyRecovery ||
      !(await this.verifyRecovery({ attempt, result, lineage: ordered, targetSnapshot }))
    )
      throw new Error("GITLAB_RESULT_RETRY_RECOVERY_STALE");
    const evaluation = decideQaAutomationRetry({
      attempt,
      result,
      lineage: ordered,
      policy: retry.policy,
      authority: retry.authority,
      decidedBy: retry.executingService,
      decidedAt: retry.decidedAt,
      correlationId: context.correlationId,
      causationId: context.causationId,
    });
    return await this.persistence.persistRetryEvaluation({
      context,
      evaluation,
      predecessor: attempt,
      previousAttempts: ordered,
      targetSnapshot,
      executingService: retry.executingService,
      causalAuthorizationBasis: retry.causalAuthorizationBasis,
    });
  }
}

/** The result service must still be the executor recorded on this exact attempt. */
export async function authorizeGitLabResultExecutor(
  manager: EntityManager,
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    attemptId: string;
    principalId: string;
  }>,
): Promise<boolean> {
  return (
    queryRows(
      await manager.query(
        `SELECT 1 FROM qa_automation_attempts attempt
       WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.attempt_id=$3
         AND attempt.executing_service_principal_id=$4`,
        [input.workspaceId, input.projectId, input.attemptId, input.principalId],
      ),
    ).length === 1
  );
}

export function createTypeOrmGitLabAutomationResultSyncConsumer(
  source: DataSource,
  observability?: GitLabAutomationObservability,
  retryAdmission?: QaAutomationRetryCommandAdmission,
): GitLabAutomationResultSyncConsumer {
  const persistence = new TypeOrmAutomationResultEvidenceUnitOfWork(
    source,
    {
      apply: async (manager, { prepared, currentAttempt }) => {
        const capacityRows = queryRows<Readonly<Record<string, unknown>>>(
          await manager.query(
            "SELECT capacity_head_id FROM workspace_capacity_heads WHERE workspace_id=$1",
            [currentAttempt.workspaceId],
          ),
        );
        if (!capacityRows[0]) return;
        const projection = queryRows<Readonly<Record<string, unknown>>>(
          await manager.query(
            `SELECT revision.control_facet,revision.operational_facet,revision.qa_facet,revision.policy_facet_ref,revision.source_set_hash
           FROM queue_entry_heads head
           JOIN queue_entry_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.queue_entry_revision_id=head.current_revision_id
          WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 AND head.suppressed_by_work_item_id IS NULL`,
            [currentAttempt.workspaceId, currentAttempt.projectId, currentAttempt.workItemId],
          ),
        )[0];
        // Result evidence is authoritative. A missing/rebuilding queue projection
        // is repaired by reconciliation and must never hold the terminal result.
        if (!projection) return;
        const control = json<Readonly<Record<string, JsonValue>>>(projection.control_facet);
        const operational = json<Readonly<Record<string, JsonValue>>>(projection.operational_facet);
        const qa = json<Readonly<Record<string, JsonValue>>>(projection.qa_facet);
        const policyFacetRef = json<
          Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>
        >(projection.policy_facet_ref);
        if (operational.state !== "KNOWN" || !operational.projectionRef) return;
        const session = queryRows<Readonly<Record<string, unknown>>>(
          await manager.query(
            "SELECT resource_version,content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
            [currentAttempt.workspaceId, currentAttempt.projectId, currentAttempt.testSessionId],
          ),
        )[0];
        if (!session) return;
        const sessionContent = json<Readonly<Record<string, JsonValue>>>(session.content);
        const committedContent = prepared.session.changed
          ? Object.freeze({
              ...sessionContent,
              state: "REVIEW_REQUIRED",
              resourceVersion: prepared.session.resourceVersion,
            })
          : sessionContent;
        const authorizationScopeWitnessHash = sha256({
          workspaceId: currentAttempt.workspaceId,
          projectId: currentAttempt.projectId,
          requiredPermission: "qa.automation.result.apply",
          classificationDecision: "AUTHORIZED_SERVICE_ATTEMPT",
        } as JsonValue);
        const binder = new PostgresCapacityAdmissionBinder(source, {
          reauthorize: async (transaction, input) =>
            await authorizeGitLabResultExecutor(transaction, {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              attemptId: currentAttempt.automationAttemptId,
              principalId: input.principalId,
            }),
        });
        await binder.admitInTransaction(manager, {
          workspaceId: currentAttempt.workspaceId,
          projectId: currentAttempt.projectId,
          workItemId: currentAttempt.workItemId,
          sessionId: currentAttempt.testSessionId,
          principalId: currentAttempt.executingServiceId,
          requestKey: `automation-result:${prepared.result.automationAttemptResultId}`,
          activityKind: "AUTOMATED_RESULT_APPLY",
          automatedResultPath: "CONVERT_RESERVATION_TO_REVIEW_CLAIM",
          actor: Object.freeze({
            kind: "SERVICE" as const,
            serviceId: currentAttempt.executingServiceId,
          }),
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
              sourceId: currentAttempt.testSessionId,
              sourceVersion: Number(session.resource_version),
              semanticHash: sha256(sessionContent as JsonValue),
            }),
          }),
          committedSessionRef: Object.freeze({
            sourceType: "QA_TEST_SESSION_REVISION",
            sourceId: currentAttempt.testSessionId,
            sourceVersion: prepared.session.resourceVersion,
            semanticHash: sha256(committedContent as JsonValue),
          }),
          authorizedScopeSnapshotRef: Object.freeze({
            id: currentAttempt.automationAttemptId,
            version: prepared.attempt.resourceVersion,
            semanticHash: authorizationScopeWitnessHash,
          }),
          decidedAt: prepared.result.recordedAt,
          correlationId: currentAttempt.correlationId,
          causationId: prepared.result.automationAttemptResultId,
        });
      },
    },
    retryAdmission,
  );
  const attempts = new TypeOrmAutomationExecutionRepository(source);
  const digest = (value: unknown) => sha256(JSON.parse(JSON.stringify(value)) as JsonValue);
  return new GitLabAutomationResultSyncConsumer(persistence, observability, async (input) => {
    const scope = { workspaceId: input.attempt.workspaceId, projectId: input.attempt.projectId };
    const [storedAttempt, storedResult, sessionAttempts, sessions] = await Promise.all([
      attempts.automationAttempt(scope, input.attempt.automationAttemptId),
      attempts.terminalResult(scope, input.attempt.automationAttemptId),
      attempts.automationAttempts(scope, input.attempt.testSessionId),
      source.query(
        "SELECT target_snapshot FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
        [scope.workspaceId, scope.projectId, input.attempt.testSessionId],
      ) as Promise<readonly { target_snapshot: unknown }[]>,
    ]);
    const storedLineage = sessionAttempts
      .filter(
        (item) =>
          item.planItemId === input.attempt.planItemId &&
          item.rootAttemptId === input.attempt.rootAttemptId &&
          item.attemptNo <= input.attempt.attemptNo,
      )
      .sort((a, b) => a.attemptNo - b.attemptNo);
    return Boolean(
      storedAttempt &&
      storedResult &&
      sessions.length === 1 &&
      digest(storedAttempt) === digest(input.attempt) &&
      digest(storedResult.content) === digest(input.result) &&
      digest(storedLineage) === digest(input.lineage) &&
      digest(json(sessions[0]!.target_snapshot)) === digest(input.targetSnapshot),
    );
  });
}

export const feature005AutomationEventTypes = Object.freeze([
  "qa.automation-attempt.created",
  "qa.automation-attempt.status-observed",
  "qa.automation-attempt.completed",
  "qa.automation-retry.decided",
  "qa.automation-artifact.registered",
  "qa.automation-quarantine.changed",
] as const);

export type Feature005AutomationEventType = (typeof feature005AutomationEventTypes)[number];
export type Feature005AutomationEventEnvelope = QaDomainEventEnvelope<
  Readonly<Record<string, unknown>>
> &
  Readonly<{
    eventType: Feature005AutomationEventType;
  }>;

const feature005PayloadSchemas = Object.freeze({
  "qa.automation-attempt.created": "urn:awp:schemas:005:events:automation-attempt-created:v1",
  "qa.automation-attempt.status-observed":
    "urn:awp:schemas:005:events:automation-attempt-status-observed:v1",
  "qa.automation-attempt.completed": "urn:awp:schemas:005:events:automation-attempt-completed:v1",
  "qa.automation-retry.decided": "urn:awp:schemas:005:events:automation-retry-decided:v1",
  "qa.automation-artifact.registered":
    "urn:awp:schemas:005:events:automation-artifact-registered:v1",
  "qa.automation-quarantine.changed": "urn:awp:schemas:005:events:automation-quarantine-changed:v1",
} satisfies Readonly<Record<Feature005AutomationEventType, string>>);

const feature005EntityTypes = Object.freeze({
  "qa.automation-attempt.created": "automation-attempt",
  "qa.automation-attempt.status-observed": "automation-attempt",
  "qa.automation-attempt.completed": "automation-attempt",
  "qa.automation-retry.decided": "automation-attempt",
  "qa.automation-artifact.registered": "artifact-reference",
  "qa.automation-quarantine.changed": "automation-quarantine",
} satisfies Readonly<Record<Feature005AutomationEventType, string>>);

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function queryRows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function eventType(value: string): value is Feature005AutomationEventType {
  return (feature005AutomationEventTypes as readonly string[]).includes(value);
}

function assertFeature005Envelope(
  row: Readonly<{
    id: string;
    workspace_id: string;
    project_id: string;
    event_type: string;
    envelope: unknown;
    envelope_hash: string;
  }>,
): Feature005AutomationEventEnvelope {
  if (!eventType(row.event_type)) throw new Error("FEATURE_005_EVENT_TYPE_INVALID");
  const envelope = json<Feature005AutomationEventEnvelope>(row.envelope);
  const schemaId = feature005PayloadSchemas[row.event_type];
  const schemaRef = envelope.payloadSchemaRef as SchemaReference;
  if (
    sha256(envelope as unknown as JsonValue) !== row.envelope_hash ||
    envelope.envelopeVersion !== 1 ||
    envelope.eventId !== row.id ||
    envelope.eventType !== row.event_type ||
    envelope.workspaceId !== row.workspace_id ||
    envelope.projectId !== row.project_id ||
    envelope.producer !== "competency-qa" ||
    envelope.producerVersion !== "1.0.0" ||
    envelope.entityType !== feature005EntityTypes[row.event_type] ||
    envelope.entityVersion < 1 ||
    envelope.payloadVersion !== 1 ||
    schemaRef.id !== schemaId ||
    schemaRef.version !== 1 ||
    schemaRef.digest !== designContractRegistry.digest(schemaId) ||
    Number.isNaN(Date.parse(envelope.occurredAt)) ||
    Number.isNaN(Date.parse(envelope.recordedAt)) ||
    Date.parse(envelope.recordedAt) < Date.parse(envelope.occurredAt)
  )
    throw new Error("FEATURE_005_EVENT_ENVELOPE_INVALID");
  designContractRegistry.validate({ schemaRef, value: envelope.payload as never });
  return Object.freeze(structuredClone(envelope));
}

export interface Feature005AutomationEventPublisher {
  publish(envelope: Feature005AutomationEventEnvelope): Promise<void>;
}

export type Feature005AutomationEventListener = (
  envelope: Feature005AutomationEventEnvelope,
) => void | Promise<void>;

/** Local closed event bus used by the worker composition; subscriber failure keeps the outbox row READY. */
export class Feature005InProcessEventPublisher implements Feature005AutomationEventPublisher {
  readonly #listeners = new Set<Feature005AutomationEventListener>();

  subscribe(listener: Feature005AutomationEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async publish(envelope: Feature005AutomationEventEnvelope): Promise<void> {
    for (const listener of this.#listeners) await listener(envelope);
  }
}

export type Feature005EventPublishOutcome = "IDLE" | "PUBLISHED";

/**
 * Publishes one exact Feature 005 envelope while holding a SKIP LOCKED row
 * claim. ACK is committed only after every publisher listener succeeds.
 */
export class TypeOrmFeature005AutomationEventOutboxWorker {
  constructor(
    private readonly source: DataSource,
    private readonly publisher: Feature005AutomationEventPublisher,
    private readonly scope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
  ) {
    if (!publisher || typeof publisher.publish !== "function")
      throw new Error("FEATURE_005_EVENT_PUBLISHER_REQUIRED");
    if (scope && (!scope.workspaceId || !scope.projectIds.length))
      throw new Error("FEATURE_005_EVENT_SCOPE_INVALID");
  }

  async runOne(): Promise<Feature005EventPublishOutcome> {
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const rows = queryRows<
        Readonly<{
          id: string;
          workspace_id: string;
          project_id: string;
          event_type: string;
          envelope: unknown;
          envelope_hash: string;
        }>
      >(
        await manager.query(
          `
SELECT id,workspace_id,project_id,event_type,envelope,envelope_hash
FROM event_outbox
WHERE state='READY' AND event_type=ANY($1::text[])
  AND ($2::uuid IS NULL OR (workspace_id=$2 AND project_id=ANY($3::uuid[])))
ORDER BY created_at,id
FOR UPDATE SKIP LOCKED
LIMIT 1`,
          [
            [...feature005AutomationEventTypes],
            this.scope?.workspaceId ?? null,
            this.scope ? [...this.scope.projectIds] : null,
          ],
        ),
      );
      const row = rows[0];
      if (!row) return "IDLE";
      const envelope = assertFeature005Envelope(row);
      await this.publisher.publish(envelope);
      const acknowledged = queryRows<Readonly<{ id: string }>>(
        await manager.query(
          `
UPDATE event_outbox SET state='ACKNOWLEDGED'
WHERE id=$1 AND state='READY'
RETURNING id`,
          [row.id],
        ),
      );
      if (acknowledged.length !== 1) throw new Error("FEATURE_005_EVENT_OUTBOX_CAS_CONFLICT");
      return "PUBLISHED";
    });
  }
}

export function createFeature005AutomationEventWorkerStep(
  source: DataSource,
  publisher: Feature005AutomationEventPublisher,
  scope?: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
): Readonly<{ run(): Promise<Feature005EventPublishOutcome> }> {
  const worker = new TypeOrmFeature005AutomationEventOutboxWorker(source, publisher, scope);
  return Object.freeze({ run: async () => await worker.runOne() });
}

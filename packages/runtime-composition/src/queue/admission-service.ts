import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ApprovalAuthorizationScopeWitness,
  type CapacityActionExpectedState,
  type CapacityAdmissionActivityKind,
  type CapacityAdmissionEvaluation,
  createMeasureOnlyAdmissionDecision,
  createPlatformActionApprovalV2,
  deriveBaseWipClaimDecision,
  evaluateCapacityAdmission,
  type HumanWipClaimRevision,
  type MeasureOnlyAdmissionDecision,
  prepareCapacityQueueAction,
  projectSafeQueueAuthorizationWitness,
  type QueueStage,
  reconcileAuthoritativeCapacityFact,
  type ReviewCapacityReservationRevision,
  transitionHumanWipClaim,
  transitionReviewCapacityReservation,
  validatePublicCapacityAdmission,
} from "@awp/platform-core";
import {
  CapacityAdmissionRepository,
  QueueActionCandidateRepository,
  QueueControlRepository,
  TypeOrmApprovalRepository,
  TypeOrmOperationalAuthorityRepository,
  withBoundedSerializationRetry,
} from "@awp/platform-persistence-typeorm";

export interface MeasureOnlyAdmissionCommitPort {
  commit(
    input: Readonly<{
      decision: MeasureOnlyAdmissionDecision;
      claimSourceRef: Readonly<Record<string, unknown>>;
      eventPayload: Readonly<Record<string, unknown>>;
      correlationId: string;
      causationId: string;
    }>,
  ): Promise<Readonly<{ outcome: "COMMITTED" | "DUPLICATE"; claimId: string | null }>>;
}

export function strongSessionEtag(
  input: Readonly<{ sourceId: string; sourceVersion: number; semanticHash: string }>,
): string {
  if (
    !input.sourceId ||
    !Number.isSafeInteger(input.sourceVersion) ||
    input.sourceVersion < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.semanticHash)
  )
    throw new Error("SESSION_ETAG_INPUT_INVALID");
  return `"qa-session:${input.sourceVersion}:${input.semanticHash}"`;
}

export function assertStrongSessionIfMatch(
  value: string | undefined,
  current: Readonly<{ sourceId: string; sourceVersion: number; semanticHash: string }>,
): void {
  if (value !== strongSessionEtag(current))
    throw new Error("CAPACITY_ADMISSION_SESSION_ETAG_STALE");
}

const admissionCommandKeys = new Set([
  "schemaVersion",
  "activityKind",
  "sessionId",
  "expectedSessionVersion",
  "expectedQueueControlVersion",
  "expectedOperationalProjectionRef",
  "overrideIntent",
]);
export function assertCapacityAdmissionHttpCommand(
  value: unknown,
): asserts value is Readonly<Record<string, JsonValue>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !admissionCommandKeys.has(key))
  )
    throw new Error("CAPACITY_ADMISSION_COMMAND_INVALID");
  const input = value as Readonly<Record<string, unknown>>;
  const operational = input.expectedOperationalProjectionRef as
    Readonly<Record<string, unknown>> | undefined;
  if (
    input.schemaVersion !== "capacity-admission-request@1.0.0" ||
    !new Set(["MANUAL_SESSION_START", "MANUAL_SESSION_RESUME", "AUTOMATED_SESSION_LAUNCH"]).has(
      String(input.activityKind),
    ) ||
    typeof input.sessionId !== "string" ||
    input.sessionId.length === 0 ||
    !Number.isSafeInteger(input.expectedSessionVersion) ||
    Number(input.expectedSessionVersion) < 1 ||
    !Number.isSafeInteger(input.expectedQueueControlVersion) ||
    Number(input.expectedQueueControlVersion) < 0 ||
    !operational ||
    operational.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION" ||
    typeof operational.sourceId !== "string" ||
    !Number.isSafeInteger(operational.sourceVersion) ||
    typeof operational.semanticHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(operational.semanticHash)
  ) {
    throw new Error("CAPACITY_ADMISSION_COMMAND_INVALID");
  }
  if (input.overrideIntent !== undefined) {
    const intent = input.overrideIntent as Readonly<Record<string, unknown>>;
    if (
      !intent ||
      typeof intent !== "object" ||
      Object.keys(intent).some((key) => !new Set(["reason", "expiresAt"]).has(key)) ||
      typeof intent.reason !== "string" ||
      !intent.reason.trim() ||
      intent.reason.length > 2_000 ||
      typeof intent.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(intent.expiresAt))
    )
      throw new Error("CAPACITY_ADMISSION_COMMAND_INVALID");
  }
  const forbidden = [
    "expectedCapacityHeadVersion",
    "humanCommittedCount",
    "workspaceHumanWipLimit",
    "claimSetHash",
    "reservationSetHash",
    "expediteSetHash",
  ];
  if (forbidden.some((key) => key in input))
    throw new Error("CAPACITY_ADMISSION_GLOBAL_TOKEN_FORBIDDEN");
}

export function capacityAdmissionHttpReceipt(
  input: Readonly<{
    outcome: CapacityAdmissionEvaluation["outcome"];
    decisionRef: Readonly<{
      sourceType: "CAPACITY_ADMISSION_DECISION";
      sourceId: string;
      sourceVersion: 1;
      semanticHash: `sha256:${string}`;
    }>;
    replayed: boolean;
    approvalId?: string;
  }>,
): Readonly<{ status: 200 | 202; location?: string; body: Readonly<Record<string, JsonValue>> }> {
  if (input.approvalId)
    return Object.freeze({
      status: 202 as const,
      location: `/approvals/${input.approvalId}`,
      body: Object.freeze({
        state: "APPROVAL_REQUIRED",
        approvalId: input.approvalId,
        outcome: input.outcome,
        decisionRef: input.decisionRef,
        replayed: input.replayed,
      }),
    });
  return Object.freeze({
    status: 200 as const,
    body: Object.freeze({
      state: "DECIDED",
      outcome: input.outcome,
      decisionRef: input.decisionRef,
      replayed: input.replayed,
    }),
  });
}

export function capacityAdmissionHttpProblem(
  error: unknown,
  correlationId: string,
): Readonly<{
  status: 403 | 404 | 409;
  body: Readonly<{
    type: string;
    title: string;
    status: 403 | 404 | 409;
    code: string;
    correlationId: string;
  }>;
}> {
  const code = error instanceof Error ? error.message : "CAPACITY_ADMISSION_CONFLICT";
  const status =
    code === "CAPACITY_ADMISSION_FORBIDDEN"
      ? (403 as const)
      : code === "CAPACITY_ADMISSION_NOT_FOUND"
        ? (404 as const)
        : /STALE|CONFLICT/iu.test(code)
          ? (409 as const)
          : (() => {
              throw error;
            })();
  const title = status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Conflict";
  const type =
    status === 404
      ? "urn:awp:problem:not-found"
      : status === 403
        ? "urn:awp:problem:forbidden"
        : "urn:awp:problem:conflict";
  return Object.freeze({
    status,
    body: Object.freeze({ type, title, status, code, correlationId }),
  });
}

const uuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export class MeasureOnlyManualAdmissionService {
  constructor(private readonly store: MeasureOnlyAdmissionCommitPort) {}

  async admit(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      requestKey: string;
      activityKind: "MANUAL_SESSION_START" | "MANUAL_SESSION_RESUME";
      stage: QueueStage;
      sessionState: "RUNNING" | "REVIEW_REQUIRED";
      existingClaim?: Readonly<{ workItemId: string; units: 1 }>;
      actor: Readonly<{ kind: "HUMAN"; principalId: string }>;
      policyFacetRef: Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>;
      authorizedScopeSnapshotRef: Readonly<{
        id: string;
        version: number;
        semanticHash: `sha256:${string}`;
      }>;
      authorizationScopeWitnessHash: `sha256:${string}`;
      expectedQueueControlVersion: number;
      operationalProjectionRef: Readonly<Record<string, unknown>>;
      qaSourceSetHash: `sha256:${string}`;
      sessionRef: Readonly<Record<string, unknown>>;
      decidedAt: string;
      correlationId: string;
      causationId: string;
    }>,
  ): Promise<Readonly<{ outcome: "COMMITTED" | "DUPLICATE"; claimId: string | null }>> {
    const derived = deriveBaseWipClaimDecision({
      workItemId: input.workItemId,
      stage: input.stage,
      activity: { mode: "MANUAL", state: input.sessionState },
      ...(input.existingClaim ? { existingClaim: input.existingClaim } : {}),
      policyMode: "MEASURE_ONLY",
    });
    if (derived.state === "NOT_CONSUMING") throw new Error("MANUAL_SESSION_NOT_CONSUMING");
    const requestKeyHash = sha256(input.requestKey);
    const request = Object.freeze({
      idempotencyKeyHash: requestKeyHash,
      requestHash: sha256({
        activityKind: input.activityKind,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        sessionRef: input.sessionRef,
      } as unknown as JsonValue),
      activityKind: input.activityKind,
      actor: input.actor,
      authorizationScopeWitnessHash: input.authorizationScopeWitnessHash,
    });
    const decisionId = uuid(
      `capacity-admission:${input.workspaceId}:${input.projectId}:${requestKeyHash}`,
    );
    const claimId =
      derived.state === "CREATE"
        ? uuid(`human-wip-claim:${input.workspaceId}:${input.projectId}:${input.workItemId}`)
        : null;
    const decision = createMeasureOnlyAdmissionDecision({
      decisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      requestKeyHash,
      requestHash: request.requestHash,
      activityKind: input.activityKind,
      outcome: derived.state === "CREATE" ? "ADMITTED" : "NO_CHANGE",
      claim: derived.state === "CREATE" ? { claimId: claimId!, cause: derived.cause } : null,
      policyFacetRef: input.policyFacetRef,
      authorizationScopeWitnessHash: input.authorizationScopeWitnessHash,
      decidedAt: input.decidedAt,
    });
    const before = Object.freeze({
      policyMode: "MEASURE_ONLY",
      authorizedScopeSnapshotRef: input.authorizedScopeSnapshotRef,
    });
    const claimSourceRef = Object.freeze({
      sourceType: "QA_TEST_SESSION_REVISION",
      ...input.sessionRef,
    });
    const claimMutationRef = claimId
      ? Object.freeze({
          sourceType: "HUMAN_WIP_CLAIM_REVISION",
          sourceId: claimId,
          sourceVersion: 1,
          semanticHash: sha256({
            claimId,
            workItemId: input.workItemId,
            sessionId: input.sessionId,
            cause: derived.state === "CREATE" ? derived.cause : "ALREADY_CLAIMED",
            sourceRef: claimSourceRef,
            acquiredAt: input.decidedAt,
          } as unknown as JsonValue),
        })
      : undefined;
    const payloadBody = Object.freeze({
      schemaVersion: "capacity-admission@1.0.0",
      admissionDecisionId: decisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      request,
      expectedState: Object.freeze({
        policyFacetRef: input.policyFacetRef,
        expectedQueueControlVersion: input.expectedQueueControlVersion,
        sessionRef: input.sessionRef,
        operationalProjectionRef: input.operationalProjectionRef,
        qaSourceSetHash: input.qaSourceSetHash,
      }),
      before,
      outcome: decision.outcome,
      violatedConstraints: Object.freeze([]),
      effect: claimMutationRef
        ? Object.freeze({
            state: "COMMITTED",
            mutationRefs: Object.freeze([claimMutationRef, input.sessionRef]),
          })
        : Object.freeze({ state: "NO_MUTATION" }),
      override: Object.freeze({ state: "NOT_USED" }),
      after: before,
      reasonCode:
        derived.state === "CREATE"
          ? "MEASURE_ONLY_BASE_CLAIM_CREATED"
          : "MEASURE_ONLY_BASE_CLAIM_EXISTS",
      decidedAt: input.decidedAt,
      recordedAt: input.decidedAt,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    const eventPayload = Object.freeze({
      ...payloadBody,
      semanticHash: sha256(payloadBody as unknown as JsonValue),
    });
    return await this.store.commit({
      decision,
      claimSourceRef,
      eventPayload,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
  }
}

export interface SerializedCapacityAdmissionRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId?: string;
  readonly principalId: string;
  readonly requestKey: string;
  readonly activityKind: CapacityAdmissionActivityKind;
  readonly automatedResultPath?: "CONVERT_RESERVATION_TO_REVIEW_CLAIM" | "RELEASE_RESERVATION";
  readonly expectedState: Readonly<Record<string, JsonValue>>;
  readonly overrideIntent?: Readonly<{ reason: string; expiresAt: string }>;
}

export interface LockedCapacityAdmissionContext {
  readonly policyMode: "MEASURE_ONLY" | "ENFORCED";
  readonly current: Readonly<{ humanCommittedCount: number; activeExpediteCount: number }>;
  readonly workspaceHumanWipLimit: number | null;
  readonly activeExpediteLimit: number | null;
  readonly targetHasClaim: boolean;
  readonly targetHasReservation: boolean;
  readonly targetHasExpedite: boolean;
  readonly projectCommittedCount?: number;
  readonly projectReservedCount?: number;
  readonly projectSoftWipLimit?: number;
  readonly projectReservedCapacity?: number;
  readonly exactOverride?: Readonly<{
    actionKind: "WIP_ADMISSION_OVERRIDE" | "EXPEDITE_CAPACITY_OVERRIDE";
    effectKind: "ALLOW_WIP_ADMISSION" | "ALLOW_EXPEDITE_CAPACITY";
  }>;
}

export interface SerializedCapacityAdmissionPorts<TTransaction, TResult> {
  transaction<T>(work: (transaction: TTransaction) => Promise<T>): Promise<T>;
  authorize(transaction: TTransaction, input: SerializedCapacityAdmissionRequest): Promise<boolean>;
  replay(
    transaction: TTransaction,
    input: Readonly<{ workspaceId: string; projectId: string; requestKeyHash: string }>,
  ): Promise<Readonly<{ requestHash: string; result: TResult }> | undefined>;
  lockAndRead(
    transaction: TTransaction,
    input: SerializedCapacityAdmissionRequest,
  ): Promise<LockedCapacityAdmissionContext>;
  persist(
    transaction: TTransaction,
    input: Readonly<{
      request: SerializedCapacityAdmissionRequest;
      requestKeyHash: string;
      requestHash: string;
      evaluation: CapacityAdmissionEvaluation;
    }>,
  ): Promise<TResult>;
}

/** PostgreSQL transaction is authoritative for this command path. */
export class SerializedCapacityAdmissionService<TTransaction, TResult> {
  constructor(
    private readonly ports: SerializedCapacityAdmissionPorts<TTransaction, TResult>,
    private readonly maxAttempts = 3,
  ) {}

  async admit(input: SerializedCapacityAdmissionRequest): Promise<TResult> {
    if (
      !input.workspaceId ||
      !input.projectId ||
      !input.workItemId ||
      !input.principalId ||
      !/^[A-Za-z0-9._:-]{16,200}$/u.test(input.requestKey)
    )
      throw new Error("CAPACITY_ADMISSION_REQUEST_INVALID");
    const requestKeyHash = sha256(input.requestKey);
    const { requestKey, ...requestBody } = input;
    void requestKey;
    const requestHash = sha256(requestBody as unknown as JsonValue);
    return await withBoundedSerializationRetry(
      async () =>
        await this.ports.transaction(async (transaction) => {
          if (!(await this.ports.authorize(transaction, input)))
            throw new Error("CAPACITY_ADMISSION_NOT_FOUND");
          const replay = await this.ports.replay(transaction, {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            requestKeyHash,
          });
          if (replay) {
            if (replay.requestHash !== requestHash)
              throw new Error("CAPACITY_ADMISSION_IDEMPOTENCY_CONFLICT");
            return replay.result;
          }
          const context = await this.ports.lockAndRead(transaction, input);
          const evaluation = evaluateCapacityAdmission({
            ...context,
            activityKind: input.activityKind,
            ...(input.automatedResultPath
              ? { automatedResultPath: input.automatedResultPath }
              : {}),
          });
          return await this.ports.persist(transaction, {
            request: input,
            requestKeyHash,
            requestHash,
            evaluation,
          });
        }),
      this.maxAttempts,
    );
  }
}

export interface PostgresCapacityAdmissionInput extends SerializedCapacityAdmissionRequest {
  readonly actor:
    | Readonly<{ kind: "HUMAN"; principalId: string }>
    | Readonly<{ kind: "SERVICE"; serviceId: string }>;
  readonly approvalInitiator?: Readonly<{
    kind: "HUMAN";
    principalId: string;
    issuer: string;
    subject: string;
  }>;
  readonly authorizationScopeWitnessHash: `sha256:${string}`;
  readonly authorizationScopeWitness?: ApprovalAuthorizationScopeWitness;
  readonly initiatorAuthorizationBasis?: JsonValue;
  readonly expectedState: Readonly<{
    policyFacetRef: Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>;
    expectedQueueControlVersion: number;
    operationalProjectionRef: Readonly<Record<string, JsonValue>>;
    qaSourceSetHash: `sha256:${string}`;
    sessionRef?: Readonly<{
      sourceType: "QA_TEST_SESSION_REVISION";
      sourceId: string;
      sourceVersion: number;
      semanticHash: `sha256:${string}`;
    }>;
  }>;
  readonly committedSessionRef?: Readonly<{
    sourceType: "QA_TEST_SESSION_REVISION";
    sourceId: string;
    sourceVersion: number;
    semanticHash: `sha256:${string}`;
  }>;
  readonly authorizedScopeSnapshotRef: Readonly<{
    id: string;
    version: number;
    semanticHash: `sha256:${string}`;
  }>;
  readonly reservationExpiresAt?: string;
  readonly blockedFromState?: "RUNNING" | "REVIEW_REQUIRED";
  readonly controlAction?: Readonly<{
    controlId: string;
    revisionId: string;
    acceptedActionRef: Readonly<Record<string, JsonValue>>;
    reason: string;
    reviewAt?: string;
    expiresAt?: string;
  }>;
  readonly decidedAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface PostgresCapacityAdmissionReceipt {
  readonly outcome: CapacityAdmissionEvaluation["outcome"];
  readonly evaluation: CapacityAdmissionEvaluation;
  readonly decisionRef: Readonly<{
    sourceType: "CAPACITY_ADMISSION_DECISION";
    sourceId: string;
    sourceVersion: 1;
    semanticHash: `sha256:${string}`;
  }>;
  readonly mutationRefs: readonly Readonly<Record<string, JsonValue>>[];
  readonly replayed: boolean;
  readonly overrideCandidate?: Readonly<{
    actionId: string;
    approvalId: string;
    approvalSubjectHash: `sha256:${string}`;
    publicIntentHash: `sha256:${string}`;
    expiresAt: string;
  }>;
}

export interface PostgresCapacityAdmissionBinderPorts {
  reauthorize(manager: EntityManager, input: PostgresCapacityAdmissionInput): Promise<boolean>;
  resolveExactOverride?(
    manager: EntityManager,
    input: PostgresCapacityAdmissionInput,
  ): Promise<
    | Readonly<{
        actionKind: "WIP_ADMISSION_OVERRIDE" | "EXPEDITE_CAPACITY_OVERRIDE";
        effectKind: "ALLOW_WIP_ADMISSION" | "ALLOW_EXPEDITE_CAPACITY";
        actionCandidateRef: Readonly<Record<string, JsonValue>>;
        approvalRef: Readonly<Record<string, JsonValue>>;
        publicIntentHash: `sha256:${string}`;
        /** Must CAS the exact Approval and PlatformAction to CONSUMED/COMPLETED on this transaction. */
        consume(
          manager: EntityManager,
          decisionRef: Readonly<{
            sourceType: "CAPACITY_ADMISSION_DECISION";
            sourceId: string;
            sourceVersion: 1;
            semanticHash: `sha256:${string}`;
          }>,
        ): Promise<void>;
      }>
    | undefined
  >;
}

const runtimeRows = (value: unknown): readonly Readonly<Record<string, unknown>>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Readonly<Record<string, unknown>>[];
};
const runtimeJson = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const capacityRef = (
  sourceType: "HUMAN_WIP_CLAIM_REVISION" | "REVIEW_CAPACITY_RESERVATION_REVISION",
  value: HumanWipClaimRevision | ReviewCapacityReservationRevision,
) =>
  Object.freeze({
    sourceType,
    sourceId: "claimId" in value ? value.claimId : value.reservationId,
    sourceVersion: value.revision,
    semanticHash: value.semanticHash,
  });

/** Concrete canonical binder. Every mutation is written on the caller's transaction after capacity→control→Session locks. */
export class PostgresCapacityAdmissionBinder {
  readonly #repository: CapacityAdmissionRepository;

  constructor(
    private readonly source: DataSource,
    private readonly ports: PostgresCapacityAdmissionBinderPorts,
  ) {
    this.#repository = new CapacityAdmissionRepository(source);
  }

  async admit(input: PostgresCapacityAdmissionInput): Promise<PostgresCapacityAdmissionReceipt> {
    return await withBoundedSerializationRetry(
      async () =>
        await this.source.transaction(
          "SERIALIZABLE",
          async (manager) => await this.admitInTransaction(manager, input),
        ),
    );
  }

  async admitInTransaction(
    manager: EntityManager,
    input: PostgresCapacityAdmissionInput,
  ): Promise<PostgresCapacityAdmissionReceipt> {
    if (
      !Number.isFinite(Date.parse(input.decidedAt)) ||
      input.expectedState.expectedQueueControlVersion < 0
    )
      throw new Error("CAPACITY_ADMISSION_REQUEST_INVALID");
    if ((input.activityKind === "MANUAL_SESSION_RESUME") !== (input.blockedFromState !== undefined))
      throw new Error("CAPACITY_ADMISSION_BLOCKED_FROM_INVALID");
    const controlActivity =
      input.activityKind === "SET_EXPEDITE" || input.activityKind === "CLEAR_EXPEDITE";
    if (controlActivity !== (input.controlAction !== undefined))
      throw new Error("CAPACITY_ADMISSION_CONTROL_ACTION_INVALID");
    const scope = Object.freeze({
      kind: "PROJECT" as const,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    const requestKeyHash = sha256(input.requestKey);
    const { requestKey, ...requestBody } = input;
    void requestKey;
    const requestHash = sha256(requestBody as unknown as JsonValue);

    const capacity = await this.#repository.lockWorkspaceCapacity(
      { kind: "WORKSPACE", workspaceId: input.workspaceId },
      manager,
    );
    const controls = runtimeRows(
      await manager.query(
        `SELECT head.control_id,head.current_revision_id,head.resource_version,revision.service_class
         FROM work_item_queue_control_heads head
         LEFT JOIN work_item_queue_control_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.control_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 FOR UPDATE OF head`,
        [input.workspaceId, input.projectId, input.workItemId],
      ),
    );
    const controlVersion = Number(controls[0]?.resource_version ?? 0);
    if (controlVersion !== input.expectedState.expectedQueueControlVersion)
      throw new Error("CAPACITY_ADMISSION_CONTROL_STALE");
    let session: Readonly<Record<string, unknown>> | undefined;
    if (input.sessionId) {
      session = runtimeRows(
        await manager.query(
          "SELECT session_id,resource_version,content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND session_id=$4 FOR UPDATE",
          [input.workspaceId, input.projectId, input.workItemId, input.sessionId],
        ),
      )[0];
      if (!session) throw new Error("CAPACITY_ADMISSION_SESSION_NOT_FOUND");
      const expectedSession = input.expectedState.sessionRef;
      const content = runtimeJson<JsonValue>(session.content);
      if (
        !expectedSession ||
        expectedSession.sourceId !== input.sessionId ||
        expectedSession.sourceVersion !== Number(session.resource_version) ||
        expectedSession.semanticHash !== sha256(content)
      )
        throw new Error("CAPACITY_ADMISSION_SESSION_STALE");
    }
    if (!(await this.ports.reauthorize(manager, input)))
      throw new Error("CAPACITY_ADMISSION_NOT_FOUND");

    const existing = runtimeRows(
      await manager.query(
        "SELECT decision_id,request_hash,outcome,semantic_hash,committed_effect_refs,violations FROM capacity_admission_decisions WHERE workspace_id=$1 AND project_id=$2 AND request_key_hash=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, requestKeyHash],
      ),
    )[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash)
        throw new Error("CAPACITY_ADMISSION_IDEMPOTENCY_CONFLICT");
      const mutationRefs = Object.freeze(
        runtimeJson<readonly Readonly<Record<string, JsonValue>>[]>(existing.committed_effect_refs),
      );
      const evaluation = Object.freeze({
        outcome: String(existing.outcome) as CapacityAdmissionEvaluation["outcome"],
        violatedConstraints: Object.freeze(
          runtimeJson<CapacityAdmissionEvaluation["violatedConstraints"]>(existing.violations),
        ),
        committedDelta: 0 as const,
        expediteDelta: 0 as const,
        mutationKind: "NO_CHANGE" as const,
      });
      return Object.freeze({
        outcome: evaluation.outcome,
        evaluation,
        decisionRef: Object.freeze({
          sourceType: "CAPACITY_ADMISSION_DECISION",
          sourceId: String(existing.decision_id),
          sourceVersion: 1,
          semanticHash: String(existing.semantic_hash) as `sha256:${string}`,
        }),
        mutationRefs,
        replayed: true,
      });
    }

    if (!new Set(["MEASURE_ONLY", "ENFORCED"]).has(String(capacity.state)))
      throw new Error("CAPACITY_ADMISSION_NOT_READY");
    const policyRef = runtimeJson<
      Readonly<{ sourceId: string; sourceVersion: number; semanticHash: `sha256:${string}` }>
    >(capacity.policy_ref);
    const policies = runtimeRows(
      await manager.query(
        `SELECT revision.mode,revision.workspace_human_wip_limit,revision.active_expedite_limit,revision.project_entries
         FROM workspace_queue_policy_heads head
         JOIN workspace_queue_policy_revisions revision ON revision.workspace_id=head.workspace_id AND revision.policy_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND revision.policy_revision_id=$2 AND revision.revision_number=$3 AND revision.semantic_hash=$4`,
        [input.workspaceId, policyRef.sourceId, policyRef.sourceVersion, policyRef.semanticHash],
      ),
    );
    const policy = policies[0];
    if (!policy || String(policy.mode) !== String(capacity.state))
      throw new Error("CAPACITY_POLICY_PIN_STALE");
    const facets = runtimeRows(
      await manager.query(
        `SELECT revision.policy_facet_id,revision.revision_number,revision.semantic_hash
         FROM project_queue_policy_facet_heads head
         JOIN project_queue_policy_facet_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.policy_facet_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2`,
        [input.workspaceId, input.projectId],
      ),
    );
    const facet = facets[0];
    if (
      !facet ||
      String(facet.policy_facet_id) !== input.expectedState.policyFacetRef.id ||
      Number(facet.revision_number) !== input.expectedState.policyFacetRef.version ||
      String(facet.semantic_hash) !== input.expectedState.policyFacetRef.semanticHash
    )
      throw new Error("CAPACITY_POLICY_FACET_STALE");

    const claim = await this.#repository.currentHumanWipClaimRevision(
      scope,
      input.workItemId,
      manager,
    );
    const reservation = await this.#repository.currentReviewReservationRevision(
      scope,
      input.workItemId,
      manager,
    );
    const activeClaim = claim?.state === "ACTIVE" ? claim : undefined;
    const activeReservation =
      reservation && new Set(["HELD", "COVERED_BY_CLAIM"]).has(reservation.state)
        ? reservation
        : undefined;
    const projectEntry = runtimeJson<
      readonly Readonly<{
        projectId: string;
        softWipLimit: number | null;
        reservedCapacity: number | null;
      }>[]
    >(policy.project_entries).find(({ projectId }) => projectId === input.projectId);
    const projectCounts =
      runtimeRows(
        await manager.query(
          `WITH current_claims AS (
         SELECT DISTINCT ON (work_item_id) work_item_id,state FROM work_item_human_wip_claims
          WHERE workspace_id=$1 AND project_id=$2 ORDER BY work_item_id,revision_number DESC
       ), current_reservations AS (
         SELECT DISTINCT ON (work_item_id) work_item_id,state FROM review_capacity_reservations
          WHERE workspace_id=$1 AND project_id=$2 ORDER BY work_item_id,revision_number DESC
       )
       SELECT (SELECT count(*) FROM current_claims WHERE state='ACTIVE') AS occupied,
              (SELECT count(*) FROM current_reservations reservation WHERE reservation.state='HELD'
                AND NOT EXISTS(SELECT 1 FROM current_claims claim WHERE claim.work_item_id=reservation.work_item_id AND claim.state='ACTIVE')) AS reserved`,
          [input.workspaceId, input.projectId],
        ),
      )[0] ?? {};
    const exactOverride = await this.ports.resolveExactOverride?.(manager, input);
    const evaluation = evaluateCapacityAdmission({
      policyMode: String(policy.mode) as "MEASURE_ONLY" | "ENFORCED",
      activityKind: input.activityKind,
      ...(input.automatedResultPath ? { automatedResultPath: input.automatedResultPath } : {}),
      current: {
        humanCommittedCount: Number(capacity.human_committed_count),
        activeExpediteCount: Number(capacity.active_expedite_count),
      },
      workspaceHumanWipLimit:
        policy.workspace_human_wip_limit === null ? null : Number(policy.workspace_human_wip_limit),
      activeExpediteLimit:
        policy.active_expedite_limit === null ? null : Number(policy.active_expedite_limit),
      targetHasClaim: Boolean(activeClaim),
      targetHasReservation: Boolean(activeReservation),
      targetHasExpedite: String(controls[0]?.service_class ?? "STANDARD") === "EXPEDITE",
      projectCommittedCount:
        Number(projectCounts.occupied ?? 0) + Number(projectCounts.reserved ?? 0),
      projectReservedCount: Number(projectCounts.reserved ?? 0),
      ...(projectEntry?.softWipLimit === null || projectEntry?.softWipLimit === undefined
        ? {}
        : { projectSoftWipLimit: projectEntry.softWipLimit }),
      ...(projectEntry?.reservedCapacity === null || projectEntry?.reservedCapacity === undefined
        ? {}
        : { projectReservedCapacity: projectEntry.reservedCapacity }),
      ...(exactOverride
        ? {
            exactOverride: {
              actionKind: exactOverride.actionKind,
              effectKind: exactOverride.effectKind,
            },
          }
        : {}),
    });

    const mutationRefs: Readonly<Record<string, JsonValue>>[] = [];
    const sourceRef =
      input.committedSessionRef ??
      input.expectedState.sessionRef ??
      input.expectedState.operationalProjectionRef;
    if (evaluation.outcome !== "DENIED" && evaluation.mutationKind === "CLAIM") {
      const next = transitionHumanWipClaim({
        claimId: uuid(
          `human-wip-claim:${input.workspaceId}:${input.projectId}:${input.workItemId}:${(claim?.revision ?? 0) + 1}`,
        ),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        ...(claim ? { current: claim } : {}),
        command: {
          kind: "UPSERT",
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          cause:
            input.activityKind === "EXTERNAL_JIRA_RECONCILIATION"
              ? "FORCED_EXTERNAL"
              : input.activityKind === "AUTOMATED_RESULT_APPLY"
                ? "AUTOMATED_REVIEW_REQUIRED"
                : "MANUAL_RUNNING",
          at: input.decidedAt,
        },
      });
      if (next.outcome === "APPENDED") {
        await this.#repository.appendHumanWipClaimRevision(scope, next.claim, sourceRef, manager);
        mutationRefs.push(capacityRef("HUMAN_WIP_CLAIM_REVISION", next.claim));
      }
    } else if (
      evaluation.outcome !== "DENIED" &&
      new Set(["RESERVATION", "CONVERT_RESERVATION", "RELEASE_RESERVATION"]).has(
        evaluation.mutationKind,
      )
    ) {
      const command =
        evaluation.mutationKind === "RESERVATION"
          ? {
              kind: "ACQUIRE" as const,
              sessionId: input.sessionId!,
              cause: `automation-launch:${input.sessionId}`,
              at: input.decidedAt,
              expiresAt: input.reservationExpiresAt!,
              targetHasClaim: Boolean(activeClaim),
            }
          : evaluation.mutationKind === "CONVERT_RESERVATION"
            ? {
                kind: "CONVERT_TO_REVIEW_CLAIM" as const,
                sessionId: input.sessionId!,
                cause: `automation-result:${input.sessionId}`,
                at: input.decidedAt,
                targetHasClaim: Boolean(activeClaim),
              }
            : {
                kind: "RELEASE" as const,
                sessionId: input.sessionId!,
                cause: `automation-release:${input.sessionId}`,
                at: input.decidedAt,
              };
      const next = transitionReviewCapacityReservation({
        reservationId: uuid(
          `review-capacity-reservation:${input.workspaceId}:${input.projectId}:${input.workItemId}:${(reservation?.revision ?? 0) + 1}`,
        ),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        ...(reservation ? { current: reservation } : {}),
        command,
      });
      if (next.outcome === "APPENDED") {
        await this.#repository.appendReviewReservationRevision(
          scope,
          next.reservation,
          sourceRef,
          manager,
        );
        mutationRefs.push(capacityRef("REVIEW_CAPACITY_RESERVATION_REVISION", next.reservation));
      }
      if (next.claimMutation !== "NONE") {
        const claimNext = transitionHumanWipClaim({
          claimId: uuid(
            `human-wip-claim:${input.workspaceId}:${input.projectId}:${input.workItemId}:${(claim?.revision ?? 0) + 1}`,
          ),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          workItemId: input.workItemId,
          ...(claim ? { current: claim } : {}),
          command: {
            kind: "UPSERT",
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            cause: activeReservation ? "AUTOMATED_REVIEW_REQUIRED" : "FORCED_EXTERNAL",
            at: input.decidedAt,
          },
        });
        if (claimNext.outcome === "APPENDED") {
          await this.#repository.appendHumanWipClaimRevision(
            scope,
            claimNext.claim,
            sourceRef,
            manager,
          );
          mutationRefs.push(capacityRef("HUMAN_WIP_CLAIM_REVISION", claimNext.claim));
        }
      }
    }
    let controlCapacityChanged = false;
    if (
      evaluation.outcome !== "DENIED" &&
      (evaluation.mutationKind === "SET_EXPEDITE" || evaluation.mutationKind === "CLEAR_EXPEDITE")
    ) {
      const action = input.controlAction;
      if (!action) throw new Error("CAPACITY_ADMISSION_CONTROL_ACTION_REQUIRED");
      const transition = await new QueueControlRepository(this.source).transitionExpedite(
        {
          scope,
          workItemId: input.workItemId,
          controlId: action.controlId,
          revisionId: action.revisionId,
          command: evaluation.mutationKind === "SET_EXPEDITE" ? "SET" : "CLEAR",
          expectedControlVersion: input.expectedState.expectedQueueControlVersion,
          acceptedActionRef: action.acceptedActionRef,
          actorId: input.actor.kind === "HUMAN" ? input.actor.principalId : input.actor.serviceId,
          reason: action.reason,
          ...(action.reviewAt ? { reviewAt: action.reviewAt } : {}),
          ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}),
          ...(evaluation.outcome === "ADMITTED_WITH_EXACT_OVERRIDE"
            ? { allowCapacityOverride: true }
            : {}),
          emitCapacityEvent: false,
          at: input.decidedAt,
        },
        manager,
      );
      if (transition.revisionRef) mutationRefs.push(transition.revisionRef);
      controlCapacityChanged = transition.capacityChanged;
    }
    if (mutationRefs.length > 0 && input.committedSessionRef)
      mutationRefs.push(input.committedSessionRef);
    const reconciled = controlCapacityChanged
      ? Object.freeze({ changed: true })
      : mutationRefs.length > 0
        ? await this.#repository.reconcileWorkspaceCapacity(
            { kind: "WORKSPACE", workspaceId: input.workspaceId },
            input.decidedAt,
            manager,
            capacity,
          )
        : undefined;

    const decisionId = uuid(
      `capacity-admission:${input.workspaceId}:${input.projectId}:${requestKeyHash}`,
    );
    const before = Object.freeze({
      policyMode: String(policy.mode),
      authorizedScopeSnapshotRef: input.authorizedScopeSnapshotRef,
    });
    const body = Object.freeze({
      schemaVersion: "capacity-admission@1.0.0",
      admissionDecisionId: decisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      request: Object.freeze({
        idempotencyKeyHash: requestKeyHash,
        requestHash,
        activityKind: input.activityKind,
        ...(input.automatedResultPath ? { automatedResultPath: input.automatedResultPath } : {}),
        actor: input.actor,
        authorizationScopeWitnessHash: input.authorizationScopeWitnessHash,
      }),
      expectedState: input.expectedState,
      before,
      outcome: evaluation.outcome,
      violatedConstraints: evaluation.violatedConstraints,
      effect:
        mutationRefs.length > 0
          ? Object.freeze({ state: "COMMITTED", mutationRefs: Object.freeze(mutationRefs) })
          : Object.freeze({ state: "NO_MUTATION" }),
      override:
        exactOverride && evaluation.outcome === "ADMITTED_WITH_EXACT_OVERRIDE"
          ? Object.freeze({
              state: "CONSUMED",
              actionKind: exactOverride.actionKind,
              effectKind: exactOverride.effectKind,
              actionCandidateRef: exactOverride.actionCandidateRef,
              approvalRef: exactOverride.approvalRef,
              publicIntentHash: exactOverride.publicIntentHash,
            })
          : Object.freeze({ state: "NOT_USED" }),
      after: before,
      reasonCode:
        evaluation.outcome === "DENIED"
          ? "CAPACITY_LIMIT_DENIED"
          : evaluation.outcome === "NO_CHANGE"
            ? "CAPACITY_ALREADY_COMMITTED"
            : "CAPACITY_ADMISSION_COMMITTED",
      decidedAt: input.decidedAt,
      recordedAt: input.decidedAt,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    const decision = Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) });
    validatePublicCapacityAdmission(decision);
    const beforeRef = Object.freeze({
      authorizedScopeSnapshotRef: input.authorizedScopeSnapshotRef,
      policyMode: policy.mode,
    });
    const afterRef = beforeRef;
    await manager.query(
      `INSERT INTO capacity_admission_decisions(decision_id,workspace_id,project_id,work_item_id,request_key_hash,request_hash,activity_kind,outcome,policy_facet_ref,authorization_scope_witness_hash,before_ref,after_ref,action_candidate_ref,approval_ref,committed_effect_refs,violations,warnings,decided_at,semantic_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'[]'::jsonb,$17,$18)`,
      [
        decisionId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        requestKeyHash,
        requestHash,
        input.activityKind,
        evaluation.outcome,
        JSON.stringify(input.expectedState.policyFacetRef),
        input.authorizationScopeWitnessHash,
        JSON.stringify(beforeRef),
        JSON.stringify(afterRef),
        exactOverride ? JSON.stringify(exactOverride.actionCandidateRef) : null,
        exactOverride ? JSON.stringify(exactOverride.approvalRef) : null,
        JSON.stringify(mutationRefs),
        JSON.stringify(evaluation.violatedConstraints),
        input.decidedAt,
        decision.semanticHash,
      ],
    );
    const decisionRef = Object.freeze({
      sourceType: "CAPACITY_ADMISSION_DECISION" as const,
      sourceId: decisionId,
      sourceVersion: 1 as const,
      semanticHash: decision.semanticHash,
    });
    const eventType =
      evaluation.outcome === "NON_DISCRETIONARY_OVERFLOW"
        ? "capacity.over-limit-detected"
        : "capacity.admission.decided";
    const eventId = uuid(`${eventType}:${decisionId}`);
    const envelope = Object.freeze({
      envelopeVersion: 1,
      eventId,
      eventType,
      occurredAt: input.decidedAt,
      recordedAt: input.decidedAt,
      producer: "queue.admission",
      producerVersion: "1.0.0",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entityType: "capacity-admission",
      entityId: decisionId,
      entityVersion: 1,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: input.actor,
      dataClassificationKey: "INTERNAL",
      payloadVersion: 1,
      payloadSchemaRef: Object.freeze({
        id: "urn:awp:schemas:006:capacity-admission:v1",
        version: 1,
        digest: decision.semanticHash,
      }),
      payload: decision,
    });
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        eventId,
        input.workspaceId,
        input.projectId,
        eventType,
        JSON.stringify(envelope),
        sha256(envelope as unknown as JsonValue),
        input.decidedAt,
      ],
    );
    if (reconciled?.changed) {
      const occupancyId = uuid(`capacity-occupancy:${decisionId}`);
      const payload = Object.freeze({
        schemaVersion: "capacity-occupancy-changed@1.0.0",
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        admissionDecisionRef: decisionRef,
        authorizedProjectionRef: input.authorizedScopeSnapshotRef,
        reconciledAt: input.decidedAt,
      });
      const occupancy = Object.freeze({
        ...envelope,
        eventId: occupancyId,
        eventType: "capacity.occupancy.changed",
        entityType: "capacity",
        entityId: input.workItemId,
        payloadSchemaRef: Object.freeze({
          id: "urn:awp:schemas:006:capacity-occupancy-changed:v1",
          version: 1,
          digest: sha256(payload as unknown as JsonValue),
        }),
        payload,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'capacity.occupancy.changed',$4,$5,'READY',$6)",
        [
          occupancyId,
          input.workspaceId,
          input.projectId,
          JSON.stringify(occupancy),
          sha256(occupancy as unknown as JsonValue),
          input.decidedAt,
        ],
      );
    }
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'queue.capacity.admit',$6,$7,$8,$9,$10,'INTERNAL',$11)",
      [
        uuid(`capacity-admission-audit:${decisionId}`),
        input.workspaceId,
        input.projectId,
        input.decidedAt,
        JSON.stringify(input.actor),
        evaluation.outcome === "DENIED" ? "DENIED" : "SUCCEEDED",
        body.reasonCode,
        input.correlationId,
        input.causationId,
        JSON.stringify({ authorizationScopeWitnessHash: input.authorizationScopeWitnessHash }),
        JSON.stringify({ decisionRef, mutationRefs }),
      ],
    );
    if (exactOverride && evaluation.outcome === "ADMITTED_WITH_EXACT_OVERRIDE") {
      await exactOverride.consume(manager, decisionRef);
    }
    let overrideCandidate: PostgresCapacityAdmissionReceipt["overrideCandidate"];
    if (evaluation.outcome === "DENIED" && input.overrideIntent) {
      if (
        input.actor.kind !== "HUMAN" ||
        String(policy.mode) !== "ENFORCED" ||
        !new Set(["MANUAL_SESSION_START", "MANUAL_SESSION_RESUME", "AUTOMATED_SESSION_LAUNCH"]).has(
          input.activityKind,
        ) ||
        !input.expectedState.sessionRef ||
        !input.approvalInitiator ||
        input.approvalInitiator.principalId !== input.actor.principalId
      )
        throw new Error("WIP_ADMISSION_OVERRIDE_NOT_ELIGIBLE");
      const overrideActivity = input.activityKind as
        "MANUAL_SESSION_START" | "MANUAL_SESSION_RESUME" | "AUTOMATED_SESSION_LAUNCH";
      const queue = runtimeRows(
        await manager.query(
          `SELECT head.queue_entry_id,revision.revision_number,revision.semantic_hash,revision.input_fingerprint,revision.subject,revision.source_refs
           FROM queue_entry_heads head
           JOIN queue_entry_revisions revision
             ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
            AND revision.queue_entry_revision_id=head.current_revision_id
          WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3
            AND head.suppressed_by_work_item_id IS NULL FOR SHARE OF head,revision`,
          [input.workspaceId, input.projectId, input.workItemId],
        ),
      )[0];
      if (!queue) throw new Error("CAPACITY_ADMISSION_QUEUE_ENTRY_STALE");
      const subject = runtimeJson<Readonly<Record<string, JsonValue>>>(queue.subject);
      if (
        subject.kind !== "WORK_ITEM" ||
        subject.id !== input.workItemId ||
        typeof subject.version !== "number" ||
        typeof subject.semanticHash !== "string"
      )
        throw new Error("CAPACITY_ADMISSION_WORK_ITEM_REF_STALE");
      const sourceRefs = runtimeJson<readonly Readonly<Record<string, JsonValue>>[]>(
        queue.source_refs,
      );
      const operational = sourceRefs.find(
        ({ sourceType }) => sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION",
      );
      const qa = sourceRefs.find(({ sourceType }) => sourceType === "QA_QUEUE_FACT_REVISION");
      if (
        !operational ||
        sha256(operational as JsonValue) !==
          sha256(input.expectedState.operationalProjectionRef as JsonValue) ||
        !qa ||
        qa.semanticHash !== input.expectedState.qaSourceSetHash
      )
        throw new Error("CAPACITY_ADMISSION_SOURCE_STALE");
      const fullExpected: CapacityActionExpectedState = Object.freeze({
        kind: "CAPACITY",
        policyRef: Object.freeze({
          id: policyRef.sourceId,
          version: policyRef.sourceVersion,
          semanticHash: policyRef.semanticHash,
        }),
        policyMode: "ENFORCED",
        expectedControlVersion: controlVersion,
        expectedQueueEntry: Object.freeze({
          queueEntryId: String(queue.queue_entry_id),
          revision: Number(queue.revision_number),
          semanticHash: String(queue.semantic_hash) as `sha256:${string}`,
          inputFingerprint: String(queue.input_fingerprint) as `sha256:${string}`,
        }),
        expectedCapacityHeadVersion: Number(capacity.resource_version),
        workspaceHumanWipLimit: Number(policy.workspace_human_wip_limit),
        activeExpediteLimit: Number(policy.active_expedite_limit),
        humanOccupiedCount: Number(capacity.human_occupied_count),
        reviewReservedCount: Number(capacity.review_reserved_count),
        humanCommittedCount: Number(capacity.human_committed_count),
        forcedExternalCount: Number(capacity.forced_external_count),
        activeExpediteCount: Number(capacity.active_expedite_count),
        claimSetHash: String(capacity.claim_set_hash) as `sha256:${string}`,
        reservationSetHash: String(capacity.reservation_set_hash) as `sha256:${string}`,
        expediteSetHash: String(capacity.expedite_set_hash) as `sha256:${string}`,
        sessionRef: input.expectedState.sessionRef,
        operationalProjectionRef: input.expectedState.operationalProjectionRef,
      });
      const actionId = uuid(`wip-admission-override:${decisionId}`);
      const approvalId = uuid(`wip-admission-override-approval:${decisionId}`);
      const workItemRef = Object.freeze({
        sourceType: "WORK_ITEM_REVISION",
        sourceId: input.workItemId,
        sourceVersion: subject.version,
        semanticHash: subject.semanticHash,
      });
      const pair = prepareCapacityQueueAction({
        actionId,
        actionKind: "WIP_ADMISSION_OVERRIDE",
        requestKey: `wip-override:${requestKeyHash}`,
        requestHash,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemRef,
        expectedState: fullExpected,
        authorizedCapacitySnapshotRef: input.authorizedScopeSnapshotRef,
        effect: Object.freeze({
          kind: "ALLOW_WIP_ADMISSION",
          activityKind: overrideActivity,
          sessionRef: input.expectedState.sessionRef,
          requestedSessionState:
            overrideActivity === "MANUAL_SESSION_RESUME" ? input.blockedFromState! : "RUNNING",
        }),
        reason: input.overrideIntent.reason,
        expiresAt: input.overrideIntent.expiresAt,
      });
      const requiredPermission = "queue.work-admit";
      const scopeWitness =
        input.authorizationScopeWitness ??
        projectSafeQueueAuthorizationWitness(
          pair.candidate.scope,
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            requiredPermission,
            classificationDecision: "ALLOW",
          },
          input.decidedAt,
        );
      const basis =
        input.initiatorAuthorizationBasis ??
        Object.freeze({ authorizationScopeWitnessHash: input.authorizationScopeWitnessHash });
      await new QueueActionCandidateRepository(this.source).saveQueueActionPair(
        {
          scope,
          pair,
          initiatorId: input.actor.principalId,
          initiatorAuthorizationBasis: basis,
          initiatorAuthorizationBasisHash: sha256(basis),
          createdAt: input.decidedAt,
        },
        manager,
      );
      const approval = createPlatformActionApprovalV2({
        approvalId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        initiator: input.approvalInitiator,
        initiatorAuthorizationScopeWitness: scopeWitness,
        action: Object.freeze({
          actionKind: "PLATFORM_ACTION",
          actionId,
          commandType: "queue.capacity.wip-admission-override",
        }),
        candidate: pair.candidate,
        requiredPermission,
        effectIdempotencyKey: `awp:wip-admission-override:${actionId}`,
        dataClassificationKey: "INTERNAL",
        expiresAt: input.overrideIntent.expiresAt,
        createdAt: input.decidedAt,
      });
      await new TypeOrmApprovalRepository(manager as unknown as DataSource).insertV2(approval);
      overrideCandidate = Object.freeze({
        actionId,
        approvalId,
        approvalSubjectHash: approval.subjectHash,
        publicIntentHash: pair.publicIntentHash,
        expiresAt: input.overrideIntent.expiresAt,
      });
    }
    return Object.freeze({
      outcome: evaluation.outcome,
      evaluation,
      decisionRef,
      mutationRefs: Object.freeze(mutationRefs),
      replayed: false,
      ...(overrideCandidate ? { overrideCandidate } : {}),
    });
  }
}

export interface PostgresAuthoritativeJiraCapacityReconciliationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly decidedAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export type PostgresAuthoritativeJiraCapacityReconciliationReceipt =
  | Readonly<{
      state: "RECONCILED";
      outcome: CapacityAdmissionEvaluation["outcome"];
      mutation:
        "UPSERT_FORCED_CLAIM" | "RELEASE_CLAIM_BLOCK" | "RELEASE_CLAIM_TERMINAL" | "NO_CHANGE";
      decisionRef: Readonly<{
        sourceType: "CAPACITY_ADMISSION_DECISION";
        sourceId: string;
        sourceVersion: 1;
        semanticHash: `sha256:${string}`;
      }>;
      replayed: boolean;
    }>
  | Readonly<{
      state: "SKIPPED";
      reasonCode:
        | "CONFIRMED_PROJECTION_NOT_FOUND"
        | "CONFIRMED_PROJECTION_NOT_CURRENT"
        | "POLICY_MAPPING_MISMATCH"
        | "QUEUE_PROJECTION_NOT_READY"
        | "CAPACITY_PROJECTION_NOT_READY"
        | "STATUS_NOT_CAPACITY_RELEVANT";
    }>;

function exactRefEqual(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>>,
): boolean {
  return (
    Boolean(left) &&
    String(left?.sourceId) === String(right.sourceId) &&
    Number(left?.sourceVersion) === Number(right.sourceVersion) &&
    String(left?.semanticHash) === String(right.semanticHash)
  );
}

/**
 * Converges a confirmed Jira projection into capacity without ever rejecting or
 * rewriting the operational projection. Unknown/stale facts are safe no-ops.
 */
export class PostgresAuthoritativeJiraCapacityReconciler {
  readonly #capacity: CapacityAdmissionRepository;
  readonly #authority: TypeOrmOperationalAuthorityRepository;

  constructor(private readonly source: DataSource) {
    this.#capacity = new CapacityAdmissionRepository(source);
    this.#authority = new TypeOrmOperationalAuthorityRepository(source);
  }

  async reconcile(
    input: PostgresAuthoritativeJiraCapacityReconciliationInput,
  ): Promise<PostgresAuthoritativeJiraCapacityReconciliationReceipt> {
    if (!Number.isFinite(Date.parse(input.decidedAt)))
      throw new Error("JIRA_CAPACITY_RECONCILIATION_TIME_INVALID");
    return await withBoundedSerializationRetry(
      async () =>
        await this.source.transaction(
          "SERIALIZABLE",
          async (manager) => await this.reconcileInTransaction(manager, input),
        ),
    );
  }

  async reconcileInTransaction(
    manager: EntityManager,
    input: PostgresAuthoritativeJiraCapacityReconciliationInput,
  ): Promise<PostgresAuthoritativeJiraCapacityReconciliationReceipt> {
    const scope = Object.freeze({
      kind: "PROJECT" as const,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    const capacity = await this.#capacity.lockWorkspaceCapacity(
      { kind: "WORKSPACE", workspaceId: input.workspaceId },
      manager,
    );
    if (!new Set(["MEASURE_ONLY", "ENFORCED"]).has(String(capacity.state)))
      throw new Error("JIRA_CAPACITY_RECONCILIATION_NOT_READY");
    const policyRef = runtimeJson<
      Readonly<{ sourceId: string; sourceVersion: number; semanticHash: `sha256:${string}` }>
    >(capacity.policy_ref);
    const policy = runtimeRows(
      await manager.query(
        `SELECT mode,workspace_human_wip_limit,active_expedite_limit,status_mapping_ref,
              external_active_consumes_wip,block_reason_rules
         FROM workspace_queue_policy_revisions
        WHERE workspace_id=$1 AND policy_revision_id=$2 AND revision_number=$3 AND semantic_hash=$4`,
        [input.workspaceId, policyRef.sourceId, policyRef.sourceVersion, policyRef.semanticHash],
      ),
    )[0];
    if (!policy || String(policy.mode) !== String(capacity.state))
      throw new Error("CAPACITY_POLICY_PIN_STALE");

    const projection = await this.#authority.confirmedProjectionForWorkItem(
      { workspaceId: input.workspaceId, projectId: input.projectId },
      input.workItemId,
      manager,
    );
    if (!projection)
      return Object.freeze({ state: "SKIPPED", reasonCode: "CONFIRMED_PROJECTION_NOT_FOUND" });
    if (projection.freshness !== "CURRENT")
      return Object.freeze({ state: "SKIPPED", reasonCode: "CONFIRMED_PROJECTION_NOT_CURRENT" });
    const mappingRef = runtimeJson<
      Readonly<{ sourceId?: string; sourceVersion?: number; id?: string; version?: number }>
    >(policy.status_mapping_ref);
    if (
      String(mappingRef.sourceId ?? mappingRef.id) !== projection.mappingRef.id ||
      Number(mappingRef.sourceVersion ?? mappingRef.version) !== projection.mappingRef.version
    ) {
      return Object.freeze({ state: "SKIPPED", reasonCode: "POLICY_MAPPING_MISMATCH" });
    }

    const operationalProjectionRef = Object.freeze({
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
      sourceId: projection.projectionId,
      sourceVersion: projection.revision,
      semanticHash: projection.authorityFieldsHash,
      observedAt: projection.observedAt,
      confirmedAt: projection.confirmedAt,
    });
    const queue = runtimeRows(
      await manager.query(
        `SELECT revision.policy_facet_ref,revision.qa_facet,revision.operational_facet,revision.source_set_hash
         FROM queue_entry_heads head JOIN queue_entry_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3
          AND head.suppressed_by_work_item_id IS NULL`,
        [input.workspaceId, input.projectId, input.workItemId],
      ),
    )[0];
    if (!queue)
      return Object.freeze({ state: "SKIPPED", reasonCode: "QUEUE_PROJECTION_NOT_READY" });
    const operationalFacet = runtimeJson<
      Readonly<{ projectionRef?: Readonly<Record<string, unknown>> }>
    >(queue.operational_facet);
    if (!exactRefEqual(operationalFacet.projectionRef, operationalProjectionRef)) {
      return Object.freeze({ state: "SKIPPED", reasonCode: "QUEUE_PROJECTION_NOT_READY" });
    }
    const capacityProjection = runtimeRows(
      await manager.query(
        `SELECT revision.safe_body
         FROM capacity_scope_projection_heads head JOIN capacity_scope_projection_revisions revision
           ON revision.workspace_id=head.workspace_id
          AND revision.capacity_projection_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.scope_kind='PROJECT' AND head.project_id=$2`,
        [input.workspaceId, input.projectId],
      ),
    )[0];
    if (!capacityProjection)
      return Object.freeze({ state: "SKIPPED", reasonCode: "CAPACITY_PROJECTION_NOT_READY" });
    const safeCapacity = runtimeJson<
      Readonly<{
        authorizedProjectionRef: Readonly<{
          id: string;
          version: number;
          semanticHash: `sha256:${string}`;
        }>;
      }>
    >(capacityProjection.safe_body);

    const status = projection.snapshot.normalizedStatus;
    const activeStatuses = runtimeJson<readonly string[]>(policy.external_active_consumes_wip);
    const operationalState =
      status === "DONE" || status === "CANCELLED"
        ? ("TERMINAL" as const)
        : status === "BLOCKED"
          ? ("BLOCKED" as const)
          : activeStatuses.includes(status)
            ? ("ACTIVE" as const)
            : undefined;
    if (!operationalState)
      return Object.freeze({ state: "SKIPPED", reasonCode: "STATUS_NOT_CAPACITY_RELEVANT" });
    const blockRules = runtimeJson<
      readonly Readonly<{
        normalizedStatus: "BLOCKED";
        reasonCode: string;
        wipEffect: "HOLD_WIP" | "RELEASE_WIP";
      }>[]
    >(policy.block_reason_rules);
    const confirmedBlockReason = projection.snapshot.blockReason?.normalizedReasonCode;
    const blockedWipEffect =
      operationalState === "BLOCKED"
        ? (blockRules.find(
            (rule) =>
              rule.normalizedStatus === "BLOCKED" && rule.reasonCode === confirmedBlockReason,
          )?.wipEffect ?? "HOLD_WIP")
        : undefined;

    const requestKeyHash = sha256(
      `jira-capacity-reconciliation:${input.workspaceId}:${input.projectId}:${input.workItemId}:${projection.projectionId}:${projection.revision}:${projection.authorityFieldsHash}:${policyRef.sourceId}:${policyRef.sourceVersion}`,
    );
    const authorizationScopeWitnessHash = sha256({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      requiredPermission: "queue.capacity.reconcile",
      classificationDecision: "SERVICE_ALLOW",
    } as JsonValue);
    const expectedState = Object.freeze({
      policyFacetRef: runtimeJson<
        Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>
      >(queue.policy_facet_ref),
      expectedQueueControlVersion: 0,
      operationalProjectionRef,
      qaSourceSetHash: (() => {
        const qa = runtimeJson<Readonly<{ factsRef?: Readonly<{ semanticHash?: string }> }>>(
          queue.qa_facet,
        );
        return String(qa.factsRef?.semanticHash ?? queue.source_set_hash) as `sha256:${string}`;
      })(),
    });
    const requestHash = sha256({
      activityKind: "EXTERNAL_JIRA_RECONCILIATION",
      expectedState,
      actor: { kind: "SERVICE", serviceId: "jira.capacity-reconciliation" },
      authorizationScopeWitnessHash,
    } as unknown as JsonValue);
    const existing = runtimeRows(
      await manager.query(
        "SELECT decision_id,request_hash,outcome,semantic_hash FROM capacity_admission_decisions WHERE workspace_id=$1 AND project_id=$2 AND request_key_hash=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, requestKeyHash],
      ),
    )[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash)
        throw new Error("CAPACITY_ADMISSION_IDEMPOTENCY_CONFLICT");
      return Object.freeze({
        state: "RECONCILED",
        outcome: String(existing.outcome) as CapacityAdmissionEvaluation["outcome"],
        mutation: "NO_CHANGE",
        replayed: true,
        decisionRef: Object.freeze({
          sourceType: "CAPACITY_ADMISSION_DECISION",
          sourceId: String(existing.decision_id),
          sourceVersion: 1,
          semanticHash: String(existing.semantic_hash) as `sha256:${string}`,
        }),
      });
    }

    const claim = await this.#capacity.currentHumanWipClaimRevision(
      scope,
      input.workItemId,
      manager,
    );
    const reservation = await this.#capacity.currentReviewReservationRevision(
      scope,
      input.workItemId,
      manager,
    );
    const activeClaim = claim?.state === "ACTIVE" ? claim : undefined;
    const activeReservation =
      reservation && new Set(["HELD", "COVERED_BY_CLAIM"]).has(reservation.state)
        ? reservation
        : undefined;
    const planned = reconcileAuthoritativeCapacityFact({
      policyMode: String(policy.mode) as "MEASURE_ONLY" | "ENFORCED",
      operationalState,
      ...(blockedWipEffect ? { blockedWipEffect } : {}),
      current: {
        humanCommittedCount: Number(capacity.human_committed_count),
        activeExpediteCount: Number(capacity.active_expedite_count),
      },
      workspaceHumanWipLimit:
        policy.workspace_human_wip_limit === null ? null : Number(policy.workspace_human_wip_limit),
      activeExpediteLimit:
        policy.active_expedite_limit === null ? null : Number(policy.active_expedite_limit),
      targetHasClaim: Boolean(activeClaim),
      targetHasReservation: Boolean(activeReservation),
      overflowAlreadyRecorded: false,
    });
    const mutationRefs: Readonly<Record<string, JsonValue>>[] = [];
    if (planned.mutation !== "NO_CHANGE") {
      const command =
        planned.mutation === "UPSERT_FORCED_CLAIM"
          ? Object.freeze({
              kind: "UPSERT" as const,
              cause: planned.cause as "EXTERNAL_ACTIVE" | "HELD_BLOCK" | "FORCED_EXTERNAL",
              at: input.decidedAt,
            })
          : planned.mutation === "RELEASE_CLAIM_BLOCK"
            ? Object.freeze({
                kind: "RELEASE_BLOCK" as const,
                cause: "HELD_BLOCK" as const,
                at: input.decidedAt,
              })
            : Object.freeze({
                kind: "RELEASE_TERMINAL" as const,
                cause: "EXTERNAL_ACTIVE" as const,
                at: input.decidedAt,
              });
      const transitioned = transitionHumanWipClaim({
        claimId: uuid(
          `human-wip-claim:${input.workspaceId}:${input.projectId}:${input.workItemId}:${(claim?.revision ?? 0) + 1}`,
        ),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        ...(claim ? { current: claim } : {}),
        command,
      });
      if (transitioned.outcome === "APPENDED") {
        await this.#capacity.appendHumanWipClaimRevision(
          scope,
          transitioned.claim,
          operationalProjectionRef,
          manager,
        );
        mutationRefs.push(capacityRef("HUMAN_WIP_CLAIM_REVISION", transitioned.claim));
      }
    }
    const reconciled =
      mutationRefs.length > 0
        ? await this.#capacity.reconcileWorkspaceCapacity(
            { kind: "WORKSPACE", workspaceId: input.workspaceId },
            input.decidedAt,
            manager,
            capacity,
          )
        : undefined;
    const decisionId = uuid(
      `capacity-admission:${input.workspaceId}:${input.projectId}:${requestKeyHash}`,
    );
    const witness = Object.freeze({
      policyMode: String(policy.mode),
      authorizedScopeSnapshotRef: safeCapacity.authorizedProjectionRef,
    });
    const violations =
      planned.outcome === "NON_DISCRETIONARY_OVERFLOW"
        ? Object.freeze(["HARD_WIP", "OVER_CAPACITY_EXTERNAL"] as const)
        : Object.freeze([]);
    const body = Object.freeze({
      schemaVersion: "capacity-admission@1.0.0",
      admissionDecisionId: decisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      request: Object.freeze({
        idempotencyKeyHash: requestKeyHash,
        requestHash,
        activityKind: "EXTERNAL_JIRA_RECONCILIATION" as const,
        actor: Object.freeze({
          kind: "SERVICE" as const,
          serviceId: "jira.capacity-reconciliation",
        }),
        authorizationScopeWitnessHash,
      }),
      expectedState,
      before: witness,
      outcome: planned.outcome,
      violatedConstraints: violations,
      effect:
        mutationRefs.length > 0
          ? Object.freeze({
              state: "COMMITTED" as const,
              mutationRefs: Object.freeze(mutationRefs),
            })
          : Object.freeze({ state: "NO_MUTATION" as const }),
      override: Object.freeze({ state: "NOT_USED" as const }),
      after: witness,
      reasonCode:
        planned.mutation === "RELEASE_CLAIM_BLOCK"
          ? "CONFIRMED_RELEASE_WIP"
          : planned.mutation === "RELEASE_CLAIM_TERMINAL"
            ? "CONFIRMED_TERMINAL"
            : planned.outcome === "NON_DISCRETIONARY_OVERFLOW"
              ? "CONFIRMED_EXTERNAL_OVERFLOW"
              : planned.mutation === "UPSERT_FORCED_CLAIM"
                ? "CONFIRMED_EXTERNAL_ACTIVE"
                : "CAPACITY_ALREADY_RECONCILED",
      decidedAt: input.decidedAt,
      recordedAt: input.decidedAt,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    const decision = Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) });
    validatePublicCapacityAdmission(decision);
    const beforeRef = Object.freeze({
      resourceVersion: Number(capacity.resource_version),
      claimSetHash: String(capacity.claim_set_hash),
      reservationSetHash: String(capacity.reservation_set_hash),
      expediteSetHash: String(capacity.expedite_set_hash),
    });
    const afterRef = Object.freeze({
      resourceVersion: Number(capacity.resource_version) + (reconciled?.changed ? 1 : 0),
      claimSetHash: reconciled?.accounting.claimSetHash ?? String(capacity.claim_set_hash),
      reservationSetHash:
        reconciled?.accounting.reservationSetHash ?? String(capacity.reservation_set_hash),
      expediteSetHash: reconciled?.accounting.expediteSetHash ?? String(capacity.expedite_set_hash),
    });
    await manager.query(
      `INSERT INTO capacity_admission_decisions(decision_id,workspace_id,project_id,work_item_id,request_key_hash,request_hash,activity_kind,outcome,policy_facet_ref,authorization_scope_witness_hash,before_ref,after_ref,action_candidate_ref,approval_ref,committed_effect_refs,violations,warnings,decided_at,semantic_hash)
       VALUES($1,$2,$3,$4,$5,$6,'EXTERNAL_JIRA_RECONCILIATION',$7,$8,$9,$10,$11,NULL,NULL,$12,$13,'[]'::jsonb,$14,$15)`,
      [
        decisionId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        requestKeyHash,
        requestHash,
        planned.outcome,
        JSON.stringify(expectedState.policyFacetRef),
        authorizationScopeWitnessHash,
        JSON.stringify(beforeRef),
        JSON.stringify(afterRef),
        JSON.stringify(mutationRefs),
        JSON.stringify(violations),
        input.decidedAt,
        decision.semanticHash,
      ],
    );
    const decisionRef = Object.freeze({
      sourceType: "CAPACITY_ADMISSION_DECISION" as const,
      sourceId: decisionId,
      sourceVersion: 1 as const,
      semanticHash: decision.semanticHash,
    });
    const eventType = planned.emitOverLimitDetected
      ? "capacity.over-limit-detected"
      : "capacity.admission.decided";
    const envelope = Object.freeze({
      envelopeVersion: 1,
      eventId: uuid(`${eventType}:${decisionId}`),
      eventType,
      occurredAt: input.decidedAt,
      recordedAt: input.decidedAt,
      producer: "jira.capacity-reconciliation",
      producerVersion: "1.0.0",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      entityType: "capacity-admission",
      entityId: decisionId,
      entityVersion: 1,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: body.request.actor,
      dataClassificationKey: "INTERNAL",
      payloadVersion: 1,
      payloadSchemaRef: Object.freeze({
        id: "urn:awp:schemas:006:capacity-admission:v1",
        version: 1,
        digest: decision.semanticHash,
      }),
      payload: decision,
    });
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        envelope.eventId,
        input.workspaceId,
        input.projectId,
        eventType,
        JSON.stringify(envelope),
        sha256(envelope as unknown as JsonValue),
        input.decidedAt,
      ],
    );
    if (reconciled?.changed) {
      const payload = Object.freeze({
        schemaVersion: "capacity-occupancy-changed@1.0.0",
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        admissionDecisionRef: decisionRef,
        authorizedProjectionRef: safeCapacity.authorizedProjectionRef,
        reconciledAt: input.decidedAt,
      });
      const occupancy = Object.freeze({
        ...envelope,
        eventId: uuid(`capacity-occupancy:${decisionId}`),
        eventType: "capacity.occupancy.changed",
        entityType: "capacity",
        entityId: input.workItemId,
        payloadSchemaRef: Object.freeze({
          id: "urn:awp:schemas:006:capacity-occupancy-changed:v1",
          version: 1,
          digest: sha256(payload as unknown as JsonValue),
        }),
        payload,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'capacity.occupancy.changed',$4,$5,'READY',$6)",
        [
          occupancy.eventId,
          input.workspaceId,
          input.projectId,
          JSON.stringify(occupancy),
          sha256(occupancy as unknown as JsonValue),
          input.decidedAt,
        ],
      );
    }
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'queue.capacity.reconcile-jira','SUCCEEDED',$6,$7,$8,NULL,'INTERNAL',$9)",
      [
        uuid(`jira-capacity-audit:${decisionId}`),
        input.workspaceId,
        input.projectId,
        input.decidedAt,
        JSON.stringify(body.request.actor),
        body.reasonCode,
        input.correlationId,
        input.causationId,
        JSON.stringify({
          operationalProjectionRef,
          decisionRef,
          mutationRefs,
          confirmedBlockReason: confirmedBlockReason ?? null,
        }),
      ],
    );
    return Object.freeze({
      state: "RECONCILED",
      outcome: planned.outcome,
      mutation: planned.mutation,
      decisionRef,
      replayed: false,
    });
  }
}

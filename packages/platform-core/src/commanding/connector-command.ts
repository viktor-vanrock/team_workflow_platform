import type {
  ActorReference,
  AuthorizationBasisRef,
  Clock,
  VersionedReference,
} from "../shared/primitives.ts";

export type CommandStatus =
  | "AWAITING_APPROVAL"
  | "QUEUED"
  | "DISPATCHED"
  | "RETRY_SCHEDULED"
  | "CONFIRMED"
  | "CONFLICT"
  | "FAILED"
  | "CANCELLED";
export type CommandEffectAuthorizationStatus =
  "NOT_REQUIRED" | "PENDING" | "AUTHORIZED" | "INVALIDATED" | "CONSUMED";
export type CommandOutboxStatus =
  "HELD" | "READY" | "LEASED" | "ENQUEUED" | "ACKNOWLEDGED" | "DEAD";
export interface CommandTerminalResult {
  readonly outcome: "SUCCEEDED" | "CONFLICT" | "FAILED";
  readonly code?: string;
  readonly receipt?: unknown;
}
export interface ConnectorCommandSnapshot {
  readonly status: CommandStatus;
  readonly effectAuthorizationStatus: CommandEffectAuthorizationStatus;
  readonly outboxStatus: CommandOutboxStatus;
  readonly terminalResult?: CommandTerminalResult;
  readonly effectInvocationStartedAt?: Date;
  readonly effectGateDecision?: "ALLOWED" | "DENIED";
  readonly effectGateReasonCode?: string;
  readonly effectGateEvaluatedAt?: Date;
  readonly effectAuthorizationBasis?: AuthorizationBasisRef;
  readonly effectAuthorizationBasisHash?: string;
  readonly approvalId?: string;
}
export interface ConnectorCommand extends ConnectorCommandSnapshot {
  readonly replayAuthorization?: Readonly<{ decisionId: string; expiresAt: Date }>;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: ActorReference;
  readonly commandType: string;
  readonly capability: Readonly<{
    key: string;
    exactContractVersion: string;
    operation: string;
    logicalRole: string;
  }>;
  readonly target: unknown;
  readonly targetHash: string;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly expectedExternalState: unknown;
  readonly bindingRef: VersionedReference;
  readonly profileRef: VersionedReference;
  readonly clientRequestKey: string;
  readonly effectIdempotencyKey: string;
  readonly dataClassificationKey: string;
  readonly initialAuthorizationBasis: AuthorizationBasisRef;
  readonly initialAuthorizationBasisHash: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly source: Readonly<{
    intakeDraftId?: string;
    confirmationVersion?: number;
    sourceWorkItemId?: string;
    intakeCandidateId?: string;
    agentRunId?: string;
    notificationIntentId?: string;
    causalHumanPrincipalId?: string;
  }>;
  readonly recoveryPolicy?: "SAFE_RETRY" | "LOOKUP_REQUIRED" | "NONE_AMBIGUOUS";
  readonly approvalId?: string;
  readonly effectAuthorizationBasis?: AuthorizationBasisRef;
  readonly effectAuthorizationBasisHash?: string;
  readonly effectGateEvaluatedAt?: Date;
  readonly executionLeaseExpiresAt?: Date;
  readonly attemptCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly rowVersion: number;
}

/** Service-driven GitLab retries retain the original human as their pilot participant. */
export function pilotCommandPrincipal(command: ConnectorCommand): string {
  if (
    command.actor.kind === "SERVICE" &&
    command.capability.key === "test-executor.trigger-status" &&
    command.capability.operation === "pipeline.trigger" &&
    command.source.causalHumanPrincipalId
  )
    return command.source.causalHumanPrincipalId;
  return command.actor.principalId;
}

export function validateConnectorCommandSnapshot(
  snapshot: Partial<ConnectorCommandSnapshot>,
): void {
  if (snapshot.status === "AWAITING_APPROVAL" && snapshot.outboxStatus !== "HELD")
    throw new Error("AWAITING_APPROVAL_REQUIRES_HELD_OUTBOX");
  if (snapshot.status === "AWAITING_APPROVAL" && snapshot.effectAuthorizationStatus !== "PENDING")
    throw new Error("AWAITING_APPROVAL_REQUIRES_PENDING_AUTHORIZATION");
  if (snapshot.status === "CONFIRMED" && snapshot.terminalResult?.outcome !== "SUCCEEDED")
    throw new Error("CONFIRMED_REQUIRES_SUCCESS_RESULT");
  if (snapshot.status === "CONFIRMED" && snapshot.outboxStatus !== "ACKNOWLEDGED")
    throw new Error("CONFIRMED_REQUIRES_ACKNOWLEDGED_OUTBOX");
  if (
    (snapshot.status === "FAILED" || snapshot.status === "CONFLICT") &&
    snapshot.terminalResult?.outcome === "SUCCEEDED"
  )
    throw new Error(`${snapshot.status}_REJECTS_SUCCESS_RESULT`);
  if (snapshot.effectGateDecision === "DENIED" && snapshot.effectInvocationStartedAt)
    throw new Error("DENIED_EFFECT_MUST_NOT_START");
  if (snapshot.effectGateDecision === "DENIED" && !snapshot.effectGateReasonCode)
    throw new Error("DENIED_EFFECT_REQUIRES_REASON");
  if (snapshot.effectInvocationStartedAt && snapshot.effectGateDecision !== "ALLOWED")
    throw new Error("INVOCATION_REQUIRES_ALLOWED_GATE");
  const gateFields = [
    snapshot.effectGateEvaluatedAt,
    snapshot.effectGateDecision,
    snapshot.effectAuthorizationBasis,
    snapshot.effectAuthorizationBasisHash,
  ];
  if (
    gateFields.some((value) => value !== undefined) &&
    gateFields.some((value) => value === undefined)
  )
    throw new Error("EFFECT_GATE_REQUIRES_EXACT_BASIS");
  if (
    snapshot.effectAuthorizationStatus === "PENDING" &&
    (snapshot.status !== "AWAITING_APPROVAL" || snapshot.outboxStatus !== "HELD")
  )
    throw new Error("PENDING_AUTHORIZATION_REQUIRES_AWAITING_HELD");
  if (
    snapshot.outboxStatus === "HELD" &&
    (snapshot.status !== "AWAITING_APPROVAL" || snapshot.effectAuthorizationStatus !== "PENDING")
  )
    throw new Error("HELD_OUTBOX_REQUIRES_AWAITING_PENDING");
  if (
    snapshot.effectAuthorizationStatus === "AUTHORIZED" &&
    (!new Set(["QUEUED", "RETRY_SCHEDULED"]).has(snapshot.status ?? "") ||
      !new Set(["READY", "LEASED", "ENQUEUED"]).has(snapshot.outboxStatus ?? "") ||
      snapshot.effectInvocationStartedAt)
  )
    throw new Error("AUTHORIZED_EFFECT_NOT_STARTED_REQUIRED");
  if (
    snapshot.effectAuthorizationStatus === "INVALIDATED" &&
    (snapshot.outboxStatus !== "DEAD" ||
      !new Set(["FAILED", "CANCELLED"]).has(snapshot.status ?? "") ||
      snapshot.effectGateDecision !== "DENIED" ||
      !snapshot.effectAuthorizationBasis ||
      !snapshot.effectAuthorizationBasisHash)
  )
    throw new Error("INVALIDATED_AUTHORIZATION_REQUIRES_DENIED_DEAD_BASIS");
  if (
    snapshot.status === "DISPATCHED" &&
    (snapshot.outboxStatus !== "ACKNOWLEDGED" ||
      !new Set(["NOT_REQUIRED", "CONSUMED"]).has(snapshot.effectAuthorizationStatus ?? "") ||
      !snapshot.effectInvocationStartedAt)
  )
    throw new Error("DISPATCHED_STATE_MATRIX_INVALID");
  if (
    snapshot.status === "QUEUED" &&
    (!new Set(["READY", "LEASED", "ENQUEUED"]).has(snapshot.outboxStatus ?? "") ||
      !new Set(["NOT_REQUIRED", "AUTHORIZED", "CONSUMED"]).has(
        snapshot.effectAuthorizationStatus ?? "",
      ))
  )
    throw new Error("QUEUED_STATE_MATRIX_INVALID");
  if (
    snapshot.status === "RETRY_SCHEDULED" &&
    (snapshot.outboxStatus !== "READY" ||
      !new Set(["NOT_REQUIRED", "AUTHORIZED", "CONSUMED"]).has(
        snapshot.effectAuthorizationStatus ?? "",
      ))
  )
    throw new Error("RETRY_STATE_MATRIX_INVALID");
  if (new Set(["CONFIRMED", "CONFLICT", "FAILED"]).has(snapshot.status ?? "")) {
    const expected = snapshot.status === "CONFIRMED" ? "SUCCEEDED" : snapshot.status;
    if (snapshot.terminalResult?.outcome !== expected)
      throw new Error("TERMINAL_RESULT_OUTCOME_MISMATCH");
  } else if (snapshot.terminalResult) throw new Error("NON_TERMINAL_RESULT_FORBIDDEN");
  if (
    snapshot.outboxStatus === "DEAD" &&
    !new Set(["CONFLICT", "FAILED", "CANCELLED"]).has(snapshot.status ?? "")
  )
    throw new Error("DEAD_OUTBOX_REQUIRES_TERMINAL_STATE");
  if (
    snapshot.status === "CONFIRMED" &&
    !new Set(["NOT_REQUIRED", "CONSUMED"]).has(snapshot.effectAuthorizationStatus ?? "")
  )
    throw new Error("CONFIRMED_EFFECT_AUTHORIZATION_INVALID");
}

export interface DurableCommandStore {
  command(): ConnectorCommand;
  deliverable(now: Date): boolean;
  markEnqueued(now: Date): void;
  markDispatched(now: Date, leaseMs: number): void;
  confirm(result: unknown, now: Date): void;
  fail(code: string, now: Date): void;
  recover(now: Date): void;
}

export class InMemoryDurableCommandStore implements DurableCommandStore {
  #command: ConnectorCommand;
  constructor(command: ConnectorCommand) {
    validateConnectorCommandSnapshot(command);
    this.#command = structuredClone(command);
  }
  static readyFixture(): InMemoryDurableCommandStore {
    const at = new Date("2026-01-01T00:00:00.000Z");
    return new InMemoryDurableCommandStore({
      id: "command-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      actor: { kind: "SERVICE", principalId: "service-1", serviceKey: "test" },
      commandType: "sample.record.publish",
      capability: {
        key: "sample.record",
        exactContractVersion: "1.0.0",
        operation: "record.publish",
        logicalRole: "FIXTURE_ROLE",
      },
      target: { id: "record-1" },
      targetHash: "sha256:target",
      payload: { message: "hello" },
      payloadHash: "sha256:payload",
      expectedExternalState: { mode: "MUST_NOT_EXIST" },
      bindingRef: { id: "binding-1", version: 1 },
      profileRef: { id: "profile-1", version: 1 },
      clientRequestKey: "request-1",
      effectIdempotencyKey: "effect-1",
      dataClassificationKey: "INTERNAL",
      initialAuthorizationBasis: {
        kind: "PROJECT",
        policyVersion: "policy@1",
        membershipRef: { id: "m", version: 1 },
        roleAssignmentRefs: [],
        entitlementRefs: [],
        skillContext: "NOT_APPLICABLE",
      },
      initialAuthorizationBasisHash: "sha256:basis",
      correlationId: "correlation-1",
      causationId: "causation-1",
      source: { intakeDraftId: "draft-1" },
      status: "QUEUED",
      effectAuthorizationStatus: "NOT_REQUIRED",
      outboxStatus: "READY",
      attemptCount: 0,
      createdAt: at,
      updatedAt: at,
      rowVersion: 1,
    });
  }
  command(): ConnectorCommand {
    return structuredClone(this.#command);
  }
  deliverable(now: Date): boolean {
    return (
      this.#command.outboxStatus === "READY" ||
      this.#command.outboxStatus === "ENQUEUED" ||
      (this.#command.status === "DISPATCHED" &&
        !!this.#command.executionLeaseExpiresAt &&
        this.#command.executionLeaseExpiresAt <= now)
    );
  }
  markEnqueued(now: Date): void {
    this.#replace({ status: "QUEUED", outboxStatus: "ENQUEUED", updatedAt: now });
  }
  markDispatched(now: Date, leaseMs: number): void {
    this.#replace({
      status: "DISPATCHED",
      outboxStatus: "ACKNOWLEDGED",
      effectInvocationStartedAt: now,
      effectGateDecision: "ALLOWED",
      effectGateEvaluatedAt: now,
      effectAuthorizationBasis: this.#command.initialAuthorizationBasis,
      effectAuthorizationBasisHash: this.#command.initialAuthorizationBasisHash,
      executionLeaseExpiresAt: new Date(now.getTime() + leaseMs),
      attemptCount: this.#command.attemptCount + 1,
      updatedAt: now,
    });
  }
  confirm(result: unknown, now: Date): void {
    this.#replace({
      status: "CONFIRMED",
      outboxStatus: "ACKNOWLEDGED",
      terminalResult: { outcome: "SUCCEEDED", receipt: result },
      executionLeaseExpiresAt: undefined,
      updatedAt: now,
    });
  }
  fail(code: string, now: Date): void {
    this.#replace({
      status: "FAILED",
      outboxStatus: "DEAD",
      terminalResult: { outcome: "FAILED", code },
      executionLeaseExpiresAt: undefined,
      updatedAt: now,
    });
  }
  recover(now: Date): void {
    const lookupOnly =
      this.#command.recoveryPolicy === "LOOKUP_REQUIRED" ||
      this.#command.recoveryPolicy === "NONE_AMBIGUOUS";
    if (
      this.#command.status === "DISPATCHED" &&
      this.#command.executionLeaseExpiresAt &&
      this.#command.executionLeaseExpiresAt <= now &&
      (!this.#command.effectInvocationStartedAt || !lookupOnly)
    ) {
      this.#replace({
        status: "QUEUED",
        outboxStatus: "READY",
        executionLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    }
  }
  #replace(patch: Record<string, unknown>): void {
    const value = {
      ...this.#command,
      ...patch,
      rowVersion: this.#command.rowVersion + 1,
    } as ConnectorCommand;
    validateConnectorCommandSnapshot(value);
    this.#command = structuredClone(value);
  }
}

export function commandLeaseExpired(command: ConnectorCommand, clock: Clock): boolean {
  return !!command.executionLeaseExpiresAt && command.executionLeaseExpiresAt <= clock.now();
}

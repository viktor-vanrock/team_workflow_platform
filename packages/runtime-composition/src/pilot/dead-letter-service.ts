import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ActorReference,
  approvalSubjectV2Hash,
  assertExactRevisionRef,
  assertProjectScope,
  type AuthorizationBasisRef,
  type ConnectorCommand,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  freezePilotValue,
  parseApprovalSubject,
  type ProjectScope,
  type ReadableApprovalSubject,
  recomputeExactApprovalSubjectHash,
  validateAuthorizationBasis,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

import {
  assessDeadLetterReplay,
  deadLetterCommandHash,
  safeDeadLetterReason,
} from "./dead-letter-policy.ts";

const digest = (value: unknown) => sha256(value as JsonValue);
const uuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
export interface DeadLetterAccess {
  readonly actor: ActorReference;
  readonly basis: AuthorizationBasisRef;
  readonly classificationCeiling: string;
  readonly scope: Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>;
}
export interface DeadLetterContext extends ProjectScope {
  authorize(permission: "pilot.replay.read" | "pilot.replay.decide"): Promise<DeadLetterAccess>;
}
export interface DeadLetterPolicy extends ProjectScope {
  readonly ref: ExactRevisionRef;
  readonly ownerRef: string;
  readonly maximumAgeMs: number;
  readonly maximumReplays: number;
}
export interface OriginalReplayProof {
  readonly reportRef: ExactRevisionRef;
  readonly fenceRef: ExactRevisionRef;
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly expiresAt: string;
}
export interface OriginalReplayGuard {
  /** Must recheck original initiator/approver rights, Pack admission, current
   * configuration, provider certainty and deployment/cohort fences. No I/O writes.
   * Holds any required Core locks in this transaction until the requeue commits. */
  check(
    command: ConnectorCommand,
    approval: ReadableApprovalSubject | undefined,
    manager: EntityManager,
    now: Date,
  ): Promise<OriginalReplayProof>;
}
interface DeadLetterRecord extends ProjectScope {
  readonly schemaVersion: 1;
  readonly commandId: string;
  readonly commandHash: string;
  readonly capturedRowVersion: number;
  readonly effectKeyHash: string;
  readonly policyRef: ExactRevisionRef;
  readonly ownerRef: string;
  readonly firstFailureAt: string;
  readonly expiresAt: string;
  readonly reasonCode: string;
  readonly approvalRef: ExactRevisionRef | null;
}
type Stored = { semantic_body: DeadLetterRecord; content_hash: `sha256:${string}` };
export interface ReplayDecisionInput {
  readonly commandId: string;
  readonly recordRef: ExactRevisionRef;
  readonly expectedRowVersion: number;
  readonly requestKey: string;
  readonly reason: "DEPENDENCY_REPAIRED" | "ACCESS_RESTORED";
}
export interface ReplayDecision {
  readonly decisionId: string;
  readonly commandId: string;
  readonly outcome: "REQUEUED";
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly resultingRowVersion: number;
}
export interface DeadLetterView {
  readonly commandId: string;
  readonly rowVersion: number;
  readonly recordRef?: ExactRevisionRef;
  readonly ownerRef: string;
  readonly commandAgeMs: number;
  readonly firstFailureAt: string;
  readonly lastFailureAt: string;
  readonly expiresAt: string;
  readonly attemptCount: number;
  readonly reasonCode: string;
  readonly certainty: "NOT_DISPATCHED" | "UNRESOLVED";
  readonly eligibility: string;
  readonly replayCount: number;
}

/** Immutable diagnostics/decisions augment the existing Core command/outbox.
 * Replays never create a command, effect key, approval or external request. */
export class PilotDeadLetterService {
  readonly #policies: readonly DeadLetterPolicy[];
  readonly #commands: TypeOrmCommandRepository;
  constructor(
    private readonly database: DataSource,
    policies: readonly DeadLetterPolicy[],
    private readonly guard: OriginalReplayGuard,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.#policies = freezePilotValue(structuredClone(policies));
    this.#commands = new TypeOrmCommandRepository(database);
    const scopes = new Set<string>();
    for (const policy of this.#policies) {
      assertProjectScope(policy);
      assertExactRevisionRef(policy.ref);
      const key = `${policy.workspaceId}:${policy.projectId}`;
      const { ref: policyRef, ...policyBody } = policy;
      if (
        digest(policyBody) !== policyRef.contentHash ||
        scopes.has(key) ||
        !uuid(policy.ownerRef) ||
        !Number.isSafeInteger(policy.maximumAgeMs) ||
        policy.maximumAgeMs < 1000 ||
        policy.maximumAgeMs > 604800000 ||
        !Number.isSafeInteger(policy.maximumReplays) ||
        policy.maximumReplays < 1 ||
        policy.maximumReplays > 10
      )
        throw new Error("DEAD_LETTER_POLICY_INVALID");
      scopes.add(key);
    }
  }
  async list(context: DeadLetterContext, input: Readonly<{ after?: string; limit?: number }> = {}) {
    const policy = this.policy(context);
    await this.authorize(context, "pilot.replay.read");
    const limit = input.limit ?? 25;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (input.after !== undefined && !uuid(input.after))
    )
      throw new Error("DEAD_LETTER_QUERY_INVALID");
    return this.database.transaction(async (manager) => {
      await this.deadline(manager);
      const rows = (await manager.query(
        "SELECT c.id FROM connector_commands c WHERE c.workspace_id=$1 AND c.project_id=$2 AND c.state IN ('FAILED','CONFLICT','CANCELLED') AND EXISTS(SELECT 1 FROM command_outbox o WHERE o.workspace_id=c.workspace_id AND o.project_id=c.project_id AND o.command_id=c.id AND o.state='DEAD') AND ($3::uuid IS NULL OR c.id>$3) ORDER BY c.id LIMIT $4",
        [context.workspaceId, context.projectId, input.after ?? null, limit + 1],
      )) as Array<{ id: string }>;
      const items: DeadLetterView[] = [];
      for (const row of rows.slice(0, limit)) {
        const command = await this.mustLoad(manager, context, row.id);
        await this.authorize(context, "pilot.replay.read", command.dataClassificationKey);
        const record = await this.record(manager, context, command.id),
          now = this.now(),
          count = await this.replayCount(manager, context, command.id);
        const expiresAt =
          record?.semantic_body.expiresAt ??
          new Date(command.createdAt.getTime() + policy.maximumAgeMs).toISOString();
        let eligibility = record
          ? (assessDeadLetterReplay(command, {
              originalHash: record.semantic_body.commandHash,
              now: now.getTime(),
              expiresAt: Date.parse(expiresAt),
              replayCount: count,
              maximumReplays: policy.maximumReplays,
            }) as string)
          : "DIAGNOSTICS_REQUIRED";
        if (record && digest(record.semantic_body.policyRef) !== digest(policy.ref))
          eligibility = "POLICY_CHANGED";
        if (eligibility === "ELIGIBLE") {
          try {
            await this.checkOriginal(manager, command, record!.semantic_body, now);
          } catch {
            eligibility = "CURRENT_AUTHORITY_REQUIRED";
          }
        }
        items.push({
          commandId: command.id,
          rowVersion: command.rowVersion,
          ...(record
            ? { recordRef: { id: command.id, version: 1, contentHash: record.content_hash } }
            : {}),
          ownerRef: record?.semantic_body.ownerRef ?? policy.ownerRef,
          commandAgeMs: Math.max(0, now.getTime() - command.createdAt.getTime()),
          firstFailureAt: record?.semantic_body.firstFailureAt ?? command.updatedAt.toISOString(),
          lastFailureAt: command.updatedAt.toISOString(),
          expiresAt,
          attemptCount: command.attemptCount,
          reasonCode: safeDeadLetterReason(command),
          certainty: command.effectInvocationStartedAt ? "UNRESOLVED" : "NOT_DISPATCHED",
          eligibility,
          replayCount: count,
        });
      }
      await this.authorize(context, "pilot.replay.read");
      return freezePilotValue({
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        evaluatedAt: this.now().toISOString(),
        items,
        ...(rows.length > limit ? { nextCursor: rows[limit - 1]!.id } : {}),
      });
    });
  }
  async capture(context: DeadLetterContext, commandId: string): Promise<ExactRevisionRef> {
    const policy = this.policy(context);
    await this.authorize(context, "pilot.replay.decide");
    return this.database.transaction(async (manager) => {
      await this.deadline(manager);
      const command = await this.lock(manager, context, commandId);
      const actor = await this.authorize(
        context,
        "pilot.replay.decide",
        command.dataClassificationKey,
      );
      const existing = await this.record(manager, context, commandId);
      if (existing) {
        if (existing.semantic_body.commandHash !== deadLetterCommandHash(command))
          throw new Error("DEAD_LETTER_COMMAND_CHANGED");
        return { id: commandId, version: 1, contentHash: existing.content_hash };
      }
      if (
        command.outboxStatus !== "DEAD" ||
        !["FAILED", "CONFLICT", "CANCELLED"].includes(command.status)
      )
        throw new Error("DEAD_LETTER_STATE_CONFLICT");
      const approval = await this.approval(manager, command);
      const record: DeadLetterRecord = {
        schemaVersion: 1,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        commandId,
        commandHash: deadLetterCommandHash(command),
        capturedRowVersion: command.rowVersion,
        effectKeyHash: digest(command.effectIdempotencyKey),
        policyRef: policy.ref,
        ownerRef: policy.ownerRef,
        firstFailureAt: command.updatedAt.toISOString(),
        expiresAt: new Date(command.createdAt.getTime() + policy.maximumAgeMs).toISOString(),
        reasonCode: safeDeadLetterReason(command),
        approvalRef: approval
          ? { id: command.approvalId!, version: approval.version, contentHash: approval.hash }
          : null,
      };
      const hash = digest(record);
      await manager.query(
        "INSERT INTO pilot_dead_letters(workspace_id,project_id,command_id,owner_ref,first_failure_at,expires_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          context.workspaceId,
          context.projectId,
          commandId,
          policy.ownerRef,
          record.firstFailureAt,
          record.expiresAt,
          JSON.stringify(record),
          hash,
        ],
      );
      await this.audit(manager, command, actor, "pilot.dead-letter.capture", {
        commandId,
        recordHash: hash,
        ownerRef: policy.ownerRef,
      });
      return { id: commandId, version: 1, contentHash: hash };
    });
  }
  async replay(context: DeadLetterContext, supplied: ReplayDecisionInput): Promise<ReplayDecision> {
    const input = freezePilotValue(structuredClone(supplied)),
      policy = this.policy(context);
    await this.authorize(context, "pilot.replay.decide");
    if (
      !input ||
      !uuid(input.commandId) ||
      typeof input.requestKey !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/u.test(input.requestKey) ||
      !Number.isSafeInteger(input.expectedRowVersion) ||
      input.expectedRowVersion < 1 ||
      !["DEPENDENCY_REPAIRED", "ACCESS_RESTORED"].includes(input.reason) ||
      Object.keys(input).some(
        (key) =>
          !["commandId", "recordRef", "expectedRowVersion", "requestKey", "reason"].includes(key),
      )
    )
      throw new Error("DEAD_LETTER_DECISION_INVALID");
    assertExactRevisionRef(input.recordRef);
    return this.database.transaction(async (manager) => {
      await this.deadline(manager);
      const command = await this.lock(manager, context, input.commandId);
      const actor = await this.authorize(
          context,
          "pilot.replay.decide",
          command.dataClassificationKey,
        ),
        record = await this.record(manager, context, input.commandId);
      if (
        !record ||
        input.recordRef.id !== command.id ||
        input.recordRef.version !== 1 ||
        input.recordRef.contentHash !== record.content_hash ||
        digest(record.semantic_body.policyRef) !== digest(policy.ref)
      )
        throw new Error("DEAD_LETTER_RECORD_CHANGED");
      if (deadLetterCommandHash(command) !== record.semantic_body.commandHash)
        throw new Error("DEAD_LETTER_COMMAND_CHANGED");
      const now = this.now(),
        proof = await this.checkOriginal(manager, command, record.semantic_body, now);
      const requestHash = digest({ ...input, actor: actor.actor });
      const prior = (await manager.query(
        "SELECT request_hash,semantic_body,content_hash FROM pilot_replay_decisions WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND request_key=$4",
        [context.workspaceId, context.projectId, command.id, input.requestKey],
      )) as Array<{ request_hash: string; semantic_body: ReplayDecision; content_hash: string }>;
      if (prior[0]) {
        if (
          prior[0].request_hash !== requestHash ||
          digest(prior[0].semantic_body) !== prior[0].content_hash
        )
          throw new Error("DEAD_LETTER_IDEMPOTENCY_CONFLICT");
        return this.result(prior[0].semantic_body);
      }
      if (command.rowVersion !== input.expectedRowVersion)
        throw new Error("DEAD_LETTER_VERSION_CONFLICT");
      const count = await this.replayCount(manager, context, command.id);
      const eligibility = assessDeadLetterReplay(command, {
        originalHash: record.semantic_body.commandHash,
        now: now.getTime(),
        expiresAt: Date.parse(record.semantic_body.expiresAt),
        replayCount: count,
        maximumReplays: policy.maximumReplays,
      });
      if (eligibility !== "ELIGIBLE") throw new Error(`DEAD_LETTER_${eligibility}`);
      const decisionId = randomUUID(),
        expiresAt = new Date(
          Math.min(Date.parse(proof.expiresAt), Date.parse(record.semantic_body.expiresAt)),
        );
      const updated: ConnectorCommand = {
        ...command,
        status: "QUEUED",
        outboxStatus: "READY",
        replayAuthorization: { decisionId, expiresAt },
        updatedAt: now,
        rowVersion: command.rowVersion + 1,
      };
      delete (updated as { terminalResult?: unknown }).terminalResult;
      delete (updated as { executionLeaseExpiresAt?: Date }).executionLeaseExpiresAt;
      validateConnectorCommandSnapshot(updated);
      const finalActor = await this.authorize(
        context,
        "pilot.replay.decide",
        command.dataClassificationKey,
      );
      if (digest(finalActor.actor) !== digest(actor.actor))
        throw new Error("DEAD_LETTER_ACCESS_DENIED");
      const finalProof = await this.checkOriginal(
        manager,
        command,
        record.semantic_body,
        this.now(),
      );
      if (digest(finalProof) !== digest(proof) || this.now().getTime() >= expiresAt.getTime())
        throw new Error("DEAD_LETTER_CURRENT_AUTHORITY_REQUIRED");
      await this.#commands.save(updated, command.rowVersion, manager);
      await manager.query(
        "UPDATE command_outbox SET state='READY',available_at=$4,lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state='DEAD'",
        [context.workspaceId, context.projectId, command.id, now],
      );
      const decision = {
        decisionId,
        commandId: command.id,
        outcome: "REQUEUED" as const,
        recordedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        resultingRowVersion: updated.rowVersion,
        recordRef: input.recordRef,
        originalCommandHash: record.semantic_body.commandHash,
        expectedRowVersion: command.rowVersion,
        reason: input.reason,
        actor: actor.actor,
        proof,
      };
      await manager.query(
        "INSERT INTO pilot_replay_decisions(id,workspace_id,project_id,command_id,request_key,actor_ref,request_hash,semantic_body,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          decision.decisionId,
          context.workspaceId,
          context.projectId,
          command.id,
          input.requestKey,
          actor.actor.principalId,
          requestHash,
          JSON.stringify(decision),
          digest(decision),
          now,
        ],
      );
      await this.audit(manager, command, finalActor, "pilot.replay.decide", {
        decisionId: decision.decisionId,
        commandId: command.id,
        recordHash: record.content_hash,
        decisionHash: digest(decision),
      });
      return this.result(decision);
    });
  }
  private async lock(
    manager: EntityManager,
    scope: ProjectScope,
    id: string,
  ): Promise<ConnectorCommand> {
    if (!uuid(id)) throw new Error("DEAD_LETTER_RESOURCE_UNAVAILABLE");
    // Same lock order as the existing dispatcher: outbox, then command.
    const outbox = (await manager.query(
      "SELECT id,state FROM command_outbox WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 FOR UPDATE",
      [scope.workspaceId, scope.projectId, id],
    )) as Array<{ id: string; state: string }>;
    if (outbox.length !== 1) throw new Error("DEAD_LETTER_RESOURCE_UNAVAILABLE");
    await manager.query(
      "SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      [scope.workspaceId, scope.projectId, id],
    );
    const command = await this.mustLoad(manager, scope, id);
    if (command.outboxStatus === "DEAD" && outbox[0]!.state !== "DEAD")
      throw new Error("DEAD_LETTER_VERSION_CONFLICT");
    return command;
  }
  private async mustLoad(
    manager: EntityManager,
    scope: ProjectScope,
    id: string,
  ): Promise<ConnectorCommand> {
    const command = await this.#commands.get(scope.workspaceId, scope.projectId, id, manager);
    if (!command) throw new Error("DEAD_LETTER_RESOURCE_UNAVAILABLE");
    validateConnectorCommandSnapshot(command);
    return command;
  }
  private async record(
    manager: EntityManager,
    scope: ProjectScope,
    id: string,
  ): Promise<Stored | undefined> {
    const rows = (await manager.query(
      "SELECT semantic_body,content_hash FROM pilot_dead_letters WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3",
      [scope.workspaceId, scope.projectId, id],
    )) as Stored[];
    const row = rows[0];
    if (
      row &&
      (digest(row.semantic_body) !== row.content_hash ||
        row.semantic_body.commandId !== id ||
        row.semantic_body.workspaceId !== scope.workspaceId ||
        row.semantic_body.projectId !== scope.projectId)
    )
      throw new Error("DEAD_LETTER_RECORD_CHANGED");
    return row;
  }
  private async approval(manager: EntityManager, command: ConnectorCommand) {
    if (!command.approvalId) return undefined;
    const rows = (await manager.query(
      "SELECT subject,subject_hash,action_id,initiator_id,approver_id,decision_state,effect_authorization_state,expires_at,row_version FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR SHARE",
      [command.workspaceId, command.projectId, command.approvalId],
    )) as Array<{
      subject: unknown;
      subject_hash: `sha256:${string}`;
      action_id: string;
      initiator_id: string;
      approver_id: string | null;
      decision_state: string;
      effect_authorization_state: string;
      expires_at: Date;
      row_version: number;
    }>;
    const row = rows[0];
    if (!row) throw new Error("DEAD_LETTER_APPROVAL_REQUIRED");
    const value = parseApprovalSubject(row.subject),
      v2 = "schemaVersion" in value;
    const hash = v2 ? approvalSubjectV2Hash(value) : recomputeExactApprovalSubjectHash(value);
    if (
      hash !== row.subject_hash ||
      value.subjectHash !== hash ||
      value.action.actionKind !== "EXTERNAL_COMMAND" ||
      value.action.actionId !== command.id ||
      row.action_id !== command.id ||
      value.action.commandType !== command.commandType ||
      value.action.operation !== command.capability.operation ||
      value.action.capabilityKey !== command.capability.key ||
      value.action.capabilityVersion !== command.capability.exactContractVersion ||
      row.initiator_id !== command.actor.principalId ||
      (value.initiator && digest(value.initiator) !== digest(command.actor)) ||
      (v2 ? value.initiator.principalId : value.initiatorId) !== command.actor.principalId ||
      row.approver_id !==
        (v2
          ? (value.decision?.approver.principalId ?? null)
          : (value.decision?.approverId ?? null)) ||
      value.workspaceId !== command.workspaceId ||
      value.projectId !== command.projectId ||
      value.targetHash !== command.targetHash ||
      value.payloadHash !== command.payloadHash ||
      value.effectIdempotencyKey !== command.effectIdempotencyKey ||
      digest(value.bindingRef) !== digest(command.bindingRef) ||
      digest(value.profileRefs) !== digest([command.profileRef]) ||
      digest(v2 ? value.expectedExternalState : value.expectedState) !==
        digest(command.expectedExternalState) ||
      new Date(value.expiresAt).getTime() !== new Date(row.expires_at).getTime() ||
      row.decision_state !== value.decisionStatus ||
      row.effect_authorization_state !== value.effectAuthorizationStatus
    )
      throw new Error("DEAD_LETTER_APPROVAL_CHANGED");
    return { value, hash: row.subject_hash, version: row.row_version };
  }
  private async checkOriginal(
    manager: EntityManager,
    command: ConnectorCommand,
    record: DeadLetterRecord,
    now: Date,
  ): Promise<OriginalReplayProof> {
    const approval = await this.approval(manager, command);
    if (
      !!record.approvalRef !== !!approval ||
      (approval &&
        (!record.approvalRef ||
          record.approvalRef.contentHash !== approval.hash ||
          record.approvalRef.version !== approval.version ||
          approval.value.decisionStatus !== "APPROVED" ||
          !["AUTHORIZED", "CONSUMED"].includes(approval.value.effectAuthorizationStatus) ||
          new Date(approval.value.expiresAt).getTime() <= now.getTime()))
    )
      throw new Error("DEAD_LETTER_APPROVAL_EXPIRED_OR_CHANGED");
    if (command.effectAuthorizationStatus !== "NOT_REQUIRED" && !approval)
      throw new Error("DEAD_LETTER_APPROVAL_REQUIRED");
    const proof = freezePilotValue(
      structuredClone(await this.guard.check(command, approval?.value, manager, now)),
    );
    [proof.reportRef, proof.fenceRef, proof.bindingRef, proof.profileRef].forEach(
      assertExactRevisionRef,
    );
    if (
      proof.bindingRef.id !== command.bindingRef.id ||
      proof.bindingRef.version !== command.bindingRef.version ||
      proof.profileRef.id !== command.profileRef.id ||
      proof.profileRef.version !== command.profileRef.version ||
      !Number.isFinite(Date.parse(proof.expiresAt)) ||
      Date.parse(proof.expiresAt) <= this.now().getTime()
    )
      throw new Error("DEAD_LETTER_CURRENT_AUTHORITY_REQUIRED");
    return {
      ...proof,
      expiresAt: new Date(
        Math.min(
          Date.parse(proof.expiresAt),
          approval ? new Date(approval.value.expiresAt).getTime() : Infinity,
        ),
      ).toISOString(),
    };
  }
  private async replayCount(
    manager: EntityManager,
    scope: ProjectScope,
    id: string,
  ): Promise<number> {
    const rows = (await manager.query(
      "SELECT count(*)::int AS count FROM pilot_replay_decisions WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3",
      [scope.workspaceId, scope.projectId, id],
    )) as Array<{ count: number }>;
    return rows[0]!.count;
  }
  private async authorize(
    context: DeadLetterContext,
    permission: "pilot.replay.read" | "pilot.replay.decide",
    classification = "CONFIDENTIAL",
  ): Promise<DeadLetterAccess> {
    const value = await context.authorize(permission);
    validateAuthorizationBasis(
      { kind: "PROJECT", workspaceId: context.workspaceId, projectId: context.projectId },
      value.basis,
    );
    if (
      value.scope.kind !== "PROJECT" ||
      value.scope.workspaceId !== context.workspaceId ||
      value.scope.projectId !== context.projectId ||
      !uuid(value.actor.principalId) ||
      (permission === "pilot.replay.decide" && value.actor.kind !== "HUMAN") ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(value.classificationCeiling),
        defaultClassificationCatalog.reference(classification),
      ) ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(value.classificationCeiling),
        defaultClassificationCatalog.reference("CONFIDENTIAL"),
      )
    )
      throw new Error("DEAD_LETTER_ACCESS_DENIED");
    return value;
  }
  private policy(scope: ProjectScope): DeadLetterPolicy {
    assertProjectScope(scope);
    const policy = this.#policies.find(
      (value) => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
    );
    if (!policy) throw new Error("DEAD_LETTER_ACCESS_DENIED");
    return policy;
  }
  private async deadline(manager: EntityManager) {
    await manager.query("SET LOCAL statement_timeout='5s'");
    await manager.query("SET LOCAL lock_timeout='5s'");
  }
  private now(): Date {
    const now = new Date(this.clock());
    if (!Number.isFinite(now.getTime())) throw new Error("DEAD_LETTER_CLOCK_INVALID");
    return now;
  }
  private result(value: ReplayDecision): ReplayDecision {
    return freezePilotValue({
      decisionId: value.decisionId,
      commandId: value.commandId,
      outcome: value.outcome,
      recordedAt: value.recordedAt,
      expiresAt: value.expiresAt,
      resultingRowVersion: value.resultingRowVersion,
    });
  }
  private async audit(
    manager: EntityManager,
    command: ConnectorCommand,
    access: DeadLetterAccess,
    action: string,
    values: JsonValue,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED','ORIGINAL_COMMAND_PRESERVED',$7,$8,$9,$10,$11)",
      [
        randomUUID(),
        command.workspaceId,
        command.projectId,
        this.now(),
        JSON.stringify(access.actor),
        action,
        command.correlationId,
        command.causationId,
        JSON.stringify(access.basis),
        command.dataClassificationKey,
        JSON.stringify({ values, versionRefs: [command.bindingRef, command.profileRef] }),
      ],
    );
  }
}

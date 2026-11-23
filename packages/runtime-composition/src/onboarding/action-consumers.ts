import type { DataSource, EntityManager } from "typeorm";

import { recalculateProjectResumeMode } from "@awp/competency-qa/node";
import {
  assertOnboardingTransition,
  consumeAuthorizedProjectAction,
  createOnboardingRevision,
  createProjectEventEnvelope,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  isSystemAdministratorRole,
  onboardingContentHash,
  type ProjectActionApproval,
  type ProjectActionCandidate,
  type ProjectEventEnvelope,
  type ProjectOnboardingRevision,
  type ProjectResumeActionCandidate,
  projectResumePrerequisitesCurrent,
  type ProjectScope,
} from "@awp/platform-core";
import { ProjectOnboardingRepository } from "@awp/platform-persistence-typeorm";

export interface WorkspaceRolloutLease extends ProjectScope {
  readonly leaseVersion: number;
  readonly actorId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export class InMemoryRolloutLeaseStore {
  readonly #leases = new Map<string, WorkspaceRolloutLease>();

  acquire(
    input: ProjectScope & Readonly<{ actorId: string; acquiredAt: string; expiresAt: string }>,
  ): WorkspaceRolloutLease {
    if (
      Number.isNaN(Date.parse(input.acquiredAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.acquiredAt)
    )
      throw new Error("ROLLOUT_LEASE_INVALID");
    const current = this.#leases.get(input.workspaceId);
    if (
      current &&
      current.projectId !== input.projectId &&
      Date.parse(current.expiresAt) > Date.parse(input.acquiredAt)
    )
      throw new Error("ROLLOUT_LEASE_HELD");
    const lease = Object.freeze({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      leaseVersion: (current?.leaseVersion ?? 0) + 1,
      actorId: input.actorId,
      acquiredAt: input.acquiredAt,
      expiresAt: input.expiresAt,
    });
    this.#leases.set(input.workspaceId, lease);
    return lease;
  }
}

export interface PilotGateResult {
  readonly kind: string;
  readonly outcome: "PASS" | "FAIL" | "BLOCKED_INPUT";
  readonly ref: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
}

export class PilotActivationService {
  constructor(private readonly leases: InMemoryRolloutLeaseStore) {}

  async activate(
    input: Readonly<{
      current: ProjectOnboardingRevision;
      gateResults: readonly PilotGateResult[];
      actionId: string;
      expectedOnboardingVersion: number;
      initiator: HumanActorSnapshot;
      approver: HumanActorSnapshot;
      approvalTargetHash: `sha256:${string}`;
      stepUpAt?: string;
      now: string;
      expiresAt: string;
    }>,
  ): Promise<Readonly<{ revision: ProjectOnboardingRevision; lease: WorkspaceRolloutLease }>> {
    if (input.current.stage !== "SHADOW" || input.current.operationalState !== "ACTIVE")
      throw new Error("PILOT_ACTIVATION_STATE_INVALID");
    if (input.current.version !== input.expectedOnboardingVersion)
      throw new Error("ONBOARDING_VERSION_CONFLICT");
    if (
      ["C1", "N2", "P3"].some(
        (kind) => !input.gateResults.some((gate) => gate.kind === kind && gate.outcome === "PASS"),
      )
    )
      throw new Error("PILOT_GATE_BLOCKED");
    if (
      !isSystemAdministratorRole(input.initiator.roleKey) ||
      !isSystemAdministratorRole(input.approver.roleKey) ||
      input.initiator.principalId === input.approver.principalId ||
      !input.stepUpAt
    )
      throw new Error("PILOT_ACTIVATION_APPROVAL_INVALID");
    const expectedHash = onboardingContentHash({
      actionId: input.actionId,
      projectId: input.current.projectId,
      version: input.current.version,
    } as never);
    if (input.approvalTargetHash !== expectedHash)
      throw new Error("APPROVAL_EXACT_SUBJECT_MISMATCH");
    return this.activateRevision(
      input.current,
      input.approver,
      input.now,
      input.expiresAt,
      input.gateResults.map(({ ref }) => ref),
    );
  }

  async activateForTest(current: ProjectOnboardingRevision, now: string) {
    return this.activateRevision(
      current,
      current.actor,
      now,
      new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
      [],
    );
  }

  private async activateRevision(
    current: ProjectOnboardingRevision,
    actor: HumanActorSnapshot,
    now: string,
    expiresAt: string,
    gateRefs: readonly PilotGateResult["ref"][],
  ) {
    const lease = this.leases.acquire({
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      actorId: actor.principalId,
      acquiredAt: now,
      expiresAt,
    });
    const revision = createOnboardingRevision({
      ...current,
      revisionId: `${current.onboardingId}:v${current.version + 1}`,
      version: current.version + 1,
      stage: "PILOT_ACTIVE",
      gateResultRefs: [...current.gateResultRefs, ...gateRefs],
      reasonCode: "ONBOARDING_PILOT_ACTIVATED",
      reason: "Exact pilot activation approval consumed under Workspace rollout lease",
      actor,
      createdAt: now,
    });
    assertOnboardingTransition(current, revision);
    return Object.freeze({ revision, lease });
  }
}

export interface DurablePilotActivationTransaction {
  committed(actionId: string): Promise<DurablePilotActivationReceipt | undefined>;
  currentOnboarding(): Promise<ProjectOnboardingRevision>;
  action(actionId: string): Promise<ProjectActionCandidate | undefined>;
  approval(approvalId: string): Promise<ProjectActionApproval | undefined>;
  currentPrerequisites(): Promise<
    Readonly<{
      refs: readonly ExactRevisionRef[];
      gates: readonly PilotGateResult[];
      initiatorAuthorized: boolean;
      approverAuthorized: boolean;
    }>
  >;
  acquireRolloutLease(
    input: Readonly<{ actorId: string; acquiredAt: string; expiresAt: string }>,
  ): Promise<WorkspaceRolloutLease>;
  commit(
    input: Readonly<{
      action: ProjectActionCandidate;
      approval: ProjectActionApproval & Readonly<{ consumedAt: string }>;
      revision: ProjectOnboardingRevision;
      lease: WorkspaceRolloutLease;
      audit: Readonly<{
        auditId: string;
        action: "ONBOARDING_PILOT_ACTIVATE";
        actionId: string;
        approvalId: string;
        revisionHash: string;
        leaseVersion: number;
        actor: HumanActorSnapshot;
        correlationId: string;
        occurredAt: string;
      }>;
      outbox: ProjectEventEnvelope;
    }>,
  ): Promise<void>;
}

export interface DurablePilotActivationPort {
  inTransaction<T>(
    input: ProjectScope & Readonly<{ expectedOnboardingVersion: number }>,
    work: (transaction: DurablePilotActivationTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface DurablePilotActivationReceipt {
  readonly actionId: string;
  readonly approvalId: string;
  readonly revision: ProjectOnboardingRevision;
  readonly lease: WorkspaceRolloutLease;
  readonly replayed: boolean;
}

const refKey = (ref: ExactRevisionRef): string =>
  `${ref.id}\u0000${ref.version}\u0000${ref.contentHash}`;

/** Consumes the canonical 007 action and its approval in one caller-owned UoW. */
export class DurablePilotActivationService {
  constructor(private readonly port: DurablePilotActivationPort) {}

  async activate(
    input: ProjectScope &
      Readonly<{
        actionId: string;
        approvalId: string;
        expectedOnboardingVersion: number;
        now: string;
      }>,
  ): Promise<DurablePilotActivationReceipt> {
    return await this.port.inTransaction(input, async (transaction) => {
      const committed = await transaction.committed(input.actionId);
      if (committed) {
        if (committed.approvalId !== input.approvalId)
          throw new Error("PILOT_ACTIVATION_ACTION_ALREADY_CONSUMED");
        return Object.freeze({ ...committed, replayed: true });
      }
      // Keep reads sequential so a SQL implementation can preserve its documented lock order.
      const current = await transaction.currentOnboarding();
      const action = await transaction.action(input.actionId);
      const approval = await transaction.approval(input.approvalId);
      const live = await transaction.currentPrerequisites();
      if (!action || action.kind !== "ONBOARDING_PILOT_ACTIVATE" || !approval)
        throw new Error("PILOT_ACTIVATION_ACTION_NOT_FOUND");
      if (
        current.stage !== "SHADOW" ||
        current.operationalState !== "ACTIVE" ||
        current.version !== input.expectedOnboardingVersion ||
        action.workspaceId !== input.workspaceId ||
        action.projectId !== input.projectId ||
        action.targetRef.id !== current.revisionId ||
        action.targetRef.version !== current.version ||
        action.targetRef.contentHash !== current.contentHash ||
        !isSystemAdministratorRole(action.initiator.roleKey)
      )
        throw new Error("PILOT_ACTIVATION_EXACT_TARGET_MISMATCH");
      const expectedRefs = action.prerequisiteRefs.map(refKey).sort();
      const currentRefs = live.refs.map(refKey).sort();
      const prerequisitesCurrent =
        expectedRefs.length === currentRefs.length &&
        expectedRefs.every((value, index) => value === currentRefs[index]);
      if (
        ["C1", "N2", "P3"].some(
          (kind) =>
            !live.gates.some(
              (gate) =>
                gate.kind === kind &&
                gate.outcome === "PASS" &&
                expectedRefs.includes(refKey(gate.ref)),
            ),
        )
      ) {
        throw new Error("PILOT_GATE_BLOCKED");
      }
      const consumed = consumeAuthorizedProjectAction(action, approval, {
        now: input.now,
        currentOnboardingVersion: current.version,
        initiatorCurrentlyAuthorized: live.initiatorAuthorized,
        approverCurrentlyAuthorized: live.approverAuthorized,
        prerequisitesCurrent,
      });
      const lease = await transaction.acquireRolloutLease({
        actorId: consumed.approver.principalId,
        acquiredAt: input.now,
        expiresAt: action.expiresAt,
      });
      const revision = createOnboardingRevision({
        ...current,
        revisionId: crypto.randomUUID(),
        version: current.version + 1,
        stage: "PILOT_ACTIVE",
        gateResultRefs: live.refs,
        reasonCode: "ONBOARDING_PILOT_ACTIVATED",
        reason: action.reason,
        actor: consumed.approver,
        causationId: action.actionId,
        createdAt: input.now,
      });
      assertOnboardingTransition(current, revision);
      const subjectRef = Object.freeze({
        id: revision.revisionId,
        version: revision.version,
        contentHash: revision.contentHash,
      });
      const outbox = createProjectEventEnvelope({
        eventId: crypto.randomUUID(),
        eventType: "PROJECT_ONBOARDING_CHANGED",
        scope: input,
        subjectRef,
        reasonCode: "ONBOARDING_PILOT_ACTIVATED",
        relatedRefs: Object.freeze([action.targetRef, ...live.refs]),
        actor: consumed.approver,
        occurredAt: input.now,
        correlationId: current.correlationId,
        causationId: action.actionId,
      });
      await transaction.commit({
        action,
        approval: consumed,
        revision,
        lease,
        audit: Object.freeze({
          auditId: crypto.randomUUID(),
          action: "ONBOARDING_PILOT_ACTIVATE",
          actionId: action.actionId,
          approvalId: approval.approvalId,
          revisionHash: revision.contentHash,
          leaseVersion: lease.leaseVersion,
          actor: consumed.approver,
          correlationId: current.correlationId,
          occurredAt: input.now,
        }),
        outbox,
      });
      return Object.freeze({
        actionId: action.actionId,
        approvalId: approval.approvalId,
        revision,
        lease,
        replayed: false,
      });
    });
  }
}

export type PostgresPilotActivationPrerequisiteResolver = (
  manager: EntityManager,
  action: ProjectActionCandidate,
) => Promise<
  Readonly<{
    refs: readonly ExactRevisionRef[];
    gates: readonly PilotGateResult[];
    initiatorAuthorized: boolean;
    approverAuthorized: boolean;
  }>
>;

function activationRows<T>(value: unknown): readonly T[] {
  return (Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value) as readonly T[];
}

/** PostgreSQL adapter for the canonical activation UoW; no permissive resolver is provided. */
export class PostgresDurablePilotActivationPort implements DurablePilotActivationPort {
  readonly #repository: ProjectOnboardingRepository;
  constructor(
    source: DataSource,
    private readonly resolvePrerequisites: PostgresPilotActivationPrerequisiteResolver,
  ) {
    this.#repository = new ProjectOnboardingRepository(source);
  }

  async inTransaction<T>(
    input: ProjectScope & Readonly<{ expectedOnboardingVersion: number }>,
    work: (transaction: DurablePilotActivationTransaction) => Promise<T>,
  ): Promise<T> {
    return await this.#repository.withPilotActivationLocks(input, async (manager) => {
      let loadedAction: ProjectActionCandidate | undefined;
      const transaction: DurablePilotActivationTransaction = {
        committed: async (actionId) => {
          const rows = activationRows<{
            state: string;
            result: DurablePilotActivationReceipt | string | null;
          }>(
            await manager.query(
              "SELECT state,result FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
              [input.workspaceId, input.projectId, actionId],
            ),
          );
          const row = rows[0];
          if (row?.state !== "COMPLETED" || row.result === null) return undefined;
          const result = (
            typeof row.result === "string" ? JSON.parse(row.result) : row.result
          ) as DurablePilotActivationReceipt;
          if (
            result.actionId !== actionId ||
            result.revision.contentHash === undefined ||
            result.lease.leaseVersion < 1
          )
            throw new Error("PILOT_ACTIVATION_RECEIPT_INVALID");
          return Object.freeze({ ...result, replayed: false });
        },
        currentOnboarding: async () => {
          const rows = activationRows<{ semantic_body: ProjectOnboardingRevision | string }>(
            await manager.query(
              `SELECT r.semantic_body FROM project_onboarding_headers h JOIN project_onboarding_revisions r ON (r.workspace_id,r.project_id,r.onboarding_id,r.version)=(h.workspace_id,h.project_id,h.onboarding_id,h.current_version) WHERE h.workspace_id=$1 AND h.project_id=$2`,
              [input.workspaceId, input.projectId],
            ),
          );
          if (!rows[0]) throw new Error("PROJECT_ONBOARDING_NOT_FOUND");
          return (
            typeof rows[0].semantic_body === "string"
              ? JSON.parse(rows[0].semantic_body)
              : rows[0].semantic_body
          ) as ProjectOnboardingRevision;
        },
        action: async (actionId) => {
          const rows = activationRows<{
            candidate_ref: ProjectActionCandidate | string;
            candidate_hash: string;
            state: string;
          }>(
            await manager.query(
              "SELECT candidate_ref,candidate_hash,state FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND action_kind='ONBOARDING_PILOT_ACTIVATE' FOR UPDATE",
              [input.workspaceId, input.projectId, actionId],
            ),
          );
          const row = rows[0];
          if (!row || row.state === "COMPLETED") return undefined;
          loadedAction = (
            typeof row.candidate_ref === "string"
              ? JSON.parse(row.candidate_ref)
              : row.candidate_ref
          ) as ProjectActionCandidate;
          if (loadedAction.contentHash !== row.candidate_hash || loadedAction.actionId !== actionId)
            throw new Error("PILOT_ACTIVATION_ACTION_HASH_MISMATCH");
          return loadedAction;
        },
        approval: async (approvalId) => {
          const rows = activationRows<{
            subject: ProjectActionApproval | string;
            subject_hash: string;
            decision_state: string;
            effect_authorization_state: string;
          }>(
            await manager.query(
              "SELECT subject,subject_hash,decision_state,effect_authorization_state FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
              [input.workspaceId, input.projectId, approvalId],
            ),
          );
          const row = rows[0];
          if (
            !row ||
            row.decision_state !== "APPROVED" ||
            row.effect_authorization_state !== "AUTHORIZED"
          )
            return undefined;
          const approval = (
            typeof row.subject === "string" ? JSON.parse(row.subject) : row.subject
          ) as ProjectActionApproval;
          if (approval.targetHash !== row.subject_hash || approval.approvalId !== approvalId)
            throw new Error("PILOT_ACTIVATION_APPROVAL_HASH_MISMATCH");
          return approval;
        },
        currentPrerequisites: async () => {
          if (!loadedAction) throw new Error("PILOT_ACTIVATION_LOCK_ORDER_INVALID");
          return await this.resolvePrerequisites(manager, loadedAction);
        },
        acquireRolloutLease: async (lease) => {
          const result = await this.#repository.acquireFirstPilotRolloutLeaseInTransaction(
            manager,
            { ...input, ...lease },
          );
          return Object.freeze({ ...input, ...lease, leaseVersion: result.leaseVersion });
        },
        commit: async (value) =>
          await this.#repository.commitPilotActivationInTransaction(manager, {
            ...input,
            previous: await transaction.currentOnboarding(),
            revision: value.revision,
            action: value.action,
            approval: value.approval,
            lease: value.lease,
            audit: value.audit,
            outbox: value.outbox,
          }),
      };
      return await work(transaction);
    });
  }
}

export class ProjectResumeService {
  async resume(
    input: Readonly<{
      current: ProjectOnboardingRevision;
      candidate: ProjectResumeActionCandidate;
      approval: ProjectActionApproval;
      liveIncidentDispositionRef: ExactRevisionRef;
      incidentDispositionAccepted: boolean;
      liveFreshProbeRefs: readonly ExactRevisionRef[];
      currentRequirementsPass: boolean;
      initiatorCurrentlyAuthorized: boolean;
      approverCurrentlyAuthorized: boolean;
      now: string;
    }>,
  ): Promise<
    Readonly<{
      revision: ProjectOnboardingRevision;
      consumedApproval: ProjectActionApproval & Readonly<{ consumedAt: string }>;
    }>
  > {
    const { current, candidate } = input;
    if (current.operationalState !== "SUSPENDED" || candidate.kind !== "PROJECT_RESUME")
      throw new Error("PROJECT_RESUME_STATE_INVALID");
    if (
      candidate.workspaceId !== current.workspaceId ||
      candidate.projectId !== current.projectId ||
      candidate.targetRef.id !== current.revisionId ||
      candidate.targetRef.version !== current.version ||
      candidate.targetRef.contentHash !== current.contentHash ||
      candidate.incidentRef !== current.incidentRef ||
      candidate.intendedCapabilityMode !== current.intendedCapabilityMode
    ) {
      throw new Error("PROJECT_RESUME_EXACT_TARGET_MISMATCH");
    }
    const prerequisitesCurrent = projectResumePrerequisitesCurrent(candidate, {
      incidentRef: current.incidentRef,
      incidentDispositionRef: input.liveIncidentDispositionRef,
      incidentDispositionAccepted: input.incidentDispositionAccepted,
      freshProbeRefs: input.liveFreshProbeRefs,
    });
    const consumedApproval = consumeAuthorizedProjectAction(candidate, input.approval, {
      now: input.now,
      currentOnboardingVersion: current.version,
      initiatorCurrentlyAuthorized: input.initiatorCurrentlyAuthorized,
      approverCurrentlyAuthorized: input.approverCurrentlyAuthorized,
      prerequisitesCurrent,
    });
    const revision = createOnboardingRevision({
      ...current,
      revisionId: `${current.onboardingId}:v${current.version + 1}`,
      version: current.version + 1,
      operationalState: "ACTIVE",
      qaCapabilityMode: recalculateProjectResumeMode(
        current.intendedCapabilityMode,
        input.currentRequirementsPass,
      ),
      reasonCode: "PROJECT_RESUMED",
      reason: candidate.reason,
      actor: input.approval.approver,
      causationId: candidate.actionId,
      createdAt: input.now,
    });
    assertOnboardingTransition(current, revision);
    return Object.freeze({ revision, consumedApproval });
  }
}

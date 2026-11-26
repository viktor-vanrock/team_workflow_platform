import type { DataSource, EntityManager } from "typeorm";

import type {
  QaAutomationRetryCommandAdmission,
  QaAutomationRetryCoreCommandRecord,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ConnectorCommand,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  pilotCommandPrincipal,
  type PilotEffectContext,
  type PilotFencePort,
  type ProjectEffectGuardSnapshot,
  type ProjectScope,
} from "@awp/platform-core";
import {
  PilotCommandAdmissionRepository,
  TypeOrmCommandRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

/** Lock and re-evaluate the causal human's permissions in the retry transaction. */
export async function assertWorkerRetryHumanAccess(
  manager: EntityManager,
  command: ConnectorCommand,
): Promise<void> {
  const humanId = command.source.causalHumanPrincipalId;
  if (!manager.queryRunner?.isTransactionActive || !humanId || command.actor.kind !== "SERVICE")
    throw new Error("PILOT_RETRY_HUMAN_ACCESS_DENIED");
  const identity = (await manager.query(
    "SELECT issuer,subject FROM identities WHERE id=$1 AND kind='HUMAN' FOR SHARE",
    [humanId],
  )) as readonly { issuer: string; subject: string }[];
  if (identity.length !== 1 || !identity[0]?.issuer || !identity[0].subject)
    throw new Error("PILOT_RETRY_HUMAN_ACCESS_DENIED");
  await manager.query(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND principal_id=$2 FOR SHARE",
    [command.workspaceId, humanId],
  );
  await manager.query(
    "SELECT id FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND (project_id IS NULL OR project_id=$3) FOR SHARE",
    [command.workspaceId, humanId, command.projectId],
  );
  await manager.query(
    "SELECT id FROM project_entitlements WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 FOR SHARE",
    [command.workspaceId, command.projectId, humanId],
  );
  await manager.query("SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 FOR SHARE", [
    command.workspaceId,
    command.projectId,
  ]);
  const scope = {
    kind: "PROJECT" as const,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
  };
  const access = new TypeOrmScopedAccessRepository(manager);
  const project = await access.getProject(scope);
  if (!project || project.state !== "ACTIVE") throw new Error("PILOT_RETRY_HUMAN_ACCESS_DENIED");
  const at = new Date();
  const commandClassification = defaultClassificationCatalog.reference(
    command.dataClassificationKey,
  );
  const decision = new DenyByDefaultAuthorizationPolicy().decide({
    context: {
      scope,
      actor: {
        kind: "HUMAN",
        principalId: humanId,
        issuer: identity[0].issuer,
        subject: identity[0].subject,
      },
      correlationId: command.correlationId,
      causationId: command.causationId,
    },
    permission: "qa.automation.session.plan",
    resourceClassification:
      project.classification.rank > commandClassification.rank
        ? project.classification
        : commandClassification,
    facts: await access.authorizationFacts(scope, humanId, at),
    at,
    policyVersion: "corporate-gitlab-retry@1",
    operationClass: "EFFECT",
    projectOperationalState: "ACTIVE",
  });
  if (!decision.allowed || !decision.basis) throw new Error("PILOT_RETRY_HUMAN_ACCESS_DENIED");
}

/** Shared transaction writer for initial and retry commands; the trusted host provides fence authority. */
export function createPilotTransactionalAdmission(
  source: DataSource,
  authority: Readonly<{
    context(scope: ProjectScope, principalId: string): Promise<PilotEffectContext>;
    guard: Readonly<{
      assertEffectsAllowed(
        scope: ProjectScope,
        version?: number,
        context?: PilotEffectContext,
      ): Promise<ProjectEffectGuardSnapshot>;
    }>;
  }>,
) {
  const repository = new PilotCommandAdmissionRepository(source);
  return {
    async persist(manager: EntityManager, command: ConnectorCommand): Promise<void> {
      if (!manager.queryRunner?.isTransactionActive) throw new Error("PILOT_TRANSACTION_REQUIRED");
      const scope = { workspaceId: command.workspaceId, projectId: command.projectId };
      const principal = pilotCommandPrincipal(command);
      const context = await authority.context(scope, principal);
      if (context.principalId !== principal) throw new Error("PILOT_COMMAND_ADMISSION_CONFLICT");
      const snapshot = await authority.guard.assertEffectsAllowed(scope, undefined, context);
      const rows = (await manager.query(
        `SELECT current_version,current_operational_state FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR SHARE`,
        [scope.workspaceId, scope.projectId],
      )) as readonly { current_version: number | string; current_operational_state: string }[];
      if (
        rows.length !== 1 ||
        Number(rows[0]!.current_version) !== snapshot.onboardingVersion ||
        rows[0]!.current_operational_state !== "ACTIVE"
      )
        throw new Error("PILOT_COMMAND_ONBOARDING_CHANGED");
      await authority.guard.assertEffectsAllowed(scope, snapshot.onboardingVersion, context);
      await repository.insert(manager, command, {
        commandId: command.id,
        payloadHash: command.payloadHash,
        targetHash: command.targetHash,
        expectedOnboardingVersion: snapshot.onboardingVersion,
        context,
      });
      await authority.guard.assertEffectsAllowed(scope, snapshot.onboardingVersion, context);
    },
    async assertReplay(manager: EntityManager, command: ConnectorCommand): Promise<void> {
      const saved = await repository.load(command, manager);
      if (!saved) throw new Error("PILOT_COMMAND_ADMISSION_REQUIRED");
      await authority.guard.assertEffectsAllowed(
        command,
        saved.expectedOnboardingVersion,
        saved.context,
      );
    },
  };
}

/** Derive the pilot participant from the current server-side fence, never from an HTTP request. */
export function createWorkerRetryAdmission(
  source: DataSource,
  fences: PilotFencePort,
  guard: Readonly<{
    assertEffectsAllowed(
      scope: ProjectScope,
      version?: number,
      context?: PilotEffectContext,
    ): Promise<ProjectEffectGuardSnapshot>;
  }>,
): QaAutomationRetryCommandAdmission {
  const authority = {
    guard,
    async context(scope: ProjectScope, principalId: string): Promise<PilotEffectContext> {
      const fence = await fences.current(scope);
      if (
        !fence ||
        fence.environment !== "NON_PROD" ||
        !["COHORT_WRITES", "SANDBOX_CONFORMANCE"].includes(fence.mode)
      )
        throw new Error("PILOT_EFFECT_FENCED");
      const context: PilotEffectContext = {
        principalId,
        purpose: fence.mode === "SANDBOX_CONFORMANCE" ? "SANDBOX_CONFORMANCE" : "BUSINESS",
        deploymentRef: fence.deploymentRef,
        cohortRef: fence.cohortRef,
        fenceRef: fence.fenceRef,
      };
      await guard.assertEffectsAllowed(scope, undefined, context);
      return context;
    },
  };
  const admission = createPilotTransactionalAdmission(source, authority);
  const assertNotQuarantined = async (manager: EntityManager, command: ConnectorCommand) => {
    const rows = (await manager.query(
      `SELECT 1 FROM qa_automation_attempts successor
       JOIN qa_automation_attempt_results result ON result.workspace_id=successor.workspace_id
         AND result.project_id=successor.project_id AND result.attempt_id=successor.predecessor_attempt_id
       JOIN qa_automation_quarantines q ON q.workspace_id=successor.workspace_id AND q.project_id=successor.project_id
       WHERE successor.workspace_id=$1 AND successor.project_id=$2 AND successor.connector_command_id=$3
         AND successor.lineage_kind='AUTO_INFRA_RETRY' AND q.current_action='ACTIVATE' AND q.current_expires_at>clock_timestamp()
         AND ((q.subject_kind='SUITE_BINDING_VERSION' AND q.suite_binding_id=successor.suite_binding_id
               AND q.suite_binding_version=successor.suite_binding_version AND q.suite_binding_content_hash=successor.suite_binding_content_hash)
           OR (q.subject_kind='INFRASTRUCTURE_CODE' AND q.infrastructure_code=result.infrastructure_error_code))
       LIMIT 1 FOR SHARE OF q`,
      [command.workspaceId, command.projectId, command.id],
    )) as readonly unknown[];
    if (rows.length) throw new Error("PILOT_RETRY_QUARANTINED");
  };
  return createRetryCommandAdmission(source, {
    async persist(manager, command) {
      await assertNotQuarantined(manager, command);
      await admission.persist(manager, command);
      await assertWorkerRetryHumanAccess(manager, command);
      await assertNotQuarantined(manager, command);
    },
    async assertReplay(manager, command) {
      await assertNotQuarantined(manager, command);
      await admission.assertReplay(manager, command);
      await assertWorkerRetryHumanAccess(manager, command);
    },
  });
}

/** Adapt a transaction-aware pilot admission to QA's stored successor command. */
export function createRetryCommandAdmission(
  source: DataSource,
  admission: Readonly<{
    persist(manager: EntityManager, command: ConnectorCommand): Promise<void>;
    assertReplay(manager: EntityManager, command: ConnectorCommand): Promise<void>;
  }>,
): QaAutomationRetryCommandAdmission {
  const repository = new TypeOrmCommandRepository(source);
  const load = async (manager: EntityManager, record: QaAutomationRetryCoreCommandRecord) => {
    if (!manager.queryRunner?.isTransactionActive) throw new Error("PILOT_TRANSACTION_REQUIRED");
    const command = await repository.get(record.workspaceId, record.projectId, record.id, manager);
    if (
      !command ||
      command.effectIdempotencyKey !== record.effectIdempotencyKey ||
      command.actor.kind !== "SERVICE" ||
      command.actor.principalId !== record.actor.principalId ||
      command.actor.serviceKey !== record.actor.serviceKey ||
      command.payloadHash !== sha256(record.payload as JsonValue) ||
      command.targetHash !== sha256(record.target as JsonValue) ||
      command.bindingRef.id !== record.bindingRef.id ||
      command.bindingRef.version !== record.bindingRef.version ||
      command.profileRef.id !== record.profileRef.id ||
      command.profileRef.version !== record.profileRef.version
    )
      throw new Error("PILOT_RETRY_COMMAND_CONFLICT");
    return command;
  };
  return {
    persist: async (manager, record) =>
      await admission.persist(manager, await load(manager, record)),
    assertReplay: async (manager, record) =>
      await admission.assertReplay(manager, await load(manager, record)),
  };
}

import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ConnectorCommand,
  type GatewayCommit,
  pilotContentHash,
  type PilotEffectContext,
  type PilotFencePort,
  type ProjectScope,
} from "@awp/platform-core";
import {
  PilotCommandAdmissionRepository,
  TypeOrmUnitOfWork,
} from "@awp/platform-persistence-typeorm";
import {
  assertCorporateGitLabBuildRef,
  assertCorporatePublishedSuiteParameters,
  createPilotTransactionalAdmission,
  type DeploymentStartup,
  PilotEffectGuard,
  TypeOrmProjectEffectGuard,
} from "@awp/runtime-composition";

/** Context is obtained from the server's current approved fence, never from an HTTP request. */
export interface CorporateCommandAdmissionAuthority {
  context(scope: ProjectScope, principalId: string): Promise<PilotEffectContext>;
  readonly guard: Pick<PilotEffectGuard, "assertEffectsAllowed">;
}

export const QA_COMMAND_ADMISSION_AUTHORITY = Symbol("QA_COMMAND_ADMISSION_AUTHORITY");

/** For command producers which already own the transaction, such as automation launch. */
export function createCorporateTransactionalCommandAdmission(
  source: DataSource,
  authority: CorporateCommandAdmissionAuthority,
) {
  const admission = createPilotTransactionalAdmission(source, authority);
  return {
    async persist(manager: Parameters<typeof admission.persist>[0], command: ConnectorCommand) {
      if (command.commandType === "qa.automation.pipeline.trigger") {
        if (!manager.queryRunner?.isTransactionActive)
          throw new Error("PILOT_TRANSACTION_REQUIRED");
        const payload = command.payload as Readonly<{
          testSessionId?: unknown;
          targetSnapshotHash?: unknown;
        }>;
        if (
          typeof payload.testSessionId !== "string" ||
          typeof payload.targetSnapshotHash !== "string"
        )
          throw new Error("CORPORATE_GITLAB_BUILD_REF_REQUIRED");
        const rows = (await manager.query(
          `SELECT target_snapshot FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 FOR SHARE`,
          [command.workspaceId, command.projectId, payload.testSessionId],
        )) as readonly { target_snapshot: unknown }[];
        const raw = rows[0]?.target_snapshot;
        const snapshot = (typeof raw === "string" ? JSON.parse(raw) : raw) as
          | Readonly<{
              snapshotHash?: string;
              target?: Readonly<{ buildRef?: unknown }>;
              suite?: Parameters<typeof assertCorporatePublishedSuiteParameters>[2];
            }>
          | undefined;
        if (!snapshot || !snapshot.target || rows.length !== 1)
          throw new Error("CORPORATE_GITLAB_BUILD_REF_REQUIRED");
        const { snapshotHash, ...body } = snapshot;
        if (
          snapshotHash !== payload.targetSnapshotHash ||
          sha256(body as unknown as JsonValue) !== snapshotHash
        )
          throw new Error("CORPORATE_GITLAB_TARGET_SNAPSHOT_STALE");
        assertCorporateGitLabBuildRef(snapshot.target);
        if (
          !snapshot.suite ||
          snapshot.suite.acceptedParameters?.BUILD_REF !== snapshot.target.buildRef
        )
          throw new Error("CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED");
        await assertCorporatePublishedSuiteParameters(manager, command, snapshot.suite);
      }
      await admission.persist(manager, command);
    },
    assertReplay: (manager: EntityManager, command: ConnectorCommand) =>
      admission.assertReplay(manager, command),
  };
}

/** Uses only the current server-side fence; the guard rechecks it after asynchronous work. */
export function createCorporateCommandAdmissionAuthority(
  source: DataSource,
  fences: PilotFencePort,
  startup: DeploymentStartup,
): CorporateCommandAdmissionAuthority {
  if (!source.isInitialized || !fences?.current || !fences.authorize || !startup?.assertReady)
    throw new Error("PILOT_COMMAND_ADMISSION_AUTHORITY_REQUIRED");
  const guard: CorporateCommandAdmissionAuthority["guard"] = {
    assertEffectsAllowed: async (scope, expectedVersion, context) => {
      const fence = await fences.current(scope);
      if (!fence || !context) throw new Error("PILOT_EFFECT_FENCED");
      // A fence names the worker incarnation, not the separately registered API process.
      const workers = (await source.query(
        `SELECT instance_id FROM pilot_runtime_registrations
         WHERE instance_id=$1 AND workspace_id=$2 AND deployment_id=$3 AND deployment_version=$4
           AND component='worker' AND config_digest=$5 AND image_digest=$6
           AND state='ACTIVE' AND expires_at>clock_timestamp()`,
        [
          fence.runtimeInstanceId,
          scope.workspaceId,
          startup.policy.deploymentId,
          startup.policy.version,
          pilotContentHash(startup.policy),
          startup.policy.imageDigest,
        ],
      )) as readonly unknown[];
      if (workers.length !== 1) throw new Error("PILOT_WORKER_FENCE_UNAVAILABLE");
      return await new PilotEffectGuard(
        new TypeOrmProjectEffectGuard(source),
        fences,
        fence.runtimeInstanceId,
        Date.now,
        startup,
      ).assertEffectsAllowed(scope, expectedVersion, context);
    },
  };
  return {
    guard,
    context: async (scope, principalId) => {
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
}

export class CorporateAdmissionUnitOfWork extends TypeOrmUnitOfWork {
  readonly #repository: PilotCommandAdmissionRepository;
  constructor(
    private readonly dataSource: DataSource,
    private readonly authority: CorporateCommandAdmissionAuthority,
  ) {
    super(dataSource);
    this.#repository = new PilotCommandAdmissionRepository(dataSource);
  }

  override async commit(value: GatewayCommit): Promise<void> {
    const command = value.command;
    const scope = { workspaceId: command.workspaceId, projectId: command.projectId };
    const context = await this.authority.context(scope, command.actor.principalId);
    if (context.principalId !== command.actor.principalId)
      throw new Error("PILOT_COMMAND_ADMISSION_CONFLICT");
    const snapshot = await this.authority.guard.assertEffectsAllowed(scope, undefined, context);
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const heads = (await manager.query(
        `SELECT current_version,current_operational_state FROM project_onboarding_headers
         WHERE workspace_id=$1 AND project_id=$2 FOR SHARE`,
        [scope.workspaceId, scope.projectId],
      )) as readonly { current_version: number | string; current_operational_state: string }[];
      if (
        heads.length !== 1 ||
        Number(heads[0]!.current_version) !== snapshot.onboardingVersion ||
        heads[0]!.current_operational_state !== "ACTIVE"
      )
        throw new Error("PILOT_COMMAND_ONBOARDING_CHANGED");
      await this.authority.guard.assertEffectsAllowed(scope, snapshot.onboardingVersion, context);
      await new TypeOrmUnitOfWork(this.dataSource, manager).commit(value);
      await this.#repository.insert(manager, command, {
        commandId: command.id,
        payloadHash: command.payloadHash,
        targetHash: command.targetHash,
        expectedOnboardingVersion: snapshot.onboardingVersion,
        context,
      });
      await this.authority.guard.assertEffectsAllowed(scope, snapshot.onboardingVersion, context);
    });
  }

  async assertReplay(command: ConnectorCommand): Promise<void> {
    const admission = await this.#repository.load(command);
    if (!admission) throw new Error("PILOT_COMMAND_ADMISSION_REQUIRED");
    await this.authority.guard.assertEffectsAllowed(
      command,
      admission.expectedOnboardingVersion,
      admission.context,
    );
  }
}

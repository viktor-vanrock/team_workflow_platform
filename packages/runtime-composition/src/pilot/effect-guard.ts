import {
  type ConnectorCommand,
  type PilotEffectContext,
  type PilotFencePort,
  type ProjectEffectGuardPort,
  type ProjectEffectGuardSnapshot,
  type ProjectScope,
  samePilotRef,
  pilotCommandPrincipal,
} from "@awp/platform-core";

import type { DeploymentStartupPort } from "./startup.ts";
import { PilotCommandAdmissionRepository } from "@awp/platform-persistence-typeorm";
import type { DataSource } from "typeorm";

/** Intersects deployment/cohort policy with the existing project guard; grants no rights. */
export class PilotEffectGuard implements ProjectEffectGuardPort {
  constructor(
    private readonly project: ProjectEffectGuardPort,
    private readonly fences: PilotFencePort,
    private readonly runtimeInstanceId: string,
    private readonly clock: () => number = Date.now,
    private readonly startup?: DeploymentStartupPort,
  ) {}

  async assertEffectsAllowed(
    scope: ProjectScope,
    expectedOnboardingVersion?: number,
    context?: PilotEffectContext,
  ): Promise<ProjectEffectGuardSnapshot> {
    if (!context) throw new Error("PILOT_CONTEXT_REQUIRED");
    if (!(await this.fences.authorize(scope, context))) throw new Error("PILOT_ACCESS_REVOKED");
    const project = await this.project.assertEffectsAllowed(scope, expectedOnboardingVersion);
    // Load the fence after asynchronous authorization, immediately before invocation.
    let fence = await this.fences.current(scope);
    if (fence?.environment === "NON_PROD" || this.startup) {
      if (!this.startup) throw new Error("DEPLOYMENT_STARTUP_REQUIRED");
      await this.startup.assertReady(scope, context.deploymentRef);
      fence = await this.fences.current(scope);
    }
    if (
      !fence ||
      fence.workspaceId !== scope.workspaceId ||
      fence.projectId !== scope.projectId ||
      fence.revoked ||
      fence.runtimeInstanceId !== this.runtimeInstanceId ||
      !["COHORT_WRITES", "SANDBOX_CONFORMANCE"].includes(fence.mode) ||
      !["LOCAL", "NON_PROD"].includes(fence.environment)
    )
      throw new Error("PILOT_EFFECT_FENCED");
    const now = this.clock();
    const start = Date.parse(fence.startsAt);
    const end = Date.parse(fence.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now >= end)
      throw new Error("PILOT_WINDOW_CLOSED");
    if (
      !samePilotRef(fence.fenceRef, context.fenceRef) ||
      !samePilotRef(fence.deploymentRef, context.deploymentRef) ||
      !samePilotRef(fence.cohortRef, context.cohortRef)
    )
      throw new Error("PILOT_PIN_CONFLICT");
    if (
      !fence.projectIds.includes(scope.projectId) ||
      !fence.principalIds.includes(context.principalId)
    )
      throw new Error("PILOT_COHORT_DENIED");
    if (
      (fence.mode === "SANDBOX_CONFORMANCE" ? "SANDBOX_CONFORMANCE" : "BUSINESS") !==
      context.purpose
    )
      throw new Error("PILOT_PURPOSE_DENIED");
    return project;
  }
}

export interface PilotCommandAdmission {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly targetHash: string;
  readonly expectedOnboardingVersion: number;
  readonly context: PilotEffectContext;
}

/** Loads the immutable admission for the original durable command, never fresh retry pins. */
export class PilotCommandEffectGuard {
  constructor(
    private readonly guard: PilotEffectGuard,
    private readonly admission: (
      command: ConnectorCommand,
    ) => Promise<PilotCommandAdmission | undefined>,
  ) {}
  async assertCommandAllowed(command: ConnectorCommand): Promise<void> {
    const admission = await this.admission(command);
    if (
      !admission ||
      admission.commandId !== command.id ||
      admission.payloadHash !== command.payloadHash ||
      admission.targetHash !== command.targetHash ||
      admission.context.principalId !== pilotCommandPrincipal(command) ||
      !Number.isSafeInteger(admission.expectedOnboardingVersion) ||
      admission.expectedOnboardingVersion < 1
    )
      throw new Error("PILOT_COMMAND_ADMISSION_CONFLICT");
    await this.guard.assertEffectsAllowed(
      command,
      admission.expectedOnboardingVersion,
      admission.context,
    );
  }
}

/** Worker reloads the originally committed admission for every invocation and retry. */
export function createStoredPilotCommandEffectGuard(
  source: DataSource,
  guard: PilotEffectGuard,
): PilotCommandEffectGuard {
  if (!source.isInitialized) throw new Error("PILOT_COMMAND_ADMISSION_STORE_REQUIRED");
  const repository = new PilotCommandAdmissionRepository(source);
  return new PilotCommandEffectGuard(guard, async (command) => await repository.load(command));
}

export async function assertPilotWorkerEffect(
  command: ConnectorCommand,
  guard: PilotCommandEffectGuard | undefined,
  required: boolean,
): Promise<void> {
  if (!guard) {
    if (required) throw new Error("PILOT_WORKER_GUARD_REQUIRED");
    return;
  }
  await guard.assertCommandAllowed(command);
}

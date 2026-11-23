import type { PilotEffectContext } from "../pilot/model.ts";
import type { ProjectScope } from "../project-onboarding/primitives.ts";

export interface ProjectEffectGuardSnapshot extends ProjectScope {
  readonly operationalState: "ACTIVE" | "SUSPENDED";
  readonly onboardingVersion: number;
}

export interface ProjectEffectGuardPort {
  assertEffectsAllowed(
    scope: ProjectScope,
    expectedOnboardingVersion?: number,
    context?: PilotEffectContext,
  ): Promise<ProjectEffectGuardSnapshot>;
}

/**
 * The single last-moment boundary for every new external effect.  Callers may
 * omit a version only when they are reloading the current onboarding head at
 * the point of invocation (for example, a durable worker consuming an older
 * command that predates the version pin).
 */
export async function executeProjectEffect<TResult>(
  guard: ProjectEffectGuardPort,
  scope: ProjectScope,
  expectedOnboardingVersion: number | undefined,
  effect: () => Promise<TResult>,
  context?: PilotEffectContext,
): Promise<TResult> {
  await guard.assertEffectsAllowed(scope, expectedOnboardingVersion, context);
  return await effect();
}

export class StaticProjectEffectGuard implements ProjectEffectGuardPort {
  constructor(private readonly snapshot: ProjectEffectGuardSnapshot) {}

  async assertEffectsAllowed(
    scope: ProjectScope,
    expectedOnboardingVersion?: number,
  ): Promise<ProjectEffectGuardSnapshot> {
    if (
      scope.workspaceId !== this.snapshot.workspaceId ||
      scope.projectId !== this.snapshot.projectId
    )
      throw new Error("PROJECT_EFFECT_SCOPE_DENIED");
    if (this.snapshot.operationalState !== "ACTIVE") throw new Error("PROJECT_EFFECTS_SUSPENDED");
    if (
      expectedOnboardingVersion !== undefined &&
      expectedOnboardingVersion !== this.snapshot.onboardingVersion
    )
      throw new Error("PROJECT_EFFECT_ONBOARDING_VERSION_CONFLICT");
    return this.snapshot;
  }
}

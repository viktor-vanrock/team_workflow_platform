import type {
  ProjectEffectGuardPort,
  ProjectEffectGuardSnapshot,
  ProjectScope,
} from "@awp/platform-core";

export interface ProjectEffectQueryExecutor {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

const rows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};

/** Reads the authoritative onboarding head immediately before a new effect. */
export class TypeOrmProjectEffectGuard implements ProjectEffectGuardPort {
  constructor(private readonly source: ProjectEffectQueryExecutor) {}

  async assertEffectsAllowed(
    scope: ProjectScope,
    expectedOnboardingVersion?: number,
  ): Promise<ProjectEffectGuardSnapshot> {
    const values = rows<
      Readonly<{ current_version: number | string; current_operational_state: string }>
    >(
      await this.source.query(
        `SELECT current_version,current_operational_state
         FROM project_onboarding_headers
        WHERE workspace_id=$1 AND project_id=$2`,
        [scope.workspaceId, scope.projectId],
      ),
    );
    const head = values[0];
    if (!head) throw new Error("PROJECT_EFFECT_SCOPE_DENIED");
    const onboardingVersion = Number(head.current_version);
    if (head.current_operational_state !== "ACTIVE") throw new Error("PROJECT_EFFECTS_SUSPENDED");
    if (
      expectedOnboardingVersion !== undefined &&
      onboardingVersion !== expectedOnboardingVersion
    ) {
      throw new Error("PROJECT_EFFECT_ONBOARDING_VERSION_CONFLICT");
    }
    return Object.freeze({ ...scope, operationalState: "ACTIVE" as const, onboardingVersion });
  }
}

export class MutableProjectEffectGuard implements ProjectEffectGuardPort {
  #state: "ACTIVE" | "SUSPENDED" = "ACTIVE";
  #onboardingVersion: number;
  constructor(
    readonly workspaceId: string,
    readonly projectId: string,
    onboardingVersion: number,
  ) {
    this.#onboardingVersion = onboardingVersion;
  }
  get onboardingVersion() {
    return this.#onboardingVersion;
  }
  suspend() {
    this.#state = "SUSPENDED";
    this.#onboardingVersion += 1;
  }
  resume() {
    this.#state = "ACTIVE";
    this.#onboardingVersion += 1;
  }
  async assertEffectsAllowed(
    scope: ProjectScope,
    expectedOnboardingVersion?: number,
  ): Promise<ProjectEffectGuardSnapshot> {
    if (scope.workspaceId !== this.workspaceId || scope.projectId !== this.projectId)
      throw new Error("PROJECT_EFFECT_SCOPE_DENIED");
    if (this.#state !== "ACTIVE") throw new Error("PROJECT_EFFECTS_SUSPENDED");
    if (
      expectedOnboardingVersion !== undefined &&
      expectedOnboardingVersion !== this.#onboardingVersion
    )
      throw new Error("PROJECT_EFFECT_ONBOARDING_VERSION_CONFLICT");
    return Object.freeze({
      ...scope,
      operationalState: "ACTIVE" as const,
      onboardingVersion: this.#onboardingVersion,
    });
  }
  async execute<T>(_provider: string, effect: () => Promise<T> | T): Promise<T> {
    await this.assertEffectsAllowed({ workspaceId: this.workspaceId, projectId: this.projectId });
    return await effect();
  }
  async reconcile<T>(work: () => Promise<T> | T): Promise<T> {
    return await work();
  }
}

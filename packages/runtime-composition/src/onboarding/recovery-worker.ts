export interface ProjectSuspensionRecoveryOperations {
  recoverStaleOperationalActions(): Promise<number>;
  expireStaleProbes(): Promise<number>;
  projectsNeedingProjectionRepair(): Promise<readonly string[]>;
  repairProjection(projectId: string): Promise<void>;
  reauthorizePendingWork(): Promise<number>;
}

export interface ProjectSuspensionRecoveryResult {
  readonly recoveredActions: number;
  readonly expiredProbes: number;
  readonly repaired: number;
  readonly reauthorizedWork: number;
}

/**
 * Restart-safe sweep. PostgreSQL remains the authority; worker memory is never
 * consulted to decide whether a Project may resume producing effects.
 */
export class ProjectSuspensionRecoveryWorker {
  constructor(private readonly operations: ProjectSuspensionRecoveryOperations) {}

  async run(): Promise<ProjectSuspensionRecoveryResult> {
    const recoveredActions = await this.operations.recoverStaleOperationalActions();
    const expiredProbes = await this.operations.expireStaleProbes();
    const projects = [...new Set(await this.operations.projectsNeedingProjectionRepair())].sort();
    for (const projectId of projects) await this.operations.repairProjection(projectId);
    const reauthorizedWork = await this.operations.reauthorizePendingWork();
    return Object.freeze({
      recoveredActions,
      expiredProbes,
      repaired: projects.length,
      reauthorizedWork,
    });
  }
}

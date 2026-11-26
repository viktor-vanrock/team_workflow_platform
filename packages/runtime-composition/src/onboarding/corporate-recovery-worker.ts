import type { DataSource } from "typeorm";
import { ProjectSuspensionRecoveryWorker } from "./recovery-worker.ts";

/** Maintenance is limited to the immutable deployment scope, including all writes. */
export function createCorporateProjectRecoveryWorker(
  source: DataSource,
  scope: Readonly<{
    workspaceId: string;
    projectIds: readonly string[];
  }>,
) {
  if (
    !source.isInitialized ||
    !scope.workspaceId ||
    !scope.projectIds.length ||
    new Set(scope.projectIds).size !== scope.projectIds.length
  )
    throw new Error("CORPORATE_PROJECT_RECOVERY_SCOPE_REQUIRED");
  const workspaceId = scope.workspaceId;
  const projectIds = Object.freeze([...scope.projectIds]);
  const count = (value: unknown): number => {
    const rows = value as readonly { count: number | string }[];
    return Number(rows[0]?.count ?? 0);
  };
  return new ProjectSuspensionRecoveryWorker({
    recoverStaleOperationalActions: async () =>
      count(
        await source.query(
          "SELECT count(*)::int AS count FROM project_operational_action_candidates WHERE workspace_id=$1 AND project_id=ANY($2::uuid[]) AND expires_at<=clock_timestamp()",
          [workspaceId, projectIds],
        ),
      ),
    expireStaleProbes: async () =>
      count(
        await source.query(
          "SELECT count(*)::int AS count FROM capability_probe_results WHERE workspace_id=$1 AND project_id=ANY($2::uuid[]) AND valid_until<=clock_timestamp()",
          [workspaceId, projectIds],
        ),
      ),
    projectsNeedingProjectionRepair: async () => {
      const rows = (await source.query(
        `SELECT h.project_id FROM project_onboarding_headers h
        JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id
          AND r.onboarding_id=h.onboarding_id AND r.version=h.current_version
        WHERE h.workspace_id=$1 AND h.project_id=ANY($2::uuid[])
          AND (h.current_stage<>r.onboarding_stage OR h.current_capability_mode<>r.qa_capability_mode
            OR h.current_operational_state<>r.project_operational_state)
        ORDER BY h.project_id`,
        [workspaceId, projectIds],
      )) as readonly { project_id: string }[];
      return rows.map(({ project_id }) => project_id);
    },
    repairProjection: async (projectId) => {
      if (!projectIds.includes(projectId))
        throw new Error("CORPORATE_PROJECT_RECOVERY_SCOPE_DENIED");
      await source.transaction("SERIALIZABLE", async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `project-onboarding-recovery:${projectId}`,
        ]);
        await manager.query(
          `UPDATE project_onboarding_headers h SET current_stage=r.onboarding_stage,
          current_capability_mode=r.qa_capability_mode,current_operational_state=r.project_operational_state,
          intended_capability_mode=r.intended_capability_mode,row_version=h.row_version+1,updated_at=clock_timestamp()
          FROM project_onboarding_revisions r WHERE h.workspace_id=$1 AND h.project_id=$2
          AND r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.onboarding_id=h.onboarding_id
          AND r.version=h.current_version`,
          [workspaceId, projectId],
        );
      });
    },
    reauthorizePendingWork: async () => {
      const rows = (await source.query(
        `UPDATE command_outbox outbox SET available_at=LEAST(outbox.available_at,clock_timestamp())
        FROM project_onboarding_headers onboarding WHERE outbox.workspace_id=$1 AND outbox.project_id=ANY($2::uuid[])
          AND outbox.workspace_id=onboarding.workspace_id AND outbox.project_id=onboarding.project_id
          AND outbox.state='READY' AND onboarding.current_operational_state='ACTIVE' RETURNING outbox.id`,
        [workspaceId, projectIds],
      )) as readonly unknown[];
      return Array.isArray(rows[0]) ? rows[0].length : rows.length;
    },
  });
}

import type { DataSource } from "typeorm";
import type { RuntimeEnvironment } from "../config/environment.ts";

/** Read-only candidates: finding a terminal pipeline does not itself finalize a QA attempt. */
export function createCorporateGitLabTerminalCandidateScanner(
  source: DataSource,
  environment: RuntimeEnvironment,
) {
  const deployment = environment.deployment;
  if (
    !source.isInitialized ||
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment?.workspaceId ||
    !deployment.projectIds.length
  )
    throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_REQUIRED");
  let observationCursor: string | null = null;
  let recoveryCursor: string | null = null;
  return {
    async scan(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
        throw new Error("CORPORATE_GITLAB_RESULT_LIMIT_INVALID");
      const read = async (cursor: string | null) =>
        (await source.query(
          `SELECT a.workspace_id,a.project_id,a.attempt_id,a.connector_command_id,o.pipeline_observation_id,o.observation_hash
         FROM qa_automation_attempts a
         JOIN gitlab_effect_reconciliations e ON e.workspace_id=a.workspace_id AND e.command_id=a.connector_command_id
         JOIN gitlab_pipeline_projection_heads h ON h.workspace_id=e.workspace_id AND h.connection_header_id=e.connection_header_id
           AND h.numeric_project_id=e.numeric_project_id AND h.external_pipeline_id=e.external_pipeline_id
         JOIN gitlab_pipeline_observations o ON o.workspace_id=h.workspace_id AND o.connection_header_id=h.connection_header_id
           AND o.numeric_project_id=h.numeric_project_id AND o.pipeline_observation_id=h.current_observation_id
         WHERE a.workspace_id=$1 AND a.project_id=ANY($2::uuid[]) AND a.current_status='RUNNING'
           AND ($4::text IS NULL OR a.attempt_id>$4::text)
           AND e.state IN ('ONE_FOUND','CONFIRMED') AND o.provider_status IN ('SUCCESS','FAILED','CANCELED','SKIPPED','MANUAL')
           AND o.external_pipeline_id=e.external_pipeline_id AND o.marker_hash=e.marker_hash
           AND o.connection_ref=e.connection_ref AND o.profile_ref=e.profile_ref
         ORDER BY a.attempt_id LIMIT $3`,
          [deployment.workspaceId, [...deployment.projectIds], limit, cursor],
        )) as readonly Readonly<{
          workspace_id: string;
          project_id: string;
          attempt_id: string;
          connector_command_id: string;
          pipeline_observation_id: string;
          observation_hash: string;
        }>[];
      let rows = await read(observationCursor);
      if (!rows.length && observationCursor !== null) rows = await read(null);
      observationCursor = rows.length ? rows[rows.length - 1]!.attempt_id : null;
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            attemptId: row.attempt_id,
            commandId: row.connector_command_id,
            observationId: row.pipeline_observation_id,
            observationHash: row.observation_hash,
          }),
        ),
      );
    },
    async scanRetryRecovery(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
        throw new Error("CORPORATE_GITLAB_RESULT_LIMIT_INVALID");
      const read = async (cursor: string | null) =>
        (await source.query(
          `SELECT a.workspace_id,a.project_id,a.attempt_id,a.terminal_result_id
         FROM qa_automation_attempts a
         JOIN qa_automation_attempt_results r ON r.workspace_id=a.workspace_id AND r.project_id=a.project_id
           AND r.attempt_id=a.attempt_id AND r.result_id=a.terminal_result_id
         WHERE a.workspace_id=$1 AND a.project_id=ANY($2::uuid[]) AND a.current_status='TERMINAL'
           AND ($4::text IS NULL OR a.attempt_id>$4::text)
           AND NOT EXISTS (SELECT 1 FROM qa_automation_retry_decisions d
             WHERE d.workspace_id=a.workspace_id AND d.project_id=a.project_id AND d.attempt_id=a.attempt_id)
         ORDER BY a.attempt_id LIMIT $3`,
          [deployment.workspaceId, [...deployment.projectIds], limit, cursor],
        )) as readonly Readonly<{
          workspace_id: string;
          project_id: string;
          attempt_id: string;
          terminal_result_id: string;
        }>[];
      let rows = await read(recoveryCursor);
      if (!rows.length && recoveryCursor !== null) rows = await read(null);
      recoveryCursor = rows.length ? rows[rows.length - 1]!.attempt_id : null;
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            attemptId: row.attempt_id,
            resultId: row.terminal_result_id,
          }),
        ),
      );
    },
  };
}

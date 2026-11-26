import type { DataSource } from "typeorm";
import type { QaAutomationAttemptRecord } from "@awp/competency-qa/node";
import type { RuntimeEnvironment } from "../config/environment.ts";

/** Read current scoped quarantine before deciding whether an automatic retry is eligible. */
export function createCorporateGitLabRetryQuarantine(
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
    throw new Error("CORPORATE_GITLAB_RETRY_SCOPE_REQUIRED");
  return {
    async active(
      attempt: QaAutomationAttemptRecord,
      infrastructureCode: string | undefined,
      signal: AbortSignal,
    ): Promise<boolean> {
      if (
        signal.aborted ||
        attempt.workspaceId !== deployment.workspaceId ||
        !deployment.projectIds.includes(attempt.projectId)
      )
        throw new Error("CORPORATE_GITLAB_RETRY_SCOPE_DENIED");
      const rows = (await source.query(
        `SELECT 1 FROM qa_automation_quarantines q
         WHERE q.workspace_id=$1 AND q.project_id=$2 AND q.current_action='ACTIVATE' AND q.current_expires_at>clock_timestamp()
           AND ((q.subject_kind='SUITE_BINDING_VERSION' AND q.suite_binding_id=$3 AND q.suite_binding_version=$4 AND q.suite_binding_content_hash=$5)
             OR (q.subject_kind='INFRASTRUCTURE_CODE' AND q.infrastructure_code=$6)) LIMIT 1`,
        [
          attempt.workspaceId,
          attempt.projectId,
          attempt.suiteBindingRef.id,
          attempt.suiteBindingRef.version,
          attempt.suiteBindingHash,
          infrastructureCode ?? null,
        ],
      )) as readonly unknown[];
      if (signal.aborted) throw new Error("CORPORATE_GITLAB_RETRY_SCOPE_DENIED");
      return rows.length > 0;
    },
  };
}

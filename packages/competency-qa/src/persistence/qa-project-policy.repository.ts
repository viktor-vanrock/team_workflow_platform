import type { QaScope } from "../domain/primitives.ts";
import type { QaProjectContext } from "../domain/qa-project-context.ts";
import type { QaRiskReviewPolicy } from "../domain/risk-review-policy.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

type Row = Readonly<{ content: unknown }>;
function rows(value: unknown): readonly Row[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
}
function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

export class QaProjectPolicyRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async currentProjectContext(
    scope: QaScope,
    contextId: string,
  ): Promise<QaProjectContext | undefined> {
    const result = await this.source.query(
      `
SELECT version_row.content
FROM qa_project_contexts header
JOIN qa_project_context_versions version_row
  ON version_row.id=header.current_published_version_id
 AND version_row.workspace_id=header.workspace_id AND version_row.project_id=header.project_id
WHERE header.workspace_id=$1 AND header.project_id=$2 AND header.id=$3`,
      [scope.workspaceId, scope.projectId, contextId],
    );
    const row = rows(result)[0];
    return row === undefined ? undefined : json<QaProjectContext>(row.content);
  }

  async currentRiskReviewPolicy(
    scope: QaScope,
    policyId: string,
  ): Promise<QaRiskReviewPolicy | undefined> {
    const result = await this.source.query(
      `
SELECT version_row.content
FROM qa_risk_review_policies header
JOIN qa_risk_review_policy_versions version_row
  ON version_row.id=header.current_published_version_id
 AND version_row.workspace_id=header.workspace_id AND version_row.project_id=header.project_id
WHERE header.workspace_id=$1 AND header.project_id=$2 AND header.id=$3`,
      [scope.workspaceId, scope.projectId, policyId],
    );
    const row = rows(result)[0];
    return row === undefined ? undefined : json<QaRiskReviewPolicy>(row.content);
  }
}

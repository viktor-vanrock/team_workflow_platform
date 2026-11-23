import { qaAggregateSnapshotHash, QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaRequestExtension } from "../domain/qa-request.ts";
import type { QaReadinessAssessment } from "../domain/readiness.ts";
import {
  createRequiredSessionPlanHeader,
  type QaRequiredSessionPlanHeader,
} from "../domain/required-session-plan.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

type Row = Record<string, unknown>;
const rows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class QaReadinessRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async latest(scope: QaScope, workItemId: string): Promise<QaReadinessAssessment | undefined> {
    const found = await this.source.query(
      "SELECT content FROM qa_readiness_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY assessment_version DESC LIMIT 1",
      [scope.workspaceId, scope.projectId, workItemId],
    );
    const row = rows<Readonly<{ content: unknown }>>(found)[0];
    return row ? json<QaReadinessAssessment>(row.content) : undefined;
  }

  async appendAndMoveLatest(
    executor: QaQueryExecutor,
    assessment: QaReadinessAssessment,
    expectedExtensionResourceVersion: number,
  ): Promise<void> {
    const extensionRows = rows<Row>(
      await executor.query(
        "SELECT extension_id,resource_version,content FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
        [assessment.scope.workspaceId, assessment.scope.projectId, assessment.workItemId],
      ),
    );
    const extension = extensionRows[0];
    if (!extension || Number(extension.resource_version) !== expectedExtensionResourceVersion)
      throw new QaDomainError("QA_READINESS_EXTENSION_CAS_CONFLICT");
    await executor.query(
      `INSERT INTO qa_readiness_assessments(assessment_id,workspace_id,project_id,work_item_id,input_revision_id,input_revision_version,input_content_hash,extension_resource_version,assessment_version,state,input_fingerprint,content_hash,content,evaluated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        assessment.assessmentId,
        assessment.scope.workspaceId,
        assessment.scope.projectId,
        assessment.workItemId,
        assessment.requestInputRevisionRef.id,
        assessment.requestInputRevisionRef.version,
        assessment.requestInputRevisionRef.contentHash,
        assessment.extensionResourceVersion,
        assessment.version,
        assessment.state,
        assessment.inputFingerprint,
        assessment.contentHash,
        assessment,
        assessment.evaluatedAt,
      ],
    );
    const previous = Object.fromEntries(
      Object.entries(json<QaRequestExtension>(extension.content)).filter(
        ([key]) => key !== "contentHash",
      ),
    );
    const body = {
      ...previous,
      latestReadinessAssessmentRef: {
        id: assessment.assessmentId,
        version: assessment.version,
        contentHash: assessment.contentHash,
      },
      resourceVersion: expectedExtensionResourceVersion + 1,
      updatedAt: assessment.evaluatedAt,
    };
    const contentHash = qaAggregateSnapshotHash(body as never);
    await executor.query(
      "UPDATE qa_request_extensions SET latest_readiness_assessment_id=$1,resource_version=resource_version+1,updated_at=$2,content_hash=$5,content=$6 WHERE extension_id=$3 AND resource_version=$4",
      [
        assessment.assessmentId,
        assessment.evaluatedAt,
        extension.extension_id,
        expectedExtensionResourceVersion,
        contentHash,
        { ...body, contentHash },
      ],
    );
  }

  async ensurePlanHeader(
    executor: QaQueryExecutor,
    input: Readonly<{
      id: string;
      extensionId: string;
      scope: QaScope;
      workItemId: string;
      createdAt: string;
    }>,
  ): Promise<QaRequiredSessionPlanHeader> {
    await executor.query(
      `INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,current_version_id,current_version,current_content_hash,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NULL,NULL,NULL,1,$6,$6) ON CONFLICT(workspace_id,project_id,work_item_id) DO NOTHING`,
      [
        input.id,
        input.scope.workspaceId,
        input.scope.projectId,
        input.workItemId,
        input.extensionId,
        input.createdAt,
      ],
    );
    const found = rows<Row>(
      await executor.query(
        "SELECT * FROM qa_required_session_plans WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
        [input.scope.workspaceId, input.scope.projectId, input.workItemId],
      ),
    );
    const row = found[0];
    if (!row) throw new QaDomainError("QA_PLAN_HEADER_NOT_FOUND");
    if (row.current_version_id === null)
      return createRequiredSessionPlanHeader({
        id: String(row.plan_id),
        workspaceId: String(row.workspace_id),
        projectId: String(row.project_id),
        workItemId: String(row.work_item_id),
        extensionId: String(row.extension_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
      });
    const revisions = rows<Readonly<{ content: unknown }>>(
      await executor.query(
        "SELECT content FROM qa_required_session_plan_versions WHERE plan_id=$1 ORDER BY version",
        [row.plan_id],
      ),
    ).map((value) => json(value.content));
    return Object.freeze({
      id: String(row.plan_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      workItemId: String(row.work_item_id),
      extensionId: String(row.extension_id),
      currentRevisionRef: {
        id: String(row.current_version_id),
        version: Number(row.current_version),
        contentHash: String(row.current_content_hash) as `sha256:${string}`,
      },
      revisions: Object.freeze(revisions) as QaRequiredSessionPlanHeader["revisions"],
      resourceVersion: Number(row.resource_version),
      ...(row.frozen_at ? { frozenAt: new Date(String(row.frozen_at)).toISOString() } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    });
  }
}

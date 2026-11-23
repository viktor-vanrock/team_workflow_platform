import type { EntityManager } from "typeorm";

type ProjectScope = Readonly<{ workspaceId: string; projectId: string }>;

/** Existing HUMAN decisions stay immutable; pending recommendations are conservatively invalidated. */
export class QaHermesPolicyInvalidation {
  async invalidate(
    manager: EntityManager,
    scope: ProjectScope,
    selectedAt: Date,
  ): Promise<Readonly<Record<string, number>>> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error("HERMES_INVALIDATION_TRANSACTION_REQUIRED");
    const resultRows = (value: unknown): readonly unknown[] =>
      Array.isArray(value) && Array.isArray(value[0])
        ? (value[0] as unknown[])
        : (value as unknown[]);
    const triage = resultRows(
      await manager.query(
        "UPDATE qa_triage_assessments SET state='STALE',stale_at=$3,stale_reason_code='BINDING_CHANGED' WHERE workspace_id=$1 AND project_id=$2 AND state='CURRENT' RETURNING id",
        [scope.workspaceId, scope.projectId, selectedAt],
      ),
    );
    const plans = resultRows(
      await manager.query(
        "UPDATE qa_session_plan_proposals SET state='STALE',stale_at=$3 WHERE workspace_id=$1 AND project_id=$2 AND state='CURRENT' RETURNING id",
        [scope.workspaceId, scope.projectId, selectedAt],
      ),
    );
    return Object.freeze({ triage: triage.length, sessionPlans: plans.length });
  }
}

import type { QaContentHash, QaHumanActor, QaScope } from "../domain/primitives.ts";
import type { QaQueryExecutor } from "../persistence/repository-helpers.ts";

export interface QaObservationCorrectionInvalidationPort {
  invalidate(
    input: Readonly<{
      scope: QaScope;
      workItemId: string;
      sessionId: string;
      planItemId: string;
      predecessorObservationId: string;
      successorObservationId: string;
      currentLeafSetHash: QaContentHash;
      actor: QaHumanActor;
      at: string;
    }>,
  ): Promise<void>;
}

export const qaNoopObservationCorrectionInvalidation: QaObservationCorrectionInvalidationPort =
  Object.freeze({ invalidate: async () => undefined });

export class TypeOrmObservationCorrectionFindingInvalidator implements QaObservationCorrectionInvalidationPort {
  constructor(private readonly source: QaQueryExecutor) {}
  async invalidate(
    input: Parameters<QaObservationCorrectionInvalidationPort["invalidate"]>[0],
  ): Promise<void> {
    const raw = (await this.source.query(
      "SELECT fo.membership_id,fo.finding_id,f.state FROM qa_finding_observations fo JOIN qa_findings f ON f.finding_id=fo.finding_id AND f.workspace_id=fo.workspace_id AND f.project_id=fo.project_id WHERE fo.workspace_id=$1 AND fo.project_id=$2 AND fo.session_id=$3 AND fo.observation_id=$4 AND fo.state='ACTIVE' FOR UPDATE OF fo,f",
      [
        input.scope.workspaceId,
        input.scope.projectId,
        input.sessionId,
        input.predecessorObservationId,
      ],
    )) as readonly unknown[];
    const memberships = (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<{
      membership_id: string;
      finding_id: string;
      state: string;
    }>[];
    for (const row of memberships) {
      if (row.state === "FROZEN") throw new Error("QA_FINDING_FROZEN");
      await this.source.query(
        "UPDATE qa_finding_observations SET state='RELEASED',released_by=$1,released_at=$2,release_reason='OBSERVATION_CORRECTED',resource_version=resource_version+1 WHERE membership_id=$3 AND state='ACTIVE'",
        [JSON.stringify(input.actor), input.at, row.membership_id],
      );
      await this.source.query(
        "UPDATE qa_findings SET state='DRAFT',current_review_revision_id=NULL,classification=NULL,resource_version=resource_version+1,content=(content-'latestReviewRevisionRef'-'classification'-'dispositionDecision'-'dispositionReason'-'disposedBy'-'disposedAt')||jsonb_build_object('state','DRAFT','resetReason','OBSERVATION_CORRECTED','correctedObservationId',$1::text,'successorObservationId',$2::text,'currentLeafSetHash',$3::text,'resetBy',$4::jsonb,'updatedAt',$5::text,'resourceVersion',resource_version+1) WHERE finding_id=$6",
        [
          input.predecessorObservationId,
          input.successorObservationId,
          input.currentLeafSetHash,
          JSON.stringify(input.actor),
          input.at,
          row.finding_id,
        ],
      );
    }
  }
}

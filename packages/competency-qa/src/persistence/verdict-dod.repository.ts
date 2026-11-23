import type { EntityManager } from "typeorm";

import type { QaCompletionCandidateAggregate } from "../domain/completion.ts";
import type { QaDodAssessment } from "../domain/dod.ts";
import type { QaScope } from "../domain/primitives.ts";
import type { QaVerdictAggregate, QaVerdictSignature } from "../domain/verdict.ts";

const json = (value: unknown): string => JSON.stringify(value);

export class TypeOrmQaVerdictDodRepository {
  constructor(private readonly manager: EntityManager) {}

  async insertVerdict(verdict: QaVerdictAggregate): Promise<void> {
    await this.manager.query(
      `INSERT INTO qa_verdicts(verdict_id,workspace_id,project_id,work_item_id,version,verdict,residual_risk,effective_risk,required_session_plan_ref,session_review_refs,evidence_manifest_refs,finding_outcome_refs,dod_rule_set_ref,risk_policy_ref,aggregate_snapshot_hash,content_hash,supersedes_verdict_id,revision_reason,state,signed_at,superseded_by_verdict_id,supersession_reason,superseded_at,created_by,created_at,resource_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        verdict.verdictId,
        verdict.workspaceId,
        verdict.projectId,
        verdict.workItemId,
        verdict.version,
        verdict.verdict,
        json(verdict.residualRisk),
        verdict.effectiveRisk,
        json(verdict.requiredSessionPlanRef),
        json(verdict.sessionReviewRefs),
        json(verdict.evidenceManifestRefs),
        json(verdict.findingOutcomeRefs),
        json(verdict.dodRuleSetRef),
        json(verdict.riskPolicyRef),
        verdict.aggregateSnapshotHash,
        verdict.contentHash,
        verdict.supersedesVerdictRef?.id ?? null,
        verdict.revisionReason ?? null,
        verdict.state,
        verdict.signedAt ?? null,
        verdict.supersededByVerdictRef?.id ?? null,
        verdict.supersessionReason ?? null,
        verdict.supersededAt ?? null,
        json(verdict.createdBy),
        verdict.createdAt,
        verdict.resourceVersion,
      ],
    );
  }

  async appendSignature(
    scope: QaScope,
    workItemId: string,
    verdictId: string,
    signature: QaVerdictSignature,
  ): Promise<void> {
    await this.manager.query(
      `INSERT INTO qa_verdict_signatures(signature_id,workspace_id,project_id,work_item_id,verdict_id,role,verdict_content_hash,signer,authorization_basis_hash,action_ref,signed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        signature.signatureId,
        scope.workspaceId,
        scope.projectId,
        workItemId,
        verdictId,
        signature.role,
        signature.verdictContentHash,
        json(signature.signer),
        signature.authorizationBasisHash,
        signature.actionRef ? json(signature.actionRef) : null,
        signature.signedAt,
      ],
    );
  }

  async advanceVerdictProjection(
    verdict: QaVerdictAggregate,
    expectedResourceVersion: number,
  ): Promise<void> {
    const result = (await this.manager.query(
      `UPDATE qa_verdicts SET state=$1,signed_at=$2,superseded_by_verdict_id=$3,supersession_reason=$4,superseded_at=$5,resource_version=resource_version+1
       WHERE verdict_id=$6 AND workspace_id=$7 AND project_id=$8 AND work_item_id=$9 AND resource_version=$10 RETURNING verdict_id`,
      [
        verdict.state,
        verdict.signedAt ?? null,
        verdict.supersededByVerdictRef?.id ?? null,
        verdict.supersessionReason ?? null,
        verdict.supersededAt ?? null,
        verdict.verdictId,
        verdict.workspaceId,
        verdict.projectId,
        verdict.workItemId,
        expectedResourceVersion,
      ],
    )) as readonly unknown[];
    if (result.length === 0) throw new Error("QA_VERDICT_CAS_CONFLICT");
  }

  async appendDod(assessment: QaDodAssessment): Promise<void> {
    await this.manager.query(
      `INSERT INTO qa_dod_assessments(assessment_id,workspace_id,project_id,work_item_id,version,state,blocker_codes,warning_codes,inventory,aggregate_input_hash,rule_set_ref,risk_policy_ref,evaluated_by,evaluated_at,completion_confirmation_ref,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        assessment.assessmentId,
        assessment.workspaceId,
        assessment.projectId,
        assessment.workItemId,
        assessment.version,
        assessment.state,
        json(assessment.blockerCodes),
        json(assessment.warningCodes),
        json(assessment.inventory),
        assessment.aggregateInputHash,
        json(assessment.ruleSetRef),
        json(assessment.riskPolicyRef),
        assessment.evaluatedBy,
        assessment.evaluatedAt,
        assessment.completionConfirmationRef ? json(assessment.completionConfirmationRef) : null,
        assessment.contentHash,
      ],
    );
  }

  async insertCompletionCandidate(candidate: QaCompletionCandidateAggregate): Promise<void> {
    await this.manager.query(
      `INSERT INTO qa_completion_candidates(candidate_id,workspace_id,project_id,work_item_id,candidate_number,version,ready_to_close_dod_ref,verdict_ref,required_session_plan_ref,summary,summary_content_hash,aggregate_snapshot_hash,expected_external_state,expected_external_version,binding_ref,profile_refs,initiated_by,created_at,content_hash,state,resource_version)
       VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'CANDIDATE',1)`,
      [
        candidate.candidateId,
        candidate.workspaceId,
        candidate.projectId,
        candidate.workItemId,
        candidate.candidateNumber,
        json(candidate.readyToCloseDodRef),
        json(candidate.verdictRef),
        json(candidate.requiredSessionPlanRef),
        json(candidate.summary),
        candidate.summary.contentHash,
        candidate.aggregateSnapshotHash,
        candidate.expectedExternalState,
        candidate.expectedExternalVersion,
        json(candidate.bindingRef),
        json(candidate.profileRefs),
        json(candidate.initiatedBy),
        candidate.createdAt,
        candidate.contentHash,
      ],
    );
  }
}

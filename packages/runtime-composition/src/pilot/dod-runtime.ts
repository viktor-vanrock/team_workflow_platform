import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  buildQaDodAssessment,
  evaluateQaDod,
  qaAggregateSnapshotHash,
  type QaCompletionCandidateInput,
  type QaContentHash,
  type QaDodAssessment,
  type QaExactReference,
  type QaHumanActor,
  type QaRequestExtension,
  type QaScope,
  TypeOrmQaVerdictDodRepository,
} from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";

import { loadQaDodInventory } from "./dod-inventory.ts";

export interface QaDodAuthority extends QaScope {
  authorize(
    permission: "qa.verdict.sign" | "qa.completion.request",
  ): Promise<Readonly<{ actor: QaHumanActor; classificationCeiling: string }>>;
}
export interface QaDodPolicy {
  readonly rules: QaExactReference;
  readonly riskPolicyRef: QaExactReference;
  readonly evidencePolicyRef: QaRequestExtension["evidencePolicyRef"];
  readonly minimumEffectiveRisk: "ORDINARY" | "HIGH" | "CRITICAL";
  readonly maximumClassificationKey: string;
}
export interface QaDodPolicyPort {
  load(manager: EntityManager, scope: QaScope, extension: QaRequestExtension): Promise<QaDodPolicy>;
}
export interface QaDodAssessmentRequest {
  readonly expectedAggregateSnapshotHash: QaContentHash;
  readonly verdictRef: QaExactReference;
}
export interface QaDodRuntime {
  assess(
    authority: QaDodAuthority,
    workItemId: string,
    request: QaDodAssessmentRequest,
  ): Promise<QaDodAssessment>;
  prepareCompletion(
    manager: EntityManager,
    authority: QaDodAuthority,
    workItemId: string,
    assessmentRef: QaExactReference,
  ): Promise<QaCompletionProof>;
}
export type QaCompletionProof = Pick<
  QaCompletionCandidateInput,
  | "readyToCloseDodRef"
  | "verdictRef"
  | "verdict"
  | "residualRisk"
  | "evidenceManifestRefs"
  | "defectLinkOrDispositionRefs"
  | "requiredSessionPlanRef"
  | "aggregateSnapshotHash"
>;

/** The HTTP request selects an exact verdict; none of its claimed inventory facts are accepted. */
export class DurableQaDodRuntime implements QaDodRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly policies: QaDodPolicyPort,
  ) {}
  async prepareCompletion(
    manager: EntityManager,
    authority: QaDodAuthority,
    workItemId: string,
    assessmentRef: QaExactReference,
  ): Promise<QaCompletionProof> {
    await authority.authorize("qa.completion.request");
    if (!manager.queryRunner?.isTransactionActive) throw new Error("QA_DOD_TRANSACTION_REQUIRED");
    const scope = [authority.workspaceId, authority.projectId, workItemId];
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `qa-request:${scope.join(":")}`,
    ]);
    const [extension] = (await manager.query(
      `SELECT e.*,w.classification_key FROM qa_request_extensions e JOIN work_items w
      ON w.workspace_id=e.workspace_id AND w.project_id=e.project_id AND w.id=e.work_item_id
      WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.work_item_id=$3 FOR UPDATE OF e,w`,
      scope,
    )) as Record<string, unknown>[];
    if (!extension) throw new Error("QA_DOD_REQUEST_NOT_FOUND");
    const evaluating = await authority.authorize("qa.completion.request");
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(evaluating.classificationCeiling),
        defaultClassificationCatalog.reference(String(extension.classification_key)),
      )
    )
      throw new Error("QA_DOD_CLASSIFICATION_DENIED");
    const [stored] = (await manager.query(
      "SELECT * FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND assessment_id=$4 AND version=$5 AND content_hash=$6 AND state='READY_TO_CLOSE'",
      [...scope, assessmentRef?.id, assessmentRef?.version, assessmentRef?.contentHash],
    )) as Record<string, unknown>[];
    if (
      !stored ||
      stored.assessment_id !== extension.latest_dod_assessment_id ||
      extension.completion_in_flight_candidate_id
    )
      throw new Error("QA_DOD_ASSESSMENT_NOT_CURRENT");
    const assessment = buildQaDodAssessment({
      assessmentId: String(stored.assessment_id),
      version: Number(stored.version),
      workspaceId: authority.workspaceId,
      projectId: authority.projectId,
      workItemId,
      state: "READY_TO_CLOSE",
      blockerCodes: stored.blocker_codes,
      warningCodes: stored.warning_codes,
      inventory: stored.inventory,
      aggregateInputHash: stored.aggregate_input_hash,
      ruleSetRef: stored.rule_set_ref,
      riskPolicyRef: stored.risk_policy_ref,
      evaluatedBy: stored.evaluated_by,
      evaluatedAt: (stored.evaluated_at as Date).toISOString(),
    } as Omit<QaDodAssessment, "contentHash">);
    if (assessment.contentHash !== stored.content_hash || !assessment.inventory.verdictRef)
      throw new Error("QA_DOD_ASSESSMENT_HASH_MISMATCH");
    const policy = await this.policies.load(
      manager,
      authority,
      extension.content as QaRequestExtension,
    );
    const ceiling = this.#policyCeiling(
      policy,
      evaluating.classificationCeiling,
      String(extension.classification_key),
    );
    const inventory = await loadQaDodInventory(
      manager,
      authority,
      workItemId,
      extension,
      policy,
      assessment.inventory.verdictRef,
      ceiling,
    );
    const current = evaluateQaDod({
      ...inventory,
      workspaceId: authority.workspaceId,
      projectId: authority.projectId,
      workItemId,
      assessmentId: assessment.assessmentId,
      version: assessment.version,
      expectedAggregateSnapshotHash: String(extension.adjudicative_aggregate_hash) as QaContentHash,
      currentAggregateSnapshotHash: String(extension.adjudicative_aggregate_hash) as QaContentHash,
      rules: policy.rules,
      riskPolicyRef: policy.riskPolicyRef,
      evaluatedBy: evaluating.actor.principalId,
      evaluatedAt: new Date().toISOString(),
    });
    if (
      current.state !== "READY_TO_CLOSE" ||
      current.aggregateInputHash !== assessment.aggregateInputHash ||
      qaAggregateSnapshotHash(current.ruleSetRef as never) !==
        qaAggregateSnapshotHash(assessment.ruleSetRef as never) ||
      qaAggregateSnapshotHash(current.riskPolicyRef as never) !==
        qaAggregateSnapshotHash(assessment.riskPolicyRef as never)
    )
      throw new Error("QA_DOD_CLOSURE_PROOF_STALE");
    const latest = await authority.authorize("qa.completion.request");
    if (
      evaluating.actor.kind !== "HUMAN" ||
      latest.actor.principalId !== evaluating.actor.principalId ||
      latest.classificationCeiling !== evaluating.classificationCeiling
    )
      throw new Error("QA_DOD_AUTHORITY_CHANGED");
    if (
      qaAggregateSnapshotHash(policy as never) !==
      qaAggregateSnapshotHash(
        (await this.policies.load(
          manager,
          authority,
          extension.content as QaRequestExtension,
        )) as never,
      )
    )
      throw new Error("QA_DOD_POLICY_CHANGED");
    const [verdict] = (await manager.query(
      "SELECT verdict,residual_risk FROM qa_verdicts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4",
      [...scope, assessment.inventory.verdictRef.id],
    )) as {
      verdict: QaCompletionCandidateInput["verdict"];
      residual_risk: { statement: string };
    }[];
    return {
      readyToCloseDodRef: assessmentRef,
      verdictRef: assessment.inventory.verdictRef,
      verdict: verdict!.verdict,
      residualRisk: verdict!.residual_risk.statement,
      requiredSessionPlanRef: current.inventory.requiredSessionPlanRef!,
      aggregateSnapshotHash: String(extension.adjudicative_aggregate_hash) as QaContentHash,
      evidenceManifestRefs: current.inventory.evidenceManifestRefs,
      defectLinkOrDispositionRefs: inventory.findings.flatMap((finding) => [
        ...(finding.reviewRef ? [{ ...finding.reviewRef, kind: "DISPOSITION" as const }] : []),
        ...finding.draftChain.flatMap((draft) =>
          draft.state === "LINKED" && draft.defectLinkRef
            ? [{ ...draft.defectLinkRef, kind: "DEFECT_LINK" as const }]
            : [],
        ),
      ]),
    };
  }
  async assess(
    authority: QaDodAuthority,
    workItemId: string,
    request: QaDodAssessmentRequest,
  ): Promise<QaDodAssessment> {
    await authority.authorize("qa.verdict.sign");
    if (
      !request?.verdictRef?.id ||
      !Number.isSafeInteger(request.verdictRef.version) ||
      request.verdictRef.version < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(request.verdictRef.contentHash) ||
      !/^sha256:[a-f0-9]{64}$/u.test(request.expectedAggregateSnapshotHash)
    )
      throw new Error("QA_DOD_REQUEST_INVALID");
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const scope = [authority.workspaceId, authority.projectId, workItemId];
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-request:${scope.join(":")}`,
      ]);
      const [row] = (await manager.query(
        `SELECT e.*,w.classification_key FROM qa_request_extensions e JOIN work_items w
        ON w.workspace_id=e.workspace_id AND w.project_id=e.project_id AND w.id=e.work_item_id
        WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.work_item_id=$3 FOR UPDATE OF e,w`,
        scope,
      )) as Record<string, unknown>[];
      if (!row) throw new Error("QA_DOD_REQUEST_NOT_FOUND");
      const authorize = async () => {
        const current = await authority.authorize("qa.verdict.sign");
        if (
          current.actor.kind !== "HUMAN" ||
          !defaultClassificationCatalog.permits(
            defaultClassificationCatalog.reference(current.classificationCeiling),
            defaultClassificationCatalog.reference(String(row.classification_key)),
          )
        )
          throw new Error("QA_DOD_CLASSIFICATION_DENIED");
        return current;
      };
      const evaluating = await authorize();
      const extension = row.content as QaRequestExtension;
      if (
        extension.workspaceId !== authority.workspaceId ||
        extension.projectId !== authority.projectId ||
        extension.workItemId !== workItemId
      )
        throw new Error("QA_DOD_REQUEST_NOT_FOUND");
      if (row.completion_in_flight_candidate_id) throw new Error("QA_DOD_COMPLETION_IN_FLIGHT");
      const policy = await this.policies.load(manager, authority, extension);
      const ceiling = this.#policyCeiling(
        policy,
        evaluating.classificationCeiling,
        String(row.classification_key),
      );
      const inventory = await loadQaDodInventory(
        manager,
        authority,
        workItemId,
        row,
        policy,
        request.verdictRef,
        ceiling,
      );
      const current = await authorize();
      if (
        current.actor.principalId !== evaluating.actor.principalId ||
        current.classificationCeiling !== evaluating.classificationCeiling
      )
        throw new Error("QA_DOD_AUTHORITY_CHANGED");
      // Recheck configuration after resolving mutable inventory and before publishing the decision.
      if (
        qaAggregateSnapshotHash(policy as never) !==
        qaAggregateSnapshotHash((await this.policies.load(manager, authority, extension)) as never)
      )
        throw new Error("QA_DOD_POLICY_CHANGED");
      const [latest] = (await manager.query(
        "SELECT COALESCE(max(version),0) AS version FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
        scope,
      )) as { version: number | string }[];
      const assessment = evaluateQaDod({
        ...inventory,
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        workItemId,
        assessmentId: randomUUID(),
        version: Number(latest!.version) + 1,
        expectedAggregateSnapshotHash: request.expectedAggregateSnapshotHash,
        currentAggregateSnapshotHash: String(row.adjudicative_aggregate_hash) as QaContentHash,
        rules: policy.rules,
        riskPolicyRef: policy.riskPolicyRef,
        evaluatedBy: current.actor.principalId,
        evaluatedAt: new Date().toISOString(),
      });
      await new TypeOrmQaVerdictDodRepository(manager).appendDod(assessment);
      const content = {
        ...extension,
        adjudicativeAggregateHash: String(row.adjudicative_aggregate_hash),
        currentRequiredSessionPlanRevisionRef: assessment.inventory.requiredSessionPlanRef,
        resourceVersion: Number(row.resource_version) + 1,
        updatedAt: assessment.evaluatedAt,
      };
      const body = Object.fromEntries(
        Object.entries(content).filter(([key]) => key !== "contentHash"),
      );
      const contentHash = qaAggregateSnapshotHash(body as never);
      await manager.query(
        `UPDATE qa_request_extensions SET latest_dod_assessment_id=$1,resource_version=resource_version+1,
        content=$2,content_hash=$3,updated_at=$4 WHERE workspace_id=$5 AND project_id=$6 AND work_item_id=$7`,
        [
          assessment.assessmentId,
          { ...body, contentHash },
          contentHash,
          assessment.evaluatedAt,
          ...scope,
        ],
      );
      return assessment;
    });
  }
  #policyCeiling(policy: QaDodPolicy, authorized: string, classification: string): string {
    const configured = defaultClassificationCatalog.reference(policy.maximumClassificationKey);
    if (
      !defaultClassificationCatalog.permits(
        configured,
        defaultClassificationCatalog.reference(classification),
      )
    )
      throw new Error("QA_DOD_CLASSIFICATION_DENIED");
    return configured.rank < defaultClassificationCatalog.reference(authorized).rank
      ? configured.key
      : authorized;
  }
}

import type { EntityManager } from "typeorm";

import {
  createQaVerdict,
  type EvaluateQaDodInput,
  evaluateSessionReviewPreconditions,
  qaAggregateSnapshotHash,
  type QaExactReference,
  type QaScope,
  type QaVerdictInput,
  type QaVerdictSignature,
} from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";

import type { QaDodPolicy } from "./dod-runtime.ts";

type Row = Record<string, unknown>;
type Preconditions = Parameters<typeof evaluateSessionReviewPreconditions>[0];
const exact = (id: unknown, version: unknown, contentHash: unknown): QaExactReference => ({
  id: String(id),
  version: Number(version),
  contentHash: String(contentHash) as `sha256:${string}`,
});
const same = (a: unknown, b: unknown) =>
  qaAggregateSnapshotHash(a as never) === qaAggregateSnapshotHash(b as never);
const refs = (values: readonly QaExactReference[]) =>
  values
    .map((value) => exact(value.id, value.version, value.contentHash))
    .sort((a, b) => a.id.localeCompare(b.id));
const date = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();

type Inventory = Pick<
  EvaluateQaDodInput,
  | "requiredSessionPlan"
  | "sessionReviews"
  | "verdict"
  | "findings"
  | "waivers"
  | "evidencePolicySatisfied"
>;
export async function loadQaAdjudicationInventory(
  manager: EntityManager,
  scope: QaScope,
  workItemId: string,
  extension: Row,
  policy: QaDodPolicy,
  classificationCeiling: string,
) {
  const args = [scope.workspaceId, scope.projectId, workItemId];
  const [plan] = (await manager.query(
    `SELECT v.*,p.current_content_hash FROM qa_required_session_plans p JOIN qa_required_session_plan_versions v
    ON v.plan_version_id=p.current_version_id AND v.workspace_id=p.workspace_id AND v.project_id=p.project_id AND v.work_item_id=p.work_item_id
    WHERE p.workspace_id=$1 AND p.project_id=$2 AND p.work_item_id=$3 FOR SHARE OF p`,
    args,
  )) as Row[];
  if (
    !plan ||
    plan.plan_version_id !== extension.current_required_session_plan_version_id ||
    plan.content_hash !== extension.current_required_session_plan_content_hash ||
    plan.content_hash !== plan.current_content_hash
  )
    throw new Error("QA_DOD_PLAN_NOT_CURRENT");
  const requirements = (await manager.query(
    "SELECT * FROM qa_required_session_plan_requirements WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND plan_version_id=$4 ORDER BY ordinal",
    [...args, plan.plan_version_id],
  )) as Row[];
  if (!requirements.length) throw new Error("QA_DOD_PLAN_NOT_CURRENT");
  // Inventory waivers need an exact durable decision resolver; until composed they cannot waive coverage.
  if (requirements.some((value) => value.resolution !== "REQUIRED"))
    throw new Error("QA_DOD_WAIVER_RESOLUTION_REQUIRED");
  const sessions = (await manager.query(
    "SELECT * FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY session_id FOR SHARE",
    args,
  )) as Row[];
  const sessionReviews: Inventory["sessionReviews"][number][] = [];
  let evidencePolicySatisfied = true;
  for (const session of sessions) {
    if (!session.latest_session_review_id || session.state !== "COMPLETED") continue;
    const [review] = (await manager.query(
      `SELECT r.*,m.manifest,m.version AS manifest_version,m.evidence_policy_ref,h.latest_adjudicative_revision_id
      FROM qa_session_reviews r JOIN qa_evidence_manifest_revisions m ON m.manifest_revision_id=r.manifest_revision_id
        AND m.workspace_id=r.workspace_id AND m.project_id=r.project_id AND m.work_item_id=r.work_item_id AND m.session_id=r.session_id AND m.content_hash=r.manifest_content_hash
      JOIN qa_evidence_manifests h ON h.manifest_id=m.manifest_id AND h.workspace_id=m.workspace_id AND h.project_id=m.project_id AND h.work_item_id=m.work_item_id AND h.session_id=m.session_id
      WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.work_item_id=$3 AND r.session_id=$4 AND r.session_review_id=$5 FOR SHARE OF h`,
      [...args, session.session_id, session.latest_session_review_id],
    )) as Row[];
    if (!review) {
      evidencePolicySatisfied = false;
      continue;
    }
    const manifest = review.manifest as Row;
    if (manifest.schemaVersion !== 1) throw new Error("QA_DOD_MANIFEST_VERSION_UNSUPPORTED");
    const { contentHash: reviewHash, ...reviewBody } = review.content as Row;
    const manifestHash = manifest.contentHash;
    const metadata = new Set([
      "schemaVersion",
      "manifestId",
      "manifestRevisionId",
      "version",
      "kind",
      "previousRevisionRef",
      "correctionReason",
      "contentHash",
    ]);
    const manifestBody = Object.fromEntries(
      Object.entries(manifest).filter(([key]) => !metadata.has(key)),
    );
    const current =
      review.manifest_revision_id === session.adjudicative_manifest_revision_id &&
      review.manifest_revision_id === review.latest_adjudicative_revision_id &&
      same(reviewHash, review.content_hash) &&
      qaAggregateSnapshotHash(reviewBody as never) === reviewHash &&
      manifestHash === review.manifest_content_hash &&
      qaAggregateSnapshotHash(manifestBody as never) === manifestHash;
    const evidence = (await manager.query(
      `SELECT l.*,a.availability,a.checksum AS current_checksum,a.size_bytes AS current_size_bytes,
      a.media_type AS current_media_type,a.classification_key AS current_classification_key,m.checksum AS member_checksum,m.size_bytes AS member_size_bytes,m.media_type AS member_media_type,m.classification_key AS member_classification_key
      FROM qa_evidence_manifest_artifact_memberships m JOIN qa_evidence_artifact_links l ON l.evidence_link_id=m.evidence_link_id
        AND l.workspace_id=m.workspace_id AND l.project_id=m.project_id AND l.work_item_id=m.work_item_id AND l.session_id=m.session_id
      JOIN artifact_references a ON a.id=l.artifact_reference_id AND a.workspace_id=l.workspace_id AND a.project_id=l.project_id
      WHERE m.workspace_id=$1 AND m.project_id=$2 AND m.work_item_id=$3 AND m.session_id=$4 AND m.manifest_revision_id=$5 ORDER BY m.ordinal FOR SHARE OF a`,
      [...args, session.session_id, review.manifest_revision_id],
    )) as Row[];
    const members = manifest.artifactMembers as Row[];
    const validEvidence = evidence.every(
      (link) =>
        link.availability === "AVAILABLE" &&
        link.current_checksum === link.checksum &&
        link.member_checksum === link.checksum &&
        Number(link.current_size_bytes) === Number(link.size_bytes) &&
        Number(link.member_size_bytes) === Number(link.size_bytes) &&
        link.current_media_type === link.media_type &&
        link.member_media_type === link.media_type &&
        link.current_classification_key === link.classification_key &&
        link.member_classification_key === link.classification_key &&
        defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(classificationCeiling),
          defaultClassificationCatalog.reference(String(link.current_classification_key)),
        ),
    );
    const membershipMatches =
      members.length === evidence.length &&
      members.every((member) =>
        evidence.some(
          (link) =>
            member.evidenceArtifactLinkId === link.evidence_link_id &&
            member.checksum === link.checksum,
        ),
      );
    const manifestPolicy = review.evidence_policy_ref as { key: string; version: string };
    const policyMatches =
      manifestPolicy.key === policy.evidencePolicyRef.key &&
      manifestPolicy.version === policy.evidencePolicyRef.version;
    const owner = (link: Row) => {
      const columns: Record<string, string> = {
        SESSION: "owner_session_id",
        PLAN_ITEM: "owner_plan_item_id",
        MANUAL_ATTEMPT: "owner_attempt_id",
        OBSERVATION: "owner_observation_id",
        FINDING: "owner_finding_id",
      };
      return {
        evidenceLinkId: String(link.evidence_link_id),
        ownerType: (link.owner_kind === "MANUAL_ATTEMPT"
          ? "ATTEMPT"
          : link.owner_kind) as "ATTEMPT",
        ownerId: String(link[columns[String(link.owner_kind)]!]),
        availability:
          link.availability === "AVAILABLE" ? ("AVAILABLE" as const) : ("EXPIRED" as const),
      };
    };
    const preconditions = evaluateSessionReviewPreconditions({
      attempts: manifest.attempts as Preconditions["attempts"],
      observations: manifest.observations as Preconditions["observations"],
      results: manifest.resultRevisions as Preconditions["results"],
      evidence: evidence.map(owner),
      waivers: [],
      findingInventory: (manifest.frozenFindingReviews as Row[]).map((value) => ({
        stage: "FROZEN",
        observationIds: (value.observationIds ?? []) as string[],
      })),
    });
    const evidenceComplete =
      current && validEvidence && membershipMatches && policyMatches && preconditions.reviewable;
    evidencePolicySatisfied &&= evidenceComplete;
    // Older plan sessions count only through a verified, unchanged requirement chain.
    const requirementId = session.requirement_id;
    let requirementKey = "";
    for (const requirement of requirements) {
      let candidate = requirement;
      const seen = new Set<unknown>();
      while (!seen.has(candidate.requirement_id)) {
        seen.add(candidate.requirement_id);
        if (candidate.requirement_id === requirementId) {
          requirementKey = String(requirement.requirement_key);
          break;
        }
        if (!candidate.carried_from_requirement_id) break;
        const [previous] = (await manager.query(
          "SELECT * FROM qa_required_session_plan_requirements WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND requirement_id=$4",
          [...args, candidate.carried_from_requirement_id],
        )) as Row[];
        if (
          !previous ||
          previous.requirement_key !== candidate.requirement_key ||
          previous.content_hash !== candidate.content_hash
        )
          break;
        candidate = previous;
      }
      if (requirementKey) break;
    }
    sessionReviews.push({
      ...exact(review.session_review_id, review.version, review.content_hash),
      requirementKey,
      current: current && !!requirementKey,
      evidenceComplete,
      evidenceManifestRef: exact(
        review.manifest_revision_id,
        review.manifest_version,
        review.manifest_content_hash,
      ),
    });
  }
  const findingRows = (await manager.query(
    `SELECT f.*,r.stage,r.disposition_decision,r.version AS review_version,r.content_hash AS review_content_hash
    FROM qa_findings f LEFT JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.frozen_review_revision_id AND r.workspace_id=f.workspace_id AND r.project_id=f.project_id AND r.work_item_id=f.work_item_id AND r.session_id=f.session_id AND r.finding_id=f.finding_id
    WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.work_item_id=$3 ORDER BY f.finding_id FOR SHARE OF f`,
    args,
  )) as Row[];
  const findings: Inventory["findings"][number][] = [];
  const findingOutcomeRefs: QaExactReference[] = [];
  for (const finding of findingRows) {
    const drafts = (await manager.query(
      `SELECT d.*,l.content_hash AS link_content_hash FROM qa_defect_drafts d LEFT JOIN qa_defect_links l
      ON l.defect_link_id=d.defect_link_id AND l.workspace_id=d.workspace_id AND l.project_id=d.project_id AND l.work_item_id=d.work_item_id AND l.finding_id=d.finding_id
      WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.work_item_id=$3 AND d.finding_id=$4 ORDER BY d.version FOR SHARE OF d`,
      [...args, finding.finding_id],
    )) as Row[];
    const frozen =
      finding.state === "FROZEN" &&
      finding.stage === "FROZEN" &&
      finding.current_review_revision_id === finding.frozen_review_revision_id;
    const reviewRef = frozen
      ? exact(
          finding.frozen_review_revision_id,
          finding.review_version,
          finding.review_content_hash,
        )
      : undefined;
    if (reviewRef) findingOutcomeRefs.push(reviewRef);
    const draftChain = drafts.map((draft) => ({
      state: String(draft.state),
      rejectedByHuman:
        (draft.rejected_by as { kind?: string } | null)?.kind === "HUMAN" &&
        !!draft.rejection_reason,
      ...(draft.link_content_hash &&
      draft.frozen_finding_review_id === finding.frozen_review_revision_id
        ? { defectLinkRef: exact(draft.defect_link_id, 1, draft.link_content_hash) }
        : {}),
    }));
    if (draftChain.at(-1)?.state === "LINKED" && draftChain.at(-1)?.defectLinkRef)
      findingOutcomeRefs.push(draftChain.at(-1)!.defectLinkRef!);
    findings.push({
      id: String(finding.finding_id),
      disposition: String(finding.disposition_decision),
      frozen,
      ...(reviewRef ? { reviewRef } : {}),
      draftChain,
    });
  }
  const requiredSessionPlan = {
    ...exact(plan.plan_version_id, plan.version, plan.content_hash),
    requiredSlots: requirements.map((value) => ({
      key: String(value.requirement_key),
      minimumSessionCount: Number(value.minimum_session_count),
      resolution: "REQUIRED" as const,
      carriedForwardSessionReviewRefs: [],
    })),
  };
  const [request] = (await manager.query(
    "SELECT content FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND input_revision_id=$4",
    [...args, extension.current_input_revision_id],
  )) as { content: { requestRisk?: string } }[];
  if (
    !request ||
    (request.content.requestRisk !== undefined &&
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(request.content.requestRisk))
  )
    throw new Error("QA_DOD_REQUEST_RISK_INVALID");
  const waivers = (await manager.query(
    "SELECT waiver_id FROM qa_waivers WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND state IN ('APPROVED','CONSUMED')",
    args,
  )) as { waiver_id: string }[];
  const requestRisk = request.content.requestRisk;
  const elevated =
    findings.some((finding) => ["ACCEPTED_RISK", "WAIVED"].includes(finding.disposition)) ||
    waivers.length > 0;
  const minimumEffectiveRisk =
    policy.minimumEffectiveRisk === "CRITICAL" || requestRisk === "CRITICAL"
      ? ("CRITICAL" as const)
      : policy.minimumEffectiveRisk === "HIGH" || requestRisk === "HIGH" || elevated
        ? ("HIGH" as const)
        : ("ORDINARY" as const);
  return {
    requiredSessionPlan,
    sessionReviews,
    findings,
    waivers: [] as QaExactReference[],
    evidencePolicySatisfied,
    findingOutcomeRefs,
    minimumEffectiveRisk,
  };
}

export async function loadQaDodInventory(
  manager: EntityManager,
  scope: QaScope,
  workItemId: string,
  extension: Row,
  policy: QaDodPolicy,
  verdictRef: QaExactReference,
  classificationCeiling: string,
): Promise<Inventory> {
  const args = [scope.workspaceId, scope.projectId, workItemId];
  const {
    requiredSessionPlan,
    sessionReviews,
    findings,
    waivers,
    evidencePolicySatisfied,
    findingOutcomeRefs,
    minimumEffectiveRisk,
  } = await loadQaAdjudicationInventory(
    manager,
    scope,
    workItemId,
    extension,
    policy,
    classificationCeiling,
  );
  const [verdict] = (await manager.query(
    "SELECT * FROM qa_verdicts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4 AND version=$5 AND content_hash=$6 FOR SHARE",
    [...args, verdictRef.id, verdictRef.version, verdictRef.contentHash],
  )) as Row[];
  if (!verdict) throw new Error("QA_DOD_VERDICT_NOT_FOUND");
  const [predecessor] = verdict.supersedes_verdict_id
    ? ((await manager.query(
        "SELECT verdict_id,version,content_hash FROM qa_verdicts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4",
        [...args, verdict.supersedes_verdict_id],
      )) as Row[])
    : [];
  const aggregate = createQaVerdict({
    verdictId: String(verdict.verdict_id),
    version: Number(verdict.version),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    workItemId,
    verdict: verdict.verdict,
    residualRisk: verdict.residual_risk,
    effectiveRisk: verdict.effective_risk,
    requiredSessionPlanRef: verdict.required_session_plan_ref,
    sessionReviewRefs: verdict.session_review_refs,
    evidenceManifestRefs: verdict.evidence_manifest_refs,
    findingOutcomeRefs: verdict.finding_outcome_refs,
    dodRuleSetRef: verdict.dod_rule_set_ref,
    riskPolicyRef: verdict.risk_policy_ref,
    aggregateSnapshotHash: verdict.aggregate_snapshot_hash,
    createdBy: verdict.created_by,
    createdAt: date(verdict.created_at),
    ...(predecessor
      ? {
          supersedesVerdictRef: exact(
            predecessor.verdict_id,
            predecessor.version,
            predecessor.content_hash,
          ),
          revisionReason: verdict.revision_reason,
        }
      : {}),
  } as QaVerdictInput);
  if (aggregate.contentHash !== verdict.content_hash)
    throw new Error("QA_DOD_VERDICT_HASH_MISMATCH");
  const signatures = (await manager.query(
    "SELECT * FROM qa_verdict_signatures WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND verdict_id=$4 ORDER BY CASE role WHEN 'PRIMARY' THEN 0 ELSE 1 END",
    [...args, verdictRef.id],
  )) as Row[];
  let signaturesValid = true;
  for (const signature of signatures) {
    const signer = signature.signer as QaVerdictSignature["signer"];
    if (signer.kind !== "HUMAN" || !signer.principalId || !signature.authorization_basis_hash) {
      signaturesValid = false;
      break;
    }
    try {
      aggregate.addSignature({
        signatureId: String(signature.signature_id),
        role: signature.role,
        verdictContentHash: signature.verdict_content_hash,
        signer,
        authorizationBasisHash: signature.authorization_basis_hash,
        signedAt: date(signature.signed_at),
        ...(signature.action_ref ? { actionRef: signature.action_ref } : {}),
      } as QaVerdictSignature);
    } catch {
      signaturesValid = false;
      break;
    }
  }

  const matchesAggregate =
    verdict.aggregate_snapshot_hash === extension.adjudicative_aggregate_hash &&
    same(
      verdict.required_session_plan_ref,
      exact(requiredSessionPlan.id, requiredSessionPlan.version, requiredSessionPlan.contentHash),
    ) &&
    same(
      refs(verdict.session_review_refs as QaExactReference[]),
      refs(sessionReviews.filter((value) => value.current)),
    ) &&
    same(
      refs(verdict.evidence_manifest_refs as QaExactReference[]),
      refs(
        sessionReviews.flatMap((value) =>
          value.evidenceManifestRef ? [value.evidenceManifestRef] : [],
        ),
      ),
    ) &&
    same(refs(verdict.finding_outcome_refs as QaExactReference[]), refs(findingOutcomeRefs)) &&
    same(verdict.dod_rule_set_ref, policy.rules) &&
    same(verdict.risk_policy_ref, policy.riskPolicyRef);
  const residualRisk = verdict.residual_risk as QaVerdictInput["residualRisk"];
  const riskRank: Record<string, number> = { ORDINARY: 0, LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 2 };
  const riskUnderrated =
    riskRank[String(verdict.effective_risk)]! <
    Math.max(riskRank[residualRisk.classification]!, riskRank[minimumEffectiveRisk]!);
  return {
    requiredSessionPlan,
    sessionReviews,
    findings,
    waivers,
    evidencePolicySatisfied,
    verdict: {
      ...verdictRef,
      state:
        signaturesValid &&
        !riskUnderrated &&
        verdict.state === "SIGNED" &&
        aggregate.state === "SIGNED"
          ? "SIGNED"
          : "UNSIGNED",
      matchesAggregate,
      residualRiskPresent: !!residualRisk.statement?.trim(),
    },
  };
}

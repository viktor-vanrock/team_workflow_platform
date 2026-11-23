import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { digest } from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  type QaRequestExtension,
  type QaRequestInputRevision,
  QaTypeOrmIntakeConfirmationWriter,
} from "../../packages/competency-qa/src/node.ts";
import type { ExactRevisionRef } from "../../packages/platform-core/src/index.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";

const hashed = <T extends { contentHash: string }>(value: T): T => {
  const { contentHash, ...body } = value;
  void contentHash;
  return { ...value, contentHash: digest(body) };
};
const us3Digest = (value: string) => digest({ value });
const us3Actor = {
  kind: "HUMAN" as const,
  principalId: localPersonaIds["executor.alpha"],
  issuer: "https://fake-idp:4443/oidc",
  subject: "executor.alpha",
};

/** Controlled confirmed request/readiness/plan from the prior QA workflow; no Session is seeded. */
export async function prepareManualRequest(
  source: DataSource,
  scope: { workspaceId: string; projectId: string },
  pins: {
    bindingRef: ExactRevisionRef;
    environmentRef: ExactRevisionRef;
    dataRef: ExactRevisionRef;
    contextRef: ExactRevisionRef;
    policy: ExactRevisionRef;
  },
) {
  const { workspaceId, projectId } = scope,
    { bindingRef, environmentRef, dataRef, contextRef, policy } = pins,
    workItemId = randomUUID();
  await source.query(
    "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) SELECT $1,$2,$3,work_type_definition_id,$4,'READY','INTERNAL',now() FROM work_items WHERE id=$5",
    [workItemId, workspaceId, projectId, us3Actor.principalId, localSeedIds.workItem],
  );
  const inputId = "c2100000-0000-4000-8000-000000000001";
  const extensionId = "c3100000-0000-4000-8000-000000000001";
  const assessmentId = "c4100000-0000-4000-8000-000000000001";
  const planId = "c5100000-0000-4000-8000-000000000001";
  const planVersionId = "c6100000-0000-4000-8000-000000000001";
  const requirementId = "c7100000-0000-4000-8000-000000000001";
  const at = new Date().toISOString();
  const input: QaRequestInputRevision = hashed({
    schemaVersion: 1,
    inputRevisionId: inputId,
    version: 1,
    previousRevisionRef: null,
    workspaceId,
    projectId,
    workItemId,
    definitionRef: { key: "qa.validation", version: "1.0.0" },
    acceptedDraftRef: {
      kind: "intake-draft",
      id: "draft",
      version: "1",
      contentHash: us3Digest("draft"),
    },
    externalRequestRef: {
      kind: "request",
      id: "REQ-us3",
      version: "2",
      contentHash: us3Digest("external"),
    },
    operationalBindingRef: bindingRef,
    originalRequesterRef: us3Actor,
    title: "Controlled accepted QA request",
    requestKind: "feature-validation",
    goal: "Validate clean PASS",
    scope: "Manual scope",
    acceptanceOutcome: "Expected outcome observed",
    blockersDeclared: true,
    blockers: [],
    dependenciesDeclared: true,
    dependencies: [],
    requestedTarget: {
      environmentId: environmentRef.id,
      environmentRevision: environmentRef.version,
      buildRef: { kind: "build", id: "build", version: "1", contentHash: us3Digest("build") },
      testDataRef: {
        kind: "test-data",
        id: dataRef.id,
        version: String(dataRef.version),
        contentHash: dataRef.contentHash,
      },
    },
    dataClassificationKey: "INTERNAL",
    responseChannelResolution: {
      state: "MISSING",
      requesterPrincipal: us3Actor,
      resolutionPolicyRef: { key: "response", version: "1", contentHash: us3Digest("response") },
      evaluatedAt: at,
      missingReasonCode: "NOT_NEEDED_FOR_US3",
    },
    readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 1 },
    invalidatedState: { readinessAssessmentRefs: [], waiverRefs: [], pendingReadyCommandRefs: [] },
    changeReasonCode: "INITIAL_CONFIRMED_DRAFT",
    contentHash: us3Digest("input"),
    recordedBy: us3Actor,
    authorizationBasisHash: us3Digest("auth"),
    recordedAt: at,
    correlationId: "c8100000-0000-4000-8000-000000000001",
  });
  const extension: QaRequestExtension = hashed({
    schemaVersion: 1,
    extensionId,
    workspaceId,
    projectId,
    workItemId,
    definitionRef: input.definitionRef,
    currentRequestInputRevisionRef: { id: inputId, version: 1, contentHash: input.contentHash },
    projectContextRef: contextRef,
    dorRuleSetRef: {
      key: policy.id,
      version: String(policy.version),
      contentHash: policy.contentHash,
    },
    dodRuleSetRef: {
      key: policy.id,
      version: String(policy.version),
      contentHash: policy.contentHash,
    },
    evidencePolicyRef: {
      key: policy.id,
      version: String(policy.version),
      contentHash: policy.contentHash,
    },
    riskReviewPolicyRef: policy,
    adjudicativeAggregateHash: us3Digest("aggregate"),
    completionDispatchGuard: { state: "OPEN" },
    resourceVersion: 1,
    contentHash: us3Digest("extension"),
    createdBy: us3Actor,
    createdAt: at,
    updatedAt: at,
    correlationId: input.correlationId,
  });
  await source.transaction(
    async (manager) =>
      await new QaTypeOrmIntakeConfirmationWriter().persist(
        {
          transactionId: "manual-onboarding-prerequisite",
          native: manager,
          contributionKey: "qa.request-create.confirmation",
          idempotencyKey: "manual-onboarding-prerequisite",
        },
        { extension, initialInput: input },
      ),
  );
  const requirement = hashed({
    id: requirementId,
    ordinal: 1,
    requirementKey: "primary",
    mode: "MANUAL" as const,
    purpose: "feature-validation",
    minimumSessionCount: 1,
    requiredCapabilities: ["manual"],
    targetPolicyRef: {
      kind: "target-policy",
      id: policy.id,
      version: String(policy.version),
      contentHash: policy.contentHash,
    },
    scopePolicyRef: {
      kind: "scope-policy",
      id: policy.id,
      version: String(policy.version),
      contentHash: policy.contentHash,
    },
    checklistPolicyRefs: [
      {
        kind: "checklist",
        id: policy.id,
        version: String(policy.version),
        contentHash: policy.contentHash,
      },
    ],
    resolution: "REQUIRED" as const,
    contentHash: us3Digest("requirement"),
    carriedForwardFromRequirementRef: null,
  });
  const plan = hashed({
    id: planVersionId,
    version: 1,
    previousRevisionRef: null,
    workspaceId,
    projectId,
    workItemId,
    readinessProofRef: { id: assessmentId, version: 1, contentHash: digest({ state: "READY" }) },
    requirements: [requirement],
    reason: "Initial plan",
    publishedBy: us3Actor,
    publishedAt: at,
    contentHash: us3Digest("plan"),
  });
  await source.transaction(async (manager) => {
    await manager.query(
      "INSERT INTO qa_readiness_assessments(assessment_id,workspace_id,project_id,work_item_id,input_revision_id,input_revision_version,input_content_hash,extension_resource_version,assessment_version,state,input_fingerprint,content_hash,content,evaluated_at) VALUES($1,$2,$3,$4,$5,1,$6,1,1,'READY',$7,$8,$9,$10)",
      [
        assessmentId,
        workspaceId,
        projectId,
        workItemId,
        inputId,
        input.contentHash,
        us3Digest("fingerprint"),
        digest({ state: "READY" }),
        JSON.stringify({ state: "READY" }),
        at,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)",
      [planId, workspaceId, projectId, workItemId, extensionId, at],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,readiness_assessment_id,content_hash,content,published_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)",
      [
        planVersionId,
        workspaceId,
        projectId,
        workItemId,
        planId,
        assessmentId,
        plan.contentHash,
        JSON.stringify(plan),
        at,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content) VALUES($1,$2,$3,$4,$5,'primary',1,'MANUAL',1,'REQUIRED',$6,$7)",
      [
        requirementId,
        workspaceId,
        projectId,
        workItemId,
        planVersionId,
        requirement.contentHash,
        JSON.stringify(requirement),
      ],
    );
    await manager.query(
      "UPDATE qa_required_session_plans SET current_version_id=$1,current_version=1,current_content_hash=$2,resource_version=2 WHERE plan_id=$3",
      [planVersionId, plan.contentHash, planId],
    );
    await manager.query(
      "UPDATE work_items SET state='READY' WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, workItemId],
    );
  });

  return {
    workItemId,
    requirementRef: {
      planRef: { id: planVersionId, revision: 1, contentHash: plan.contentHash },
      requirementKey: "primary",
      ordinal: 1,
      contentHash: requirement.contentHash,
    },
  };
}

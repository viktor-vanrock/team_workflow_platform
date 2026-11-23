import { describe, expect, it } from "vitest";

import { createCompletionCandidate } from "../../packages/competency-qa/src/application/create-completion-candidate.ts";
import { createQaVerdict } from "../../packages/competency-qa/src/application/create-verdict.ts";
import { evaluateQaDod } from "../../packages/competency-qa/src/application/dod-evaluator.ts";
import { QaCompletionCandidateStore } from "../../packages/competency-qa/src/application/invalidate-completion-candidate.ts";
import { confirmQaCompletion } from "../../packages/competency-qa/src/application/on-completion-confirmed.ts";
import { QaWorkItemDetailSectionRegistry } from "../../packages/competency-qa/src/application/qa-work-item-detail.ts";
import {
  cosignQaVerdict,
  signQaVerdict,
} from "../../packages/competency-qa/src/application/sign-verdict.ts";
import { createQaVerdictCompletionDetailSection } from "../../packages/competency-qa/src/application/verdict-completion-detail-section.ts";
import {
  qaAggregateSnapshotHash,
  type QaExactReference,
} from "../../packages/competency-qa/src/domain/primitives.ts";
import { createOperationalWorkItemMockConnector } from "../../packages/connector-mock/src/operational-work-item.connector.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workItemId = "33333333-3333-4333-8333-333333333333";
const at = "2026-08-31T12:00:00.000Z";
const ref = (id: string): QaExactReference =>
  Object.freeze({
    id,
    version: 1,
    contentHash: qaAggregateSnapshotHash({ id, version: 1 } as never),
  });
const executor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "platform",
  subject: "executor",
});
const lead = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "lead",
  issuer: "platform",
  subject: "lead",
});

describe("accepted request → reviewed FAIL → linked defect → Verdict → one confirmed DONE", () => {
  it("keeps FAIL as QA outcome while DONE closes only the operational request", async () => {
    const planRef = ref("required-plan-v1");
    const reviewRef = ref("review-v1");
    const evidenceRef = ref("manifest-v1");
    const findingReviewRef = ref("finding-review-v1");
    const defectLinkRef = ref("defect-link-v1");
    const aggregateHash = qaAggregateSnapshotHash({
      acceptedRequest: workItemId,
      reviewedSessions: [reviewRef],
      findingOutcomes: [defectLinkRef],
    } as never);
    const verdict = createQaVerdict({
      verdictId: "verdict-v1",
      version: 1,
      workspaceId,
      projectId,
      workItemId,
      verdict: "FAIL",
      residualRisk: {
        statement: "Linked product defect remains open; this is not a release decision",
        classification: "HIGH",
      },
      effectiveRisk: "HIGH",
      requiredSessionPlanRef: planRef,
      sessionReviewRefs: [reviewRef],
      evidenceManifestRefs: [evidenceRef],
      findingOutcomeRefs: [defectLinkRef],
      dodRuleSetRef: ref("dod-rules-v1"),
      riskPolicyRef: ref("risk-policy-v1"),
      aggregateSnapshotHash: aggregateHash,
      createdBy: executor,
      createdAt: at,
    });
    signQaVerdict(verdict, {
      actor: executor,
      role: "QA_EXECUTOR",
      permission: "qa.verdict.sign",
      liveAuthorized: true,
      authorizationBasisHash: qaAggregateSnapshotHash({ role: "executor" } as never),
      at,
    });
    cosignQaVerdict(verdict, {
      actor: lead,
      role: "QA_LEAD",
      permission: "qa.verdict.cosign",
      liveAuthorized: true,
      authorizationBasisHash: qaAggregateSnapshotHash({ role: "lead" } as never),
      actionRef: ref("cosign-action"),
      expiresAt: "2026-09-01T00:00:00.000Z",
      now: at,
    });
    const dod = evaluateQaDod({
      assessmentId: "dod-ready",
      workspaceId,
      projectId,
      workItemId,
      expectedAggregateSnapshotHash: aggregateHash,
      currentAggregateSnapshotHash: aggregateHash,
      requiredSessionPlan: {
        ...planRef,
        requiredSlots: [
          {
            key: "manual-primary",
            minimumSessionCount: 1,
            resolution: "REQUIRED",
            carriedForwardSessionReviewRefs: [],
          },
        ],
      },
      sessionReviews: [
        {
          ...reviewRef,
          requirementKey: "manual-primary",
          evidenceComplete: true,
          current: true,
          evidenceManifestRef: evidenceRef,
        },
      ],
      verdict: {
        ...verdict.ref,
        state: verdict.state,
        matchesAggregate: verdict.matchesAggregate(aggregateHash),
        residualRiskPresent: true,
      },
      findings: [
        {
          id: "finding-1",
          disposition: "CREATE_DEFECT",
          frozen: true,
          reviewRef: findingReviewRef,
          draftChain: [{ state: "FAILED" }, { state: "LINKED", defectLinkRef }],
        },
      ],
      waivers: [],
      evidencePolicySatisfied: true,
      rules: ref("dod-rules-v1"),
      riskPolicyRef: ref("risk-policy-v1"),
      evaluatedBy: executor.principalId,
      evaluatedAt: at,
    });
    expect(dod).toMatchObject({ state: "READY_TO_CLOSE", blockerCodes: [] });

    const candidate = createCompletionCandidate({
      candidateId: "completion-v1",
      candidateNumber: 1,
      workspaceId,
      projectId,
      workItemId,
      readyToCloseDodRef: {
        id: dod.assessmentId,
        version: dod.version,
        contentHash: dod.contentHash,
      },
      verdictRef: verdict.ref,
      verdict: verdict.verdict,
      residualRisk: verdict.residualRisk.statement,
      evidenceManifestRefs: [evidenceRef],
      defectLinkOrDispositionRefs: [{ ...defectLinkRef, kind: "DEFECT_LINK" }],
      requiredSessionPlanRef: planRef,
      aggregateSnapshotHash: aggregateHash,
      expectedExternalState: "READY",
      expectedExternalVersion: "2",
      bindingRef: { id: "binding", version: 4 },
      profileRefs: [{ id: "profile", version: 4 }],
      initiatedBy: executor,
      createdAt: at,
    });
    candidate.awaitApproval({
      approvalId: "close-approval",
      subjectHash: candidate.contentHash,
      at,
    });
    candidate.authorize({
      approverId: lead.principalId,
      authorizationBasisHash: qaAggregateSnapshotHash({ lead: true } as never),
      at,
    });
    const effectKey = "effect:completion:one";
    candidate.dispatch({
      commandId: "completion-command",
      effectKeyHash: qaAggregateSnapshotHash(effectKey as never),
      at,
    });
    const store = new QaCompletionCandidateStore();
    store.add(candidate);
    store.installInFlight(candidate);
    let effects = 0;
    const connector = createOperationalWorkItemMockConnector({
      createRequest: async () => {
        throw new Error("unused");
      },
      readRequestEffect: async () => undefined,
      createDefect: async () => {
        throw new Error("unused");
      },
      readDefectEffect: async () => undefined,
      transitionRequest: async (request) => {
        effects += 1;
        return {
          operation: "request.transition",
          entityKind: "REQUEST",
          externalEntityId: request.target.externalEntityId,
          externalDisplayKey: request.target.externalEntityId,
          externalVersion: "3",
          rawExternalState: "MOCK_DONE",
          normalizedStatus: "DONE",
          naturalKey: "qa-manual-flow",
          effectId: request.effectIdempotencyKey,
          observedAt: at,
          completionSummaryReceipt: {
            id: `comment:${request.effectIdempotencyKey}`,
            contentHash: request.payload.completionSummary!.contentHash,
          },
          scope: request.scope,
          profileRef: request.profileRef,
        };
      },
      readRequestTransitionEffect: async () => undefined,
    });
    const result = await connector.operations.requestTransition.handler.invoke(
      {
        scope: { kind: "PROJECT", workspaceId, projectId },
        actor: { kind: "SERVICE", principalId: "worker", serviceKey: "worker" },
        correlationId: "correlation",
        causationId: "causation",
        effectIdempotencyKey: effectKey,
        profileRef: { id: "profile", version: 4 },
        classification: { key: "INTERNAL", rank: 10 },
        signal: new AbortController().signal,
      },
      {
        workspaceId,
        projectId,
        entityKind: "REQUEST",
        authorityScopeKey: "qa.alpha",
        externalEntityId: "REQ-qa-manual-flow",
      },
      {
        requestedNormalizedStatus: "DONE",
        expectedExternalVersion: candidate.expectedExternalVersion,
        completionSummary: candidate.summary,
      },
    );
    confirmQaCompletion(store, {
      candidateId: candidate.candidateId,
      commandId: candidate.commandRef!.id,
      summaryContentHash: candidate.summary.contentHash,
      summaryReceipt: result.completionSummaryReceipt!,
      normalizedStatus: "DONE",
      rawExternalState: result.rawExternalState,
      externalVersion: result.externalVersion,
      confirmedAt: result.observedAt,
    });
    expect(effects).toBe(1);
    expect(candidate).toMatchObject({ state: "CONFIRMED", terminalReason: undefined });
    expect(candidate.summary.verdict).toBe("FAIL");
    expect(store.latestDodAssessment(workItemId)?.state).toBe("SATISFIED");
    expect(store.finalConfirmations()).toHaveLength(1);
  });

  it("reloads all ordered story detail sections including final close history", async () => {
    const loaded: string[] = [];
    const detail = await new QaWorkItemDetailSectionRegistry([
      {
        key: "qa.intake",
        order: 100,
        load: async () => {
          loaded.push("intake");
          return {
            requestExtension: { workItemId },
            requestInputHistory: { revisions: [{ version: 1 }] },
          };
        },
      },
      {
        key: "qa.execution",
        order: 400,
        load: async () => {
          loaded.push("execution");
          return {
            sessions: [{ state: "COMPLETED" }],
            evidenceManifestHistories: [{ manifestId: "manifest-v1" }],
          };
        },
      },
      {
        key: "qa.findings",
        order: 500,
        load: async () => {
          loaded.push("findings");
          return { findings: [{ state: "FROZEN" }], defectLinks: [{ normalizedStatus: "NEW" }] };
        },
      },
      createQaVerdictCompletionDetailSection({
        verdicts: async () => {
          loaded.push("completion");
          return [{ state: "SIGNED", verdict: "FAIL" }];
        },
        verdictSignatures: async () => [{ role: "PRIMARY" }, { role: "LEAD_COSIGN" }],
        dodAssessments: async () => [{ state: "SATISFIED" }],
        completionCandidates: async () => [{ state: "CONFIRMED" }],
        finalCloseConfirmations: async () => [{ normalizedStatus: "DONE" }],
        postCloseCorrectionMarkers: async () => [],
      }),
    ]).detail({ workspaceId, projectId, workItemId });
    expect(loaded).toEqual(["intake", "execution", "findings", "completion"]);
    expect(detail).toMatchObject({
      sessions: [{ state: "COMPLETED" }],
      defectLinks: [{ normalizedStatus: "NEW" }],
      verdicts: [{ state: "SIGNED", verdict: "FAIL" }],
      dodAssessments: [{ state: "SATISFIED" }],
      finalCloseConfirmations: [{ normalizedStatus: "DONE" }],
    });
  });
});

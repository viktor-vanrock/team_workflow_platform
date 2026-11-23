import { describe, expect, it, vi } from "vitest";

import { createCompletionCandidate } from "../../packages/competency-qa/src/application/create-completion-candidate.ts";
import {
  createQaCompletionInvalidator,
  QaCompletionCandidateStore,
} from "../../packages/competency-qa/src/application/invalidate-completion-candidate.ts";
import { confirmQaCompletion } from "../../packages/competency-qa/src/application/on-completion-confirmed.ts";
import { QaAdjudicativeMutationGuard } from "../../packages/competency-qa/src/application/qa-adjudicative-mutation-guard.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const context = Object.freeze({
  actor: {
    kind: "HUMAN" as const,
    principalId: "executor.alpha",
    issuer: "fake-idp",
    subject: "executor.alpha",
  },
  scope: {
    kind: "PROJECT" as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
  },
  correlationId: "correlation-1",
  causationId: "causation-1",
});
const candidate = () =>
  createCompletionCandidate({
    candidateId: "candidate-1",
    candidateNumber: 1,
    workspaceId: context.scope.workspaceId,
    projectId: context.scope.projectId,
    workItemId: "33333333-3333-4333-8333-333333333333",
    readyToCloseDodRef: { id: "dod-1", version: 1, contentHash: hash("a") },
    verdictRef: { id: "verdict-1", version: 1, contentHash: hash("b") },
    verdict: "FAIL",
    residualRisk: "Known open defect",
    evidenceManifestRefs: [{ id: "manifest-1", version: 1, contentHash: hash("c") }],
    defectLinkOrDispositionRefs: [
      { kind: "DEFECT_LINK", id: "link-1", version: 1, contentHash: hash("d") },
    ],
    requiredSessionPlanRef: { id: "plan-1", version: 1, contentHash: hash("e") },
    aggregateSnapshotHash: hash("1"),
    expectedExternalState: "READY",
    expectedExternalVersion: "3",
    bindingRef: { id: "binding-1", version: 4 },
    profileRefs: [{ id: "profile-1", version: 4 }],
    initiatedBy: context.actor,
    createdAt: "2026-08-31T12:00:00.000Z",
  });

describe("completion approval, race and recovery", () => {
  it("invalidates every predispatch state before an aggregate mutation and emits zero effect", async () => {
    for (const state of ["CANDIDATE", "AWAITING_APPROVAL", "AUTHORIZED"] as const) {
      const current = candidate();
      if (state !== "CANDIDATE")
        current.awaitApproval({
          approvalId: "approval-1",
          subjectHash: hash("4"),
          at: "2026-08-31T12:01:00.000Z",
        });
      if (state === "AUTHORIZED")
        current.authorize({
          approverId: "lead.alpha",
          authorizationBasisHash: hash("5"),
          at: "2026-08-31T12:02:00.000Z",
        });
      const store = new QaCompletionCandidateStore();
      store.add(current);
      const invoke = vi.fn();
      const guard = new QaAdjudicativeMutationGuard(
        {
          current: async () => ({
            normalizedStatus: "IN_PROGRESS",
            aggregateSnapshotHash: hash("1"),
            completionCandidate: {
              id: current.candidateId,
              version: current.version,
              contentHash: current.contentHash,
              state: current.state,
            },
          }),
        },
        createQaCompletionInvalidator(store),
      );
      await guard.authorize(context, current.workItemId, {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      });
      expect(current.state).toBe("INVALIDATED");
      expect(current.terminalFromState).toBe(state);
      expect(invoke).not.toHaveBeenCalled();
      expect(store.latestDodAssessment(current.workItemId)).toMatchObject({
        state: "BLOCKED",
        blockerCodes: ["AGGREGATE_CHANGED"],
      });
    }
  });

  it("dispatch-first blocks aggregate mutation, FAILED preserves provenance and releases the pointer", async () => {
    const current = candidate();
    const store = new QaCompletionCandidateStore();
    store.add(current);
    current.awaitApproval({
      approvalId: "approval-1",
      subjectHash: hash("4"),
      at: "2026-08-31T12:01:00.000Z",
    });
    current.authorize({
      approverId: "lead.alpha",
      authorizationBasisHash: hash("5"),
      at: "2026-08-31T12:02:00.000Z",
    });
    current.dispatch({
      commandId: "command-1",
      effectKeyHash: hash("6"),
      at: "2026-08-31T12:03:00.000Z",
    });
    store.installInFlight(current);
    const guard = new QaAdjudicativeMutationGuard(
      {
        current: async () => ({
          normalizedStatus: "IN_PROGRESS",
          aggregateSnapshotHash: hash("1"),
          completionCandidate: {
            id: current.candidateId,
            version: current.version,
            contentHash: current.contentHash,
            state: current.state,
          },
        }),
      },
      createQaCompletionInvalidator(store),
    );
    await expect(
      guard.authorize(context, current.workItemId, {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      }),
    ).rejects.toThrow("QA_COMPLETION_IN_FLIGHT");
    current.fail({
      code: "TIMEOUT",
      reason: "Ambiguous terminal effect",
      at: "2026-08-31T12:04:00.000Z",
    });
    store.releaseInFlight(current);
    expect(current).toMatchObject({
      state: "FAILED",
      terminalFromState: "DISPATCHED",
      commandRef: { id: "command-1" },
      effectKeyHash: hash("6"),
    });
    expect(store.inFlight(current.workItemId)).toBeUndefined();
  });

  it("confirms crash recovery exactly once and forbids terminal reason on CONFIRMED", () => {
    const current = candidate();
    const store = new QaCompletionCandidateStore();
    store.add(current);
    current.awaitApproval({
      approvalId: "approval-1",
      subjectHash: hash("4"),
      at: "2026-08-31T12:01:00.000Z",
    });
    current.authorize({
      approverId: "lead.alpha",
      authorizationBasisHash: hash("5"),
      at: "2026-08-31T12:02:00.000Z",
    });
    current.dispatch({
      commandId: "command-1",
      effectKeyHash: hash("6"),
      at: "2026-08-31T12:03:00.000Z",
    });
    store.installInFlight(current);
    const input = {
      candidateId: current.candidateId,
      commandId: "command-1",
      summaryContentHash: current.summary.contentHash,
      summaryReceipt: { id: "comment-1", contentHash: current.summary.contentHash },
      normalizedStatus: "DONE" as const,
      rawExternalState: "MOCK_DONE",
      externalVersion: "4",
      confirmedAt: "2026-08-31T12:05:00.000Z",
    };
    const first = confirmQaCompletion(store, input);
    const replay = confirmQaCompletion(store, input);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(current).toMatchObject({ state: "CONFIRMED", terminalReason: undefined });
    expect(store.finalConfirmations()).toHaveLength(1);
    expect(store.latestDodAssessment(current.workItemId)?.state).toBe("SATISFIED");
  });
});

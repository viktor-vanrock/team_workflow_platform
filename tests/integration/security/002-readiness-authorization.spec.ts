import { describe, expect, it } from "vitest";

import { buildRevisedQaRequestInput } from "../../../packages/competency-qa/src/application/revise-qa-request-input.ts";
import {
  approveDorWaiver,
  createDorWaiver,
} from "../../../packages/competency-qa/src/domain/waiver.ts";
import { makeCompleteReadinessInput } from "../../support/002-readiness-fixture.ts";

describe("readiness human authorization", () => {
  it("copies the frozen structural tuple and rejects stale/service revisions", () => {
    const current = makeCompleteReadinessInput().currentInput;
    const actor = {
      kind: "HUMAN" as const,
      principalId: "executor",
      issuer: "fake-idp",
      subject: "executor",
    };
    const revised = buildRevisedQaRequestInput({
      current,
      expectedCurrentRef: {
        id: current.inputRevisionId,
        version: current.version,
        contentHash: current.contentHash,
      },
      revisionId: "input-b",
      semanticInput: { ...current, goal: "Updated goal" },
      changeReasonCode: "REQUESTER_CORRECTION",
      reason: "Clarified expected behavior",
      actor,
      authorizationBasisHash: current.authorizationBasisHash,
      recordedAt: "2026-08-30T11:00:00.000Z",
      correlationId: "correlation-b",
      readyDispatchState: "NONE",
      hasSessions: false,
    });
    expect(revised).toMatchObject({
      title: current.title,
      requestKind: current.requestKind,
      dataClassificationKey: current.dataClassificationKey,
      version: 2,
    });
    expect(() =>
      buildRevisedQaRequestInput({
        current,
        expectedCurrentRef: {
          id: current.inputRevisionId,
          version: 9,
          contentHash: current.contentHash,
        },
        revisionId: "input-c",
        semanticInput: {},
        changeReasonCode: "REQUESTER_CORRECTION",
        reason: "stale",
        actor,
        authorizationBasisHash: current.authorizationBasisHash,
        recordedAt: "2026-08-30T11:00:00.000Z",
        correlationId: "correlation-c",
        readyDispatchState: "NONE",
        hasSessions: false,
      }),
    ).toThrow("QA_REQUEST_INPUT_STALE");
  });

  it("allows only the exact distinct-lead registry waiver", () => {
    const candidate = createDorWaiver({
      id: "waiver-a",
      scope: { workspaceId: "w", projectId: "p" },
      workItemId: "wi",
      ruleCode: "PROJECT_REGISTRY_NEEDS_REVIEW",
      assessmentRef: { id: "assessment", version: 1, contentHash: "sha256:a" },
      inputFingerprint: "sha256:b",
      initiatedBy: "executor",
      reason: "Registry reviewed independently",
      expiresAt: "2026-08-31T10:00:00.000Z",
      createdAt: "2026-08-30T10:00:00.000Z",
    });
    expect(() =>
      approveDorWaiver(candidate, {
        actorId: "executor",
        role: "QA_LEAD",
        decidedAt: "2026-08-30T10:01:00.000Z",
        authorizationBasisHash: "sha256:c",
      }),
    ).toThrow("QA_WAIVER_DISTINCT_LEAD_REQUIRED");
    expect(
      approveDorWaiver(candidate, {
        actorId: "lead",
        role: "QA_LEAD",
        decidedAt: "2026-08-30T10:01:00.000Z",
        authorizationBasisHash: "sha256:c",
      }).state,
    ).toBe("APPROVED");
    expect(() =>
      createDorWaiver({ ...candidate, id: "waiver-b", ruleCode: "GOAL_REQUIRED" as never }),
    ).toThrow("QA_DOR_WAIVER_SUBJECT_FORBIDDEN");
  });
});

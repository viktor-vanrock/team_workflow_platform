import { describe, expect, it } from "vitest";

import { evaluateQaDod } from "../../../packages/competency-qa/src/application/dod-evaluator.ts";
import { requestCompletionWaiver } from "../../../packages/competency-qa/src/application/request-completion-waiver.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const base = () => ({
  assessmentId: "dod-1",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  workItemId: "33333333-3333-4333-8333-333333333333",
  expectedAggregateSnapshotHash: hash("1"),
  currentAggregateSnapshotHash: hash("1"),
  requiredSessionPlan: Object.freeze({
    id: "plan-v2",
    version: 2,
    contentHash: hash("a"),
    requiredSlots: Object.freeze([
      {
        key: "smoke",
        minimumSessionCount: 1,
        resolution: "REQUIRED" as const,
        carriedForwardSessionReviewRefs: Object.freeze([
          { id: "review-v1", version: 1, contentHash: hash("b") },
        ]),
      },
    ]),
  }),
  sessionReviews: Object.freeze([
    {
      id: "review-v1",
      version: 1,
      contentHash: hash("b"),
      requirementKey: "smoke",
      evidenceComplete: true,
      current: true,
    },
  ]),
  verdict: Object.freeze({
    id: "verdict-1",
    version: 1,
    contentHash: hash("c"),
    state: "SIGNED" as const,
    matchesAggregate: true,
    residualRiskPresent: true,
  }),
  findings: Object.freeze([
    {
      id: "finding-1",
      disposition: "CREATE_DEFECT" as const,
      frozen: true,
      draftChain: Object.freeze([
        { state: "FAILED" as const },
        { state: "INVALIDATED" as const },
        {
          state: "LINKED" as const,
          defectLinkRef: { id: "link-1", version: 1, contentHash: hash("d") },
        },
      ]),
    },
  ]),
  waivers: Object.freeze([]),
  evidencePolicySatisfied: true,
  rules: Object.freeze({ id: "dod.v1", version: 1, contentHash: hash("e") }),
  riskPolicyRef: Object.freeze({ id: "risk.v1", version: 1, contentHash: hash("f") }),
  evaluatedBy: "executor.alpha",
  evaluatedAt: "2026-08-31T11:00:00.000Z",
});

describe("AT-011 deterministic DoD", () => {
  it("accepts exact carry-forward coverage and a current LINKED defect head", () => {
    const assessment = evaluateQaDod(base());
    expect(assessment.state).toBe("READY_TO_CLOSE");
    expect(assessment.blockerCodes).toEqual([]);
    expect(assessment.inventory.sessionReviewRefs).toEqual([
      { id: "review-v1", version: 1, contentHash: hash("b") },
    ]);
  });

  it("accepts human REJECTED as a final current CREATE_DEFECT chain outcome", () => {
    const input = base();
    const assessment = evaluateQaDod({
      ...input,
      findings: [
        {
          ...input.findings[0]!,
          draftChain: [{ state: "FAILED" }, { state: "REJECTED", rejectedByHuman: true }],
        },
      ],
    });
    expect(assessment.state).toBe("READY_TO_CLOSE");
  });

  it.each([
    [
      "unresolved current draft",
      {
        findings: [
          {
            id: "finding-1",
            disposition: "CREATE_DEFECT",
            frozen: true,
            draftChain: [{ state: "FAILED" }],
          },
        ],
      },
      "DRAFT_PUBLICATION_UNRESOLVED",
    ],
    ["stale verdict", { verdict: { ...base().verdict, matchesAggregate: false } }, "VERDICT_STALE"],
    ["negative evidence gap", { evidencePolicySatisfied: false }, "NEGATIVE_EVIDENCE_INCOMPLETE"],
    ["changed aggregate", { currentAggregateSnapshotHash: hash("9") }, "AGGREGATE_CHANGED"],
  ] as const)("blocks %s without a waiver escape", (_name, override, blocker) => {
    const assessment = evaluateQaDod({ ...base(), ...override } as ReturnType<typeof base>);
    expect(assessment.state).toBe("BLOCKED");
    expect(assessment.blockerCodes).toContain(blocker);
  });

  it("supports only PLAN_ITEM, zero-execution SESSION and non-last REQUIRED_SESSION waivers", () => {
    expect(
      requestCompletionWaiver({
        kind: "PLAN_ITEM",
        attempted: false,
        negative: false,
        reason: "Not applicable",
        remainingRequiredSessions: 1,
      }),
    ).toMatchObject({ kind: "PLAN_ITEM" });
    expect(
      requestCompletionWaiver({
        kind: "SESSION",
        attempted: false,
        negative: false,
        zeroExecutionCancelled: true,
        reason: "Duplicate session",
        remainingRequiredSessions: 1,
      }),
    ).toMatchObject({ kind: "SESSION" });
    expect(
      requestCompletionWaiver({
        kind: "REQUIRED_SESSION",
        attempted: false,
        negative: false,
        reason: "Environment retired",
        remainingRequiredSessions: 2,
      }),
    ).toMatchObject({ kind: "REQUIRED_SESSION" });
    for (const invalid of [
      {
        kind: "DOD",
        attempted: false,
        negative: false,
        reason: "No",
        remainingRequiredSessions: 2,
      },
      {
        kind: "EVIDENCE",
        attempted: false,
        negative: true,
        reason: "No",
        remainingRequiredSessions: 2,
      },
      {
        kind: "SESSION",
        attempted: true,
        negative: false,
        zeroExecutionCancelled: false,
        reason: "No",
        remainingRequiredSessions: 2,
      },
      {
        kind: "REQUIRED_SESSION",
        attempted: false,
        negative: false,
        reason: "No",
        remainingRequiredSessions: 1,
      },
    ])
      expect(() => requestCompletionWaiver(invalid as never)).toThrow();
  });
});

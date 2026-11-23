import { describe, expect, it } from "vitest";

import {
  createQaVerdict,
  supersedeQaVerdict,
} from "../../../../packages/competency-qa/src/application/create-verdict.ts";
import {
  cosignQaVerdict,
  signQaVerdict,
} from "../../../../packages/competency-qa/src/application/sign-verdict.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const executor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "executor.alpha",
  issuer: "fake-idp",
  subject: "executor.alpha",
});
const lead = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "lead.alpha",
  issuer: "fake-idp",
  subject: "lead.alpha",
});

const draft = (risk: "ORDINARY" | "HIGH" | "CRITICAL" = "ORDINARY", version = 1) =>
  createQaVerdict({
    verdictId: `verdict-${version}`,
    version,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    workItemId: "33333333-3333-4333-8333-333333333333",
    verdict: "FAIL",
    residualRisk: Object.freeze({
      statement: "Checkout remains unavailable for some users",
      classification: risk === "ORDINARY" ? "MEDIUM" : risk,
    }),
    effectiveRisk: risk,
    requiredSessionPlanRef: Object.freeze({ id: "plan-v1", version: 1, contentHash: hash("a") }),
    sessionReviewRefs: Object.freeze([{ id: "review-1", version: 1, contentHash: hash("b") }]),
    evidenceManifestRefs: Object.freeze([{ id: "manifest-1", version: 1, contentHash: hash("c") }]),
    findingOutcomeRefs: Object.freeze([{ id: "link-1", version: 1, contentHash: hash("d") }]),
    dodRuleSetRef: Object.freeze({ id: "dod.v1", version: 1, contentHash: hash("e") }),
    riskPolicyRef: Object.freeze({ id: "risk.v1", version: 1, contentHash: hash("f") }),
    aggregateSnapshotHash: hash("1"),
    createdBy: executor,
    createdAt: "2026-08-31T10:00:00.000Z",
  });

describe("AT-010 Verdict risk review", () => {
  it("signs ordinary risk with one live QA Executor signature", () => {
    const verdict = draft();
    signQaVerdict(verdict, {
      actor: executor,
      role: "QA_EXECUTOR",
      permission: "qa.verdict.sign",
      liveAuthorized: true,
      authorizationBasisHash: hash("2"),
      at: "2026-08-31T10:01:00.000Z",
    });
    expect(verdict.state).toBe("SIGNED");
    expect(verdict.signatures.map(({ role }) => role)).toEqual(["PRIMARY"]);
  });

  it.each(["HIGH", "CRITICAL"] as const)("requires a distinct live Lead co-sign for %s", (risk) => {
    const verdict = draft(risk);
    signQaVerdict(verdict, {
      actor: executor,
      role: "QA_EXECUTOR",
      permission: "qa.verdict.sign",
      liveAuthorized: true,
      authorizationBasisHash: hash("2"),
      at: "2026-08-31T10:01:00.000Z",
    });
    expect(verdict.state).toBe("PARTIALLY_SIGNED");
    expect(() =>
      cosignQaVerdict(verdict, {
        actor: executor,
        role: "QA_LEAD",
        permission: "qa.verdict.cosign",
        liveAuthorized: true,
        authorizationBasisHash: hash("3"),
        actionRef: { id: "action-self", version: 1, contentHash: hash("4") },
        expiresAt: "2026-08-31T11:00:00.000Z",
        now: "2026-08-31T10:02:00.000Z",
      }),
    ).toThrow("QA_VERDICT_COSIGN_DISTINCT_ACTOR_REQUIRED");
    cosignQaVerdict(verdict, {
      actor: lead,
      role: "QA_LEAD",
      permission: "qa.verdict.cosign",
      liveAuthorized: true,
      authorizationBasisHash: hash("3"),
      actionRef: { id: "action-1", version: 1, contentHash: hash("4") },
      expiresAt: "2026-08-31T11:00:00.000Z",
      now: "2026-08-31T10:02:00.000Z",
    });
    expect(verdict.state).toBe("SIGNED");
    expect(verdict.signatures.map(({ signer }) => signer.principalId)).toEqual([
      "executor.alpha",
      "lead.alpha",
    ]);
  });

  it("denies revoked, expired and stale co-sign actions", () => {
    for (const input of [
      { liveAuthorized: false, expiresAt: "2026-08-31T11:00:00.000Z", subjectMatches: true },
      { liveAuthorized: true, expiresAt: "2026-08-31T09:00:00.000Z", subjectMatches: true },
      { liveAuthorized: true, expiresAt: "2026-08-31T11:00:00.000Z", subjectMatches: false },
    ]) {
      const verdict = draft("HIGH");
      signQaVerdict(verdict, {
        actor: executor,
        role: "QA_EXECUTOR",
        permission: "qa.verdict.sign",
        liveAuthorized: true,
        authorizationBasisHash: hash("2"),
        at: "2026-08-31T10:01:00.000Z",
      });
      expect(() =>
        cosignQaVerdict(verdict, {
          actor: lead,
          role: "QA_LEAD",
          permission: "qa.verdict.cosign",
          authorizationBasisHash: hash("3"),
          actionRef: { id: "action-1", version: 1, contentHash: hash("4") },
          now: "2026-08-31T10:02:00.000Z",
          ...input,
        }),
      ).toThrow();
    }
  });

  it("retains signed history on aggregate drift and uses the sole explicit SUPERSEDED projection", () => {
    const previous = draft();
    signQaVerdict(previous, {
      actor: executor,
      role: "QA_EXECUTOR",
      permission: "qa.verdict.sign",
      liveAuthorized: true,
      authorizationBasisHash: hash("2"),
      at: "2026-08-31T10:01:00.000Z",
    });
    expect(previous.matchesAggregate(hash("9"))).toBe(false);
    expect(previous.state).toBe("SIGNED");

    const next = supersedeQaVerdict(previous, {
      verdictId: "verdict-2",
      aggregateSnapshotHash: hash("9"),
      residualRisk: Object.freeze({
        statement: "Updated risk after evidence correction",
        classification: "MEDIUM",
      }),
      revisionReason: "Evidence correction changed adjudicative inputs",
      actor: executor,
      at: "2026-08-31T10:10:00.000Z",
    });
    expect(previous.state).toBe("SUPERSEDED");
    expect(previous.supersededByVerdictRef?.id).toBe(next.verdictId);
    expect(previous.signedAt).toBe("2026-08-31T10:01:00.000Z");
    expect(next.supersedesVerdictRef?.id).toBe(previous.verdictId);
    expect(next.version).toBe(2);
  });
});

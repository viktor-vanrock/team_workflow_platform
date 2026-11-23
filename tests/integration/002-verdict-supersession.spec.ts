import { describe, expect, it } from "vitest";

import { QaAdjudicativeMutationGuard } from "../../packages/competency-qa/src/application/qa-adjudicative-mutation-guard.ts";
import {
  QaPostCloseCorrectionStore,
  recordPostCloseCorrection,
} from "../../packages/competency-qa/src/application/record-post-close-correction.ts";

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
  authorizationBasis: {
    kind: "PROJECT" as const,
    policyVersion: "1",
    membershipRef: { id: "membership-1", version: 1 },
    roleAssignmentRefs: [{ id: "role-1", version: 1 }],
    entitlementRefs: [{ id: "entitlement-1", version: 1 }],
    skillContext: "NOT_APPLICABLE" as const,
  },
  correlationId: "correlation-1",
  causationId: "causation-1",
});

describe("post-DONE adjudicative freeze", () => {
  it.each([
    "input",
    "readiness",
    "plan",
    "session",
    "attempt",
    "observation",
    "result",
    "review",
    "evidence",
    "finding",
    "draft",
    "waiver",
    "verdict",
    "dod",
    "completion",
  ])("denies %s aggregate mutation after DONE", async () => {
    const guard = new QaAdjudicativeMutationGuard({
      current: async () => ({ normalizedStatus: "DONE", aggregateSnapshotHash: hash("1") }),
    });
    await expect(
      guard.authorize(context, "work-item-1", {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      }),
    ).rejects.toThrow("QA_WORK_ITEM_DONE");
  });

  it("allows only exact confirmed replay/read through completion self-transition", async () => {
    const projection = {
      normalizedStatus: "DONE" as const,
      aggregateSnapshotHash: hash("1"),
      completionCandidate: {
        id: "candidate-1",
        version: 1,
        contentHash: hash("2"),
        state: "CONFIRMED" as const,
      },
    };
    const guard = new QaAdjudicativeMutationGuard({ current: async () => projection });
    await expect(
      guard.authorize(context, "work-item-1", {
        classification: "COMPLETION_SELF_TRANSITION",
        candidateRef: projection.completionCandidate,
        fromState: "CONFIRMED",
        toState: "CONFIRMED",
        expectedAggregateSnapshotHash: hash("1"),
        idempotentReplay: true,
      }),
    ).resolves.toBeDefined();
    await expect(
      guard.authorize(context, "work-item-1", {
        classification: "COMPLETION_SELF_TRANSITION",
        candidateRef: projection.completionCandidate,
        fromState: "CONFIRMED",
        toState: "FAILED",
        expectedAggregateSnapshotHash: hash("1"),
      }),
    ).rejects.toThrow();
  });

  it("records one same-manifest clerical revision without changing adjudicative lineage", async () => {
    const store = new QaPostCloseCorrectionStore({
      manifestId: "manifest-1",
      latestRevisionRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      latestAdjudicativeRevisionRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      resourceVersion: 1,
      content: { note: "Initial note", artifactRefs: ["artifact-1"] },
    });
    const result = await recordPostCloseCorrection({
      store,
      context,
      workItemId: "work-item-1",
      manifestId: "manifest-1",
      ifMatch: 1,
      expectedPreviousRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      patch: { note: "Corrected display note" },
      annotations: [{ field: "note", reason: "Typo correction" }],
      markerId: "marker-1",
      revisionId: "manifest-r2",
      at: "2026-08-31T13:00:00.000Z",
    });
    expect(result.manifest.latestRevisionRef.id).toBe("manifest-r2");
    expect(result.manifest.latestAdjudicativeRevisionRef.id).toBe("manifest-r1");
    expect(result.marker).toMatchObject({
      basis: "HUMAN",
      authorizationBasisHash: expect.stringMatching(/^sha256:/),
    });
    expect(store.markers()).toHaveLength(1);
  });

  it("denies stale, semantic, cross-manifest and tampered correction attempts", async () => {
    const store = new QaPostCloseCorrectionStore({
      manifestId: "manifest-1",
      latestRevisionRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      latestAdjudicativeRevisionRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      resourceVersion: 1,
      content: { note: "Initial", artifactRefs: ["artifact-1"] },
    });
    const base = {
      store,
      context,
      workItemId: "work-item-1",
      manifestId: "manifest-1",
      ifMatch: 1,
      expectedPreviousRef: { id: "manifest-r1", version: 1, contentHash: hash("3") },
      patch: { note: "Corrected" },
      annotations: [{ field: "note", reason: "Typo" }],
      markerId: "marker-1",
      revisionId: "manifest-r2",
      at: "2026-08-31T13:00:00.000Z",
    } as const;
    await expect(recordPostCloseCorrection({ ...base, ifMatch: 0 })).rejects.toThrow(
      "QA_ETAG_MISMATCH",
    );
    await expect(
      recordPostCloseCorrection({ ...base, manifestId: "manifest-other" }),
    ).rejects.toThrow("QA_MANIFEST_MISMATCH");
    await expect(
      recordPostCloseCorrection({ ...base, patch: { artifactRefs: ["artifact-2"] } as never }),
    ).rejects.toThrow("QA_POST_CLOSE_CHANGE_NOT_CLERICAL");
  });
});

import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationBasisRef,
  WorkspaceContext,
} from "../../packages/platform-core/src/index.ts";

interface QaScope {
  readonly workspaceId: string;
  readonly projectId: string;
}

interface QaExactReference {
  readonly id: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
}

interface QaImmutableRevision extends QaExactReference {
  readonly previous?: QaExactReference;
}

type QaMutationClass =
  | "AGGREGATE_MUTATION"
  | "COMPLETION_SELF_TRANSITION"
  | "POST_CLOSE_CLERICAL_CORRECTION"
  | "READ_ONLY";

type CompletionState =
  | "CANDIDATE"
  | "AWAITING_APPROVAL"
  | "AUTHORIZED"
  | "DISPATCHED"
  | "CONFIRMED"
  | "FAILED"
  | "REJECTED"
  | "INVALIDATED";

interface QaAdjudicativeProjection {
  readonly normalizedStatus: "NEW" | "READY" | "IN_PROGRESS" | "DONE";
  readonly aggregateSnapshotHash: `sha256:${string}`;
  readonly completionCandidate?: QaExactReference & Readonly<{ state: CompletionState }>;
}

interface QaMutationRequest {
  readonly classification: QaMutationClass;
  readonly candidateRef?: QaExactReference;
  readonly fromState?: CompletionState;
  readonly toState?: CompletionState;
  readonly expectedAggregateSnapshotHash?: `sha256:${string}`;
  readonly changesAggregate?: boolean;
  readonly idempotentReplay?: boolean;
  readonly clericalAnnotations?: readonly Readonly<{ field: string; reason: string }>[];
}

interface QaMutationGuardInstance {
  authorize(
    context: WorkspaceContext,
    workItemId: string,
    request: QaMutationRequest,
  ): Promise<Readonly<{ classification: QaMutationClass }>>;
}

interface QaMutationGuardConstructor {
  new (
    projections: Readonly<{
      current(context: WorkspaceContext, workItemId: string): Promise<QaAdjudicativeProjection>;
    }>,
    invalidator: Readonly<{
      invalidatePending(
        context: WorkspaceContext,
        workItemId: string,
        reason: string,
      ): Promise<void>;
    }>,
  ): QaMutationGuardInstance;
}

interface QaFoundationExports {
  readonly assertQaScope?: (expected: QaScope, actual: QaScope) => void;
  readonly assertQaExactReference?: (expected: QaExactReference, actual: QaExactReference) => void;
  readonly assertQaRevisionSuccessor?: (
    previous: QaImmutableRevision,
    next: QaImmutableRevision,
  ) => void;
  readonly assertQaHumanAttestation?: (
    context: WorkspaceContext,
    attestation: Readonly<{
      actorId: string;
      actorKind: string;
      permission: string;
      authorizationBasis: AuthorizationBasisRef;
    }>,
  ) => void;
  readonly QaAdjudicativeMutationGuard?: QaMutationGuardConstructor;
}

const context: WorkspaceContext = Object.freeze({
  actor: { kind: "HUMAN", principalId: "executor", issuer: "fake-idp", subject: "executor" },
  scope: { kind: "PROJECT", workspaceId: "workspace-alpha", projectId: "project-alpha" },
  correlationId: "correlation",
  causationId: "causation",
} as const);

const basis: AuthorizationBasisRef = Object.freeze({
  kind: "PROJECT",
  membershipRef: { id: "membership", version: 1 },
  entitlementRefs: [{ id: "entitlement", version: 1 }],
  roleAssignmentRefs: [{ id: "role", version: 1 }],
  policyVersion: "qa.authorization@1",
  skillContext: "NOT_APPLICABLE",
} as const);

const candidate: QaExactReference = Object.freeze({
  id: "candidate-a",
  version: 3,
  contentHash: "sha256:candidate-a",
} as const);

async function foundation(): Promise<Required<QaFoundationExports>> {
  const qa = (await import("../../packages/competency-qa/src/node.ts")) as QaFoundationExports;
  for (const name of [
    "assertQaScope",
    "assertQaExactReference",
    "assertQaRevisionSuccessor",
    "assertQaHumanAttestation",
    "QaAdjudicativeMutationGuard",
  ] as const)
    expect(qa[name], `${name} must be exported by the QA foundation`).toBeTypeOf("function");
  return qa as Required<QaFoundationExports>;
}

function guardFixture(Guard: QaMutationGuardConstructor, initial: QaAdjudicativeProjection) {
  let projection = initial;
  const current = vi.fn(async () => projection);
  const invalidatePending = vi.fn(async () => undefined);
  return {
    guard: new Guard({ current }, { invalidatePending }),
    current,
    invalidatePending,
    setProjection(next: QaAdjudicativeProjection) {
      projection = next;
    },
  };
}

describe("QA scoped/exact/revision/HUMAN primitives", () => {
  it("rejects cross-scope identifiers before accepting an exact reference", async () => {
    const qa = await foundation();
    const scope = { workspaceId: "workspace-alpha", projectId: "project-alpha" };
    expect(() => qa.assertQaScope(scope, scope)).not.toThrow();
    expect(() => qa.assertQaScope(scope, { ...scope, projectId: "project-beta" })).toThrow(
      "QA_SCOPE_MISMATCH",
    );
    expect(() => qa.assertQaScope(scope, { ...scope, workspaceId: "workspace-delta" })).toThrow(
      "QA_SCOPE_MISMATCH",
    );

    expect(() => qa.assertQaExactReference(candidate, candidate)).not.toThrow();
    expect(() => qa.assertQaExactReference(candidate, { ...candidate, version: 4 })).toThrow(
      "QA_EXACT_REFERENCE_MISMATCH",
    );
    expect(() =>
      qa.assertQaExactReference(candidate, { ...candidate, contentHash: "sha256:drift" }),
    ).toThrow("QA_EXACT_REFERENCE_MISMATCH");
  });

  it("rejects revision gaps, forks and missing predecessor hashes", async () => {
    const qa = await foundation();
    const revision1: QaImmutableRevision = {
      id: "revision-a",
      version: 1,
      contentHash: "sha256:one",
    };
    const revision2: QaImmutableRevision = {
      id: "revision-a",
      version: 2,
      contentHash: "sha256:two",
      previous: revision1,
    };
    expect(() => qa.assertQaRevisionSuccessor(revision1, revision2)).not.toThrow();
    expect(() => qa.assertQaRevisionSuccessor(revision1, { ...revision2, version: 3 })).toThrow(
      "QA_REVISION_GAP",
    );
    expect(() =>
      qa.assertQaRevisionSuccessor(revision1, {
        ...revision2,
        previous: { ...revision1, contentHash: "sha256:fork" },
      }),
    ).toThrow("QA_REVISION_FORK");
  });

  it("accepts only a matching verified HUMAN attestation", async () => {
    const qa = await foundation();
    const attestation = {
      actorId: "executor",
      actorKind: "HUMAN",
      permission: "qa.session.execute",
      authorizationBasis: basis,
    };
    expect(() => qa.assertQaHumanAttestation(context, attestation)).not.toThrow();
    expect(() =>
      qa.assertQaHumanAttestation(context, { ...attestation, actorId: "forged" }),
    ).toThrow("QA_HUMAN_ATTESTATION_MISMATCH");
    expect(() =>
      qa.assertQaHumanAttestation(context, { ...attestation, actorKind: "SERVICE" }),
    ).toThrow("QA_VERIFIED_HUMAN_REQUIRED");
  });
});

describe("QaAdjudicativeMutationGuard closed mutation classes", () => {
  it("invalidates a predispatch candidate for aggregate mutation but denies in-flight and DONE", async () => {
    const qa = await foundation();
    const fixture = guardFixture(qa.QaAdjudicativeMutationGuard, {
      normalizedStatus: "IN_PROGRESS",
      aggregateSnapshotHash: "sha256:aggregate-a",
      completionCandidate: { ...candidate, state: "AWAITING_APPROVAL" },
    });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      }),
    ).resolves.toEqual({ classification: "AGGREGATE_MUTATION" });
    expect(fixture.invalidatePending).toHaveBeenCalledOnce();

    fixture.setProjection({
      normalizedStatus: "IN_PROGRESS",
      aggregateSnapshotHash: "sha256:aggregate-a",
      completionCandidate: { ...candidate, state: "DISPATCHED" },
    });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      }),
    ).rejects.toThrow("QA_COMPLETION_IN_FLIGHT");

    fixture.setProjection({
      normalizedStatus: "DONE",
      aggregateSnapshotHash: "sha256:aggregate-a",
    });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "AGGREGATE_MUTATION",
        changesAggregate: true,
      }),
    ).rejects.toThrow("QA_WORK_ITEM_DONE");
  });

  it("allows only the exact candidate self-transition without aggregate mutation", async () => {
    const qa = await foundation();
    const fixture = guardFixture(qa.QaAdjudicativeMutationGuard, {
      normalizedStatus: "IN_PROGRESS",
      aggregateSnapshotHash: "sha256:aggregate-a",
      completionCandidate: { ...candidate, state: "AUTHORIZED" },
    });
    const exact: QaMutationRequest = {
      classification: "COMPLETION_SELF_TRANSITION",
      candidateRef: candidate,
      fromState: "AUTHORIZED",
      toState: "DISPATCHED",
      expectedAggregateSnapshotHash: "sha256:aggregate-a",
      changesAggregate: false,
    };
    await expect(fixture.guard.authorize(context, "work-item", exact)).resolves.toEqual({
      classification: "COMPLETION_SELF_TRANSITION",
    });
    expect(fixture.invalidatePending).not.toHaveBeenCalled();
    await expect(
      fixture.guard.authorize(context, "work-item", {
        ...exact,
        candidateRef: { ...candidate, id: "candidate-b" },
      }),
    ).rejects.toThrow("QA_COMPLETION_CANDIDATE_MISMATCH");
    await expect(
      fixture.guard.authorize(context, "work-item", {
        ...exact,
        changesAggregate: true,
      }),
    ).rejects.toThrow("QA_SELF_TRANSITION_AGGREGATE_MUTATION");
  });

  it("permits only bounded post-DONE clerical work plus reads/idempotent confirmed replay", async () => {
    const qa = await foundation();
    const fixture = guardFixture(qa.QaAdjudicativeMutationGuard, {
      normalizedStatus: "DONE",
      aggregateSnapshotHash: "sha256:aggregate-done",
      completionCandidate: { ...candidate, state: "CONFIRMED" },
    });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "READ_ONLY",
      }),
    ).resolves.toEqual({ classification: "READ_ONLY" });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "POST_CLOSE_CLERICAL_CORRECTION",
        changesAggregate: false,
        clericalAnnotations: [{ field: "displayNote", reason: "Typo correction" }],
      }),
    ).resolves.toEqual({ classification: "POST_CLOSE_CLERICAL_CORRECTION" });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "POST_CLOSE_CLERICAL_CORRECTION",
        changesAggregate: true,
        clericalAnnotations: [{ field: "verdict", reason: "Semantic rewrite" }],
      }),
    ).rejects.toThrow("QA_POST_CLOSE_CHANGE_NOT_CLERICAL");
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "COMPLETION_SELF_TRANSITION",
        candidateRef: candidate,
        fromState: "CONFIRMED",
        toState: "CONFIRMED",
        expectedAggregateSnapshotHash: "sha256:aggregate-done",
        changesAggregate: false,
        idempotentReplay: true,
      }),
    ).resolves.toEqual({ classification: "COMPLETION_SELF_TRANSITION" });
    await expect(
      fixture.guard.authorize(context, "work-item", {
        classification: "AUTOMATED_BYPASS" as QaMutationClass,
      }),
    ).rejects.toThrow("QA_MUTATION_CLASS_UNSUPPORTED");
  });
});

import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  assertQueueActionConsumedResult,
  computeCapacityAccounting,
  createCapacitySnapshot,
  createQueueActionPair,
  validateCapacitySnapshot,
  validatePublicCapacityAdmission,
} from "../../../packages/platform-core/src/index.ts";
import { MeasureOnlyManualAdmissionService } from "../../../packages/runtime-composition/src/index.ts";
import { policyIds } from "../../helpers/006/policy-fixture.ts";
import { cloneJson, digest } from "../../helpers/006/triage-fixture.ts";
import { fixtureJson, requiredFixture } from "../../support/fixture-value.ts";

const ids = Object.freeze({
  workItem: "00000000-0000-4000-8000-000000000611",
  session: "00000000-0000-4000-8000-000000000612",
  projection: "00000000-0000-4000-8000-000000000613",
  policyFacet: "00000000-0000-4000-8000-000000000614",
  operational: "00000000-0000-4000-8000-000000000615",
  correlation: "00000000-0000-4000-8000-000000000616",
  causation: "00000000-0000-4000-8000-000000000617",
});

async function admissionFixture() {
  let payload: Readonly<Record<string, unknown>> | undefined;
  const service = new MeasureOnlyManualAdmissionService({
    commit: async (value) => {
      payload = value.eventPayload;
      return { outcome: "COMMITTED", claimId: value.decision.claim?.claimId ?? null };
    },
  });
  await service.admit({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: ids.workItem,
    sessionId: ids.session,
    requestKey: "manual-start-capacity-contract",
    activityKind: "MANUAL_SESSION_START",
    stage: "ACTIVE",
    sessionState: "RUNNING",
    actor: { kind: "HUMAN", principalId: policyIds.principal },
    policyFacetRef: { id: ids.policyFacet, version: 1, semanticHash: digest("policy-facet") },
    authorizedScopeSnapshotRef: {
      id: ids.projection,
      version: 1,
      semanticHash: digest("capacity-projection"),
    },
    authorizationScopeWitnessHash: digest("project-safe-witness"),
    expectedQueueControlVersion: 0,
    operationalProjectionRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: ids.operational,
      sourceVersion: 1,
      semanticHash: digest("operational"),
      confirmedAt: "2026-09-03T08:00:00.000Z",
    },
    qaSourceSetHash: digest("qa-set"),
    sessionRef: {
      sourceType: "QA_TEST_SESSION_REVISION",
      sourceId: ids.session,
      sourceVersion: 2,
      semanticHash: digest("session"),
    },
    decidedAt: "2026-09-03T09:00:00.000Z",
    correlationId: ids.correlation,
    causationId: ids.causation,
  });
  return payload!;
}

describe("US4 public capacity contracts", () => {
  it("derives a schema-valid authorized snapshot and hides every global head/basis witness", () => {
    const accounting = computeCapacityAccounting({
      claims: [
        {
          projectId: policyIds.projectA,
          workItemId: ids.workItem,
          state: "ACTIVE",
          causes: ["MANUAL_RUNNING"],
        },
      ],
      reservations: [],
      expedites: [],
      authorizedProjectIds: [policyIds.projectA],
      policyMode: "MEASURE_ONLY",
    });
    const snapshot = createCapacitySnapshot({
      workspaceId: policyIds.workspace,
      scope: { kind: "PROJECT", workspaceId: policyIds.workspace, projectId: policyIds.projectA },
      authorizedProjectIds: [policyIds.projectA],
      policyFacetRef: { id: ids.policyFacet, version: 1, semanticHash: digest("policy-facet") },
      policyMode: "MEASURE_ONLY",
      authorizedProjectionId: ids.projection,
      authorizedProjectionVersion: 1,
      accounting,
      freshness: "CURRENT",
      asOf: "2026-09-03T09:00:00.000Z",
      reconciledAt: "2026-09-03T09:00:00.000Z",
    });
    expect(
      designContractRegistry.validateById("urn:awp:schemas:006:capacity-snapshot:v1", snapshot),
    ).toBe(snapshot);
    expect(snapshot).toMatchObject({
      humanOccupiedCount: 1,
      humanCommittedCount: 1,
      limits: { state: "NOT_CONFIGURED" },
      projectFacets: [{ warningState: "NOT_CONFIGURED" }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /capacityHead|authorizationBasis|membershipRef|entitlementRef/u,
    );
    const leaked = { ...snapshot, capacityHeadVersion: 7 } as never;
    expect(() =>
      designContractRegistry.validateById("urn:awp:schemas:006:capacity-snapshot:v1", leaked),
    ).toThrow();
    const warningMismatch = cloneJson(snapshot) as unknown as {
      projectFacets: Array<{ warningState: string }>;
    };
    requiredFixture(warningMismatch.projectFacets[0]).warningState = "ABOVE_SOFT_LIMIT";
    expect(() => validateCapacitySnapshot(warningMismatch as never)).toThrow(
      "CAPACITY_SNAPSHOT_PROJECT_WARNING_MISMATCH",
    );
  });

  it("enforces admission outcome, blocker, no-global-witness, and activity-to-mutation cardinality rules", async () => {
    const admission = await admissionFixture();
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:006:capacity-admission:v1",
        admission as never,
      ),
    ).toBe(admission);
    expect(() => validatePublicCapacityAdmission(admission)).not.toThrow();
    expect(JSON.stringify(admission)).not.toMatch(
      /capacityHeadVersion|humanCommittedCount|claimSetHash|authorizationBasis/u,
    );
    const leaked = cloneJson(admission) as Record<string, unknown>;
    (leaked.before as Record<string, unknown>).capacityHeadVersion = 4;
    expect(() => validatePublicCapacityAdmission(leaked)).toThrow(
      "CAPACITY_ADMISSION_GLOBAL_WITNESS_FORBIDDEN",
    );
    const wrongRefs = cloneJson(admission) as Record<string, unknown>;
    const wrongEffect = wrongRefs.effect as Record<string, unknown>;
    const mutationRefs = wrongEffect.mutationRefs as readonly unknown[];
    wrongEffect.mutationRefs = mutationRefs.filter(
      (value) =>
        (value as Readonly<Record<string, unknown>>).sourceType === "QA_TEST_SESSION_REVISION",
    );
    expect(() =>
      designContractRegistry.validateById("urn:awp:schemas:006:capacity-admission:v1", wrongRefs),
    ).toThrow();
    const deniedWithoutBlocker = cloneJson(admission) as Record<string, unknown>;
    deniedWithoutBlocker.outcome = "DENIED";
    deniedWithoutBlocker.effect = { state: "NO_MUTATION" };
    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:schemas:006:capacity-admission:v1",
        deniedWithoutBlocker,
      ),
    ).toThrow();
  });

  it("requires an exact public candidate hash for consumed overrides", async () => {
    const admission = cloneJson(await admissionFixture()) as Record<string, unknown>;
    (admission.before as Record<string, unknown>).policyMode = "ENFORCED";
    (admission.after as Record<string, unknown>).policyMode = "ENFORCED";
    admission.outcome = "ADMITTED_WITH_EXACT_OVERRIDE";
    admission.violatedConstraints = ["HARD_WIP"];
    admission.override = {
      state: "CONSUMED",
      actionKind: "WIP_ADMISSION_OVERRIDE",
      effectKind: "ALLOW_WIP_ADMISSION",
      approvalRef: {
        sourceType: "APPROVAL_SUBJECT_V2",
        sourceId: ids.correlation,
        sourceVersion: 2,
        semanticHash: digest("approval"),
      },
      actionCandidateRef: {
        sourceType: "QUEUE_ACTION_CANDIDATE",
        sourceId: ids.causation,
        sourceVersion: 1,
        semanticHash: digest("candidate"),
      },
      publicIntentHash: digest("different"),
    };
    const semantic = { ...admission };
    delete semantic.semanticHash;
    admission.semanticHash = (
      await import("../../../packages/platform-contracts/src/index.ts")
    ).sha256(fixtureJson(semantic));
    expect(() => validatePublicCapacityAdmission(admission)).toThrow(
      "CAPACITY_ADMISSION_OVERRIDE_PUBLIC_HASH_MISMATCH",
    );

    const scope = {
      kind: "PROJECT" as const,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
    };
    const target = {
      kind: "WORK_ITEM" as const,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemRef: {
        sourceType: "WORK_ITEM_REVISION",
        sourceId: ids.workItem,
        sourceVersion: 1,
        semanticHash: digest("work-item"),
      },
    };
    const pair = createQueueActionPair({
      candidate: {
        schemaVersion: "queue-action-candidate@1.0.0",
        actionId: ids.causation,
        actionKind: "WIP_ADMISSION_OVERRIDE",
        scope,
        target,
        requestHash: digest("request"),
        expectedVisibleState: { kind: "CAPACITY_ADMISSION", policyMode: "ENFORCED" },
        requestedEffect: { kind: "ALLOW_WIP_ADMISSION" },
        reason: "Exact override",
        expiresAt: "2026-09-04T09:00:00.000Z",
        approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
      },
      witness: {
        schemaVersion: "queue-control-action@1.0.0",
        actionId: ids.causation,
        actionKind: "WIP_ADMISSION_OVERRIDE",
        scope,
        target,
        expectedState: { kind: "CAPACITY_ADMISSION", policyMode: "ENFORCED" },
        requestedEffect: { kind: "ALLOW_WIP_ADMISSION" },
        reason: "Exact override",
        expiresAt: "2026-09-04T09:00:00.000Z",
        approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
        idempotencyKeyHash: digest("key"),
      },
    });
    expect(() =>
      assertQueueActionConsumedResult(pair, {
        resultRef: {
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: ids.workItem,
          sourceVersion: 1,
          semanticHash: digest("wrong-family"),
        },
      }),
    ).toThrow("CAPACITY_ADMISSION_RESULT_FAMILY_MISMATCH");
    expect(() =>
      assertQueueActionConsumedResult(pair, {
        resultRef: {
          sourceType: "CAPACITY_ADMISSION_DECISION",
          sourceId: ids.workItem,
          sourceVersion: 1,
          semanticHash: digest("admission"),
        },
      }),
    ).not.toThrow();
  });
});

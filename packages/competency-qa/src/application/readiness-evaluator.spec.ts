import { describe, expect, it } from "vitest";

import {
  DOR_RULE_CODES,
  evaluateQaReadiness,
  type QaReadinessEvaluationInput,
} from "./readiness-evaluator.ts";

const digest = (value: string) =>
  `sha256:${value.padEnd(64, value[0] ?? "0").slice(0, 64)}` as const;
const ref = (kind: string, id: string) => ({ kind, id, version: "1", contentHash: digest(id) });
const actor = {
  kind: "HUMAN" as const,
  principalId: "requester",
  issuer: "fake-idp",
  subject: "requester",
};

function valid(): QaReadinessEvaluationInput {
  return {
    scope: { workspaceId: "workspace-a", projectId: "project-a" },
    workItemId: "work-item-a",
    extensionResourceVersion: 2,
    currentInput: {
      schemaVersion: 1,
      inputRevisionId: "input-2",
      version: 2,
      previousRevisionRef: { id: "input-1", version: 1, contentHash: digest("prev") },
      workspaceId: "workspace-a",
      projectId: "project-a",
      workItemId: "work-item-a",
      definitionRef: { key: "qa.validation", version: "1.0.0" },
      acceptedDraftRef: ref("draft", "draft-a"),
      externalRequestRef: ref("request", "REQ-a"),
      operationalBindingRef: { id: "binding-a", version: 2 },
      originalRequesterRef: actor,
      title: "Validate checkout",
      requestKind: "feature-validation",
      goal: "Prove checkout works",
      scope: "Checkout happy path",
      acceptanceOutcome: "Order is created",
      sourceRefs: [ref("commit", "commit-a")],
      blockersDeclared: true,
      blockers: [],
      dependenciesDeclared: true,
      dependencies: [],
      requestedTarget: {
        environmentId: "env-a",
        environmentRevision: 3,
        buildRef: ref("build", "build-a"),
        targetPolicyRef: ref("target-policy", "target-a"),
        testDataRef: ref("test-data", "test-data-a"),
      },
      requestRisk: "LOW",
      desiredDate: "2026-09-01",
      checklistRefs: [ref("checklist", "checklist-a")],
      dataClassificationKey: "INTERNAL",
      responseChannelResolution: {
        state: "CONFIRMED",
        requesterPrincipal: actor,
        resolutionPolicyRef: {
          key: "qa.response-channel",
          version: "1",
          contentHash: digest("channel-policy"),
        },
        responseChannelRef: {
          channelKind: "PLATFORM_WEB",
          channelId: "channel-a",
          version: 1,
          contentHash: digest("channel"),
        },
        evaluatedAt: "2026-08-30T10:00:00.000Z",
      },
      readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 2 },
      invalidatedState: {
        readinessAssessmentRefs: [],
        waiverRefs: [],
        pendingReadyCommandRefs: [],
      },
      changeReasonCode: "MISSING_INFO_SUPPLIED",
      contentHash: digest("input-2"),
      recordedBy: actor,
      authorizationBasisHash: digest("basis"),
      recordedAt: "2026-08-30T10:00:00.000Z",
      correlationId: "correlation-a",
    },
    acceptedRequest: { exists: true, externalVersion: "1", normalizedStatus: "NEW" },
    project: { state: "ACTIVE", registryState: "CURRENT", registryRevision: 3 },
    requesterEntitlement: { active: true, basisHash: digest("entitlement") },
    mappingHealth: {
      valid: true,
      bindingRef: { id: "binding-a", version: 2 },
      profileRef: { id: "profile-a", version: 2 },
    },
    contextRef: { id: "context-a", version: 1, contentHash: digest("context") },
    dorRuleSetRef: { key: "qa.dor", version: "1.0.0", contentHash: digest("dor") },
    allowedEnvironmentRefs: [{ environmentId: "env-a", revision: 3 }],
    maximumClassificationKey: "INTERNAL",
    evaluatedBy: actor,
    evaluatedAt: "2026-08-30T10:01:00.000Z",
  };
}

describe("AT-003 deterministic readiness", () => {
  it("returns READY for the exact current complete revision", async () => {
    const result = await evaluateQaReadiness(valid());
    expect(result.state).toBe("READY");
    expect(result.blockers).toEqual([]);
    expect(result.requestInputRevisionRef).toEqual({
      id: "input-2",
      version: 2,
      contentHash: digest("input-2"),
    });
    expect(result.inputs.responseChannel.state).toBe("CONFIRMED");
  });

  it.each([
    [
      "goal",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        currentInput: {
          ...input.currentInput,
          goal: undefined,
        } as unknown as QaReadinessEvaluationInput["currentInput"],
      }),
      "GOAL_REQUIRED",
    ],
    [
      "scope",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        currentInput: {
          ...input.currentInput,
          scope: undefined,
        } as unknown as QaReadinessEvaluationInput["currentInput"],
      }),
      "VALIDATION_SCOPE_REQUIRED",
    ],
    [
      "outcome",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        currentInput: {
          ...input.currentInput,
          acceptanceOutcome: undefined,
        } as unknown as QaReadinessEvaluationInput["currentInput"],
      }),
      "ACCEPTANCE_OUTCOME_REQUIRED",
    ],
    [
      "blockers declaration",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        currentInput: { ...input.currentInput, blockersDeclared: false },
      }),
      "BLOCKERS_DECLARATION_REQUIRED",
    ],
    [
      "dependencies declaration",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        currentInput: { ...input.currentInput, dependenciesDeclared: false },
      }),
      "DEPENDENCIES_DECLARATION_REQUIRED",
    ],
    [
      "active project",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        project: { ...input.project, state: "INACTIVE" as const },
      }),
      "PROJECT_INACTIVE",
    ],
    [
      "entitlement",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        requesterEntitlement: { ...input.requesterEntitlement, active: false },
      }),
      "REQUESTER_ENTITLEMENT_INACTIVE",
    ],
    [
      "mapping",
      (input: QaReadinessEvaluationInput) => ({
        ...input,
        mappingHealth: {
          ...input.mappingHealth,
          valid: false,
          errors: ["PROFILE_MAPPING_INVALID"],
        },
      }),
      "BINDING_PROFILE_MAPPING_INVALID",
    ],
  ])("emits a stable blocker for missing %s", async (_name, mutate, code) => {
    const result = await evaluateQaReadiness(mutate(valid()) as QaReadinessEvaluationInput);
    expect(result.state).toBe("NEEDS_INFO");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
  });

  it("maps a persisted missing original-requester channel without a second lookup", async () => {
    const input = valid();
    const result = await evaluateQaReadiness({
      ...input,
      currentInput: {
        ...input.currentInput,
        responseChannelResolution: {
          state: "MISSING",
          requesterPrincipal: actor,
          resolutionPolicyRef: {
            key: "qa.response-channel",
            version: "1",
            contentHash: digest("channel-policy"),
          },
          evaluatedAt: "2026-08-30T10:00:00.000Z",
          missingReasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
        },
      },
    });
    expect(result.inputs.responseChannel).toMatchObject({
      state: "UNCONFIRMED",
      requesterPrincipal: actor,
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "RESPONSE_CHANNEL_UNCONFIRMED",
    );
  });

  it("exposes exactly one waivable DoR code", () => {
    expect(DOR_RULE_CODES.filter((rule) => rule.waivable).map((rule) => rule.code)).toEqual([
      "PROJECT_REGISTRY_NEEDS_REVIEW",
    ]);
  });
});

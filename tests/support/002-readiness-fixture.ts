import type { QaReadinessEvaluationInput } from "../../packages/competency-qa/src/application/readiness-evaluator.ts";

const hash = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const immutableRef = (kind: string, id: string) => ({
  kind,
  id,
  version: "1",
  contentHash: hash(id),
});
const actor = {
  kind: "HUMAN" as const,
  principalId: "requester-a",
  issuer: "fake-idp",
  subject: "requester-a",
};

export function makeCompleteReadinessInput(): QaReadinessEvaluationInput {
  return {
    scope: { workspaceId: "workspace-a", projectId: "project-a" },
    workItemId: "work-item-a",
    extensionResourceVersion: 1,
    currentInput: {
      schemaVersion: 1,
      inputRevisionId: "input-a",
      version: 1,
      previousRevisionRef: null,
      workspaceId: "workspace-a",
      projectId: "project-a",
      workItemId: "work-item-a",
      definitionRef: { key: "qa.validation", version: "1.0.0" },
      acceptedDraftRef: immutableRef("draft", "draft-a"),
      externalRequestRef: immutableRef("request", "request-a"),
      operationalBindingRef: { id: "binding-a", version: 1 },
      originalRequesterRef: actor,
      title: "Validate",
      requestKind: "feature-validation",
      goal: "Validate behavior",
      scope: "Feature scope",
      acceptanceOutcome: "Accepted outcome",
      sourceRefs: [immutableRef("commit", "commit-a")],
      blockersDeclared: true,
      blockers: [],
      dependenciesDeclared: true,
      dependencies: [],
      requestedTarget: {
        environmentId: "env-a",
        environmentRevision: 1,
        buildRef: immutableRef("build", "build-a"),
        testDataRef: immutableRef("data", "data-a"),
      },
      requestRisk: "LOW",
      desiredDate: "2026-09-01",
      checklistRefs: [immutableRef("checklist", "check-a")],
      dataClassificationKey: "INTERNAL",
      responseChannelResolution: {
        state: "CONFIRMED",
        requesterPrincipal: actor,
        resolutionPolicyRef: {
          key: "qa.channel",
          version: "1",
          contentHash: hash("channel-policy"),
        },
        responseChannelRef: {
          channelKind: "PLATFORM_WEB",
          channelId: "channel-a",
          version: 1,
          contentHash: hash("channel-a"),
        },
        evaluatedAt: "2026-08-30T10:00:00.000Z",
      },
      readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 1 },
      invalidatedState: {
        readinessAssessmentRefs: [],
        waiverRefs: [],
        pendingReadyCommandRefs: [],
      },
      changeReasonCode: "INITIAL_CONFIRMED_DRAFT",
      contentHash: hash("input-a"),
      recordedBy: actor,
      authorizationBasisHash: hash("basis"),
      recordedAt: "2026-08-30T10:00:00.000Z",
      correlationId: "correlation-a",
    },
    acceptedRequest: { exists: true, externalVersion: "1", normalizedStatus: "NEW" },
    project: { state: "ACTIVE", registryState: "CURRENT", registryRevision: 1 },
    requesterEntitlement: { active: true, basisHash: hash("entitlement") },
    mappingHealth: {
      valid: true,
      bindingRef: { id: "binding-a", version: 1 },
      profileRef: { id: "profile-a", version: 1 },
    },
    contextRef: { id: "context-a", version: 1, contentHash: hash("context") },
    dorRuleSetRef: { key: "qa.dor", version: "1.0.0", contentHash: hash("dor") },
    allowedEnvironmentRefs: [{ environmentId: "env-a", revision: 1 }],
    maximumClassificationKey: "INTERNAL",
    evaluatedBy: actor,
    evaluatedAt: "2026-08-30T10:01:00.000Z",
  };
}

import {
  assessProjectCapabilityMode,
  buildTargetSnapshotV2,
  evidenceContentHash,
  executeGuardedAutomationLaunch,
  parseQaProjectCapabilityMode,
  type ProjectCapabilityProbe,
  qaValidationCapabilityRequirementSetV1,
} from "@awp/competency-qa/node";
import { createOnboardingRevision } from "@awp/platform-core";

import { createGitLabCapabilityProbes } from "../gitlab/profile-validation.ts";
import { qaProjectOnboardingLocalSeed as seed } from "../seed/qa-project-onboarding-local-seed.ts";
import { InMemoryRolloutLeaseStore, PilotActivationService } from "./action-consumers.ts";
import { acceptBindingFunctionally } from "./binding-acceptance-service.ts";
import {
  BindingLifecycleService,
  InMemoryBindingLifecycleStore,
} from "./binding-lifecycle-service.ts";
import { reviseProjectCapabilityMode } from "./onboarding-service.ts";

export async function runFullQaPromotionScenario() {
  const scope = Object.freeze({ workspaceId: seed.workspaceId, projectId: seed.projectId });
  const pipelineContractHash = evidenceContentHash({
    pipelineKey: "qa.validation",
    resultJobKey: "machine-result",
  });
  const gitLab = createGitLabCapabilityProbes({
    probeIdPrefix: "full-qa-gitlab",
    ...scope,
    bindingRef: seed.refs.fullQaBinding,
    profileRef: seed.refs.gitLabProfile,
    connectionRef: seed.refs.gitLabConnection,
    mappingRef: seed.refs.gitLabMapping,
    validationReportRef: seed.refs.fullQaValidation,
    expectedPipelineContractHash: pipelineContractHash,
    observedPipelineContractHash: pipelineContractHash,
    availableOperations: [
      "merge-request.read",
      "commit.read",
      "build.read",
      "pipeline.trigger",
      "pipeline.read",
      "pipeline.lookup",
      "artifact.metadata",
      "artifact.stream",
    ],
    observedAt: seed.now,
    validUntil: seed.later,
    now: seed.now,
  });
  const automationRequirementKeys = [
    "gitlab-source-context",
    "gitlab-test-execution",
    "gitlab-artifact-source",
  ] as const;
  const probes: ProjectCapabilityProbe[] = [
    {
      ref: seed.exactRef("jira-authority-probe"),
      requirementKey: "jira-qa-request-authority",
      requirement: "MANUAL",
      status: "AVAILABLE",
      validUntil: seed.later,
    },
    {
      ref: seed.exactRef("jira-source-probe"),
      requirementKey: "jira-source-context",
      requirement: "MANUAL",
      status: "AVAILABLE",
      validUntil: seed.later,
    },
    {
      ref: seed.exactRef("jira-defect-probe"),
      requirementKey: "jira-defect-destination",
      requirement: "MANUAL",
      status: "AVAILABLE",
      validUntil: seed.later,
    },
    ...gitLab.map((value, index) => ({
      ref: { id: value.probeId, version: value.version, contentHash: value.contentHash },
      requirementKey: automationRequirementKeys[index]!,
      requirement: "AUTOMATION" as const,
      status: value.status,
      validUntil: value.validUntil,
    })),
    {
      ref: seed.exactRef("mattermost-outage-probe"),
      requirementKey: "mattermost-pilot-messaging",
      requirement: "PILOT_MESSAGING",
      status: "DEGRADED",
      validUntil: seed.later,
    },
  ];

  const acceptance = acceptBindingFunctionally({
    ...scope,
    acceptanceId: "00000000-0000-4000-8000-000000000785",
    bindingRef: seed.refs.fullQaBinding,
    validationReportRef: seed.refs.fullQaValidation,
    qaProjectContextRef: seed.refs.context,
    acceptedResourceRefs: [seed.refs.automationSuite, seed.refs.environment, seed.refs.policy],
    checklistRef: seed.refs.checklist,
    acceptedBy: seed.qaLead,
    acceptedAt: seed.now,
  });
  const store = new InMemoryBindingLifecycleStore({ onboardingVersion: 2 });
  store.seedPublished({
    ...scope,
    ref: seed.refs.binding,
    state: "PUBLISHED",
    resourceVersion: 1,
    semanticContent: { roles: ["JIRA", "MATTERMOST"] },
  });
  const lifecycle = new BindingLifecycleService(store);
  const action = await lifecycle.requestPublication({
    ...scope,
    actionId: "00000000-0000-4000-8000-000000000786",
    bindingRef: seed.refs.fullQaBinding,
    validationReportRef: seed.refs.fullQaValidation,
    acceptance,
    expectedOnboardingVersion: 2,
    initiator: seed.integrationAdministrator,
    reason: "Publish exact GitLab automation Binding",
    createdAt: seed.now,
    expiresAt: seed.later,
  });
  const published = await lifecycle.publish({
    actionId: action.actionId,
    approval: {
      approvalId: "00000000-0000-4000-8000-000000000787",
      subjectKind: "PLATFORM_ACTION",
      actionKind: "BINDING_PUBLISH",
      actionId: action.actionId,
      targetHash: action.contentHash,
      initiatorPrincipalId: action.initiator.principalId,
      approver: seed.workspaceOwner,
      stepUpAt: seed.now,
      approvedAt: seed.now,
      expiresAt: seed.later,
    },
    approverCurrentlyAuthorized: true,
    now: seed.now,
  });
  const assessment = assessProjectCapabilityMode({
    assessmentId: "00000000-0000-4000-8000-000000000788",
    ...scope,
    bindingRef: seed.refs.fullQaBinding,
    contextRef: seed.refs.context,
    requirementSetRef: qaValidationCapabilityRequirementSetV1.ref,
    requirementSet: qaValidationCapabilityRequirementSetV1,
    acceptedAutomationSuite: {
      suiteBindingRef: seed.refs.automationSuite,
      bindingRef: seed.refs.fullQaBinding,
      environmentRef: seed.refs.environment,
      evidencePolicyRef: seed.refs.policy,
    },
    probes,
    now: seed.now,
  });
  const manualShadow = createOnboardingRevision({
    revisionId: "00000000-0000-4000-8000-000000000789",
    onboardingId: "00000000-0000-4000-8000-000000000762",
    version: 3,
    ...scope,
    stage: "SHADOW",
    qaCapabilityMode: "MANUAL_ONLY",
    operationalState: "ACTIVE",
    intendedCapabilityMode: "MANUAL_ONLY",
    projectRegistryRef: seed.exactRef("00000000-0000-4000-8000-000000000761"),
    bindingRef: seed.refs.fullQaBinding,
    qaProjectContextRef: seed.refs.context,
    starterEntitlementSetHash: evidenceContentHash(["starter"]),
    gateResultRefs: [seed.exactRef("gate-l0"), seed.exactRef("gate-c1"), seed.exactRef("gate-n2")],
    ownerSetHash: evidenceContentHash([seed.workspaceOwner.principalId, seed.qaLead.principalId]),
    reasonCode: "MANUAL_SHADOW",
    reason: "Manual shadow baseline",
    actor: seed.integrationAdministrator,
    correlationId: seed.correlationId,
    createdAt: seed.now,
  });
  const onboarding = reviseProjectCapabilityMode({
    current: manualShadow,
    assessment,
    actor: seed.integrationAdministrator,
    correlationId: seed.correlationId,
    evaluatedAt: seed.now,
    nextRevisionId: "00000000-0000-4000-8000-000000000790",
  });
  const snapshot = buildTargetSnapshotV2({
    snapshotId: "00000000-0000-4000-8000-000000000791",
    ...scope,
    workItemId: seed.workItemId,
    sessionId: "00000000-0000-4000-8000-000000000792",
    mode: "AUTOMATED",
    sourceRefs: [seed.exactRef("merge-request:17")],
    buildRef: seed.exactRef("commit:abc"),
    environmentRef: seed.refs.environment,
    testDataRefs: [seed.refs.testData],
    accountLeaseRefs: [],
    definitionRefs: [seed.refs.automationSuite],
    bindingRef: seed.refs.fullQaBinding,
    configurationPins: [
      {
        logicalRole: "SOURCE_CONTEXT",
        capabilityKey: "source-context.read",
        exactContractVersion: "1.0.0",
        profileRef: seed.refs.gitLabProfile,
        connectionRef: seed.refs.gitLabConnection,
        mappingRef: seed.refs.gitLabMapping,
        validationReportRef: seed.refs.fullQaValidation,
        operationSetHash: evidenceContentHash(["merge-request.read", "commit.read", "build.read"]),
        externalScopeHash: evidenceContentHash({ projectId: seed.projectId }),
      },
      {
        logicalRole: "TEST_EXECUTION",
        capabilityKey: "test-executor.trigger-status",
        exactContractVersion: "1.0.0",
        profileRef: seed.refs.gitLabProfile,
        connectionRef: seed.refs.gitLabConnection,
        mappingRef: seed.refs.gitLabMapping,
        validationReportRef: seed.refs.fullQaValidation,
        operationSetHash: evidenceContentHash([
          "pipeline.trigger",
          "pipeline.read",
          "pipeline.lookup",
        ]),
        externalScopeHash: evidenceContentHash({ projectId: seed.projectId }),
      },
      {
        logicalRole: "ARTIFACT_SOURCE",
        capabilityKey: "artifact.ci-read",
        exactContractVersion: "1.0.0",
        profileRef: seed.refs.gitLabProfile,
        connectionRef: seed.refs.gitLabConnection,
        mappingRef: seed.refs.gitLabMapping,
        validationReportRef: seed.refs.fullQaValidation,
        operationSetHash: evidenceContentHash(["artifact.metadata", "artifact.stream"]),
        externalScopeHash: evidenceContentHash({ projectId: seed.projectId }),
      },
    ],
    policyRefs: [seed.refs.policy],
    modeConfiguration: {
      schemaRef: seed.exactRef("automated-mode"),
      value: { suiteKey: "qa-smoke" },
      contentHash: evidenceContentHash({ suiteKey: "qa-smoke" }),
    },
    capturedAt: seed.now,
  });
  let providerEffects = 0;
  await executeGuardedAutomationLaunch(
    {
      ...scope,
      capabilityMode: parseQaProjectCapabilityMode(onboarding.qaCapabilityMode),
      bindingRef: seed.refs.fullQaBinding,
      acceptedSuiteRef: seed.refs.automationSuite,
      requestedSuiteRef: seed.refs.automationSuite,
      targetSnapshot: snapshot,
    },
    async () => {
      providerEffects += 1;
      return { state: "COMPLETED" as const };
    },
  );
  const pilotActivation = new PilotActivationService(new InMemoryRolloutLeaseStore());
  await pilotActivation.activateForTest(manualShadow, seed.now);
  const secondShadow = createOnboardingRevision({
    ...manualShadow,
    workspaceId: seed.workspaceId,
    projectId: seed.sequentialPilotProjectId,
    revisionId: "00000000-0000-4000-8000-000000000793",
    onboardingId: "00000000-0000-4000-8000-000000000794",
    projectRegistryRef: seed.exactRef("00000000-0000-4000-8000-000000000795"),
    bindingRef: seed.exactRef("00000000-0000-4000-8000-000000000796"),
    qaProjectContextRef: seed.exactRef("00000000-0000-4000-8000-000000000797"),
  });
  let overlapDenial = "";
  try {
    await pilotActivation.activateForTest(secondShadow, "2026-09-03T12:30:00.000Z");
  } catch (error) {
    overlapDenial = error instanceof Error ? error.message : String(error);
  }
  const recoveredPilot = await pilotActivation.activateForTest(
    secondShadow,
    "2026-09-03T13:00:01.000Z",
  );

  return Object.freeze({
    scenarioId: "full-qa-promotion" as const,
    status: "PASS" as const,
    stage: onboarding.stage,
    capabilityMode: parseQaProjectCapabilityMode(onboarding.qaCapabilityMode),
    operationalState: onboarding.operationalState,
    gitLabProbeCount: gitLab.length,
    acceptance: acceptance.outcome,
    ownerApprovalConsumed: published.approval.consumedAt !== undefined,
    automatedSession: Object.freeze({ state: "COMPLETED" as const, providerEffects }),
    mattermostFallback: assessment.messagingFallback,
    rolloutLease: Object.freeze({
      overlapDenial,
      recoveredProjectId: recoveredPilot.revision.projectId,
      recoveredStage: recoveredPilot.revision.stage,
    }),
    previousSessionBindingRef: seed.refs.binding,
    currentSessionBindingRef: published.binding.ref,
  });
}

import {
  assessProjectCapabilityMode,
  buildTargetSnapshot,
  evidenceContentHash,
  InMemoryQaProjectResourceStore,
  ManageQaProjectResources,
  parseQaProjectCapabilityMode,
  startGuardedQaSession,
} from "@awp/competency-qa/node";
import { createOnboardingRevision, type ProjectEventEnvelope } from "@awp/platform-core";
import {
  InMemoryProjectEntitlementRepository,
  InMemoryProjectOnboardingRepository,
} from "@awp/platform-persistence-typeorm";

import { qaProjectOnboardingLocalSeed as seed } from "../seed/qa-project-onboarding-local-seed.ts";
import { acceptBindingFunctionally } from "./binding-acceptance-service.ts";
import {
  BindingLifecycleService,
  InMemoryBindingLifecycleStore,
} from "./binding-lifecycle-service.ts";
import { validateManualBindingCandidate } from "./capability-probes.ts";
import { ProjectEntitlementService } from "./entitlement-service.ts";
import { createOnboardingEvent } from "./events.ts";
import { evaluateProjectOnboarding } from "./onboarding-service.ts";
import { ProjectRegistrationService } from "./project-registration-service.ts";
import { ProjectOnboardingEventWorker } from "./worker.ts";

const externalRef = (
  kind: string,
  value: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>,
) =>
  Object.freeze({
    kind,
    id: value.id,
    version: String(value.version),
    contentHash: value.contentHash,
  });

export async function runManualOnlyOnboardingScenario() {
  const scope = { workspaceId: seed.workspaceId, projectId: seed.projectId };
  const qaLeadActor = {
    kind: "HUMAN" as const,
    principalId: seed.qaLead.principalId,
    issuer: "https://fake-idp.local",
    subject: "qa-lead.alpha",
  };
  const registrationRepository = new InMemoryProjectOnboardingRepository();
  const registration = await new ProjectRegistrationService(registrationRepository, {
    now: () => seed.now,
    next: (kind) =>
      ({
        registry: "00000000-0000-4000-8000-000000000761",
        onboarding: "00000000-0000-4000-8000-000000000762",
        audit: "00000000-0000-4000-8000-000000000763",
        event: "00000000-0000-4000-8000-000000000764",
      })[kind],
  }).register({
    ...scope,
    idempotencyKey: "manual-only-project",
    key: "project-a",
    name: "Project A",
    ownerIds: [seed.workspaceOwner.principalId, seed.qaLead.principalId],
    criticalityKey: "STANDARD",
    dataClassificationKey: "INTERNAL",
    starterEntitlementSetHash: evidenceContentHash(["starter"]),
    actor: seed.integrationAdministrator,
    reason: "Manual-only onboarding",
    correlationId: seed.correlationId,
  });

  const entitlementRepository = new InMemoryProjectEntitlementRepository();
  const entitlementService = new ProjectEntitlementService(entitlementRepository);
  const entitlement = await entitlementService.change({
    ...scope,
    idempotencyKey: "starter-qa-engineer",
    expectedVersion: 0,
    entitlementId: "00000000-0000-4000-8000-000000000765",
    principalId: seed.qaEngineer.principalId,
    operation: "GRANT",
    effect: "ALLOW",
    permissions: ["qa.session.read", "qa.session.start"],
    classificationCeilingKey: "INTERNAL",
    validFrom: seed.now,
    actor: seed.integrationAdministrator,
    reason: "Starter QA access",
    correlationId: seed.correlationId,
    createdAt: seed.now,
  });

  const resources = new ManageQaProjectResources(new InMemoryQaProjectResourceStore());
  const environment = await resources.publishEnvironment({
    revisionId: seed.refs.environment.id,
    environmentId: seed.refs.environment.id,
    version: 1,
    ...scope,
    key: "local",
    name: "Local",
    scope: "LOCAL",
    ownerPrincipalId: seed.qaLead.principalId,
    dataClassificationKey: "INTERNAL",
    status: "PUBLISHED",
    configurationRef: {
      key: "runtime",
      schemaRef: {
        id: "environment-schema",
        version: 1,
        digest: evidenceContentHash("environment-schema"),
      },
      resourceRef: seed.exactRef("runtime"),
    },
    allowedTestDataPolicyRefs: [seed.refs.policy],
    createdBy: qaLeadActor,
    createdAt: seed.now,
    publishedAt: seed.now,
  });
  const environmentRef = {
    id: environment.environmentId,
    version: environment.version,
    contentHash: environment.contentHash,
  };
  const testData = await resources.publishTestData({
    entryId: seed.refs.testData.id,
    version: 1,
    ...scope,
    kind: "DATASET",
    externalRef: seed.exactRef("opaque-test-data"),
    ownerPrincipalId: seed.qaLead.principalId,
    allowedEnvironmentRefs: [environmentRef],
    dataClassificationKey: "INTERNAL",
    retentionPolicyRef: seed.refs.policy,
    state: "PUBLISHED",
  });
  const accountPool = await resources.publishAccountPool({
    poolId: seed.refs.accountPool.id,
    version: 1,
    ...scope,
    environmentRef,
    resolverRef: {
      key: "local-secret-adapter",
      schemaRef: {
        id: "resolver-schema",
        version: 1,
        digest: evidenceContentHash("resolver-schema"),
      },
      resourceRef: seed.exactRef("opaque-resolver"),
    },
    ownerPrincipalId: seed.qaLead.principalId,
    maximumConcurrentLeases: 1,
    maximumLeaseDurationSeconds: 3600,
    dataClassificationKey: "INTERNAL",
    state: "PUBLISHED",
  });
  const policy = externalRef("POLICY", seed.refs.policy);
  const context = await resources.publishContext({
    schemaVersion: 2,
    contextId: seed.refs.context.id,
    version: 1,
    ...scope,
    state: "PUBLISHED",
    environmentRefs: [externalRef("ENVIRONMENT", environmentRef)],
    testDataCatalogRefs: [
      externalRef("TEST_DATA", {
        id: testData.entryId,
        version: testData.version,
        contentHash: testData.contentHash,
      }),
    ],
    accountPoolRefs: [
      externalRef("ACCOUNT_POOL", {
        id: accountPool.poolId,
        version: accountPool.version,
        contentHash: accountPool.contentHash,
      }),
    ],
    targetPolicyRefs: [policy],
    scopePolicyRefs: [policy],
    checklistPolicyRefs: [policy],
    defaultTargetPolicyRef: policy,
    defaultScopePolicyRef: policy,
    defaultChecklistRefs: [policy],
    evidencePolicyRef: policy,
    retentionPolicyRef: policy,
    redactionPolicyRef: policy,
    exportPolicyRef: policy,
    riskReviewPolicyRef: policy,
    dorRuleSetRef: policy,
    dodRuleSetRef: policy,
    capabilityRequirementSetRef: externalRef("REQUIREMENTS", seed.refs.requirements),
    maximumClassificationKey: "INTERNAL",
    resourceVersion: 1,
    createdBy: qaLeadActor,
    publishedBy: qaLeadActor,
    publishedAt: seed.now,
  });
  const contextRef = {
    id: context.contextId,
    version: context.version,
    contentHash: context.contentHash,
  };

  const entries = [
    {
      connectorType: "JIRA" as const,
      logicalRole: "QA_REQUEST_AUTHORITY" as const,
      profileRef: seed.exactRef("jira-central"),
    },
    {
      connectorType: "JIRA" as const,
      logicalRole: "SOURCE_CONTEXT" as const,
      profileRef: seed.exactRef("jira-source"),
    },
    {
      connectorType: "JIRA" as const,
      logicalRole: "DEFECT_DESTINATION" as const,
      profileRef: seed.exactRef("jira-defect"),
    },
    {
      connectorType: "MATTERMOST" as const,
      logicalRole: "PILOT_MESSAGING" as const,
      profileRef: seed.exactRef("mattermost-pilot"),
    },
  ];
  const candidate = validateManualBindingCandidate({
    ...scope,
    bindingRef: seed.refs.binding,
    qaProjectContextRef: contextRef,
    entries,
    now: seed.now,
  });
  const acceptance = acceptBindingFunctionally({
    ...scope,
    acceptanceId: "00000000-0000-4000-8000-000000000766",
    bindingRef: seed.refs.binding,
    validationReportRef: candidate.report.ref,
    qaProjectContextRef: contextRef,
    acceptedResourceRefs: entries.map(({ profileRef }) => profileRef),
    checklistRef: seed.refs.checklist,
    acceptedBy: seed.qaLead,
    acceptedAt: seed.now,
  });
  const bindingStore = new InMemoryBindingLifecycleStore();
  const bindingService = new BindingLifecycleService(bindingStore);
  const action = await bindingService.requestPublication({
    ...scope,
    actionId: "00000000-0000-4000-8000-000000000767",
    bindingRef: seed.refs.binding,
    validationReportRef: candidate.report.ref,
    acceptance,
    expectedOnboardingVersion: 2,
    initiator: seed.integrationAdministrator,
    reason: "Publish exact manual Binding",
    createdAt: seed.now,
    expiresAt: seed.later,
  });
  const published = await bindingService.publish({
    actionId: action.actionId,
    approval: {
      approvalId: "00000000-0000-4000-8000-000000000768",
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
    assessmentId: "00000000-0000-4000-8000-000000000769",
    ...scope,
    bindingRef: seed.refs.binding,
    contextRef,
    requirementSetRef: seed.refs.requirements,
    now: seed.now,
    probes: [
      {
        ref: seed.exactRef("jira-manual-probe"),
        requirement: "MANUAL",
        status: "AVAILABLE",
        validUntil: seed.later,
      },
      {
        ref: seed.exactRef("mattermost-pilot-probe"),
        requirement: "PILOT_MESSAGING",
        status: "AVAILABLE",
        validUntil: seed.later,
      },
    ],
  });
  const validating = createOnboardingRevision({
    ...registration.onboarding,
    revisionId: "00000000-0000-4000-8000-000000000770",
    version: 2,
    stage: "VALIDATING",
    reasonCode: "VALIDATION_REQUESTED",
    reason: "Validate manual onboarding",
    actor: seed.integrationAdministrator,
    createdAt: seed.now,
  });
  await registrationRepository.appendOnboardingRevision(validating);
  const onboarding = evaluateProjectOnboarding({
    current: validating,
    assessment,
    bindingRef: seed.refs.binding,
    qaProjectContextRef: contextRef,
    gateResultRefs: [seed.exactRef("gate-l0"), seed.exactRef("gate-c1"), seed.exactRef("gate-n2")],
    actor: seed.integrationAdministrator,
    correlationId: seed.correlationId,
    evaluatedAt: seed.now,
    nextRevisionId: "00000000-0000-4000-8000-000000000771",
  });
  await registrationRepository.appendOnboardingRevision(onboarding);

  const snapshot = buildTargetSnapshot({
    snapshotId: "00000000-0000-4000-8000-000000000741",
    ...scope,
    workItemId: seed.workItemId,
    sessionId: seed.sessionId,
    mode: "MANUAL",
    sourceRefs: [seed.exactRef("source")],
    buildRef: seed.exactRef("build"),
    environmentRef,
    testDataRefs: [
      { id: testData.entryId, version: testData.version, contentHash: testData.contentHash },
    ],
    accountLeaseRefs: [],
    definitionRefs: [seed.exactRef("definition")],
    configurationPins: [
      {
        ordinal: 1,
        logicalRole: "QA_REQUEST_AUTHORITY",
        capabilityKey: "qa.request",
        exactContractVersion: "1.0.0",
        bindingRef: seed.refs.binding,
        profileRef: entries[0]!.profileRef,
        connectionRef: seed.exactRef("jira-connection"),
        validationReportRef: candidate.report.ref,
        operationSetHash: evidenceContentHash(["read"]),
        externalScopeHash: evidenceContentHash({ projectId: seed.projectId }),
      },
    ],
    policyRefs: [seed.refs.policy],
    modeConfiguration: {
      schemaRef: seed.exactRef("manual-mode"),
      value: { manual: true },
      contentHash: evidenceContentHash({ manual: true }),
    },
    capturedAt: seed.now,
  });
  const persistedSnapshots: unknown[] = [];
  await startGuardedQaSession({
    mode: "MANUAL",
    onboarding: {
      operationalState: onboarding.operationalState,
      capabilityMode: parseQaProjectCapabilityMode(onboarding.qaCapabilityMode),
    },
    snapshot,
    eligibility: {
      bindingRef: seed.refs.binding,
      allowedEnvironmentRefs: [environmentRef],
      allowedTestDataRefs: [
        { id: testData.entryId, version: testData.version, contentHash: testData.contentHash },
      ],
      activeAccountLeaseRefs: [],
    },
    persist: async (value) => {
      persistedSnapshots.push(value);
    },
  });
  let automatedDenial = "";
  try {
    await startGuardedQaSession({
      mode: "AUTOMATED",
      onboarding: {
        operationalState: onboarding.operationalState,
        capabilityMode: parseQaProjectCapabilityMode(onboarding.qaCapabilityMode),
      },
      snapshot: snapshot as never,
      persist: async () => undefined,
    });
  } catch (error) {
    automatedDenial = error instanceof Error ? error.message : String(error);
  }

  const event = createOnboardingEvent({
    eventId: "00000000-0000-4000-8000-000000000772",
    kind: "PROJECT_CAPABILITY_MODE_CHANGED",
    ...scope,
    subjectRef: {
      id: assessment.assessmentId,
      version: assessment.version,
      contentHash: assessment.contentHash,
    },
    relatedRefs: [seed.refs.binding, contextRef],
    reasonCode: "MANUAL_ONLY",
    actor: seed.service,
    occurredAt: seed.now,
    correlationId: seed.correlationId,
    causationId: seed.correlationId,
  });
  const queue: ProjectEventEnvelope[] = [event, event];
  const projected: ProjectEventEnvelope[] = [];
  const worker = new ProjectOnboardingEventWorker(
    {
      ready: async () => queue,
      acknowledge: async () => undefined,
      quarantine: async () => undefined,
    },
    {
      apply: async (value) => {
        projected.push(value);
      },
    },
  );
  const workerResult = await worker.run();

  return Object.freeze({
    scenarioId: "manual-only-onboarding" as const,
    status: "PASS" as const,
    projectId: seed.projectId,
    stage: onboarding.stage,
    capabilityMode: parseQaProjectCapabilityMode(onboarding.qaCapabilityMode),
    operationalState: onboarding.operationalState,
    manualSessionStarted: persistedSnapshots.length === 1,
    automatedDenial,
    exactRefs: Object.freeze({
      binding: published.binding.ref,
      context: contextRef,
      environment: environmentRef,
    }),
    auditCount: registrationRepository.audit().length + 1 + bindingStore.audit().length,
    outboxCount: registrationRepository.outbox().length + bindingStore.outbox().length,
    worker: workerResult,
    entitlementVersion: entitlement.revision.version,
  });
}

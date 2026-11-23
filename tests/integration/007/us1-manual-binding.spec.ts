import { describe, expect, it } from "vitest";

import { createJiraCapabilityProbe } from "../../../packages/runtime-composition/src/jira/profile-validation.ts";
import { createMattermostCapabilityProbe } from "../../../packages/runtime-composition/src/mattermost/profile-validation.ts";
import { acceptBindingFunctionally } from "../../../packages/runtime-composition/src/onboarding/binding-acceptance-service.ts";
import {
  BindingLifecycleService,
  InMemoryBindingLifecycleStore,
} from "../../../packages/runtime-composition/src/onboarding/binding-lifecycle-service.ts";
import { validateManualBindingCandidate } from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US1 manual Binding", () => {
  it("requires exact Jira authority/source/defect and Mattermost pilot roles before QA Lead acceptance", () => {
    const candidate = validateManualBindingCandidate({
      bindingRef: exactRef("binding"),
      ...projectScope(),
      qaProjectContextRef: exactRef("context"),
      entries: [
        {
          connectorType: "JIRA",
          logicalRole: "QA_REQUEST_AUTHORITY",
          profileRef: exactRef("jira-central"),
        },
        {
          connectorType: "JIRA",
          logicalRole: "SOURCE_CONTEXT",
          profileRef: exactRef("jira-source"),
        },
        {
          connectorType: "JIRA",
          logicalRole: "DEFECT_DESTINATION",
          profileRef: exactRef("jira-defect"),
        },
        {
          connectorType: "MATTERMOST",
          logicalRole: "PILOT_MESSAGING",
          profileRef: exactRef("mattermost"),
        },
      ],
      now: onboardingFixture.now,
    });
    expect(candidate.report.outcome).toBe("PASS");
    const acceptance = acceptBindingFunctionally({
      ...projectScope(),
      acceptanceId: "acceptance",
      bindingRef: candidate.bindingRef,
      validationReportRef: candidate.report.ref,
      qaProjectContextRef: exactRef("context"),
      acceptedResourceRefs: candidate.entries.map(({ profileRef }) => profileRef),
      checklistRef: exactRef("checklist"),
      acceptedBy: humanActor(onboardingFixture.qaLeadId),
      acceptedAt: onboardingFixture.now,
    });
    expect(acceptance.outcome).toBe("ACCEPTED");
  });

  it("keeps an incomplete candidate DRAFT without validation report pin", () => {
    const candidate = validateManualBindingCandidate({
      bindingRef: exactRef("binding"),
      ...projectScope(),
      qaProjectContextRef: exactRef("context"),
      entries: [
        { connectorType: "JIRA", logicalRole: "SOURCE_CONTEXT", profileRef: exactRef("jira") },
      ],
      now: onboardingFixture.now,
    });
    expect(candidate).toMatchObject({ state: "DRAFT", validationReportId: undefined });
    expect(candidate.report.safeIssueCodes).toContain("QA_REQUEST_AUTHORITY_MISSING");
  });

  it("publishes only the exact accepted Binding with a distinct stepped-up Workspace Owner", async () => {
    const candidate = validateManualBindingCandidate({
      bindingRef: exactRef("binding"),
      ...projectScope(),
      qaProjectContextRef: exactRef("context"),
      entries: [
        {
          connectorType: "JIRA",
          logicalRole: "QA_REQUEST_AUTHORITY",
          profileRef: exactRef("jira-central"),
        },
        {
          connectorType: "JIRA",
          logicalRole: "SOURCE_CONTEXT",
          profileRef: exactRef("jira-source"),
        },
        {
          connectorType: "JIRA",
          logicalRole: "DEFECT_DESTINATION",
          profileRef: exactRef("jira-defect"),
        },
        {
          connectorType: "MATTERMOST",
          logicalRole: "PILOT_MESSAGING",
          profileRef: exactRef("mattermost"),
        },
      ],
      now: onboardingFixture.now,
    });
    const acceptance = acceptBindingFunctionally({
      ...projectScope(),
      acceptanceId: "acceptance",
      bindingRef: candidate.bindingRef,
      validationReportRef: candidate.report.ref,
      qaProjectContextRef: exactRef("context"),
      acceptedResourceRefs: candidate.entries.map(({ profileRef }) => profileRef),
      checklistRef: exactRef("checklist"),
      acceptedBy: humanActor(onboardingFixture.qaLeadId),
      acceptedAt: onboardingFixture.now,
    });
    const store = new InMemoryBindingLifecycleStore();
    const service = new BindingLifecycleService(store);
    const action = await service.requestPublication({
      ...projectScope(),
      actionId: "action",
      bindingRef: candidate.bindingRef,
      validationReportRef: candidate.report.ref,
      acceptance,
      expectedOnboardingVersion: 2,
      initiator: humanActor(
        onboardingFixture.integrationAdministratorId,
        "integration-administrator",
      ),
      reason: "Publish manual Binding",
      createdAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    });
    const owner = {
      ...humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
      stepUpAt: onboardingFixture.now,
    };
    const published = await service.publish({
      actionId: action.actionId,
      approval: {
        approvalId: "approval",
        subjectKind: "PLATFORM_ACTION",
        actionKind: "BINDING_PUBLISH",
        actionId: action.actionId,
        targetHash: action.contentHash,
        initiatorPrincipalId: action.initiator.principalId,
        approver: owner,
        stepUpAt: onboardingFixture.now,
        approvedAt: onboardingFixture.now,
        expiresAt: onboardingFixture.later,
      },
      approverCurrentlyAuthorized: true,
      now: onboardingFixture.now,
    });
    expect(published.binding).toMatchObject({ state: "PUBLISHED", ref: candidate.bindingRef });
    await expect(
      service.publish({
        actionId: action.actionId,
        approval: published.approval,
        approverCurrentlyAuthorized: true,
        now: onboardingFixture.now,
      }),
    ).rejects.toThrow("APPROVAL_ALREADY_CONSUMED");
  });

  it("normalizes Jira and Mattermost checks into immutable safe probes", () => {
    const common = {
      probeId: "probe",
      ...projectScope(),
      bindingRef: exactRef("binding"),
      profileRef: exactRef("profile"),
      connectionRef: exactRef("connection"),
      validationReportRef: exactRef("validation"),
      logicalRole: "QA_REQUEST_AUTHORITY",
      capabilityKey: "qa.request",
      exactContractVersion: "1.0.0",
      operation: "read",
      environmentScope: "NON_PROD" as const,
      observedAt: onboardingFixture.now,
      validUntil: onboardingFixture.later,
    };
    const jira = createJiraCapabilityProbe({ ...common, available: true });
    const mattermost = createMattermostCapabilityProbe({
      ...common,
      probeId: "probe-mm",
      logicalRole: "PILOT_MESSAGING",
      capabilityKey: "notification.delivery",
      health: "DEGRADED",
      safeIssueCodes: ["MATTERMOST_UNAVAILABLE"],
    });
    expect(jira).toMatchObject({ actorKind: "SERVICE", status: "AVAILABLE", safeIssueCodes: [] });
    expect(mattermost).toMatchObject({
      actorKind: "SERVICE",
      status: "DEGRADED",
      safeIssueCodes: ["MATTERMOST_UNAVAILABLE"],
    });
    expect(JSON.stringify(mattermost)).not.toMatch(/password|token|cookie/iu);
  });
});

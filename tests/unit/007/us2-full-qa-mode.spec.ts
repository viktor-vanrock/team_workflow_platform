import { describe, expect, it } from "vitest";

import { fullQaSuiteAcceptanceFacts } from "../../../packages/competency-qa/src/application/manage-automation-suite.ts";
import {
  assessProjectCapabilityMode,
  type ProjectCapabilityProbe,
} from "../../../packages/competency-qa/src/application/project-capability-mode.ts";
import { qaCompetencyManifestV13 } from "../../../packages/competency-qa/src/manifest-v1.3.ts";
import {
  qaCompetencyManifestV14,
  qaValidationCapabilityRequirementSetV1,
  qaValidationWorkTypeDefinitionV14,
} from "../../../packages/competency-qa/src/manifest-v1.4.ts";
import { acceptBindingFunctionally } from "../../../packages/runtime-composition/src/onboarding/binding-acceptance-service.ts";
import { exactRef, onboardingFixture, projectScope } from "../../support/007-onboarding-fixture.ts";

const probe = (
  requirementKey: string,
  requirement: ProjectCapabilityProbe["requirement"],
  overrides: Partial<ProjectCapabilityProbe> = {},
): ProjectCapabilityProbe => ({
  ref: exactRef(`probe-${requirementKey}`),
  requirementKey,
  requirement,
  status: "AVAILABLE",
  validUntil: onboardingFixture.later,
  ...overrides,
});

const manual = [
  probe("jira-qa-request-authority", "MANUAL"),
  probe("jira-source-context", "MANUAL"),
  probe("jira-defect-destination", "MANUAL"),
];
const automation = [
  probe("gitlab-source-context", "AUTOMATION"),
  probe("gitlab-test-execution", "AUTOMATION"),
  probe("gitlab-artifact-source", "AUTOMATION"),
];

function assess(probes: readonly ProjectCapabilityProbe[], suiteBindingRef = exactRef("suite")) {
  const bindingRef = exactRef("binding-full");
  return assessProjectCapabilityMode({
    ...projectScope(),
    bindingRef,
    contextRef: exactRef("context"),
    requirementSetRef: qaValidationCapabilityRequirementSetV1.ref,
    requirementSet: qaValidationCapabilityRequirementSetV1,
    acceptedAutomationSuite: {
      suiteBindingRef,
      bindingRef,
      environmentRef: exactRef("environment"),
      evidencePolicyRef: exactRef("evidence-policy"),
    },
    now: onboardingFixture.now,
    probes,
  });
}

describe("Feature 007 US2 FULL_QA requirement truth table", () => {
  it("publishes additive immutable v1.4 identities while leaving v1.3 intact", () => {
    expect(qaCompetencyManifestV13.metadata.version).toBe("1.3.0");
    expect(qaCompetencyManifestV14.metadata.version).toBe("1.4.0");
    expect(qaValidationWorkTypeDefinitionV14.capabilityRequirements).toEqual(
      qaCompetencyManifestV13.workTypes[0]!.capabilityRequirements,
    );
    expect(qaValidationCapabilityRequirementSetV1.requirements).toHaveLength(7);
    expect(Object.isFrozen(qaValidationCapabilityRequirementSetV1)).toBe(true);
  });

  it("requires all Jira and GitLab roles plus the exact accepted suite", () => {
    expect(
      assess([...manual, ...automation, probe("mattermost-pilot-messaging", "PILOT_MESSAGING")]),
    ).toMatchObject({
      manualRequirements: "SATISFIED",
      automationRequirements: "SATISFIED",
      derivedMode: "FULL_QA",
    });
    expect(assess([...manual, ...automation.slice(0, 2)])).toMatchObject({
      derivedMode: "MANUAL_ONLY",
      reasonCodes: expect.arrayContaining(["AUTOMATION_ARTIFACT_SOURCE_UNSATISFIED"]),
    });
    expect(assess([...manual, ...automation], exactRef("different-suite"))).toMatchObject({
      derivedMode: "FULL_QA",
    });
  });

  it("downgrades safely for stale mandatory probes or a suite accepted against another Binding", () => {
    const stale = assess([
      ...manual,
      ...automation.map((item, index) =>
        index === 1 ? { ...item, validUntil: "2026-09-03T11:59:59.000Z" } : item,
      ),
    ]);
    expect(stale).toMatchObject({
      derivedMode: "MANUAL_ONLY",
      reasonCodes: expect.arrayContaining(["AUTOMATION_PROBE_STALE"]),
    });

    const bindingRef = exactRef("binding-full");
    const mismatched = assessProjectCapabilityMode({
      ...projectScope(),
      bindingRef,
      contextRef: exactRef("context"),
      requirementSetRef: qaValidationCapabilityRequirementSetV1.ref,
      requirementSet: qaValidationCapabilityRequirementSetV1,
      acceptedAutomationSuite: {
        suiteBindingRef: exactRef("suite"),
        bindingRef: exactRef("binding-old"),
        environmentRef: exactRef("environment"),
        evidencePolicyRef: exactRef("evidence-policy"),
      },
      now: onboardingFixture.now,
      probes: [...manual, ...automation],
    });
    expect(mismatched).toMatchObject({
      derivedMode: "MANUAL_ONLY",
      reasonCodes: expect.arrayContaining(["AUTOMATION_SUITE_ACCEPTANCE_MISMATCH"]),
    });
  });

  it("keeps FULL_QA during a Mattermost outage and exposes web/outbox fallback", () => {
    const result = assess([
      ...manual,
      ...automation,
      probe("mattermost-pilot-messaging", "PILOT_MESSAGING", { status: "DEGRADED" }),
    ]);
    expect(result).toMatchObject({
      derivedMode: "FULL_QA",
      pilotMessagingRequirement: "DEGRADED",
      messagingFallback: "WEB_AND_OUTBOX",
    });
  });

  it("accepts only an exact published suite, pipeline contract, environment and evidence policy", () => {
    const bindingRef = exactRef("binding-full");
    const environmentRef = exactRef("environment");
    const evidencePolicyRef = exactRef("evidence-policy");
    const pipelineContractHash = exactRef("pipeline-contract").contentHash;
    const suite = {
      id: "suite:v1",
      suiteBindingId: "suite",
      suiteKey: "smoke",
      version: 1,
      state: "PUBLISHED" as const,
      ...projectScope(),
      contentHash: exactRef("suite:v1").contentHash,
      validationReportId: "suite-report",
      validationReportContentHash: exactRef("suite-report").contentHash,
      content: {
        ownerPrincipalId: "qa-lead",
        suiteDefinitionRef: exactRef("suite-definition"),
        logicalExecutionContract: {
          pipelineKey: "smoke",
          sourceRefPolicyRef: "source-policy@1",
          resultJobKey: "result",
          contractHash: pipelineContractHash,
        },
        allowedTargetTypes: ["MERGE_REQUEST" as const],
        allowedEnvironmentRefs: [`${environmentRef.id}@${environmentRef.version}`],
        parameterSchemaRef: exactRef("params"),
        resultSchemaRef: exactRef("result"),
        artifactPolicyRef: evidencePolicyRef,
        retryPolicyRef: exactRef("retry"),
        quarantinePolicyRef: exactRef("quarantine"),
        capabilityRequirements: [
          "source-context.read@1.0.0" as const,
          "test-executor.trigger-status@1.0.0" as const,
          "artifact.ci-read@1.0.0" as const,
        ],
      },
      createdBy: {
        kind: "HUMAN" as const,
        principalId: "qa-lead",
        issuer: "local",
        subject: "qa-lead",
      },
      createdAt: onboardingFixture.now,
      publishedAt: onboardingFixture.now,
      retiredAt: null,
    };
    const facts = fullQaSuiteAcceptanceFacts({
      suite,
      bindingRef,
      environmentRef,
      evidencePolicyRef,
      expectedPipelineContractHash: pipelineContractHash,
    });
    const accepted = acceptBindingFunctionally({
      ...projectScope(),
      acceptanceId: "full-qa-acceptance",
      bindingRef,
      validationReportRef: exactRef("validation"),
      qaProjectContextRef: exactRef("context"),
      acceptedResourceRefs: [facts.suiteRef, environmentRef, evidencePolicyRef],
      checklistRef: exactRef("checklist"),
      acceptedBy: {
        kind: "HUMAN",
        principalId: onboardingFixture.qaLeadId,
        roleKey: "qa-lead",
        authorizationBasisRef: exactRef("basis"),
        authenticationContextRef: exactRef("authn"),
      },
      acceptedAt: onboardingFixture.now,
      automationAcceptance: { ...facts, expectedPipelineContractHash: pipelineContractHash },
    });
    expect(accepted).toMatchObject({ outcome: "ACCEPTED", safeIssueCodes: [] });

    const rejected = acceptBindingFunctionally({
      ...projectScope(),
      acceptanceId: "full-qa-rejection",
      bindingRef,
      validationReportRef: exactRef("validation"),
      qaProjectContextRef: exactRef("context"),
      acceptedResourceRefs: [facts.suiteRef, environmentRef, evidencePolicyRef],
      checklistRef: exactRef("checklist"),
      acceptedBy: {
        kind: "HUMAN",
        principalId: onboardingFixture.qaLeadId,
        roleKey: "qa-lead",
        authorizationBasisRef: exactRef("basis"),
        authenticationContextRef: exactRef("authn"),
      },
      acceptedAt: onboardingFixture.now,
      automationAcceptance: {
        ...facts,
        expectedPipelineContractHash: exactRef("other-contract").contentHash,
      },
    });
    expect(rejected).toMatchObject({
      outcome: "REJECTED",
      safeIssueCodes: ["PIPELINE_CONTRACT_MISMATCH"],
    });
  });
});

import { describe, expect, it } from "vitest";

import { assessProjectCapabilityMode } from "../../../packages/competency-qa/src/application/project-capability-mode.ts";
import { createOnboardingRevision } from "../../../packages/platform-core/src/project-onboarding/model.ts";
import { evaluateProjectOnboarding } from "../../../packages/runtime-composition/src/onboarding/onboarding-service.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US1 capability mode", () => {
  it("derives MANUAL_ONLY when mandatory manual probes are fresh and GitLab is absent", () => {
    const result = assessProjectCapabilityMode({
      ...projectScope(),
      bindingRef: exactRef("binding"),
      contextRef: exactRef("context"),
      requirementSetRef: exactRef("requirements"),
      now: onboardingFixture.now,
      probes: [
        {
          ref: exactRef("jira"),
          requirement: "MANUAL",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
        {
          ref: exactRef("mattermost"),
          requirement: "PILOT_MESSAGING",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
      ],
    });
    expect(result).toMatchObject({
      manualRequirements: "SATISFIED",
      automationRequirements: "UNSATISFIED",
      derivedMode: "MANUAL_ONLY",
    });
    expect(result.reasonCodes).toEqual(["AUTOMATION_REQUIREMENTS_UNSATISFIED"]);
  });

  it("returns deterministic safe reasons for stale mandatory probes", () => {
    const result = assessProjectCapabilityMode({
      ...projectScope(),
      bindingRef: exactRef("binding"),
      contextRef: exactRef("context"),
      requirementSetRef: exactRef("requirements"),
      now: onboardingFixture.now,
      probes: [
        {
          ref: exactRef("jira"),
          requirement: "MANUAL",
          status: "AVAILABLE",
          validUntil: "2026-09-03T11:59:59.000Z",
        },
      ],
    });
    expect(result.reasonCodes).toEqual([
      "MANUAL_PROBE_STALE",
      "MANUAL_REQUIREMENTS_UNSATISFIED",
      "AUTOMATION_REQUIREMENTS_UNSATISFIED",
      "PILOT_MESSAGING_UNSATISFIED",
    ]);
  });

  it("moves a validated manual Project to SHADOW while preserving MANUAL_ONLY and ACTIVE", () => {
    const scope = projectScope();
    const bindingRef = exactRef("binding");
    const contextRef = exactRef("context");
    const assessment = assessProjectCapabilityMode({
      ...scope,
      bindingRef,
      contextRef,
      requirementSetRef: exactRef("requirements"),
      now: onboardingFixture.now,
      probes: [
        {
          ref: exactRef("jira"),
          requirement: "MANUAL",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
        {
          ref: exactRef("mattermost"),
          requirement: "PILOT_MESSAGING",
          status: "AVAILABLE",
          validUntil: onboardingFixture.later,
        },
      ],
    });
    const current = createOnboardingRevision({
      revisionId: "onboarding-r2",
      onboardingId: "onboarding",
      version: 2,
      ...scope,
      stage: "VALIDATING",
      qaCapabilityMode: "MANUAL_ONLY",
      operationalState: "ACTIVE",
      intendedCapabilityMode: "MANUAL_ONLY",
      projectRegistryRef: exactRef("registry"),
      starterEntitlementSetHash: testHash("starter"),
      gateResultRefs: [],
      ownerSetHash: testHash("owners"),
      reasonCode: "VALIDATING",
      reason: "Validate",
      actor: humanActor(),
      correlationId: onboardingFixture.correlationId,
      createdAt: onboardingFixture.now,
    });
    const next = evaluateProjectOnboarding({
      current,
      assessment,
      bindingRef,
      qaProjectContextRef: contextRef,
      gateResultRefs: [exactRef("l0"), exactRef("c1"), exactRef("n2")],
      actor: humanActor(),
      correlationId: onboardingFixture.correlationId,
      evaluatedAt: onboardingFixture.now,
      nextRevisionId: "onboarding-r3",
    });
    expect(next).toMatchObject({
      version: 3,
      stage: "SHADOW",
      qaCapabilityMode: "MANUAL_ONLY",
      operationalState: "ACTIVE",
      bindingRef,
      qaProjectContextRef: contextRef,
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { assertAutomatedSessionPlanningAllowed } from "../../../packages/competency-qa/src/application/plan-automated-session.ts";
import { buildTargetSnapshotV2 } from "../../../packages/competency-qa/src/application/target-snapshot-builder-v2.ts";
import { executeGuardedAutomationLaunch } from "../../../packages/competency-qa/src/application/trigger-automation.ts";
import {
  exactRef,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

const snapshot = () =>
  buildTargetSnapshotV2({
    snapshotId: "snapshot",
    ...projectScope(),
    workItemId: "work-item",
    sessionId: "session",
    mode: "AUTOMATED",
    sourceRefs: [exactRef("source")],
    buildRef: exactRef("build"),
    environmentRef: exactRef("environment"),
    testDataRefs: [exactRef("test-data")],
    accountLeaseRefs: [],
    definitionRefs: [exactRef("suite")],
    bindingRef: exactRef("binding-full"),
    configurationPins: [
      {
        logicalRole: "SOURCE_CONTEXT",
        capabilityKey: "source-context.read",
        exactContractVersion: "1.0.0",
        profileRef: exactRef("profile-source"),
        connectionRef: exactRef("connection"),
        validationReportRef: exactRef("validation"),
        operationSetHash: testHash("source-ops"),
        externalScopeHash: testHash("source-scope"),
      },
      {
        logicalRole: "TEST_EXECUTION",
        capabilityKey: "test-executor.trigger-status",
        exactContractVersion: "1.0.0",
        profileRef: exactRef("profile-execution"),
        connectionRef: exactRef("connection"),
        validationReportRef: exactRef("validation"),
        operationSetHash: testHash("execution-ops"),
        externalScopeHash: testHash("execution-scope"),
      },
      {
        logicalRole: "ARTIFACT_SOURCE",
        capabilityKey: "artifact.ci-read",
        exactContractVersion: "1.0.0",
        profileRef: exactRef("profile-artifact"),
        connectionRef: exactRef("connection"),
        validationReportRef: exactRef("validation"),
        operationSetHash: testHash("artifact-ops"),
        externalScopeHash: testHash("artifact-scope"),
      },
    ],
    policyRefs: [exactRef("evidence-policy")],
    modeConfiguration: {
      schemaRef: { id: "mode-schema", version: 1 },
      value: { suiteKey: "smoke" },
      contentHash: testHash({ suiteKey: "smoke" }),
    },
    capturedAt: onboardingFixture.now,
  });

describe("Feature 007 US2 automated Session guards", () => {
  it("requires FULL_QA, the exact accepted suite and Target Snapshot v2", async () => {
    const targetSnapshot = snapshot();
    const allowed = {
      ...projectScope(),
      capabilityMode: "FULL_QA" as const,
      bindingRef: exactRef("binding-full"),
      acceptedSuiteRef: exactRef("suite"),
      requestedSuiteRef: exactRef("suite"),
      targetSnapshot,
    };
    expect(assertAutomatedSessionPlanningAllowed(allowed)).toBe(targetSnapshot);
    await expect(
      executeGuardedAutomationLaunch(allowed, async () => "provider-receipt"),
    ).resolves.toBe("provider-receipt");
  });

  it.each([
    ["mode", { capabilityMode: "MANUAL_ONLY" as const }],
    ["suite", { requestedSuiteRef: exactRef("other-suite") }],
    ["snapshot", { targetSnapshot: { schemaVersion: "qa-target-snapshot@1.0.0" } as never }],
  ])("performs zero provider effects when %s prerequisite is denied", async (_label, override) => {
    const provider = vi.fn(async () => "provider-receipt");
    const input = {
      ...projectScope(),
      capabilityMode: "FULL_QA" as const,
      bindingRef: exactRef("binding-full"),
      acceptedSuiteRef: exactRef("suite"),
      requestedSuiteRef: exactRef("suite"),
      targetSnapshot: snapshot(),
      ...override,
    };
    await expect(executeGuardedAutomationLaunch(input, provider)).rejects.toThrow(
      /QA_AUTOMATION_/u,
    );
    expect(provider).not.toHaveBeenCalled();
  });
});

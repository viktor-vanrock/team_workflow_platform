import { describe, expect, it, vi } from "vitest";

import { startGuardedQaSession } from "../../../packages/competency-qa/src/application/session-start-guards.ts";
import { buildTargetSnapshot } from "../../../packages/competency-qa/src/application/target-snapshot-builder.ts";
import { evidenceContentHash } from "../../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";
import { exactRef, onboardingFixture, projectScope } from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US1 Session mode guards", () => {
  it("captures the exact manual environment/Binding chain", async () => {
    const persist = vi.fn(async () => undefined);
    const snapshot = buildTargetSnapshot({
      snapshotId: "00000000-0000-4000-8000-000000000741",
      ...projectScope(),
      workItemId: "00000000-0000-4000-8000-000000000742",
      sessionId: "00000000-0000-4000-8000-000000000743",
      mode: "MANUAL",
      sourceRefs: [exactRef("source")],
      buildRef: exactRef("build"),
      environmentRef: exactRef("environment"),
      testDataRefs: [exactRef("data")],
      accountLeaseRefs: [],
      definitionRefs: [exactRef("definition")],
      configurationPins: [
        {
          ordinal: 1,
          logicalRole: "QA_REQUEST_AUTHORITY",
          capabilityKey: "qa.request",
          exactContractVersion: "1.0.0",
          bindingRef: exactRef("binding"),
          profileRef: exactRef("profile"),
          connectionRef: exactRef("connection"),
          validationReportRef: exactRef("validation"),
          operationSetHash: evidenceContentHash(["read"]),
          externalScopeHash: evidenceContentHash({ project: onboardingFixture.projectA }),
        },
      ],
      policyRefs: [exactRef("policy")],
      modeConfiguration: {
        schemaRef: exactRef("mode"),
        value: { manual: true },
        contentHash: evidenceContentHash({ manual: true }),
      },
      capturedAt: onboardingFixture.now,
    });
    await expect(
      startGuardedQaSession({
        mode: "MANUAL",
        onboarding: { operationalState: "ACTIVE", capabilityMode: "MANUAL_ONLY" },
        snapshot,
        eligibility: {
          bindingRef: exactRef("binding"),
          allowedEnvironmentRefs: [exactRef("environment")],
          allowedTestDataRefs: [exactRef("data")],
          activeAccountLeaseRefs: [],
        },
        persist,
      }),
    ).resolves.toEqual(snapshot);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("denies automation before persistence or provider effects", async () => {
    const persist = vi.fn(async () => undefined);
    const providerEffect = vi.fn(async () => undefined);
    await expect(
      startGuardedQaSession({
        mode: "AUTOMATED",
        onboarding: { operationalState: "ACTIVE", capabilityMode: "MANUAL_ONLY" },
        snapshot: {} as never,
        persist,
        providerEffect,
      }),
    ).rejects.toThrow("AUTOMATION_REQUIRES_FULL_QA");
    expect(persist).not.toHaveBeenCalled();
    expect(providerEffect).not.toHaveBeenCalled();
  });
});

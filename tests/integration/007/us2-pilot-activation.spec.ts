import { describe, expect, it } from "vitest";

import { createOnboardingRevision } from "../../../packages/platform-core/src/project-onboarding/model.ts";
import {
  InMemoryRolloutLeaseStore,
  PilotActivationService,
} from "../../../packages/runtime-composition/src/onboarding/action-consumers.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

const shadow = (projectId: string, version = 3) =>
  createOnboardingRevision({
    revisionId: `onboarding-${projectId}-${version}`,
    onboardingId: `onboarding-${projectId}`,
    version,
    ...projectScope(projectId),
    stage: "SHADOW",
    qaCapabilityMode: "FULL_QA",
    operationalState: "ACTIVE",
    intendedCapabilityMode: "FULL_QA",
    projectRegistryRef: exactRef(`registry-${projectId}`),
    bindingRef: exactRef(`binding-${projectId}`),
    qaProjectContextRef: exactRef(`context-${projectId}`),
    starterEntitlementSetHash: testHash("starter"),
    gateResultRefs: [exactRef("l0"), exactRef("c1"), exactRef("n2")],
    ownerSetHash: testHash("owners"),
    reasonCode: "SHADOW_READY",
    reason: "Ready",
    actor: humanActor(),
    correlationId: onboardingFixture.correlationId,
    createdAt: onboardingFixture.now,
  });

describe("Feature 007 US2 sequential pilot activation", () => {
  it("requires PASS C1/N2/P3 and exact Owner approval", async () => {
    const service = new PilotActivationService(new InMemoryRolloutLeaseStore());
    const current = shadow(onboardingFixture.projectA);
    const activated = await service.activate({
      current,
      gateResults: ["C1", "N2", "P3"].map((kind) => ({
        kind,
        outcome: "PASS" as const,
        ref: exactRef(kind.toLowerCase()),
      })),
      actionId: "pilot-a",
      expectedOnboardingVersion: current.version,
      initiator: humanActor(
        onboardingFixture.integrationAdministratorId,
        "integration-administrator",
      ),
      approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
      approvalTargetHash: testHash({
        actionId: "pilot-a",
        projectId: onboardingFixture.projectA,
        version: current.version,
      }),
      stepUpAt: onboardingFixture.now,
      now: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    });
    expect(activated.revision.stage).toBe("PILOT_ACTIVE");

    await expect(
      service.activate({
        current: shadow(onboardingFixture.projectB),
        gateResults: [
          { kind: "C1", outcome: "BLOCKED_INPUT", ref: exactRef("c1-b") },
          { kind: "N2", outcome: "PASS", ref: exactRef("n2-b") },
          { kind: "P3", outcome: "PASS", ref: exactRef("p3-b") },
        ],
        actionId: "pilot-b",
        expectedOnboardingVersion: 3,
        initiator: humanActor(
          onboardingFixture.integrationAdministratorId,
          "integration-administrator",
        ),
        approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
        approvalTargetHash: testHash({
          actionId: "pilot-b",
          projectId: onboardingFixture.projectB,
          version: 3,
        }),
        stepUpAt: onboardingFixture.now,
        now: onboardingFixture.now,
        expiresAt: onboardingFixture.later,
      }),
    ).rejects.toThrow("PILOT_GATE_BLOCKED");
  });

  it("serializes first promotions and recovers only after rollout-lease expiry", async () => {
    const leases = new InMemoryRolloutLeaseStore();
    const service = new PilotActivationService(leases);
    leases.acquire({
      ...projectScope(onboardingFixture.projectA),
      actorId: onboardingFixture.workspaceOwnerId,
      acquiredAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    });
    await expect(
      service.activateForTest(shadow(onboardingFixture.projectB), "2026-09-03T12:30:00.000Z"),
    ).rejects.toThrow("ROLLOUT_LEASE_HELD");
    await expect(
      service.activateForTest(shadow(onboardingFixture.projectB), "2026-09-03T13:00:01.000Z"),
    ).resolves.toMatchObject({ revision: { stage: "PILOT_ACTIVE" } });
  });
});

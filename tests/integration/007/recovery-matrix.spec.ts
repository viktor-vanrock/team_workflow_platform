import { describe, expect, it, vi } from "vitest";

import {
  createProjectEventEnvelope,
  ProjectEventInbox,
} from "../../../packages/platform-core/src/index.ts";
import { ProjectSuspensionRecoveryWorker } from "../../../packages/runtime-composition/src/onboarding/recovery-worker.ts";
import { exactRef, onboardingFixture, testHash } from "../../support/007-onboarding-fixture.ts";

const event = (eventId: string, version: number) =>
  createProjectEventEnvelope({
    eventId,
    eventType: "PROJECT_ONBOARDING_CHANGED",
    scope: { workspaceId: onboardingFixture.workspaceId, projectId: onboardingFixture.projectA },
    subjectRef: {
      ...exactRef(`onboarding-${version}`, version),
      workspaceId: onboardingFixture.workspaceId,
      projectId: onboardingFixture.projectA,
    },
    reasonCode: "RECOVERY_MATRIX",
    relatedRefs: [],
    actor: {
      kind: "SERVICE",
      principalId: onboardingFixture.serviceId,
      serviceKey: "project-onboarding-worker",
    },
    occurredAt: onboardingFixture.now,
    correlationId: onboardingFixture.correlationId,
    causationId: "causation-007-recovery",
  });

describe("Feature 007 aggregate recovery matrix", () => {
  it("accepts out-of-order events once, deduplicates replay and quarantines mismatched bytes", () => {
    const inbox = new ProjectEventInbox();
    const later = event("event-later", 2);
    const earlier = event("event-earlier", 1);
    expect([inbox.accept(later), inbox.accept(earlier), inbox.accept(later)]).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "DUPLICATE",
    ]);
    const mismatch = { ...later, payload: { ...later.payload, contentHash: testHash("mismatch") } };
    expect(inbox.accept(mismatch)).toBe("QUARANTINED_MISMATCH");
  });

  it("replays durable PostgreSQL recovery after a worker restart without duplicating repair", async () => {
    const repaired = new Set<string>();
    const repair = vi.fn(async (projectId: string) => {
      repaired.add(projectId);
    });
    const operations = {
      recoverStaleOperationalActions: async () => 1,
      expireStaleProbes: async () => 1,
      projectsNeedingProjectionRepair: async () =>
        repaired.has(onboardingFixture.projectA) ? [] : [onboardingFixture.projectA],
      repairProjection: repair,
      reauthorizePendingWork: async () => 1,
    };
    await new ProjectSuspensionRecoveryWorker(operations).run();
    await new ProjectSuspensionRecoveryWorker(operations).run();
    expect(repair).toHaveBeenCalledTimes(1);
  });
});

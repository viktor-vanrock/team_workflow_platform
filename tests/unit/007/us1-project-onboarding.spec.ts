import { describe, expect, it } from "vitest";

import {
  assertOnboardingTransition,
  createOnboardingRevision,
  createProjectRegistryRevision,
} from "../../../packages/platform-core/src/project-onboarding/model.ts";
import { InMemoryProjectOnboardingRepository } from "../../../packages/platform-persistence-typeorm/src/project-onboarding.repository.ts";
import { ProjectRegistrationService } from "../../../packages/runtime-composition/src/onboarding/project-registration-service.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

function onboarding(version: number, stage: "DRAFT" | "VALIDATING" | "NEEDS_FIX" | "SHADOW") {
  return createOnboardingRevision({
    revisionId: `onboarding-r${version}`,
    onboardingId: "onboarding",
    version,
    ...projectScope(),
    stage,
    qaCapabilityMode: "MANUAL_ONLY",
    operationalState: "ACTIVE",
    intendedCapabilityMode: "MANUAL_ONLY",
    projectRegistryRef: exactRef("registry"),
    ...(stage === "SHADOW"
      ? { bindingRef: exactRef("binding"), qaProjectContextRef: exactRef("context") }
      : {}),
    starterEntitlementSetHash: testHash("starter"),
    gateResultRefs: [],
    ownerSetHash: testHash("owners"),
    reasonCode: stage,
    reason: `Move to ${stage}`,
    actor: humanActor(),
    correlationId: onboardingFixture.correlationId,
    createdAt: onboardingFixture.now,
  });
}

describe("Feature 007 US1 Project lifecycle", () => {
  it("creates a stable immutable registry revision with canonical owners and classification", () => {
    const revision = createProjectRegistryRevision({
      revisionId: "registry-r1",
      version: 1,
      ...projectScope(),
      key: "project-a",
      name: "Project A",
      ownerIds: [onboardingFixture.qaLeadId, onboardingFixture.workspaceOwnerId],
      criticalityKey: "STANDARD",
      dataClassificationKey: "INTERNAL",
      verificationStatus: "CURRENT",
      reason: "Register",
      createdBy: humanActor(),
      createdAt: onboardingFixture.now,
    });
    expect(revision.ownerIds).toEqual([...revision.ownerIds].sort());
    expect(revision.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(revision)).toBe(true);
  });

  it("allows DRAFT→VALIDATING→NEEDS_FIX and DRAFT→VALIDATING→SHADOW only", () => {
    const draft = onboarding(1, "DRAFT");
    const validating = onboarding(2, "VALIDATING");
    expect(() => assertOnboardingTransition(draft, validating)).not.toThrow();
    expect(() => assertOnboardingTransition(validating, onboarding(3, "NEEDS_FIX"))).not.toThrow();
    expect(() => assertOnboardingTransition(validating, onboarding(3, "SHADOW"))).not.toThrow();
    expect(() => assertOnboardingTransition(draft, onboarding(2, "SHADOW"))).toThrow(
      "ONBOARDING_STAGE_TRANSITION_INVALID",
    );
  });

  it("registers the Project, registry/onboarding revisions, audit and outbox atomically with idempotency", async () => {
    const repository = new InMemoryProjectOnboardingRepository();
    const service = new ProjectRegistrationService(repository, {
      now: () => onboardingFixture.now,
      next: (kind) => `${onboardingFixture.projectA}-${kind}`,
    });
    const input = {
      idempotencyKey: "register-project-a",
      ...projectScope(),
      key: "project-a",
      name: "Project A",
      ownerIds: [onboardingFixture.workspaceOwnerId, onboardingFixture.qaLeadId],
      criticalityKey: "STANDARD",
      dataClassificationKey: "INTERNAL",
      starterEntitlementSetHash: testHash("starter"),
      actor: humanActor(),
      reason: "Register Project A",
      correlationId: onboardingFixture.correlationId,
    };
    const registered = await service.register(input);
    expect(registered).toMatchObject({
      replayed: false,
      registry: { version: 1 },
      onboarding: { version: 1, stage: "DRAFT" },
    });
    expect(repository.audit()).toHaveLength(1);
    expect(repository.outbox()).toHaveLength(1);
    await expect(service.register(input)).resolves.toMatchObject({
      replayed: true,
      projectId: onboardingFixture.projectA,
    });
    await expect(service.register({ ...input, name: "Changed" })).rejects.toThrow(
      "PROJECT_REGISTRATION_IDEMPOTENCY_CONFLICT",
    );
  });
});

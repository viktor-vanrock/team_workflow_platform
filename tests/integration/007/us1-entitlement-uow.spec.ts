import { describe, expect, it } from "vitest";

import { InMemoryProjectEntitlementRepository } from "../../../packages/platform-persistence-typeorm/src/project-entitlement.repository.ts";
import { ProjectEntitlementService } from "../../../packages/runtime-composition/src/onboarding/entitlement-service.ts";
import {
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US1 entitlement unit of work", () => {
  it("atomically grants, replaces and revokes with CAS, current projection and before/after audit", async () => {
    const repository = new InMemoryProjectEntitlementRepository();
    const service = new ProjectEntitlementService(repository);
    const base = {
      ...projectScope(),
      entitlementId: "entitlement",
      principalId: onboardingFixture.qaEngineerId,
      effect: "ALLOW" as const,
      classificationCeilingKey: "INTERNAL",
      validFrom: onboardingFixture.now,
      actor: humanActor(),
      reason: "starter",
      correlationId: onboardingFixture.correlationId,
      createdAt: onboardingFixture.now,
    };
    const granted = await service.change({
      ...base,
      idempotencyKey: "grant-1",
      expectedVersion: 0,
      operation: "GRANT",
      permissions: ["qa.session.read", "qa.session.start"],
    });
    expect(granted.audit.before).toBeUndefined();
    expect(granted.audit.after).toEqual(granted.revision);
    expect((await repository.current(projectScope(), "entitlement"))?.version).toBe(1);

    const replay = await service.change({
      ...base,
      idempotencyKey: "grant-1",
      expectedVersion: 0,
      operation: "GRANT",
      permissions: ["qa.session.read", "qa.session.start"],
    });
    expect(replay.replayed).toBe(true);
    await expect(
      service.change({
        ...base,
        idempotencyKey: "grant-1",
        expectedVersion: 0,
        operation: "GRANT",
        permissions: ["different"],
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");

    const replaced = await service.change({
      ...base,
      idempotencyKey: "replace-2",
      expectedVersion: 1,
      operation: "REPLACE",
      permissions: ["qa.session.read"],
    });
    expect(replaced.revision.version).toBe(2);
    const revoked = await service.change({
      ...base,
      idempotencyKey: "revoke-3",
      expectedVersion: 2,
      operation: "REVOKE",
      permissions: ["qa.session.read"],
      revokedAt: onboardingFixture.now,
    });
    expect(revoked.revision.version).toBe(3);
    expect(revoked.audit.before?.version).toBe(2);
  });
});

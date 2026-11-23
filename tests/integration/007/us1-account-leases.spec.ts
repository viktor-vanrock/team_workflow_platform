import { describe, expect, it } from "vitest";

import {
  InMemoryTestAccountLeaseStore,
  ManageTestAccountLease,
} from "../../../packages/competency-qa/src/application/manage-test-account-lease.ts";
import { TestAccountCredentialResolver } from "../../../packages/runtime-composition/src/qa/test-account-resolver.ts";
import {
  exactRef,
  onboardingFixture,
  projectScope,
  qaHumanActor,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US1 account leases", () => {
  it("acquires one active slot, resolves credentials only at runtime, and records release/expiry lineage", async () => {
    const store = new InMemoryTestAccountLeaseStore();
    const manager = new ManageTestAccountLease(store);
    const input = {
      leaseId: "lease",
      ...projectScope(),
      poolRef: exactRef("pool"),
      environmentRef: exactRef("environment"),
      subject: { kind: "SESSION" as const, id: "session" },
      leasedToPrincipalId: onboardingFixture.qaEngineerId,
      opaqueAccountRef: "account-slot-1",
      maximumLeaseDurationSeconds: 3600,
      requestedDurationSeconds: 1800,
      createdBy: qaHumanActor(),
      now: onboardingFixture.now,
    };
    const acquired = await manager.acquire(input);
    expect(acquired.state).toBe("ACTIVE");
    await expect(manager.acquire({ ...input, leaseId: "other" })).rejects.toThrow(
      "ACCOUNT_SLOT_ALREADY_LEASED",
    );

    const resolver = new TestAccountCredentialResolver({
      resolve: async (reference) =>
        reference === "account-slot-1"
          ? { username: "fixture", password: "runtime-only" }
          : undefined,
    });
    await expect(resolver.resolve(acquired, onboardingFixture.now)).resolves.toEqual({
      username: "fixture",
      password: "runtime-only",
    });
    expect(JSON.stringify(acquired)).not.toContain("runtime-only");

    const released = await manager.release({
      scope: projectScope(),
      leaseId: "lease",
      actor: qaHumanActor(),
      now: onboardingFixture.now,
      reasonCode: "SESSION_COMPLETE",
    });
    expect(released).toMatchObject({ version: 2, state: "RELEASED" });
    expect(store.audit().map(({ action }) => action)).toEqual(["LEASE_ACQUIRED", "LEASE_RELEASED"]);
  });

  it("expires elapsed leases and refuses resolution", async () => {
    const store = new InMemoryTestAccountLeaseStore();
    const manager = new ManageTestAccountLease(store);
    const lease = await manager.acquire({
      leaseId: "lease",
      ...projectScope(),
      poolRef: exactRef("pool"),
      environmentRef: exactRef("environment"),
      subject: { kind: "SESSION", id: "session" },
      leasedToPrincipalId: onboardingFixture.qaEngineerId,
      opaqueAccountRef: "slot",
      maximumLeaseDurationSeconds: 10,
      requestedDurationSeconds: 1,
      createdBy: qaHumanActor(),
      now: onboardingFixture.now,
    });
    const expired = await manager.expire(projectScope(), "2026-09-03T12:00:02.000Z");
    expect(expired[0]).toMatchObject({ leaseId: lease.leaseId, state: "EXPIRED", version: 2 });
  });
});

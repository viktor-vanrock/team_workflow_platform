import { describe, expect, it } from "vitest";

import {
  ConnectorBroker,
  type ConnectorEffectCommand,
} from "../../../packages/platform-core/src/commanding/connector-broker.ts";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  executeProjectEffect,
  StaticProjectEffectGuard,
} from "../../../packages/platform-core/src/commanding/project-effect-guard.ts";
import type {
  PilotEffectContext,
  PilotFenceSnapshot,
} from "../../../packages/platform-core/src/pilot/model.ts";
import {
  assertPilotWorkerEffect,
  PilotCommandEffectGuard,
  PilotEffectGuard,
} from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const ref = { id: "revision", version: 1, contentHash: hash };
const scope = { workspaceId: "w1", projectId: "p1" };
const context: PilotEffectContext = {
  principalId: "human1",
  purpose: "BUSINESS",
  deploymentRef: ref,
  cohortRef: ref,
  fenceRef: ref,
};
function fixture(withStartup = true) {
  let now = Date.parse("2026-09-03T08:00:00Z");
  let authorized = true;
  let effects = 0;
  let state: PilotFenceSnapshot = {
    ...scope,
    mode: "COHORT_WRITES",
    fenceRef: ref,
    deploymentRef: ref,
    cohortRef: ref,
    projectIds: ["p1"],
    principalIds: ["human1"],
    environment: "NON_PROD",
    startsAt: "2026-09-03T07:00:00Z",
    expiresAt: "2026-09-03T09:00:00Z",
    revoked: false,
    runtimeInstanceId: "runtime-1",
  };
  const guard = new PilotEffectGuard(
    new StaticProjectEffectGuard({ ...scope, operationalState: "ACTIVE", onboardingVersion: 1 }),
    { current: async () => state, authorize: async () => authorized },
    "runtime-1",
    () => now,
    withStartup ? { assertReady: async () => undefined } : undefined,
  );
  return {
    guard,
    patch: (patch: Partial<PilotFenceSnapshot>) => {
      state = { ...state, ...patch };
    },
    revoke: () => {
      authorized = false;
    },
    expire: () => {
      now += 3600000;
    },
    effects: () => effects,
    send: (ctx: PilotEffectContext | undefined = context) =>
      executeProjectEffect(guard, scope, 1, async () => ++effects, ctx),
  };
}

describe("008 dispatch fence", () => {
  it("denies non-production writes without current API/worker deployment agreement", async () => {
    const f = fixture(false);
    await expect(f.send()).rejects.toThrow("DEPLOYMENT_STARTUP_REQUIRED");
    expect(f.effects()).toBe(0);
  });
  it("rechecks the fence after asynchronous startup validation", async () => {
    let writes = 0;
    let mode: PilotFenceSnapshot["mode"] = "COHORT_WRITES";
    const guard = new PilotEffectGuard(
      new StaticProjectEffectGuard({ ...scope, operationalState: "ACTIVE", onboardingVersion: 1 }),
      {
        authorize: async () => true,
        current: async () => ({
          ...scope,
          mode,
          fenceRef: ref,
          deploymentRef: ref,
          cohortRef: ref,
          projectIds: [scope.projectId],
          principalIds: [context.principalId],
          environment: "NON_PROD",
          startsAt: "2026-09-03T07:00:00Z",
          expiresAt: "2026-09-03T09:00:00Z",
          revoked: false,
          runtimeInstanceId: "runtime-1",
        }),
      },
      "runtime-1",
      () => Date.parse("2026-09-03T08:00:00Z"),
      {
        assertReady: async () => {
          mode = "SHADOW";
        },
      },
    );
    await expect(
      executeProjectEffect(guard, scope, 1, async () => ++writes, context),
    ).rejects.toThrow("PILOT_EFFECT_FENCED");
    expect(writes).toBe(0);
  });
  it("requires immutable worker admission and rechecks the original pins on retries", async () => {
    const f = fixture();
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      ...scope,
      actor: { kind: "SERVICE" as const, principalId: "human1", serviceKey: "fixture" },
    };
    const guard = new PilotCommandEffectGuard(f.guard, async () => ({
      commandId: command.id,
      payloadHash: command.payloadHash,
      targetHash: command.targetHash,
      expectedOnboardingVersion: 1,
      context,
    }));
    await expect(assertPilotWorkerEffect(command, undefined, true)).rejects.toThrow(
      "PILOT_WORKER_GUARD_REQUIRED",
    );
    await assertPilotWorkerEffect(command, guard, true);
    await expect(
      assertPilotWorkerEffect({ ...command, payloadHash: "tampered" }, guard, true),
    ).rejects.toThrow("PILOT_COMMAND_ADMISSION_CONFLICT");
    f.revoke();
    await expect(assertPilotWorkerEffect(command, guard, true)).rejects.toThrow(
      "PILOT_ACCESS_REVOKED",
    );
  });
  it("rechecks the fence after asynchronous broker resolution and binds command actor", async () => {
    const f = fixture();
    let writes = 0;
    const broker = new ConnectorBroker(
      {
        resolve: async () => {
          f.patch({ mode: "SHADOW" });
          return {
            bindingRef: ref,
            profileRef: ref,
            connectionRef: ref,
            mappingRef: ref,
            connectorRef: { key: "fixture", version: "1" },
            classification: { key: "INTERNAL", rank: 10 },
            retired: false,
          };
        },
      },
      undefined,
      f.guard,
    );
    broker.register({
      connectorKey: "fixture",
      connectorVersion: "1",
      capabilityKey: "write",
      capabilityVersion: "1",
      operation: "post",
      handler: { invoke: async () => ++writes },
    });
    const command: ConnectorEffectCommand = {
      ...scope,
      id: "cmd",
      actor: { kind: "SERVICE", principalId: "human1", serviceKey: "fixture" },
      commandType: "write",
      capability: {
        key: "write",
        exactContractVersion: "1",
        operation: "post",
        logicalRole: "AUTHORITY",
      },
      target: {},
      payload: {},
      bindingRef: ref,
      profileRef: ref,
      effectIdempotencyKey: "one",
      dataClassificationKey: "INTERNAL",
      correlationId: "c",
      causationId: "c",
      initialAuthorizationBasis: {
        kind: "PROJECT",
        policyVersion: "1",
        membershipRef: ref,
        roleAssignmentRefs: [ref],
        entitlementRefs: [ref],
        skillContext: "NOT_APPLICABLE",
      },
      pilotContext: context,
    };
    await expect(broker.invoke(command)).rejects.toThrow("PILOT_EFFECT_FENCED");
    await expect(
      broker.invoke({ ...command, pilotContext: { ...context, principalId: "other" } }),
    ).rejects.toThrow("PILOT_ACTOR_CONFLICT");
    expect(writes).toBe(0);
  });
  it("rechecks current state after queue delay and each retry", async () => {
    const f = fixture();
    await f.send();
    f.expire();
    await expect(f.send()).rejects.toThrow("PILOT_WINDOW_CLOSED");
    expect(f.effects()).toBe(1);
  });
  it.each(["DENY", "SHADOW", "RECOVERY"] as const)("prevents actual writes in %s", async (mode) => {
    const f = fixture();
    f.patch({ mode });
    await expect(f.send()).rejects.toThrow("PILOT_EFFECT_FENCED");
    expect(f.effects()).toBe(0);
  });
  it("cannot release queued shadow writes or stale deployment/cohort pins", async () => {
    const f = fixture();
    await expect(f.send({ ...context, fenceRef: { ...ref, version: 0 } })).rejects.toThrow(
      "PILOT_PIN_CONFLICT",
    );
    f.patch({ cohortRef: { ...ref, version: 2 } });
    await expect(f.send()).rejects.toThrow("PILOT_PIN_CONFLICT");
    expect(f.effects()).toBe(0);
  });
  it("cohort only narrows current permissions and scope", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.send()).rejects.toThrow("PILOT_ACCESS_REVOKED");
    const other = fixture();
    other.patch({ projectIds: ["p2"] });
    await expect(other.send()).rejects.toThrow("PILOT_COHORT_DENIED");
    expect(f.effects() + other.effects()).toBe(0);
  });
  it("fences revoked and old runtime instances", async () => {
    for (const patch of [{ revoked: true }, { runtimeInstanceId: "restored-runtime" }]) {
      const f = fixture();
      f.patch(patch);
      await expect(f.send()).rejects.toThrow("PILOT_EFFECT_FENCED");
      expect(f.effects()).toBe(0);
    }
  });
  it("requires explicit sandbox purpose and rejects missing context", async () => {
    const f = fixture();
    f.patch({ mode: "SANDBOX_CONFORMANCE" });
    await expect(f.send()).rejects.toThrow("PILOT_PURPOSE_DENIED");
    await f.send({ ...context, purpose: "SANDBOX_CONFORMANCE" });
    await expect(f.guard.assertEffectsAllowed(scope)).rejects.toThrow("PILOT_CONTEXT_REQUIRED");
    expect(f.effects()).toBe(1);
  });
});

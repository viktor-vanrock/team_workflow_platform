import { describe, expect, it } from "vitest";

import {
  createExactApproval,
  decideApproval,
} from "../../packages/platform-core/src/approval/approval.ts";
import { consumeEffectAuthorization } from "../../packages/platform-core/src/approval/effect-authorization.ts";
import { InMemoryDurableCommandStore } from "../../packages/platform-core/src/commanding/connector-command.ts";
import { evaluateEffectGate } from "../../packages/platform-core/src/commanding/effect-gate.ts";
import {
  CommandWorker,
  DeterministicClock,
  InMemoryRecoverableQueue,
  OutboxDispatcher,
  RecoverySweeper,
  validateJobEnvelope,
} from "../../packages/platform-testkit/src/index.ts";

function approvedFixture() {
  return decideApproval(
    createExactApproval({
      id: "approval-a",
      workspaceId: "workspace-a",
      projectId: "project-a",
      initiatorId: "initiator-a",
      initiator: {
        kind: "SERVICE",
        principalId: "initiator-a",
        serviceKey: "test",
      },
      action: {
        actionKind: "EXTERNAL_COMMAND",
        actionId: "command-a",
        commandType: "sample.record.publish",
        capabilityKey: "sample.record",
        capabilityVersion: "1.0.0",
        operation: "record.publish",
      },
      target: { id: "record-a" },
      targetHash: "sha256:target",
      payloadHash: "sha256:payload",
      expectedState: { mode: "MUST_NOT_EXIST" },
      bindingRef: { id: "binding-a", version: 1 },
      profileRefs: [{ id: "profile-a", version: 1 }],
      requiredPermission: "connector.effect.approve",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
      effectIdempotencyKey: "effect-a",
      expiresAt: new Date("2030-01-01"),
      createdAt: new Date("2026-01-01"),
    }),
    {
      approverId: "approver-a",
      approverRole: "OWNER",
      authorizationBasisHash: "sha256:basis",
    },
  );
}

describe("T113 durable effect focused regression", () => {
  it("rejects tampered jobs before effect", () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    expect(() =>
      validateJobEnvelope(
        {
          schemaVersion: 1,
          commandId: command.id,
          workspaceId: "tampered",
          projectId: command.projectId,
          actor: command.actor,
          correlationId: command.correlationId,
          causationId: command.causationId,
          rowVersion: command.rowVersion,
        },
        command,
      ),
    ).toThrow("JOB_ENVELOPE_MISMATCH");
  });

  it("recovers crash after an idempotent effect", async () => {
    const clock = new DeterministicClock();
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    const effects = new Map<string, unknown>();
    await new OutboxDispatcher(store, queue, clock).dispatch();
    const worker = new CommandWorker(
      store,
      queue,
      {
        invoke: async (key) => {
          const value = effects.get(key) ?? { receipt: "stable" };
          effects.set(key, value);
          return value;
        },
      },
      clock,
    );
    await expect(worker.work({ crashAfterEffect: true })).rejects.toThrow("CRASH_AFTER_EFFECT");
    clock.advance(120_000);
    await new RecoverySweeper(store, queue, clock).sweep();
    await worker.work();
    expect(effects.size).toBe(1);
    expect(store.command().status).toBe("CONFIRMED");
  });

  it("arbitrates concurrent Approval and blocks NOT_REQUIRED drift", async () => {
    const approval = approvedFixture();
    const result = await Promise.allSettled([
      consumeEffectAuthorization(approval, {
        subjectHash: approval.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01"),
      }),
      consumeEffectAuthorization(approval, {
        subjectHash: approval.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01"),
      }),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);

    let calls = 0;
    expect(
      (
        await evaluateEffectGate({
          approvalMode: "NOT_REQUIRED",
          pinnedConfigurationHash: "sha256:old",
          liveConfigurationHash: "sha256:new",
          invoke: async () => {
            calls += 1;
          },
        })
      ).reasonCode,
    ).toBe("CONFIGURATION_DRIFT");
    expect(calls).toBe(0);
  });
});

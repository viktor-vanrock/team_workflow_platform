import { describe, expect, it } from "vitest";

import { CommandGateway } from "../../packages/platform-core/src/commanding/command-gateway.ts";
import { InMemoryCommandUnitOfWork } from "../../packages/platform-core/src/commanding/idempotency.ts";
import {
  DeterministicClock,
  DeterministicIdGenerator,
  workspaceContext,
} from "../../packages/platform-testkit/src/index.ts";

const intent = {
  clientRequestKey: "publish-1",
  commandType: "sample.record.publish",
  capability: {
    key: "sample.record",
    exactContractVersion: "1.0.0",
    operation: "record.publish",
    logicalRole: "PRIMARY",
  },
  target: { recordKey: "phase1-a" },
  payload: { title: "A" },
  expectedExternalState: { mode: "MUST_NOT_EXIST" as const },
  bindingRef: { id: "binding", version: 1 },
  profileRef: { id: "profile", version: 1 },
  dataClassificationKey: "INTERNAL",
  source: { intakeDraftId: "draft" },
};
const context = workspaceContext({
  authorizationBasis: {
    kind: "PROJECT",
    policyVersion: "policy@1",
    membershipRef: { id: "m", version: 1 },
    roleAssignmentRefs: [{ id: "r", version: 1 }],
    entitlementRefs: [{ id: "e", version: 1 }],
    skillContext: "NOT_APPLICABLE",
  },
});
describe("T082 Command Gateway transaction", () => {
  it("atomically deduplicates actor+scope+operation and rejects a conflicting hash", async () => {
    const store = new InMemoryCommandUnitOfWork();
    const gateway = new CommandGateway(
      store,
      new DeterministicClock(),
      new DeterministicIdGenerator(),
    );
    const first = await gateway.submit(context, intent);
    const replay = await gateway.submit(context, intent);
    expect(replay.command.id).toBe(first.command.id);
    expect(replay.replayed).toBe(true);
    await expect(
      gateway.submit(context, { ...intent, payload: { title: "changed" } }),
    ).rejects.toThrow("IDEMPOTENCY_KEY_CONFLICT");
    expect(store.snapshot()).toMatchObject({
      mutations: 1,
      commands: 1,
      idempotencyRecords: 1,
      auditEvents: 1,
      outboxRecords: 1,
    });
  });
  it("does not collapse the same client key across Projects", async () => {
    const store = new InMemoryCommandUnitOfWork();
    const gateway = new CommandGateway(
      store,
      new DeterministicClock(),
      new DeterministicIdGenerator(),
    );
    await gateway.submit(context, intent);
    await gateway.submit(
      workspaceContext({
        ...context,
        scope: {
          kind: "PROJECT",
          workspaceId: context.scope.workspaceId,
          projectId: "other-project",
        },
      }),
      intent,
    );
    expect(store.snapshot().commands).toBe(2);
  });
});

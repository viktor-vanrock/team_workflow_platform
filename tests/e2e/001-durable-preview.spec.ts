import { describe, expect, it } from "vitest";

import { MockHubService } from "../../apps/mock-hub/src/mock-hub.controller.ts";
import { InMemoryMockStateRepository } from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { createSampleRecordConnector } from "../../packages/connector-mock/src/sample-record.connector.ts";
import {
  CommandGateway,
  ConfirmOperationalCreate,
  ConnectorBroker,
  InMemoryCommandUnitOfWork,
  InMemoryDurableCommandStore,
} from "../../packages/platform-core/src/index.ts";
import {
  CommandWorker,
  DeterministicClock,
  DeterministicIdGenerator,
  InMemoryRecoverableQueue,
  OutboxDispatcher,
  workspaceContext,
} from "../../packages/platform-testkit/src/index.ts";

describe("T114 durable vertical preview", () => {
  it("runs Dummy intent through the typed Connector and pinned confirmation once", async () => {
    const clock = new DeterministicClock();
    const gateway = new CommandGateway(
      new InMemoryCommandUnitOfWork(),
      clock,
      new DeterministicIdGenerator(),
    );
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
    const submitted = await gateway.submit(context, {
      clientRequestKey: "preview",
      commandType: "sample.record.publish",
      capability: {
        key: "sample.record",
        exactContractVersion: "1.0.0",
        operation: "record.publish",
        logicalRole: "PRIMARY",
      },
      target: { id: "phase1-preview" },
      payload: { message: "hello" },
      expectedExternalState: { mode: "MUST_NOT_EXIST" },
      bindingRef: { id: "binding", version: 3 },
      profileRef: { id: "profile", version: 7 },
      dataClassificationKey: "INTERNAL",
      source: { intakeDraftId: "draft" },
    });
    const durable = new InMemoryDurableCommandStore(submitted.command);
    const queue = new InMemoryRecoverableQueue();
    const mockRepository = new InMemoryMockStateRepository();
    const hub = new MockHubService(mockRepository);
    const connector = createSampleRecordConnector(hub);
    let resolvedChain = false;
    const broker = new ConnectorBroker({
      resolve: async (command) => {
        resolvedChain = true;
        return {
          bindingRef: command.bindingRef,
          profileRef: command.profileRef,
          connectionRef: { id: "connection", version: 5 },
          mappingRef: { id: "mapping", version: 2 },
          connectorRef: { key: connector.key, version: connector.version },
          classification: { key: "INTERNAL", rank: 20 },
          retired: false,
        };
      },
    });
    const operation = connector.operations.publishSampleRecord;
    broker.register({
      connectorKey: connector.key,
      connectorVersion: connector.version,
      capabilityKey: operation.capabilityKey,
      capabilityVersion: operation.exactContractVersion,
      operation: operation.operation,
      handler: operation.handler,
    });

    await new OutboxDispatcher(durable, queue, clock).dispatch();
    await new CommandWorker(
      durable,
      queue,
      {
        invoke: async (effectIdempotencyKey, command) => {
          expect(effectIdempotencyKey).toBe(submitted.command.effectIdempotencyKey);
          expect(command.id).toBe(submitted.command.id);
          return await broker.invoke(durable.command());
        },
      },
      clock,
    ).work();

    const confirmations: unknown[] = [];
    const confirmation = new ConfirmOperationalCreate(
      {
        confirm: async (work) => await work({ transactionId: "preview", native: {} }),
      },
      new Map([
        [
          "dummy",
          {
            componentRef: "dummy",
            confirm: async (_transaction, input) => {
              confirmations.push(input);
            },
          },
        ],
      ]),
    );
    await confirmation.confirm("dummy", {
      workspaceId: submitted.command.workspaceId,
      projectId: submitted.command.projectId,
      commandId: submitted.command.id,
      result: durable.command().terminalResult,
      workItemId: "work-item",
      sourceDraftId: "draft",
      bindingRef: submitted.command.bindingRef,
      profileRef: submitted.command.profileRef,
    });

    expect(resolvedChain).toBe(true);
    expect((await mockRepository.effects())[0]?.effectCount).toBe(1);
    expect(confirmations[0]).toMatchObject({
      workItemId: "work-item",
      bindingRef: { version: 3 },
      profileRef: { version: 7 },
    });
    expect(durable.command()).toMatchObject({
      status: "CONFIRMED",
      bindingRef: { version: 3 },
      profileRef: { version: 7 },
    });
  });
});

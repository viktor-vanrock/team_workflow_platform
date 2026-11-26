import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { TypeOrmCommandDeliveryStore } from "../../../packages/platform-persistence-typeorm/src/command-delivery.store.ts";
import { createCorporateMattermostWorkerSteps } from "../../../packages/runtime-composition/src/mattermost/corporate-worker.ts";
import { DurableMattermostNotificationLifecycle } from "../../../packages/runtime-composition/src/mattermost/notification-worker.ts";

afterEach(() => vi.restoreAllMocks());
describe("corporate Mattermost worker", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  it("rejects missing actor authorization and non-dev profiles", () => {
    const source = { isInitialized: true };
    expect(() => createCorporateMattermostWorkerSteps({ source, environment } as never)).toThrow(
      "CORPORATE_MATTERMOST_WORKER_REQUIRED",
    );
    expect(() =>
      createCorporateMattermostWorkerSteps({
        source,
        environment: { ...environment, environmentScope: "PLATFORM_PROD" },
        authority: { revalidate: vi.fn() },
      } as never),
    ).toThrow("CORPORATE_MATTERMOST_WORKER_REQUIRED");
  });
  it("does not dispatch or send after authorization is revoked", async () => {
    const fixture = InMemoryDurableCommandStore.readyFixture().command();
    const command = {
      ...fixture,
      workspaceId: "workspace",
      projectId: "project",
      capability: {
        ...fixture.capability,
        key: "messaging.notify",
        operation: "notification.send",
        exactContractVersion: "1.0.0",
      },
    };
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "claim").mockResolvedValue([
      { outbox: {} },
    ] as never);
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "acknowledgeEnqueued").mockResolvedValue(
      command,
    );
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "load").mockResolvedValue(command);
    vi.spyOn(DurableMattermostNotificationLifecycle.prototype, "denial").mockResolvedValue(
      undefined,
    );
    const dispatched = vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "markDispatched");
    const factories = { mattermost: vi.fn() };
    const worker = createCorporateMattermostWorkerSteps({
      source: { isInitialized: true, manager: {} },
      environment,
      factories,
      grants: [],
      commands: { guard: { assertCommandAllowed: vi.fn() } },
      authority: {
        revalidate: async () => {
          throw new Error("REVOKED");
        },
      },
      templates: { verify: async () => false },
    } as never);
    await worker.dispatcher.run();
    await worker.commands.run();
    expect(dispatched).not.toHaveBeenCalled();
    expect(factories.mattermost).not.toHaveBeenCalled();
  });
  it("marks an uncertain send ambiguous without issuing a second post", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      workspaceId: "workspace",
      projectId: "project",
      recoveryPolicy: "NONE_AMBIGUOUS" as const,
      effectInvocationStartedAt: new Date("2026-01-01T00:00:00Z"),
      executionLeaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
      attemptCount: 2,
    };
    const source = {
      isInitialized: true,
      query: vi.fn(async () => [
        { workspace_id: "workspace", project_id: "project", id: command.id },
      ]),
    };
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "recoverExpired").mockResolvedValue([]);
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "load").mockResolvedValue(command);
    const fail = vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "fail").mockResolvedValue(command);
    const factories = { mattermost: vi.fn() };
    const worker = createCorporateMattermostWorkerSteps({
      source,
      environment,
      factories,
      grants: [],
      commands: {},
      authority: { revalidate: vi.fn() },
      templates: { verify: async () => false },
    } as never);
    expect(await worker.recovery.run()).toBe(1);
    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      "MATTERMOST_DELIVERY_AMBIGUOUS_LOOKUP_UNSUPPORTED",
      expect.any(Date),
      expect.any(Function),
    );
    expect(factories.mattermost).not.toHaveBeenCalled();
  });
  it("leaves lookup-required commands pending without a provider lookup", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      recoveryPolicy: "LOOKUP_REQUIRED" as const,
      effectInvocationStartedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const source = {
      isInitialized: true,
      query: vi.fn(async () => [
        { workspace_id: "workspace", project_id: "project", id: command.id },
      ]),
    };
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "recoverExpired").mockResolvedValue([]);
    vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "load").mockResolvedValue(command);
    const fail = vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "fail");
    const worker = createCorporateMattermostWorkerSteps({
      source,
      environment,
      grants: [],
      factories: {},
      commands: {},
      authority: { revalidate: vi.fn() },
      templates: { verify: async () => false },
    } as never);
    expect(await worker.recovery.run()).toBe(0);
    expect(fail).not.toHaveBeenCalled();
  });
});

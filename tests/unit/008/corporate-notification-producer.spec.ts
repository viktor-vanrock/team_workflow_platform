import { describe, expect, it, vi } from "vitest";
import { createCorporateQaNotificationProducer } from "../../../packages/runtime-composition/src/mattermost/corporate-notification-producer.ts";

describe("corporate notification producer", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  it("requires a live pilot guard and the non-production deployment", () => {
    expect(() =>
      createCorporateQaNotificationProducer({
        source: { isInitialized: true },
        environment,
        guard: {},
      } as never),
    ).toThrow("CORPORATE_NOTIFICATION_PRODUCER_REQUIRED");
  });
  it("scans only deployment projects and does nothing with an empty inbox", async () => {
    const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => []);
    const source = {
      isInitialized: true,
      transaction: async (_level: string, work: (manager: unknown) => Promise<unknown>) =>
        await work({ query }),
    };
    const producer = createCorporateQaNotificationProducer({
      source,
      environment,
      grants: [],
      guard: { assertCommandAllowed: vi.fn() },
    } as never);
    expect(await producer.run()).toBe(0);
    expect(query.mock.calls[0]?.[0]).toContain("e.project_id=ANY($2::uuid[])");
    expect(query.mock.calls[0]?.[1]).toEqual(["workspace", ["project"]]);
  });
  it("rejects a forged event before looking up recipients or creating a command", async () => {
    const query = vi.fn(async () => [
      {
        id: "event",
        workspace_id: "workspace",
        project_id: "project",
        envelope_hash: "forged",
        envelope: {
          workspaceId: "workspace",
          projectId: "project",
          eventType: "qa.request.accepted",
          payload: { workItemId: "work" },
        },
      },
    ]);
    const source = {
      isInitialized: true,
      transaction: async (_level: string, work: (manager: unknown) => Promise<unknown>) =>
        await work({ query }),
    };
    const producer = createCorporateQaNotificationProducer({
      source,
      environment,
      grants: [],
      guard: { assertCommandAllowed: vi.fn() },
    } as never);
    await expect(producer.run()).rejects.toThrow("CORPORATE_NOTIFICATION_EVENT_INVALID");
    expect(query).toHaveBeenCalledTimes(1);
  });
});

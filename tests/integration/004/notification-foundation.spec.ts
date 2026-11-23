import { describe, expect, it } from "vitest";

import { InMemoryNotificationUnitOfWork } from "../../../packages/platform-persistence-typeorm/src/agent-notification-unit-of-work.ts";

describe("Notification foundation", () =>
  it("creates one branch/command/action set and zero effects on denial", async () => {
    const uow = new InMemoryNotificationUnitOfWork();
    expect(
      await uow.project({ allowed: false, dedupeKey: "denied", actionIntentIds: [] }),
    ).toMatchObject({ denied: true, notificationIntentId: undefined });
    const accepted = await uow.project({
      allowed: true,
      dedupeKey: "one",
      actionIntentIds: ["a", "b", "c"],
    });
    expect(accepted).toMatchObject({ denied: false, actionCount: 3 });
    expect(
      await uow.project({ allowed: true, dedupeKey: "one", actionIntentIds: ["a", "b", "c"] }),
    ).toEqual(accepted);
  }));

import { describe, expect, it } from "vitest";

import { NotificationIntentAggregate } from "../../../../packages/platform-core/src/index.ts";
import { MattermostNotificationWorker } from "../../../../packages/runtime-composition/src/index.ts";

const subject = () =>
  NotificationIntentAggregate.create({
    id: "n",
    workspaceId: "w",
    projectId: "p",
    dedupeKey: "effect",
    sourceEventRef: "event",
    target: { kind: "PROJECT_CHANNEL", purpose: "QA_COORDINATION" },
    payload: {},
    render: "render",
    commandId: "command",
    expiresAt: new Date("2026-09-03"),
  }).snapshot();
describe("US4 no blind resend", () => {
  it.each(["RATE_LIMIT_429", "SERVER_500", "TIMEOUT_AFTER_EFFECT", "NETWORK_LOSS"])(
    "issues no second POST after %s",
    async (code) => {
      let calls = 0;
      const worker = new MattermostNotificationWorker(
        {
          send: async () => {
            calls += 1;
            throw new Error(code);
          },
        },
        { materialize: () => ({ bytes: new Uint8Array([1]), purge: () => undefined }) },
      );
      const uncertain = await worker.deliver(subject(), new Date("2026-09-01"));
      expect(uncertain.state).toBe("LOOKUP_REQUIRED");
      await expect(worker.deliver(uncertain, new Date("2026-09-01"))).rejects.toThrow(
        "NOTIFICATION_NOT_QUEUED",
      );
      expect(calls).toBe(1);
    },
  );
});

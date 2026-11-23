import { describe, expect, it, vi } from "vitest";

import {
  InMemoryExternalInteractionReceiptRepository,
  InMemoryInteractionIntentRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { MattermostIngressService } from "../../../packages/runtime-composition/src/index.ts";

describe("US1 callback concurrency", () => {
  it("claims one normalized receipt and replays acknowledgement", async () => {
    const receipts = new InMemoryExternalInteractionReceiptRepository();
    const dispatch = vi.fn(async () => {});
    const service = new MattermostIngressService(receipts, { dispatch }, async (connectionId) => ({
      workspaceId: "w",
      projectId: "p",
      connectionId,
    }));
    const body = {
      state: "opaque-intent-token-123456",
      callback_id: "draft",
      user_id: "mm-u",
      team_id: "team",
      channel_id: "channel",
      submission: { title: "Checkout" },
    };
    const raw = Buffer.from(JSON.stringify(body));
    const input = {
      connectionId: "c",
      kind: "DIALOG_SUBMISSION" as const,
      body,
      rawBytes: raw,
      headers: {},
      receivedAt: new Date("2026-09-01"),
    };
    expect(await Promise.all([service.accept(input), service.accept(input)])).toEqual([
      { type: "ok" },
      { type: "ok" },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it("does not consume an intent for the wrong actor and replays exact result", async () => {
    const intents = new InMemoryInteractionIntentRepository();
    await intents.issue({
      id: "i",
      workspaceId: "w",
      projectId: "p",
      actorPrincipalId: "u",
      expiresAt: new Date("2026-09-02"),
    });
    await expect(
      intents.consume("w", "p", "i", "attacker", "result", new Date("2026-09-01")),
    ).rejects.toThrow("INTERACTION_ACTOR_MISMATCH");
    expect(
      await intents.consume("w", "p", "i", "u", "result", new Date("2026-09-01")),
    ).toMatchObject({ replayed: false });
    expect(
      await intents.consume("w", "p", "i", "u", "result", new Date("2026-09-01")),
    ).toMatchObject({ replayed: true });
  });
});

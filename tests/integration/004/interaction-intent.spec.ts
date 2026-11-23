import { describe, expect, it } from "vitest";

import { InMemoryInteractionIntentRepository } from "../../../packages/platform-persistence-typeorm/src/interaction-intent.repository.ts";

describe("InteractionIntent repository", () =>
  it("atomically returns one stable result", async () => {
    const repository = new InMemoryInteractionIntentRepository();
    await repository.issue({
      id: "i",
      workspaceId: "w",
      projectId: "p",
      actorPrincipalId: "u",
      expiresAt: new Date("2026-09-02"),
    });
    expect(
      await repository.consume("w", "p", "i", "u", "result", new Date("2026-09-01")),
    ).toMatchObject({ replayed: false });
    expect(
      await repository.consume("w", "p", "i", "u", "result", new Date("2026-09-01")),
    ).toMatchObject({ replayed: true });
  }));

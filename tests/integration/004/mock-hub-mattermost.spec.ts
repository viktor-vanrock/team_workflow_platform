import { describe, expect, it } from "vitest";

import { InMemoryMattermostRepository } from "../../../apps/mock-hub/src/mattermost/state/mattermost.repository.ts";

describe("Mock Hub Mattermost faults", () =>
  it("persists an effect once across a simulated restart", () => {
    const repository = InMemoryMattermostRepository.seeded();
    repository.setFault("TIMEOUT_AFTER_EFFECT");
    expect(() =>
      repository.createPost({
        effectKey: "e",
        channelId: "mm-channel-project-alpha",
        message: "safe",
      }),
    ).toThrow(/TIMEOUT/u);
    const restarted = repository.restart();
    expect(restarted.lookupEffect("e")).toHaveLength(1);
    expect(() =>
      restarted.createPost({
        effectKey: "e",
        channelId: "mm-channel-project-alpha",
        message: "safe",
      }),
    ).toThrow(/DUPLICATE/u);
  }));

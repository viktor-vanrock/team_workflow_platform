import { describe, expect, it } from "vitest";

import { InMemoryMattermostRepository } from "../../../apps/mock-hub/src/mattermost/state/mattermost.repository.ts";
import { classifyMattermostReconciliation } from "../../../packages/connector-mattermost/src/index.ts";
import { IntakeCandidateAggregate } from "../../../packages/platform-core/src/index.ts";

describe("004 concurrency and crash recovery", () => {
  it("converges concurrent callbacks/source drift while delivery remains lookup-only", async () => {
    const candidate = IntakeCandidateAggregate.discover({
      id: "c",
      workspaceId: "w",
      projectId: "p",
      deduplicationKey: "jira:1",
      currentSourceFingerprint: "v1",
      expiresAt: new Date("2026-09-03"),
    });
    const observations = await Promise.all(
      Array.from({ length: 8 }, async () => candidate.observe("v2", 1)),
    );
    expect(observations.filter(({ appended }) => appended)).toHaveLength(1);
    const hub = InMemoryMattermostRepository.seeded();
    hub.setFault("TIMEOUT_AFTER_EFFECT");
    expect(() =>
      hub.createPost({
        effectKey: "effect",
        channelId: "mm-channel-project-alpha",
        message: "one",
      }),
    ).toThrow("TIMEOUT_AFTER_EFFECT");
    const restarted = hub.restart();
    expect(
      classifyMattermostReconciliation({
        supported: true,
        matches: restarted
          .lookupEffect("effect")
          .map(({ id }) => ({ kind: "MESSAGE", opaqueId: id })),
      }),
    ).toMatchObject({ outcome: "DELIVERED" });
    expect(() =>
      restarted.createPost({
        effectKey: "effect",
        channelId: "mm-channel-project-alpha",
        message: "two",
      }),
    ).toThrow("DUPLICATE_EFFECT");
  });
});

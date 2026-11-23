import { describe, expect, it } from "vitest";

import { InteractionIntentAggregate } from "../../../packages/platform-core/src/interactions/interaction-intent.ts";

describe("InteractionIntent single-use lifecycle", () => {
  it("consumes once, replays the stable result and leaves wrong-actor attempts pending", () => {
    const intent = InteractionIntentAggregate.issue({
      id: "i1",
      workspaceId: "w",
      projectId: "p",
      actorPrincipalId: "u",
      action: { kind: "CANDIDATE_CREATE", parameters: {} },
      subject: { kind: "CANDIDATE", id: "c", version: 1, contentHash: "sha256:x" },
      transport: { kind: "MATTERMOST", target: { kind: "PRINCIPAL_DM", principalId: "u" } },
      expiresAt: new Date("2026-09-02T00:00:00Z"),
    });
    expect(() => intent.consume("foreign", "r0", new Date("2026-09-01T00:00:00Z"))).toThrow(
      /ACTOR/u,
    );
    expect(intent.snapshot().status).toBe("PENDING");
    expect(intent.consume("u", "r1", new Date("2026-09-01T00:00:00Z"))).toMatchObject({
      replayed: false,
      resultRef: "r1",
    });
    expect(intent.consume("u", "r1", new Date("2026-09-01T00:01:00Z"))).toMatchObject({
      replayed: true,
      resultRef: "r1",
    });
  });
});

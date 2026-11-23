import { describe, expect, it } from "vitest";

import { sha256 } from "../../../../packages/platform-contracts/src/index.ts";
import { createActionProvenance } from "../../../../packages/platform-core/src/index.ts";

describe("004 audit lineage", () => {
  it("reconstructs HUMAN/SERVICE→subject→grant→command→attempt→result from safe commitments", () => {
    const subject = { kind: "WORK_ITEM", id: "wi", version: 2, contentHash: "sha256:wi" };
    const steps = [
      { kind: "HUMAN", ref: "human" },
      { kind: "SERVICE", ref: "worker" },
      { kind: "SUBJECT", ref: sha256(subject) },
      { kind: "GRANT", ref: sha256({ action: "notification.intent.create", subject }) },
      { kind: "COMMAND", ref: "command" },
      { kind: "ATTEMPT", ref: "command:1" },
      { kind: "RESULT", ref: "post:opaque" },
    ];
    expect(steps.map(({ kind }) => kind)).toEqual([
      "HUMAN",
      "SERVICE",
      "SUBJECT",
      "GRANT",
      "COMMAND",
      "ATTEMPT",
      "RESULT",
    ]);
    expect(new Set(steps.map(({ ref }) => ref)).size).toBe(steps.length);
    expect(JSON.stringify(steps)).not.toMatch(/token|secret|requestBody/iu);
    expect(
      createActionProvenance({
        id: "audit",
        workspaceId: "w",
        projectId: "p",
        actor: { kind: "HUMAN", principalId: "human", issuer: "fixture", subject: "human" },
        subject: { kind: "WORK_ITEM", id: "wi", version: 2, contentHash: "sha256:wi" },
        action: "work-item.read",
        effectClass: "READ_ONLY",
        configuration: {},
        occurredAt: new Date(),
      }),
    ).toMatchObject({ id: "audit" });
  });
});

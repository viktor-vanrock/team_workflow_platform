import { describe, expect, it } from "vitest";

import { createActionProvenance } from "../../../packages/platform-core/src/audit/action-provenance.ts";

describe("ActionProvenance", () => {
  const base = {
    id: "a1",
    workspaceId: "w1",
    projectId: "p1",
    actor: { kind: "HUMAN" as const, principalId: "u1", issuer: "idp", subject: "u1" },
    subject: { kind: "DRAFT" as const, id: "d1", version: 1, contentHash: "sha256:x" },
    effectClass: "DRAFT_MUTATION" as const,
    configuration: { kind: "DRAFT" as const, draftRevisionId: "r1" },
    action: "draft.revise",
    occurredAt: new Date("2026-09-01T00:00:00Z"),
  };
  it("accepts a closed HUMAN draft mutation", () =>
    expect(createActionProvenance(base)).toMatchObject({
      id: "a1",
      effectClass: "DRAFT_MUTATION",
    }));
  it("rejects SERVICE acting as a HUMAN draft mutator", () =>
    expect(() =>
      createActionProvenance({
        ...base,
        actor: { kind: "SERVICE", principalId: "s1", serviceKey: "hermes" },
      }),
    ).toThrow(/ACTOR/u));
});

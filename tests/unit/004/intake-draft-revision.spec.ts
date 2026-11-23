import { describe, expect, it } from "vitest";

import { IntakeDraftRevisionAggregate } from "../../../packages/platform-core/src/index.ts";

describe("Intake Draft revisions", () => {
  it("appends contiguous CAS revisions and confirms only the exact ready snapshot", () => {
    const draft = IntakeDraftRevisionAggregate.create({
      id: "d",
      workspaceId: "w",
      projectId: "p",
      revisionId: "r1",
      content: {
        schemaVersion: 1,
        title: "T",
        requestKind: "smoke",
        requestedClassificationKey: "INTERNAL",
      },
      createdBy: "u",
      createdAt: new Date("2026-09-01"),
    });
    const first = draft.snapshot();
    draft.validate(1, true);
    expect(draft.confirm("HUMAN", 1, first.current.contentHash).confirmationRevision).toBe(1);
    expect(() =>
      draft.append({
        revisionId: "r2",
        content: { ...first.current.content, goal: "G" },
        createdBy: "u",
        createdAt: new Date("2026-09-02"),
        expectedRowVersion: 1,
        expectedContentHash: first.current.contentHash,
      }),
    ).toThrow(/CAS/u);
  });
});

import { describe, expect, it } from "vitest";

import { IntakeDraftRevisionAggregate } from "../../../packages/platform-core/src/index.ts";

describe("US1 draft revision CAS", () =>
  it("appends immutable revisions and rejects stale suggestions", () => {
    const aggregate = IntakeDraftRevisionAggregate.create({
      id: "d",
      workspaceId: "w",
      projectId: "p",
      revisionId: "r1",
      content: { schemaVersion: 1 },
      createdBy: "u",
      createdAt: new Date("2026-09-01"),
    });
    const current = aggregate.snapshot();
    const next = aggregate.append({
      revisionId: "r2",
      content: { schemaVersion: 1, title: "Checkout" },
      createdBy: "u",
      createdAt: new Date("2026-09-01"),
      expectedRowVersion: 1,
      expectedContentHash: current.current.contentHash,
    });
    expect(next).toMatchObject({
      revision: 2,
      previousRevisionId: "r1",
      previousContentHash: current.current.contentHash,
    });
    expect(() =>
      aggregate.append({
        revisionId: "r3",
        content: { schemaVersion: 1, title: "stale" },
        createdBy: "u",
        createdAt: new Date(),
        expectedRowVersion: 1,
        expectedContentHash: current.current.contentHash,
      }),
    ).toThrow("DRAFT_REVISION_CAS_CONFLICT");
  }));

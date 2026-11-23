import { describe, expect, it } from "vitest";

import { IntakeDraftRevisionAggregate } from "../../../packages/platform-core/src/index.ts";

describe("US1 exact confirmation", () =>
  it("pins one HUMAN revision and refuses a second mutation", () => {
    const aggregate = IntakeDraftRevisionAggregate.create({
      id: "d",
      workspaceId: "w",
      projectId: "p",
      revisionId: "r1",
      content: {
        schemaVersion: 1,
        title: "Checkout",
        requestKind: "smoke",
        requestedClassificationKey: "INTERNAL",
      },
      createdBy: "u",
      createdAt: new Date("2026-09-01"),
    });
    const ready = aggregate.validate(1, true);
    const confirmed = aggregate.confirm("HUMAN", 1, ready.current.contentHash);
    expect(confirmed).toMatchObject({ state: "CONFIRMED", confirmationRevision: 1 });
    expect(() => aggregate.confirm("HUMAN", 1, ready.current.contentHash)).toThrow(
      "DRAFT_CONFIRM_SNAPSHOT_CONFLICT",
    );
  }));

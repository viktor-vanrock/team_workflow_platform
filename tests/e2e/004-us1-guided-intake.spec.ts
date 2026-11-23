import { describe, expect, it } from "vitest";

import { IntakeDraftRevisionAggregate } from "../../packages/platform-core/src/index.ts";
import {
  MattermostBootstrapAdapter,
  ProjectSelectionService,
} from "../../packages/runtime-composition/src/index.ts";

describe("US1 guided intake journey", () =>
  it("runs bootstrap, selection, revision and exact confirmation", async () => {
    expect(
      new MattermostBootstrapAdapter("https://workspace.local/intake").respond({
        command: "/awp",
        text: "create",
      }).response_type,
    ).toBe("ephemeral");
    const selection = new ProjectSelectionService(
      {
        options: async () => [
          {
            workspaceId: "w",
            projectId: "p",
            workspaceLabel: "W",
            projectLabel: "P",
            configurationHash: "h",
          },
        ],
        reauthorize: async () => true,
      },
      () => new Date("2026-09-01"),
    );
    const option = (await selection.issue("u", "session")).items[0]!;
    let aggregate: IntakeDraftRevisionAggregate | undefined;
    await selection.consume({
      principalId: "u",
      oidcSessionId: "session",
      ...option,
      requestKey: "guided-intake-request",
      createDraft: async () => {
        aggregate = IntakeDraftRevisionAggregate.create({
          id: "d",
          workspaceId: "w",
          projectId: "p",
          revisionId: "r1",
          content: { schemaVersion: 1 },
          createdBy: "u",
          createdAt: new Date("2026-09-01"),
        });
        return { id: "d", resultRef: "draft:d:revision:1" };
      },
    });
    const before = aggregate!.snapshot();
    aggregate!.append({
      revisionId: "r2",
      content: {
        schemaVersion: 1,
        title: "Checkout",
        requestKind: "smoke",
        requestedClassificationKey: "INTERNAL",
      },
      createdBy: "u",
      createdAt: new Date("2026-09-01"),
      expectedRowVersion: 1,
      expectedContentHash: before.current.contentHash,
    });
    const ready = aggregate!.validate(2, true);
    expect(aggregate!.confirm("HUMAN", 2, ready.current.contentHash).state).toBe("CONFIRMED");
  }));

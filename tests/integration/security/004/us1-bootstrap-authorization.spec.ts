import { describe, expect, it } from "vitest";

import {
  MattermostBootstrapAdapter,
  ProjectSelectionService,
} from "../../../../packages/runtime-composition/src/index.ts";

describe("US1 bootstrap authorization", () => {
  it("rejects forged and oversized bootstrap shapes without state", () => {
    const adapter = new MattermostBootstrapAdapter("https://workspace.example/intake", 64);
    expect(() => adapter.respond({ command: "/awp", text: "create", projectId: "forged" })).toThrow(
      "MATTERMOST_BOOTSTRAP",
    );
    expect(() =>
      adapter.respond({ command: "/awp", text: "create", user_id: "x".repeat(100) }),
    ).toThrow("MATTERMOST_BOOTSTRAP_TOO_LARGE");
  });
  it("does not enumerate projects and rejects revoked authorization", async () => {
    let allowed = true;
    const service = new ProjectSelectionService(
      {
        options: async () =>
          allowed
            ? [
                {
                  workspaceId: "w",
                  projectId: "p",
                  workspaceLabel: "W",
                  projectLabel: "P",
                  configurationHash: "h",
                },
              ]
            : [],
        reauthorize: async () => allowed,
      },
      () => new Date("2026-09-01"),
    );
    const issued = await service.issue("u", "s");
    allowed = false;
    await expect(
      service.consume({
        principalId: "u",
        oidcSessionId: "s",
        ...issued.items[0]!,
        requestKey: "request-key-00001",
        createDraft: async () => ({ id: "d", resultRef: "draft:d:revision:1" }),
      }),
    ).rejects.toThrow("PROJECT_SELECTION_REAUTHORIZATION_DENIED");
    expect((await service.issue("u", "s")).items).toEqual([]);
  });
});

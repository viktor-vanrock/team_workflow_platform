import { describe, expect, it } from "vitest";

import {
  MattermostBootstrapAdapter,
  ProjectSelectionService,
} from "../../../packages/runtime-composition/src/index.ts";

describe("US1 bootstrap and selection contracts", () => {
  it("returns one byte-stable authority-free acknowledgement", () => {
    const adapter = new MattermostBootstrapAdapter(
      "https://workspace.example/qa/mattermost-intake",
    );
    const a = adapter.respond({ command: "/awp", text: "create", user_id: "ignored" });
    const b = adapter.respond({ command: "/awp", text: "create", user_id: "different" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual({
      response_type: "ephemeral",
      text: "https://workspace.example/qa/mattermost-intake",
    });
  });
  it("returns only server-authorized project labels and opaque option tokens", async () => {
    const service = new ProjectSelectionService(
      {
        options: async () => [
          {
            workspaceId: "w",
            projectId: "p",
            workspaceLabel: "Workspace",
            projectLabel: "Project",
            configurationHash: "sha256:a",
          },
        ],
        reauthorize: async () => true,
      },
      () => new Date("2026-09-01T00:00:00Z"),
    );
    const result = await service.issue("principal", "oidc-session");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ workspaceLabel: "Workspace", projectLabel: "Project" });
    expect(result.items[0]!.intentToken.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify(result)).not.toContain("configurationHash");
  });
});

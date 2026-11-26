import { describe, expect, it, vi } from "vitest";

import { createCorporateJiraCreateObservationAuthority } from "../../../packages/runtime-composition/src/jira/corporate-create-observation.ts";

describe("corporate Jira create observation", () => {
  it("rejects a missing exact project grant before reading Jira", async () => {
    const jira = vi.fn();
    const authority = createCorporateJiraCreateObservationAuthority({
      grants: [],
      factories: { jira },
    } as never);
    const command = { workspaceId: "workspace", projectId: "project" };
    const pins = {
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
      connectionRef: { id: "connection", version: 1 },
    };
    await expect(
      authority.read(command as never, pins as never, { externalEntityId: "100" } as never),
    ).rejects.toThrow("CORPORATE_JIRA_CREATE_BINDING_REQUIRED");
    expect(jira).not.toHaveBeenCalled();
  });
});

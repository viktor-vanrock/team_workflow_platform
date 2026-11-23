import { expect, it } from "vitest";

import { canVisit, sections } from "../../../apps/web/src/workspace/navigation.ts";

it("service identities have diagnostics instead of human QA navigation", () => {
  const session = {
    accessToken: "service",
    persona: { key: "worker.local", label: "Worker", kind: "SERVICE" as const },
    context: { workspaceId: "w", workspaceKey: "local-functional", projectId: "p" },
    projects: [{ projectId: "p", projectKey: "P", permissions: ["work-item.read"] }],
    grants: {
      roles: ["worker"],
      permissions: ["work-item.read"],
      classificationCeiling: "INTERNAL",
    },
  };
  expect(
    sections.filter((section) => canVisit(section, session)).map((section) => section.path),
  ).toEqual(["/", "/help"]);
});

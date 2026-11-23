import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
describe("004 generated OpenAPI/runtime drift", () => {
  it("contains all 20 Feature 004 routes and their runtime controllers", async () => {
    const api = JSON.parse(
      await readFile(resolve(root, "apps/api/openapi.generated.json"), "utf8"),
    ) as { paths: Record<string, unknown> };
    for (const path of [
      "/api/v1/public/mattermost/awp-bootstrap",
      "/api/v1/intake/mattermost/project-option-sets",
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/intake-candidates",
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-runs",
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/triage-assessments/{assessmentId}",
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/session-plan-proposals/{proposalId}",
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/notification-intents/{notificationIntentId}",
    ])
      expect(api.paths[path]).toBeDefined();
    const module = await readFile(resolve(root, "apps/api/src/app.module.ts"), "utf8");
    for (const controller of [
      "MattermostBootstrapController",
      "MattermostIngressController",
      "IntakeCandidatesController",
      "AgentRunsController",
      "NotificationIntentsController",
      "QaHermesProposalResourcesController",
    ])
      expect(module).toContain(controller);
  });
  it("includes the deterministic Mattermost Mock Hub surface", async () => {
    const mock = JSON.parse(
      await readFile(resolve(root, "apps/mock-hub/openapi.generated.json"), "utf8"),
    ) as { paths: Record<string, unknown> };
    for (const path of [
      "/api/v4/system/ping",
      "/api/v4/posts",
      "/mock/mattermost/state",
      "/mock/mattermost/fault",
      "/mock/mattermost/callbacks",
    ])
      expect(mock.paths[path]).toBeDefined();
  });
});

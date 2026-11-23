import { describe, expect, it } from "vitest";

import {
  assertGitLabMockProtocolOperation,
  authorizeGitLabMockControl,
  gitLabMockProtocolSurface,
} from "../../../apps/mock-hub/src/gitlab/gitlab.module.ts";

describe("Mock Hub GitLab foundation contract", () => {
  it("publishes only the bounded REST v4 discovery/source/read surface", () => {
    expect(gitLabMockProtocolSurface).toEqual([
      ["GET", "/api/v4/version"],
      ["GET", "/api/v4/projects/:projectId"],
      ["GET", "/api/v4/projects/:projectId/merge_requests/:iid"],
      ["GET", "/api/v4/projects/:projectId/repository/commits/:sha"],
      ["GET", "/api/v4/projects/:projectId/repository/branches/:ref"],
      ["POST", "/api/v4/projects/:projectId/ci/lint"],
      ["POST", "/api/v4/projects/:projectId/trigger/pipeline"],
      ["GET", "/api/v4/projects/:projectId/pipelines"],
      ["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId"],
      ["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId/variables"],
      ["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId/jobs"],
      ["GET", "/api/v4/projects/:projectId/jobs/:jobId/artifacts"],
    ]);
    expect(() =>
      assertGitLabMockProtocolOperation("POST", "/api/v4/projects/5001/pipelines/1/retry"),
    ).toThrow("GITLAB_MOCK_ROUTE_UNKNOWN");
    expect(() =>
      assertGitLabMockProtocolOperation(
        "GET",
        "/api/v4/projects/5001/repository/files/.gitlab-ci.yml",
      ),
    ).toThrow("GITLAB_MOCK_ROUTE_UNKNOWN");
  });

  it("requires the local control key and exact numeric project scope", () => {
    expect(
      authorizeGitLabMockControl({
        expectedControlKey: "local-control",
        providedControlKey: "local-control",
        numericProjectId: 5001,
        allowedProjectIds: [5001],
      }),
    ).toEqual({ numericProjectId: 5001 });
    expect(() =>
      authorizeGitLabMockControl({
        expectedControlKey: "local-control",
        providedControlKey: "wrong",
        numericProjectId: 5001,
        allowedProjectIds: [5001],
      }),
    ).toThrow("GITLAB_MOCK_CONTROL_UNAUTHORIZED");
    expect(() =>
      authorizeGitLabMockControl({
        expectedControlKey: "local-control",
        providedControlKey: "local-control",
        numericProjectId: 5002,
        allowedProjectIds: [5001],
      }),
    ).toThrow("GITLAB_MOCK_CONTROL_SCOPE_FORBIDDEN");
  });
});

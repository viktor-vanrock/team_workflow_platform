import { describe, expect, it, vi } from "vitest";
import { selectGitLabSuitePipeline } from "../../../packages/connector-gitlab/src/profile/gitlab-suite-pipeline-selection.ts";

const sha = "a".repeat(40);
const setup = () => {
  const pipeline = { id: 101, ref: "qa/ref", sha, status: "success" };
  const job = { id: 201, name: "awp:result", status: "success" };
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([pipeline])))
    .mockResolvedValueOnce(new Response(JSON.stringify([job])));
  return {
    input: {
      client: { request },
      numericProjectId: 5001,
      exactRef: "qa/ref",
      commitSha: sha,
      jobName: "awp:result",
      signal: new AbortController().signal,
      revalidate: vi.fn(async () => undefined),
    },
    request,
    pipeline,
    job,
  };
};
describe("server-side selection of GitLab Suite pipeline", () => {
  it("selects a unique successful pipeline of the pinned ref and commit and its exact job", async () => {
    const { input, request } = setup();
    await expect(selectGitLabSuitePipeline(input as never)).resolves.toEqual({
      pipelineId: "101",
      jobId: "201",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      path: "/api/v4/projects/5001/pipelines?ref=qa%2Fref&per_page=100",
    });
  });
  it("rejects ambiguous pipelines and incomplete pages", async () => {
    const value = setup();
    value.request
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([value.pipeline, { ...value.pipeline, id: 102 }])),
      );
    await expect(selectGitLabSuitePipeline(value.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_SELECTION_AMBIGUOUS",
    );
    const truncated = setup();
    truncated.request
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([truncated.pipeline]), { headers: { "x-next-page": "2" } }),
      );
    await expect(selectGitLabSuitePipeline(truncated.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_SELECTION_TRUNCATED",
    );
  });
  it("does not return a selection after authority is revoked", async () => {
    const value = setup();
    value.input.revalidate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("REVOKED"));
    await expect(selectGitLabSuitePipeline(value.input as never)).rejects.toThrow("REVOKED");
  });
});

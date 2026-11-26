import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readGitLabSuitePipelineEvidence } from "../../../packages/connector-gitlab/src/profile/gitlab-suite-pipeline-evidence.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";

const schemaId = "urn:awp:schemas:005:gitlab-pipeline-result:v1";
const raw = readFileSync(
  new URL(
    "../../../specs/005-gitlab-automated-validation/contracts/examples/pipeline-result.pass.v1.json",
    import.meta.url,
  ),
  "utf8",
);
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const setup = () => {
  const pipeline = { id: 12001, project_id: 5001, sha: commitSha, status: "success" };
  const jobs = [{ id: 22001, name: "awp:result", status: "success", pipeline: { id: 12001 } }];
  const requestJson = vi.fn(async (request: { path: string }) =>
    request.path.endsWith("/jobs") ? jobs : pipeline,
  );
  const request = vi.fn(
    async () => new Response(raw, { headers: { "content-type": "application/json" } }),
  );
  const revalidate = vi.fn(async () => undefined);
  return {
    input: {
      client: { request, requestJson },
      numericProjectId: 5001,
      pipelineId: "12001",
      jobId: "22001",
      commitSha,
      jobName: "awp:result",
      artifactPath: "awp/results/result.json",
      suiteKey: "qa.api.smoke",
      allowedEnvironmentRefs: ["environment:test:qa-1@17"],
      schemaRef: { id: schemaId, version: 1, digest: designContractRegistry.digest(schemaId) },
      maximumBytes: 10000,
      signal: new AbortController().signal,
      revalidate,
    },
    pipeline,
    jobs,
    request,
    requestJson,
    revalidate,
  };
};
describe("evidence from a real GitLab pipeline artifact", () => {
  it("reads the selected pipeline, its exact job and actual result artifact", async () => {
    const { input, request, revalidate } = setup();
    const evidence = await readGitLabSuitePipelineEvidence(input as never);
    expect(evidence).toMatchObject({
      pipelineId: "12001",
      jobId: "22001",
      commitSha,
      contentHash: sha256(raw),
      provesPipelineArtifact: true,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/api/v4/projects/5001/jobs/22001/artifacts?artifact_path=awp%2Fresults%2Fresult.json",
      }),
    );
    expect(revalidate).toHaveBeenCalledTimes(4);
  });
  it("rejects the wrong commit, job, pipeline or artifact without manufacturing evidence", async () => {
    const wrongCommit = setup();
    wrongCommit.pipeline.sha = "a".repeat(40);
    await expect(readGitLabSuitePipelineEvidence(wrongCommit.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_INVALID",
    );
    expect(wrongCommit.request).not.toHaveBeenCalled();
    const wrongJob = setup();
    wrongJob.jobs[0]!.pipeline.id = 42;
    await expect(readGitLabSuitePipelineEvidence(wrongJob.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_INVALID",
    );
    const wrongArtifact = setup();
    wrongArtifact.request.mockResolvedValueOnce(
      new Response(raw.replace('"pipelineId": 12001', '"pipelineId": 999'), {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(readGitLabSuitePipelineEvidence(wrongArtifact.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_ARTIFACT_MISMATCH",
    );
  });
  it("does not accept evidence after the authorization is revoked", async () => {
    const value = setup();
    value.revalidate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("REVOKED"));
    await expect(readGitLabSuitePipelineEvidence(value.input as never)).rejects.toThrow("REVOKED");
    expect(value.request).not.toHaveBeenCalled();
  });
  it("rejects a pipeline that changes while the artifact is read", async () => {
    const value = setup();
    value.request.mockImplementationOnce(async () => {
      value.pipeline.sha = "f".repeat(40);
      return new Response(raw, { headers: { "content-type": "application/json" } });
    });
    await expect(readGitLabSuitePipelineEvidence(value.input as never)).rejects.toThrow(
      "GITLAB_SUITE_RUN_INVALID",
    );
  });
  it("rejects a result with an unexpected schema or oversized body", async () => {
    const wrongSchema = setup();
    await expect(
      readGitLabSuitePipelineEvidence({
        ...wrongSchema.input,
        schemaRef: { ...wrongSchema.input.schemaRef, digest: sha256("wrong") },
      } as never),
    ).rejects.toThrow("GITLAB_SUITE_RUN_SCHEMA_INVALID");
    expect(wrongSchema.requestJson).not.toHaveBeenCalled();
    const tooLarge = setup();
    await expect(
      readGitLabSuitePipelineEvidence({ ...tooLarge.input, maximumBytes: 5 } as never),
    ).rejects.toThrow("GITLAB_SUITE_RUN_ARTIFACT_TOO_LARGE");
  });
});

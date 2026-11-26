import {
  designContractRegistry,
  type JsonValue,
  type SchemaReference,
  sha256,
} from "@awp/platform-contracts";

import type { GitLabRestClient } from "../http/gitlab-rest-client.ts";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GITLAB_SUITE_RUN_INVALID");
  return value as Record<string, unknown>;
};

/** Evidence from a real, server-selected GitLab pipeline; no pipeline or job is triggered here. */
export async function readGitLabSuitePipelineEvidence(
  input: Readonly<{
    client: Pick<GitLabRestClient, "request" | "requestJson">;
    numericProjectId: number;
    pipelineId: string;
    jobId: string;
    commitSha: string;
    jobName: string;
    artifactPath: string;
    suiteKey: string;
    allowedEnvironmentRefs: readonly string[];
    schemaRef: SchemaReference;
    maximumBytes: number;
    signal: AbortSignal;
    /** Must recheck the server-selected pipeline and current configuration and service rights. */
    revalidate(): Promise<void>;
  }>,
) {
  const validId = (value: string) =>
    /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
  if (
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    !validId(input.pipelineId) ||
    !validId(input.jobId) ||
    !/^[a-f0-9]{40}$/u.test(input.commitSha) ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.jobName) ||
    !/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,512}$/u.test(input.artifactPath) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(input.suiteKey) ||
    !input.allowedEnvironmentRefs.length ||
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.maximumBytes > 10_485_760 ||
    input.signal.aborted ||
    typeof input.revalidate !== "function"
  )
    throw new Error("GITLAB_SUITE_RUN_SCOPE_INVALID");
  const schemaId = "urn:awp:schemas:005:gitlab-pipeline-result:v1";
  if (
    input.schemaRef.id !== schemaId ||
    input.schemaRef.version !== 1 ||
    input.schemaRef.digest !== designContractRegistry.digest(schemaId)
  )
    throw new Error("GITLAB_SUITE_RUN_SCHEMA_INVALID");
  const prefix = `/api/v4/projects/${input.numericProjectId}`;
  const observe = async () => {
    await input.revalidate();
    const pipeline = object(
      await input.client.requestJson({
        operation: "pipeline.read",
        authOperation: "pipelineRead",
        method: "GET",
        path: `${prefix}/pipelines/${input.pipelineId}`,
        signal: input.signal,
      }),
    );
    const jobs = await input.client.requestJson<unknown>({
      operation: "pipeline.jobs-read",
      authOperation: "pipelineRead",
      method: "GET",
      path: `${prefix}/pipelines/${input.pipelineId}/jobs`,
      signal: input.signal,
    });
    if (
      String(pipeline.id) !== input.pipelineId ||
      (pipeline.project_id !== undefined &&
        Number(pipeline.project_id) !== input.numericProjectId) ||
      pipeline.sha !== input.commitSha ||
      pipeline.status !== "success" ||
      !Array.isArray(jobs) ||
      jobs.length > 100
    )
      throw new Error("GITLAB_SUITE_RUN_INVALID");
    const matches = jobs.filter((item: unknown) => {
      const job = object(item);
      const pipelineId = job.pipeline !== undefined ? object(job.pipeline).id : job.pipeline_id;
      return (
        String(job.id ?? job.job_id) === input.jobId &&
        job.name === input.jobName &&
        job.status === "success" &&
        String(pipelineId) === input.pipelineId
      );
    });
    if (matches.length !== 1 || input.signal.aborted) throw new Error("GITLAB_SUITE_RUN_INVALID");
    await input.revalidate();
  };
  await observe();
  const response = await input.client.request({
    operation: "artifact.result-read",
    authOperation: "artifactStream",
    method: "GET",
    path: `${prefix}/jobs/${input.jobId}/artifacts?artifact_path=${encodeURIComponent(input.artifactPath)}`,
    maxResponseBytes: input.maximumBytes,
    signal: input.signal,
  });
  if (
    !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  )
    throw new Error("GITLAB_SUITE_RUN_ARTIFACT_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > input.maximumBytes || input.signal.aborted)
        throw new Error("GITLAB_SUITE_RUN_ARTIFACT_TOO_LARGE");
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let raw: string;
  let result: Record<string, unknown>;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (raw.charCodeAt(0) === 0xfeff || new TextEncoder().encode(raw).byteLength !== size)
      throw new Error();
    result = object(JSON.parse(raw));
    designContractRegistry.validate({
      schemaRef: input.schemaRef,
      value: result as unknown as JsonValue,
    });
  } catch {
    throw new Error("GITLAB_SUITE_RUN_ARTIFACT_INVALID");
  }
  if (
    String(result.pipelineId) !== input.pipelineId ||
    String(result.jobId) !== input.jobId ||
    result.commitSha !== input.commitSha ||
    result.suiteKey !== input.suiteKey ||
    typeof result.environmentRef !== "string" ||
    !input.allowedEnvironmentRefs.includes(result.environmentRef)
  )
    throw new Error("GITLAB_SUITE_RUN_ARTIFACT_MISMATCH");
  await observe();
  return Object.freeze({
    pipelineId: input.pipelineId,
    jobId: input.jobId,
    commitSha: input.commitSha,
    schemaRef: Object.freeze({ ...input.schemaRef }),
    artifactPath: input.artifactPath,
    byteSize: size,
    contentHash: sha256(raw),
    provesPipelineArtifact: true as const,
  });
}

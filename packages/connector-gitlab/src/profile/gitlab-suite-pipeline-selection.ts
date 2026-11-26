import type { GitLabRestClient } from "../http/gitlab-rest-client.ts";

async function boundedPage(response: Response, signal: AbortSignal): Promise<unknown[]> {
  if ((response.headers.get("x-next-page") ?? "") !== "" || !response.body)
    throw new Error("GITLAB_SUITE_RUN_SELECTION_TRUNCATED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_048_576 || signal.aborted)
        throw new Error("GITLAB_SUITE_RUN_SELECTION_TRUNCATED");
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("GITLAB_SUITE_RUN_SELECTION_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length >= 100)
    throw new Error("GITLAB_SUITE_RUN_SELECTION_TRUNCATED");
  return parsed as unknown[];
}

/** Select from provider facts, never from a browser-supplied pipeline or job ID. */
export async function selectGitLabSuitePipeline(
  input: Readonly<{
    client: Pick<GitLabRestClient, "request">;
    numericProjectId: number;
    exactRef: string;
    commitSha: string;
    jobName: string;
    signal: AbortSignal;
    revalidate(): Promise<void>;
  }>,
) {
  if (
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    !input.exactRef ||
    input.exactRef.length > 255 ||
    /[\p{Cc}]/u.test(input.exactRef) ||
    !/^[a-f0-9]{40}$/u.test(input.commitSha) ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.jobName) ||
    typeof input.revalidate !== "function" ||
    input.signal.aborted
  )
    throw new Error("GITLAB_SUITE_RUN_SELECTION_INVALID");
  const prefix = `/api/v4/projects/${input.numericProjectId}`;
  await input.revalidate();
  const response = await input.client.request({
    operation: "pipeline.lookup",
    authOperation: "pipelineLookup",
    method: "GET",
    path: `${prefix}/pipelines?ref=${encodeURIComponent(input.exactRef)}&per_page=100`,
    signal: input.signal,
    maxResponseBytes: 1_048_576,
  });
  const pipelines = await boundedPage(response, input.signal);
  const matches = pipelines.filter((value: unknown): value is Record<string, unknown> =>
    Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).ref === input.exactRef &&
      (value as Record<string, unknown>).sha === input.commitSha &&
      (value as Record<string, unknown>).status === "success",
    ),
  );
  if (matches.length !== 1) throw new Error("GITLAB_SUITE_RUN_SELECTION_AMBIGUOUS");
  const pipelineId = String(matches[0]!.id);
  if (!/^[1-9][0-9]{0,15}$/u.test(pipelineId) || !Number.isSafeInteger(Number(pipelineId)))
    throw new Error("GITLAB_SUITE_RUN_SELECTION_INVALID");
  const jobsResponse = await input.client.request({
    operation: "pipeline.jobs-read",
    authOperation: "pipelineRead",
    method: "GET",
    path: `${prefix}/pipelines/${pipelineId}/jobs?per_page=100`,
    signal: input.signal,
    maxResponseBytes: 1_048_576,
  });
  const jobs = await boundedPage(jobsResponse, input.signal);
  const selected = jobs.filter((value: unknown): value is Record<string, unknown> =>
    Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).name === input.jobName &&
      (value as Record<string, unknown>).status === "success",
    ),
  );
  if (selected.length !== 1) throw new Error("GITLAB_SUITE_RUN_SELECTION_AMBIGUOUS");
  const jobId = String(selected[0]!.id ?? selected[0]!.job_id);
  if (!/^[1-9][0-9]{0,15}$/u.test(jobId) || !Number.isSafeInteger(Number(jobId)))
    throw new Error("GITLAB_SUITE_RUN_SELECTION_INVALID");
  await input.revalidate();
  if (input.signal.aborted) throw new Error("GITLAB_SUITE_RUN_SELECTION_INVALID");
  return Object.freeze({ pipelineId, jobId });
}

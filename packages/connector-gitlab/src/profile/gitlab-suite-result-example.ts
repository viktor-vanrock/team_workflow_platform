import {
  designContractRegistry,
  type JsonValue,
  type SchemaReference,
  sha256,
} from "@awp/platform-contracts";

import type { GitLabRestClient } from "../http/gitlab-rest-client.ts";

const schemaId = "urn:awp:schemas:005:gitlab-pipeline-result:v1";

/** A committed example proves schema compatibility only, never actual CI artifact generation. */
export async function readGitLabSuiteResultExample(
  input: Readonly<{
    client: Pick<GitLabRestClient, "request">;
    numericProjectId: number;
    commitSha: string;
    schemaRef: SchemaReference;
    maximumBytes: number;
    signal: AbortSignal;
    /** Composition must recheck approved project, commit, configuration and service authority. */
    revalidate(): Promise<void>;
  }>,
) {
  const { schemaRef, signal } = input;
  if (
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    !/^[a-f0-9]{40}$/u.test(input.commitSha) ||
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.maximumBytes > 10_485_760 ||
    signal.aborted ||
    typeof input.revalidate !== "function"
  )
    throw new Error("GITLAB_EXAMPLE_SCOPE_INVALID");
  if (
    schemaRef.id !== schemaId ||
    schemaRef.version !== 1 ||
    schemaRef.digest !== designContractRegistry.digest(schemaId)
  )
    throw new Error("GITLAB_EXAMPLE_SCHEMA_INVALID");
  await input.revalidate();
  if (signal.aborted) throw new Error("GITLAB_EXAMPLE_SCOPE_INVALID");
  const response = await input.client.request({
    operation: "suite-result-example.read",
    authOperation: "buildRead",
    method: "GET",
    path: `/api/v4/projects/${input.numericProjectId}/repository/files/.awp%2Fqa%2Fresult-example.json/raw?ref=${input.commitSha}`,
    maxResponseBytes: input.maximumBytes,
    signal,
  });
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > input.maximumBytes)) {
    await response.body?.cancel();
    throw new Error("GITLAB_EXAMPLE_TOO_LARGE");
  }
  if (!response.body) throw new Error("GITLAB_EXAMPLE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > input.maximumBytes || signal.aborted) throw new Error("GITLAB_EXAMPLE_TOO_LARGE");
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
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (raw.charCodeAt(0) === 0xfeff || new TextEncoder().encode(raw).byteLength !== size)
      throw new Error();
    designContractRegistry.validate({ schemaRef, value: JSON.parse(raw) as JsonValue });
  } catch {
    throw new Error("GITLAB_EXAMPLE_INVALID");
  }
  await input.revalidate();
  if (signal.aborted) throw new Error("GITLAB_EXAMPLE_SCOPE_INVALID");
  return Object.freeze({
    commitSha: input.commitSha,
    schemaRef: Object.freeze({ ...schemaRef }),
    byteSize: size,
    contentHash: sha256(raw),
    provesPipelineArtifact: false as const,
  });
}

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  gitLabConnectorManifest,
  gitLabConnectorManifestV11,
} from "../../../packages/connector-gitlab/src/manifest.ts";
import { readGitLabSuiteResultExample } from "../../../packages/connector-gitlab/src/profile/gitlab-suite-result-example.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";

const schemaId = "urn:awp:schemas:005:gitlab-pipeline-result:v1";
const schemaRef = { id: schemaId, version: 1, digest: designContractRegistry.digest(schemaId) };
const example = readFileSync(
  new URL(
    "../../../specs/005-gitlab-automated-validation/contracts/examples/pipeline-result.pass.v1.json",
    import.meta.url,
  ),
  "utf8",
);
const commit = "a".repeat(40);
const base = () => ({
  client: { request: vi.fn(async () => new Response(example)) },
  numericProjectId: 5001,
  commitSha: commit,
  schemaRef,
  maximumBytes: 10000,
  signal: new AbortController().signal,
  revalidate: vi.fn(async () => undefined),
});

describe("pinned GitLab suite result example", () => {
  it("keeps v1 unchanged and stages the exact-file exception in v1.1", () => {
    expect(gitLabConnectorManifest.metadata.version).toBe("1.0.0");
    expect(gitLabConnectorManifestV11.metadata.version).toBe("1.1.0");
    expect(gitLabConnectorManifestV11.prohibitedOperations).toContain("repository.file.read");
    expect(gitLabConnectorManifestV11.support.pinnedSuiteResultExample.path).toBe(
      ".awp/qa/result-example.json",
    );
  });
  it("returns schema-validated metadata bound to the exact commit but no CI proof", async () => {
    const input = base();
    expect(await readGitLabSuiteResultExample(input)).toEqual({
      commitSha: commit,
      schemaRef,
      byteSize: new TextEncoder().encode(example).byteLength,
      contentHash: sha256(example),
      provesPipelineArtifact: false,
    });
    expect(input.client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        operation: "suite-result-example.read",
        path: `/api/v4/projects/5001/repository/files/.awp%2Fqa%2Fresult-example.json/raw?ref=${commit}`,
      }),
    );
    expect(input.revalidate).toHaveBeenCalledTimes(2);
  });
  it("rejects moving refs, incorrect schema and invalid or oversized example", async () => {
    const input = base();
    await expect(readGitLabSuiteResultExample({ ...input, commitSha: "main" })).rejects.toThrow(
      "GITLAB_EXAMPLE_SCOPE_INVALID",
    );
    await expect(
      readGitLabSuiteResultExample({
        ...input,
        schemaRef: { ...schemaRef, digest: sha256("wrong") },
      }),
    ).rejects.toThrow("GITLAB_EXAMPLE_SCHEMA_INVALID");
    expect(input.client.request).not.toHaveBeenCalled();
    input.client.request.mockResolvedValueOnce(new Response("{}"));
    await expect(readGitLabSuiteResultExample(input)).rejects.toThrow("GITLAB_EXAMPLE_INVALID");
    input.client.request.mockResolvedValueOnce(new Response(example));
    await expect(readGitLabSuiteResultExample({ ...input, maximumBytes: 5 })).rejects.toThrow(
      "GITLAB_EXAMPLE_TOO_LARGE",
    );
  });
  it("does not return evidence after the authority is revoked", async () => {
    const input = base();
    input.revalidate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("REVOKED"));
    await expect(readGitLabSuiteResultExample(input)).rejects.toThrow("REVOKED");
  });
});

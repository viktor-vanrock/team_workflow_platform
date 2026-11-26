import { describe, expect, it, vi } from "vitest";

import { createCorporateSuiteExampleAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-suite-example-authority.ts";
import { integrationConfigurationHash } from "../../../packages/runtime-composition/src/onboarding/configuration-hash.ts";

const mocks = vi.hoisted(() => ({
  c1: vi.fn(),
  publications: vi.fn(),
  read: vi.fn(),
  select: vi.fn(),
  evidence: vi.fn(),
  preflight: vi.fn(),
  connection: vi.fn(),
}));
vi.mock(
  "../../../packages/runtime-composition/src/pilot/published-deployment-references.ts",
  () => ({
    PublishedDeploymentReferences: class {
      load = mocks.publications;
    },
  }),
);
vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-c1-metadata.ts", () => ({
  resolveCorporateGitLabC1: mocks.c1,
}));
vi.mock("../../../packages/connector-gitlab/src/index.ts", async (original) => ({
  ...(await original<typeof import("@awp/connector-gitlab")>()),
  preflightGitLabProfile: mocks.preflight,
  validateGitLabConnectionConfiguration: mocks.connection,
  readGitLabSuiteResultExample: mocks.read,
  selectGitLabSuitePipeline: mocks.select,
  readGitLabSuitePipelineEvidence: mocks.evidence,
}));

describe("corporate Suite example authority", () => {
  it("loads C1, the current approved discovery and exact binding before reading", async () => {
    const profileContent = { profile: "fixture" },
      connectionContent = { connection: "fixture" };
    const profileRef = {
      id: "profile",
      version: 1,
      contentHash: integrationConfigurationHash("connector_profile", profileContent),
    };
    const connectionRef = {
      id: "connection",
      version: 1,
      contentHash: integrationConfigurationHash("connection", connectionContent),
    };
    const bindingRef = { id: "binding", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
    const schemaRef = { id: "schema", version: 1, digest: `sha256:${"b".repeat(64)}` };
    mocks.publications.mockResolvedValue({ publications: [] });
    const executionPin = {
      logicalRole: "TEST_EXECUTION",
      profileRef,
      profileHash: profileRef.contentHash,
      connectionRef,
      connectionHash: connectionRef.contentHash,
      projectIntegrationBindingRef: bindingRef,
      projectIntegrationBindingHash: bindingRef.contentHash,
    };
    const metadata = {
      contentHash: "c1",
      numericGitLabProjectId: 5001,
      server: { edition: "EE", exactVersion: "17.0", exactBuild: "build" },
      resultContract: { schemaRef },
      configurationPins: [executionPin],
    };
    mocks.c1.mockReturnValue(metadata);
    mocks.connection.mockReturnValue({});
    mocks.preflight.mockReturnValue({
      status: "SAFE_TO_DISCOVER",
      profile: {
        numericGitLabProjectId: 5001,
        trigger: { ref: "qa/ref" },
        suiteMappings: [
          {
            suiteKey: "smoke",
            resultJobName: "awp:result",
            resultArtifactPath: "awp/result.json",
            allowedEnvironmentRefs: ["qa-test"],
          },
        ],
        resultContract: { schemaRef, maxBytes: 1024 },
      },
    });
    mocks.read.mockImplementation(
      async (input: { revalidate(): Promise<void>; commitSha: string }) => {
        await input.revalidate();
        return { commitSha: input.commitSha, provesPipelineArtifact: false };
      },
    );
    const query = vi.fn().mockResolvedValue([
      {
        profile_content: profileContent,
        profile_hash: profileRef.contentHash,
        connection_content: connectionContent,
        connection_hash: connectionRef.contentHash,
        discovery_snapshot_id: "discovery",
        discovery_hash: "digest",
        edition: "EE",
        exact_version: "17.0",
        exact_build: "build",
        exact_ref: "qa/ref",
        ref_commit_sha: "a".repeat(40),
      },
    ]);
    const binding = {
      ref: bindingRef,
      provider: "GITLAB",
      workspaceId: "w",
      projectId: "p",
      profileRef,
      connectionRef,
      gitlab: { numericProjectId: 5001 },
    };
    const authorize = vi.fn().mockResolvedValue(true);
    const gitlab = vi.fn().mockReturnValue({ client: {} });
    const authority = createCorporateSuiteExampleAuthority({
      source: { isInitialized: true, query },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      },
      grants: [{ binding, integrationBindingRef: bindingRef }],
      factories: { gitlab },
      authority: { authorize },
    } as never);
    const result = await authority.read(
      { workspaceId: "w", projectId: "p", suiteKey: "smoke" },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ commitSha: "a".repeat(40), provesPipelineArtifact: false });
    expect(gitlab).toHaveBeenCalledWith("binding", {}, 5001, "1.1.0");
    expect(query.mock.calls[0]?.[0]).toContain("d.connector_version='1.1.0'");
    expect(authorize).toHaveBeenCalledTimes(2);
    await expect(
      authority.read(
        { workspaceId: "w", projectId: "other", suiteKey: "smoke" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_EXAMPLE_SCOPE_DENIED");
    await expect(
      authority.verifyPipelineArtifact(
        { workspaceId: "w", projectId: "p", suiteKey: "smoke" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_SUITE_ARTIFACT_AUTHORITY_REQUIRED");
    expect(mocks.select).not.toHaveBeenCalled();
    mocks.c1.mockReturnValue({
      ...metadata,
      configurationPins: [executionPin, { ...executionPin, logicalRole: "ARTIFACT_SOURCE" }],
    });
    mocks.select.mockResolvedValue({ pipelineId: "101", jobId: "201" });
    mocks.evidence.mockResolvedValue({
      pipelineId: "101",
      jobId: "201",
      provesPipelineArtifact: true,
    });
    await expect(
      authority.verifyPipelineArtifact(
        { workspaceId: "w", projectId: "p", suiteKey: "smoke" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ provesPipelineArtifact: true, pipelineId: "101", jobId: "201" });
    expect(mocks.evidence).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: "101", jobId: "201", commitSha: "a".repeat(40) }),
    );
  });
});

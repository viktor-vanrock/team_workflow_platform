import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { createCorporateGitLabResultArtifactProvider } from "../../../packages/runtime-composition/src/gitlab/corporate-result-artifact-provider.ts";

describe("corporate GitLab artifact provider", () => {
  it("rejects a missing artifact pin before querying configuration", async () => {
    const query = vi.fn();
    await expect(
      createCorporateGitLabResultArtifactProvider({
        source: { query },
        grants: [],
        factories: {},
        authority: {},
        attempt: { currentStatus: "RUNNING" },
        snapshot: { configurationPins: [] },
        numericProjectId: 100,
        signal: new AbortController().signal,
        revalidateAttempt: vi.fn(),
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_ARTIFACT_PIN_INVALID");
    expect(query).not.toHaveBeenCalled();
  });

  it("does not use a pipeline-only grant for artifact reads", async () => {
    const query = vi.fn();
    const ref = { id: "ref", version: 1, contentHash: "sha256:ref" };
    const body = {
      workspaceId: "w",
      projectId: "p",
      testSessionId: "s",
      configurationPins: [
        {
          logicalRole: "ARTIFACT_SOURCE",
          capabilityKey: "artifact.ci-read",
          exactContractVersion: "1.0.0",
          projectIntegrationBindingRef: ref,
          profileRef: ref,
          connectionRef: ref,
        },
      ],
    };
    const snapshotHash = sha256(body);
    await expect(
      createCorporateGitLabResultArtifactProvider({
        source: { query },
        grants: [],
        factories: {},
        authority: {},
        attempt: {
          workspaceId: "w",
          projectId: "p",
          testSessionId: "s",
          currentStatus: "RUNNING",
          targetSnapshotHash: snapshotHash,
        },
        snapshot: { ...body, snapshotHash },
        numericProjectId: 100,
        signal: new AbortController().signal,
        revalidateAttempt: vi.fn(),
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_ARTIFACT_ACCESS_DENIED");
    expect(query).not.toHaveBeenCalled();
  });
});

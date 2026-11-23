import { describe, expect, it, vi } from "vitest";

import type { ObjectStoragePort } from "../../../packages/platform-core/src/index.ts";
import { GitLabDispatchingObjectStorage } from "../../../packages/runtime-composition/src/gitlab/artifact-storage.ts";

describe("Feature 010 GitLab-only artifact byte routing", () => {
  it("delegates GitLab references and rejects every other provider", async () => {
    const stream = vi.fn(async () => ({
      body: (async function* () {
        yield new TextEncoder().encode("artifact");
      })(),
    }));
    const storage = new GitLabDispatchingObjectStorage({ stream } satisfies ObjectStoragePort);
    await expect(
      storage.stream({
        providerKind: "GITLAB_CI",
        opaqueLocator: "gitlab-artifact-reference:00000000-0000-4000-8000-000000000001",
        objectVersionOrEtag: "sha256:value",
      }),
    ).resolves.toBeDefined();
    await expect(
      storage.stream({
        providerKind: "LEGACY_EXTERNAL",
        opaqueLocator: "legacy",
        objectVersionOrEtag: "v1",
      }),
    ).rejects.toThrow("GITLAB_ONLY_ARTIFACT_PROVIDER_REQUIRED");
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

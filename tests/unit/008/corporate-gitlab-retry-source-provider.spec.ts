import { describe, expect, it, vi } from "vitest";

import { createCorporateGitLabRetrySourceProvider } from "../../../packages/runtime-composition/src/gitlab/corporate-retry-source-provider.ts";

describe("corporate GitLab retry source provider", () => {
  it("requires the source-context pin before querying provider configuration", async () => {
    const query = vi.fn();
    await expect(
      createCorporateGitLabRetrySourceProvider({
        source: { query },
        grants: [],
        factories: {},
        authority: {},
        attempt: { currentStatus: "RUNNING" },
        snapshot: { configurationPins: [] },
        numericProjectId: 5001,
        signal: new AbortController().signal,
        revalidateAttempt: vi.fn(),
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RETRY_SOURCE_PIN_INVALID");
    expect(query).not.toHaveBeenCalled();
  });
});

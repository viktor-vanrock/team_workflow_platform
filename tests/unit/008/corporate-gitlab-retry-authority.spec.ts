import { afterEach, describe, expect, it, vi } from "vitest";

import { TypeOrmCommandRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createCorporateGitLabRetryAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-retry-authority.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate GitLab retry authority", () => {
  it("rejects production configuration", () => {
    expect(() =>
      createCorporateGitLabRetryAuthority({
        source: { isInitialized: true },
        environment: {
          profile: "non-local",
          environmentScope: "PLATFORM_PROD",
          deployment: { workspaceId: "w", projectIds: ["p"] },
        },
        guard: { assertCommandAllowed: vi.fn() },
        grants: [],
        factories: {},
        connectorAuthority: {},
      } as never),
    ).toThrow("CORPORATE_GITLAB_RETRY_AUTHORITY_REQUIRED");
  });
  it("requires the stored command and matching original authorization basis", async () => {
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue(undefined);
    const guard = { assertCommandAllowed: vi.fn() };
    const authority = createCorporateGitLabRetryAuthority({
      source: { isInitialized: true },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      },
      guard,
      grants: [],
      factories: {},
      connectorAuthority: {},
    } as never);
    await expect(
      authority.resolve(
        { workspaceId: "w", projectId: "p", connectorCommandId: "c" } as never,
        { snapshotHash: "hash" } as never,
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_RETRY_COMMAND_INVALID");
    expect(guard.assertCommandAllowed).not.toHaveBeenCalled();
  });
});

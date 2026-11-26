import { describe, expect, it, vi } from "vitest";

import {
  assertCorporateGitLabDiscoveryCurrent,
  assertCorporateGitLabDiscoveryServer,
} from "../../../packages/runtime-composition/src/gitlab/corporate-discovery-server.ts";

describe("corporate GitLab discovery server", () => {
  const server = { edition: "EE", exactVersion: "17.0.0", exactBuild: "build" };
  const discovery = { edition: "EE", exact_version: "17.0.0", exact_build: "build" };
  it("accepts only the exact server pinned by C1", () => {
    expect(() => assertCorporateGitLabDiscoveryServer(discovery, server)).not.toThrow();
    for (const field of ["edition", "exact_version", "exact_build"]) {
      expect(() =>
        assertCorporateGitLabDiscoveryServer({ ...discovery, [field]: "other" }, server),
      ).toThrow("CORPORATE_GITLAB_DISCOVERY_SERVER_MISMATCH");
    }
  });
  it("rejects expired discovery and a changed server on recheck", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([discovery])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...discovery, exact_build: "changed" }]);
    const source = { query } as never;
    const ref = { id: "connection", version: 1, contentHash: "sha256:connection" };
    await expect(
      assertCorporateGitLabDiscoveryCurrent(source, "workspace", ref, 5001, server),
    ).resolves.toBeUndefined();
    await expect(
      assertCorporateGitLabDiscoveryCurrent(source, "workspace", ref, 5001, server),
    ).rejects.toThrow("CORPORATE_GITLAB_DISCOVERY_STALE");
    await expect(
      assertCorporateGitLabDiscoveryCurrent(source, "workspace", ref, 5001, server),
    ).rejects.toThrow("CORPORATE_GITLAB_DISCOVERY_SERVER_MISMATCH");
  });
});

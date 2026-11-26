import { describe, expect, it, vi } from "vitest";
import {
  createCorporateGitLabTerminalObservation,
  assertCorporateGitLabObservationMatches,
} from "../../../packages/runtime-composition/src/gitlab/corporate-terminal-observation.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";

describe("corporate GitLab terminal observation", () => {
  it("accepts a fresh read with the same provider facts and rejects changed job state", () => {
    const body = {
      terminal: true,
      externalPipelineId: "100",
      externalJobIds: ["200"],
      providerState: "SUCCESS",
      providerRevisionToken: "revision",
      sourceCommitSha: "commit",
      providerUpdatedAt: "2026-01-01T00:00:00.000Z",
      observedAt: "2026-01-01T00:02:00.000Z",
    };
    const observation = { ...body, observationHash: sha256(body) };
    const stored = {
      external_pipeline_id: "100",
      external_job_ids: ["200"],
      provider_status: "SUCCESS",
      provider_revision_token: "revision",
      source_commit_sha: "commit",
      provider_updated_at: "2026-01-01T00:00:00Z",
    };
    expect(() =>
      assertCorporateGitLabObservationMatches(stored, observation as never),
    ).not.toThrow();
    expect(() =>
      assertCorporateGitLabObservationMatches(
        { ...stored, external_job_ids: ["201"] },
        observation as never,
      ),
    ).toThrow("CORPORATE_GITLAB_RESULT_OBSERVATION_CHANGED");
  });
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  const candidate = {
    workspaceId: "workspace",
    projectId: "project",
    attemptId: "attempt",
    commandId: "command",
    observationId: "observation",
    observationHash: "hash",
  };
  const profileRef = { id: "profile", version: 1, contentHash: "profile-hash" },
    connectionRef = { id: "connection", version: 1, contentHash: "connection-hash" };
  const binding = {
    provider: "GITLAB",
    workspaceId: "workspace",
    projectId: "project",
    profileRef,
    connectionRef,
  };
  it("rechecks scoped provider access around the current observation", async () => {
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => [
      { effect_connection_ref: connectionRef, effect_profile_ref: profileRef },
    ]);
    const authorize = vi.fn(async () => true);
    const loader = createCorporateGitLabTerminalObservation({
      source: { isInitialized: true, query },
      environment,
      grants: [{ binding }],
      authority: { authorize },
    } as never);
    expect((await loader.load(candidate, new AbortController().signal)).candidate).toEqual(
      candidate,
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "workspace",
      "project",
      "attempt",
      "command",
      "observation",
      "hash",
    ]);
  });
  it("rejects scope drift and revoked service authorization", async () => {
    const query = vi.fn(async () => [
      { effect_connection_ref: connectionRef, effect_profile_ref: profileRef },
    ]);
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const loader = createCorporateGitLabTerminalObservation({
      source: { isInitialized: true, query },
      environment,
      grants: [{ binding }],
      authority: { authorize },
    } as never);
    await expect(
      loader.load({ ...candidate, projectId: "other" }, new AbortController().signal),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
    expect(query).not.toHaveBeenCalled();
    await expect(loader.load(candidate, new AbortController().signal)).rejects.toThrow(
      "CORPORATE_GITLAB_RESULT_ACCESS_DENIED",
    );
  });
  it("rejects an observation that is no longer current", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { effect_connection_ref: connectionRef, effect_profile_ref: profileRef },
      ])
      .mockResolvedValueOnce([]);
    const loader = createCorporateGitLabTerminalObservation({
      source: { isInitialized: true, query },
      environment,
      grants: [{ binding }],
      authority: { authorize: async () => true },
    } as never);
    await expect(loader.load(candidate, new AbortController().signal)).rejects.toThrow(
      "CORPORATE_GITLAB_RESULT_OBSERVATION_STALE",
    );
  });
});

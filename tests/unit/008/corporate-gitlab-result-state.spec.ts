import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { TypeOrmAutomationExecutionRepository } from "../../../packages/competency-qa/src/node.ts";
import { createCorporateGitLabResultState } from "../../../packages/runtime-composition/src/gitlab/corporate-result-state.ts";

describe("corporate GitLab result state", () => {
  afterEach(() => vi.restoreAllMocks());
  it("rejects local and production environments", () => {
    for (const environment of [
      { profile: "local", environmentScope: "LOCAL" },
      {
        profile: "non-local",
        environmentScope: "PLATFORM_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      },
    ]) {
      expect(() =>
        createCorporateGitLabResultState({ isInitialized: true } as never, environment as never),
      ).toThrow("CORPORATE_GITLAB_RESULT_SCOPE_REQUIRED");
    }
  });

  it("rejects another project before querying durable state", async () => {
    const query = vi.fn();
    const state = createCorporateGitLabResultState(
      { isInitialized: true, query } as never,
      {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      } as never,
    );
    await expect(
      state.load({ workspaceId: "w", projectId: "other", attemptId: "a" }, "RUNNING"),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves a missing attempt for a later pass", async () => {
    const query = vi.fn(async () => []);
    const state = createCorporateGitLabResultState(
      { isInitialized: true, query } as never,
      {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      } as never,
    );
    await expect(
      state.load({ workspaceId: "w", projectId: "p", attemptId: "a" }, "RUNNING"),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
  });

  it("reloads the pinned snapshot, current status and lineage", async () => {
    const body = { workspaceId: "w", projectId: "p", testSessionId: "s" };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const attempt = {
      automationAttemptId: "a",
      workspaceId: "w",
      projectId: "p",
      testSessionId: "s",
      planItemId: "plan",
      rootAttemptId: "a",
      attemptNo: 1,
      targetSnapshotHash: snapshot.snapshotHash,
      currentStatus: "RUNNING",
      currentStatusRevisionId: "status",
      currentStatusRevisionNo: 2,
    };
    vi.spyOn(TypeOrmAutomationExecutionRepository.prototype, "automationAttempt").mockResolvedValue(
      attempt as never,
    );
    vi.spyOn(
      TypeOrmAutomationExecutionRepository.prototype,
      "automationAttempts",
    ).mockResolvedValue([attempt] as never);
    vi.spyOn(
      TypeOrmAutomationExecutionRepository.prototype,
      "automationStatusHistory",
    ).mockResolvedValue([
      { statusRevisionId: "status", revisionNo: 2, status: "RUNNING" },
    ] as never);
    const state = createCorporateGitLabResultState(
      {
        isInitialized: true,
        query: vi.fn(async () => [
          { state: "RUNNING", resource_version: 2, target_snapshot: snapshot },
        ]),
      } as never,
      {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "w", projectIds: ["p"] },
      } as never,
    );
    const loaded = await state.load(
      { workspaceId: "w", projectId: "p", attemptId: "a" },
      "RUNNING",
    );
    expect(loaded).toMatchObject({
      targetSnapshot: snapshot,
      lineage: [attempt],
      previousLineageResults: [],
      session: { state: "RUNNING", resourceVersion: 2 },
    });
  });
});

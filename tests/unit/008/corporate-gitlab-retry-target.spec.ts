import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { verifyCorporateGitLabRetryTarget } from "../../../packages/runtime-composition/src/gitlab/corporate-retry-target.ts";

describe("corporate GitLab retry target", () => {
  function fixture() {
    const ref = { id: "ref", version: 1, contentHash: sha256("ref") };
    const pin = {
      logicalRole: "SOURCE_CONTEXT",
      capabilityKey: "source-context.read",
      exactContractVersion: "1.0.0",
      projectIntegrationBindingRef: ref,
      profileRef: ref,
      connectionRef: ref,
      validationReportRef: ref,
      operationSetHash: sha256("operations"),
    };
    const snapshotBody = {
      workspaceId: "workspace",
      projectId: "project",
      target: { type: "COMMIT", commitSha: "a".repeat(40) },
      configurationPins: [pin],
    };
    const snapshot = { ...snapshotBody, snapshotHash: sha256(snapshotBody) };
    const observationBody = {
      sourceKind: "COMMIT",
      sourceRef: snapshotBody.target.commitSha,
      commitSha: snapshotBody.target.commitSha,
      parentCommitShas: [],
      providerRevisionToken: "revision",
      observedAt: "2026-01-01T00:00:00.000Z",
    };
    const observation = { ...observationBody, observationHash: sha256(observationBody) };
    const source = {
      read: vi.fn(async () => ({
        schemaVersion: "source-context.read@1.0.0",
        messageType: "RESULT",
        operation: "commit.read",
        observation,
      })),
    };
    return {
      snapshot,
      context: {
        scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
        actor: { kind: "SERVICE" },
        signal: new AbortController().signal,
        configurationPins: [{ ...pin, bindingRef: ref }],
      },
      source,
      numericProjectId: 5001,
      revalidate: vi.fn(async () => undefined),
    };
  }

  it("reads the pinned source and revalidates authority on both sides", async () => {
    const input = fixture();
    await expect(verifyCorporateGitLabRetryTarget(input as never)).resolves.toBe(
      (await input.source.read()).observation.observationHash,
    );
    expect(input.revalidate).toHaveBeenCalledTimes(2);
    expect(input.source.read).toHaveBeenCalledWith(
      input.context,
      expect.objectContaining({
        operation: "commit.read",
        selector: expect.objectContaining({ expectedRevision: "a".repeat(40) }),
      }),
    );
  });

  it("rejects a changed commit", async () => {
    const input = fixture();
    const original = await input.source.read();
    const { observationHash: _hash, ...body } = original.observation;
    void _hash;
    const changed = { ...body, commitSha: "b".repeat(40) };
    input.source.read.mockResolvedValueOnce({
      ...original,
      observation: { ...changed, observationHash: sha256(changed) },
    });
    await expect(verifyCorporateGitLabRetryTarget(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_RETRY_TARGET_CHANGED",
    );
  });

  it("rejects revoked access after the read", async () => {
    const input = fixture();
    input.revalidate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ACCESS_REVOKED"));
    await expect(verifyCorporateGitLabRetryTarget(input as never)).rejects.toThrow(
      "ACCESS_REVOKED",
    );
  });

  it("rejects a different project or capability pin before reading", async () => {
    const input = fixture();
    input.context.scope.projectId = "other";
    await expect(verifyCorporateGitLabRetryTarget(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_RETRY_TARGET_INVALID",
    );
    expect(input.source.read).not.toHaveBeenCalled();
    input.context.scope.projectId = "project";
    input.context.configurationPins[0]!.capabilityKey = "other";
    await expect(verifyCorporateGitLabRetryTarget(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_RETRY_TARGET_INVALID",
    );
    expect(input.source.read).not.toHaveBeenCalled();
  });

  it.each([
    ["MERGE_REQUEST", "5001:17", "17", "merge-request.read"],
    ["MERGE_REQUEST", "!17", "17", "merge-request.read"],
    ["BUILD", "gitlab-pipeline:5001:9001", "9001", "build.read"],
    ["BUILD", "pipeline:101", "101", "build.read"],
  ])("uses a scoped provider id for %s %s", async (kind, ref, expectedRef, operation) => {
    const input = fixture();
    const target =
      kind === "BUILD"
        ? { type: kind, buildRef: ref, commitSha: "a".repeat(40) }
        : { type: kind, mergeRequestRef: ref, commitSha: "a".repeat(40) };
    const { snapshotHash: _hash, ...oldBody } = input.snapshot;
    void _hash;
    const body = { ...oldBody, target };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const observationBody =
      kind === "BUILD"
        ? {
            sourceKind: kind,
            sourceRef: expectedRef,
            sourceCommitSha: target.commitSha,
            state: "AVAILABLE",
          }
        : {
            sourceKind: kind,
            sourceRef: expectedRef,
            headCommitSha: target.commitSha,
            state: "OPEN",
          };
    const source = {
      read: vi.fn(async () => ({
        schemaVersion: "source-context.read@1.0.0",
        messageType: "RESULT",
        operation,
        observation: { ...observationBody, observationHash: sha256(observationBody) },
      })),
    };
    await verifyCorporateGitLabRetryTarget({ ...input, snapshot, source } as never);
    expect(source.read).toHaveBeenCalledWith(
      input.context,
      expect.objectContaining({ selector: expect.objectContaining({ sourceRef: expectedRef }) }),
    );
  });

  it("rejects a source reference naming a different GitLab project", async () => {
    const input = fixture();
    const { snapshotHash: _hash, ...oldBody } = input.snapshot;
    void _hash;
    const body = {
      ...oldBody,
      target: { type: "BUILD", buildRef: "gitlab-pipeline:42:9001", commitSha: "a".repeat(40) },
    };
    await expect(
      verifyCorporateGitLabRetryTarget({
        ...input,
        snapshot: { ...body, snapshotHash: sha256(body) },
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RETRY_TARGET_INVALID");
    expect(input.source.read).not.toHaveBeenCalled();
  });
});

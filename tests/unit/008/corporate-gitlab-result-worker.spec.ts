import { describe, expect, it, vi } from "vitest";

import { createCorporateGitLabResultWorker } from "../../../packages/runtime-composition/src/gitlab/corporate-result-worker.ts";

describe("corporate GitLab result worker", () => {
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
  const recovery = {
    workspaceId: "workspace",
    projectId: "project",
    attemptId: "old",
    resultId: "result",
  };
  const request = {
    facts: {
      attempt: {
        workspaceId: "workspace",
        projectId: "project",
        automationAttemptId: "attempt",
        connectorCommandId: "command",
      },
      observation: { observationHash: "hash" },
    },
  };
  it("rechecks authority and processes result and recovery through the existing consumer", async () => {
    const recoveredCandidate = { ...recovery, attemptId: candidate.attemptId };
    const scanner = {
      scan: async () => [candidate],
      scanRetryRecovery: async () => [recoveredCandidate],
    };
    const authority = {
      prepare: vi.fn(async () => request),
      prepareRecovery: vi.fn(async () => ({
        attempt: { workspaceId: "workspace", projectId: "project", automationAttemptId: "attempt" },
        result: { automationAttemptResultId: "result" },
      })),
      revalidate: vi.fn(async () => undefined),
    };
    const consumer = {
      consume: vi.fn(async () => undefined),
      resumeRetry: vi.fn(async () => undefined),
    };
    const worker = createCorporateGitLabResultWorker({
      environment,
      scanner,
      authority,
      consumer,
    } as never);
    expect(await worker.run()).toEqual({ applied: 1, recovered: 1, deferred: 0 });
    expect(authority.revalidate).toHaveBeenCalledTimes(2);
    expect(authority.revalidate).toHaveBeenNthCalledWith(
      1,
      candidate,
      expect.any(AbortSignal),
      request,
    );
    expect(consumer.consume).toHaveBeenCalledOnce();
    expect(consumer.resumeRetry).toHaveBeenCalledOnce();
  });
  it("does not commit a result after revocation or for a different attempt", async () => {
    const scanner = {
      scan: async () => [candidate, { ...candidate, projectId: "other" }],
      scanRetryRecovery: async () => [],
    };
    const authority = {
      prepare: vi.fn(async () => request),
      prepareRecovery: vi.fn(),
      revalidate: vi.fn(async () => {
        throw new Error("ACCESS_REVOKED");
      }),
    };
    const consumer = { consume: vi.fn(), resumeRetry: vi.fn() };
    const worker = createCorporateGitLabResultWorker({
      environment,
      scanner,
      authority,
      consumer,
    } as never);
    expect(await worker.run()).toEqual({ applied: 0, recovered: 0, deferred: 2 });
    expect(authority.prepare).toHaveBeenCalledOnce();
    expect(consumer.consume).not.toHaveBeenCalled();
  });

  it("recovers a saved terminal result when retry evaluation fails after the result commit", async () => {
    const recoveredCandidate = { ...recovery, attemptId: candidate.attemptId };
    const scanner = {
      scan: async () => [candidate],
      scanRetryRecovery: async () => [recoveredCandidate],
    };
    const authority = {
      prepare: vi.fn(async () => request),
      prepareRecovery: vi.fn(async () => ({
        attempt: { workspaceId: "workspace", projectId: "project", automationAttemptId: "attempt" },
        result: { automationAttemptResultId: "result" },
      })),
      revalidate: vi.fn(async () => undefined),
    };
    const consumer = {
      consume: vi.fn(async () => {
        throw new Error("RETRY_WRITE_INTERRUPTED");
      }),
      resumeRetry: vi.fn(async () => undefined),
    };
    const worker = createCorporateGitLabResultWorker({
      environment,
      scanner,
      authority,
      consumer,
    } as never);
    expect(await worker.run()).toEqual({ applied: 0, recovered: 1, deferred: 1 });
    expect(consumer.resumeRetry).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from "vitest";

import { decideGitLabRateHealth } from "../../../packages/connector-gitlab/src/reconciliation/gitlab-rate-health.ts";
import {
  planGitLabReconciliationRead,
  reduceGitLabPipelineObservation,
} from "../../../packages/connector-gitlab/src/reconciliation/gitlab-reconciliation.ts";
import {
  deriveGitLabOperationalHealth,
  deriveQaAutomationExecutionActivity,
} from "../../../packages/runtime-composition/src/gitlab/operational-health.ts";

const current = Object.freeze({
  observationHash: `sha256:${"1".repeat(64)}` as const,
  providerRevisionToken: "running:2",
  providerUpdatedAt: "2026-09-01T12:00:00.000Z",
  providerStatus: "running",
});

describe("Feature 005 GitLab monotonic reconciliation", () => {
  it("advances only to a newer authoritative observation and preserves duplicate/out-of-order history", () => {
    expect(
      reduceGitLabPipelineObservation({ current: undefined, candidate: current }),
    ).toMatchObject({ advanced: true, reason: "INITIAL", effective: current });
    expect(reduceGitLabPipelineObservation({ current, candidate: current })).toMatchObject({
      advanced: false,
      reason: "DUPLICATE",
      effective: current,
    });
    expect(
      reduceGitLabPipelineObservation({
        current,
        candidate: {
          ...current,
          observationHash: `sha256:${"2".repeat(64)}`,
          providerRevisionToken: "pending:1",
          providerUpdatedAt: "2026-09-01T11:59:00.000Z",
          providerStatus: "pending",
        },
      }),
    ).toMatchObject({ advanced: false, reason: "OUT_OF_ORDER", effective: current });
    const newer = {
      ...current,
      observationHash: `sha256:${"3".repeat(64)}` as const,
      providerRevisionToken: "success:3",
      providerUpdatedAt: "2026-09-01T12:01:00.000Z",
      providerStatus: "success",
    };
    expect(reduceGitLabPipelineObservation({ current, candidate: newer })).toMatchObject({
      advanced: true,
      reason: "NEWER",
      effective: newer,
    });
  });

  it("fails closed on two different provider revisions at the same timestamp", () => {
    expect(() =>
      reduceGitLabPipelineObservation({
        current,
        candidate: {
          ...current,
          observationHash: `sha256:${"4".repeat(64)}`,
          providerRevisionToken: "failed:conflict",
          providerStatus: "failed",
        },
      }),
    ).toThrow(expect.objectContaining({ code: "GITLAB_OBSERVATION_SAME_TIME_CONFLICT" }));
  });

  it("repairs a lost webhook within two bounded polls and treats webhook delivery only as a read hint", () => {
    const first = planGitLabReconciliationRead({
      now: "2026-09-01T12:00:30.000Z",
      attemptActive: true,
      lastAuthoritativeReadAt: "2026-09-01T12:00:00.000Z",
      pollCount: 0,
      policy: {
        webhookGraceSeconds: 30,
        pollIntervalSeconds: 30,
        freshnessTargetSeconds: 120,
        maximumRepairPolls: 2,
      },
    });
    expect(first).toMatchObject({
      action: "PIPELINE_READ",
      source: "POLL_REPAIR",
      nextPollCount: 1,
      webhookCanonical: false,
    });
    const hinted = planGitLabReconciliationRead({
      now: "2026-09-01T12:00:31.000Z",
      attemptActive: true,
      webhookHintReceivedAt: "2026-09-01T12:00:30.000Z",
      lastAuthoritativeReadAt: "2026-09-01T12:00:00.000Z",
      pollCount: 1,
      policy: {
        webhookGraceSeconds: 30,
        pollIntervalSeconds: 30,
        freshnessTargetSeconds: 120,
        maximumRepairPolls: 2,
      },
    });
    expect(hinted).toMatchObject({
      action: "PIPELINE_READ",
      source: "WEBHOOK_HINT",
      nextPollCount: 1,
      webhookCanonical: false,
    });
    expect(
      planGitLabReconciliationRead({
        now: "2026-09-01T12:01:00.000Z",
        attemptActive: true,
        lastAuthoritativeReadAt: "2026-09-01T12:00:30.000Z",
        pollCount: 2,
        policy: {
          webhookGraceSeconds: 30,
          pollIntervalSeconds: 30,
          freshnessTargetSeconds: 120,
          maximumRepairPolls: 2,
        },
      }),
    ).toMatchObject({ action: "EXHAUSTED", reasonCode: "REPAIR_POLL_BUDGET_EXHAUSTED" });
  });

  it("closes 401/403 without retry and applies server-hint-aware bounded 429/5xx backoff", () => {
    const policy = {
      maximumReadRetries: 3,
      minimumBackoffMs: 1_000,
      maximumBackoffMs: 30_000,
    } as const;
    for (const httpStatus of [401, 403]) {
      expect(
        decideGitLabRateHealth({
          operation: "READ",
          httpStatus,
          attempt: 1,
          observedAt: "2026-09-01T12:00:00.000Z",
          policy,
        }),
      ).toEqual(
        expect.objectContaining({ decision: "AUTH_DEGRADED", retry: false, terminal: true }),
      );
    }
    expect(
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 429,
        retryAfterSeconds: 17,
        attempt: 1,
        observedAt: "2026-09-01T12:00:00.000Z",
        policy,
      }),
    ).toMatchObject({
      decision: "BACKOFF",
      retry: true,
      backoffMs: 17_000,
      nextEligibleAt: "2026-09-01T12:00:17.000Z",
    });
    expect(
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 503,
        attempt: 3,
        observedAt: "2026-09-01T12:00:00.000Z",
        policy,
      }),
    ).toMatchObject({ decision: "BACKOFF", retry: true, backoffMs: 4_000 });
    expect(
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 503,
        attempt: 4,
        observedAt: "2026-09-01T12:00:00.000Z",
        policy,
      }),
    ).toMatchObject({ decision: "UNAVAILABLE", retry: false, terminal: true });
    for (const retryAfterSeconds of [60, NaN, Infinity, -1])
      expect(
        decideGitLabRateHealth({
          operation: "READ",
          httpStatus: 429,
          retryAfterSeconds,
          attempt: 1,
          observedAt: "2026-09-01T12:00:00.000Z",
          policy,
        }),
      ).toMatchObject({ decision: "UNAVAILABLE", retry: false, terminal: true });
    expect(
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 429,
        retryAfterSeconds: 1,
        attempt: 3,
        observedAt: "2026-09-01T12:00:00.000Z",
        policy,
      }),
    ).toMatchObject({ backoffMs: 4000 });
  });

  it("never retries a trigger write after the durable post marker", () => {
    expect(
      decideGitLabRateHealth({
        operation: "TRIGGER_POST_MARKED",
        httpStatus: 503,
        attempt: 1,
        observedAt: "2026-09-01T12:00:00.000Z",
        policy: { maximumReadRetries: 3, minimumBackoffMs: 1_000, maximumBackoffMs: 30_000 },
      }),
    ).toMatchObject({
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: "POST_MARKER_WRITE_RETRY_FORBIDDEN",
    });
  });

  it("derives Connection freshness independently from structural FULL_QA and exposes pending/error recovery state", () => {
    const base = {
      now: "2026-09-01T12:02:00.000Z",
      discoveryExpiresAt: "2026-09-08T12:00:00.000Z",
      freshnessTargetSeconds: 120,
      activeAttemptCount: 1,
      pendingReadCount: 0,
    } as const;
    expect(deriveGitLabOperationalHealth({ ...base, pendingReadCount: 1 })).toMatchObject({
      connectionHealth: "AVAILABLE",
      freshness: "PENDING",
      liveAvailability: "AVAILABLE",
      reasonCodes: [],
    });
    expect(
      deriveGitLabOperationalHealth({
        ...base,
        lastAuthoritativeReadAt: "2026-09-01T11:59:00.000Z",
      }),
    ).toMatchObject({
      connectionHealth: "AVAILABLE",
      freshness: "STALE",
      liveAvailability: "DEGRADED",
      reasonCodes: ["RECONCILIATION_STALE"],
    });
    expect(
      deriveGitLabOperationalHealth({
        ...base,
        rate: { decision: "AUTH_DEGRADED", httpStatus: 401 },
      }),
    ).toMatchObject({
      connectionHealth: "AUTH_DEGRADED",
      freshness: "ERROR",
      liveAvailability: "UNAVAILABLE",
      reasonCodes: ["AUTH_REVOKED"],
    });
    expect(
      deriveGitLabOperationalHealth({
        ...base,
        rate: { decision: "BACKOFF", httpStatus: 429, nextEligibleAt: "2026-09-01T12:02:17.000Z" },
      }),
    ).toMatchObject({
      connectionHealth: "BACKOFF",
      freshness: "PENDING",
      liveAvailability: "DEGRADED",
      reasonCodes: ["RATE_LIMITED"],
    });
  });

  it("keeps execution activity derived instead of mutating sticky Session state", () => {
    expect(deriveQaAutomationExecutionActivity({ attemptExists: false })).toBe("IDLE");
    expect(
      deriveQaAutomationExecutionActivity({
        attemptExists: true,
        currentStatus: "TRIGGER_PENDING",
        commandState: "QUEUED",
        freshness: "CURRENT",
      }),
    ).toBe("TRIGGER_PENDING");
    expect(
      deriveQaAutomationExecutionActivity({
        attemptExists: true,
        currentStatus: "RUNNING",
        commandState: "CONFIRMED",
        freshness: "STALE",
      }),
    ).toBe("RECONCILING");
    expect(
      deriveQaAutomationExecutionActivity({
        attemptExists: true,
        currentStatus: "TERMINAL",
        retryScheduled: true,
        successorExists: false,
      }),
    ).toBe("RETRY_PENDING");
    expect(
      deriveQaAutomationExecutionActivity({
        attemptExists: true,
        currentStatus: "TERMINAL",
        retryScheduled: false,
      }),
    ).toBe("TERMINAL");
  });
});

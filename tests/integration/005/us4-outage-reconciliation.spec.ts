import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decideGitLabRateHealth } from "../../../packages/connector-gitlab/src/reconciliation/gitlab-rate-health.ts";
import {
  type GitLabPipelineObservationInput,
  GitLabReconciliationPersistenceError,
  TypeOrmGitLabReconciliationRepository,
} from "../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";

const workspaceId = "550e8400-e29b-41d4-a716-446655440301";
const connectionHeaderId = "550e8400-e29b-41d4-a716-446655440302";
const profileId = "550e8400-e29b-41d4-a716-446655440303";
const scope = Object.freeze({ workspaceId, connectionHeaderId, numericProjectId: 5001 });
const connectionRef = Object.freeze({
  id: connectionHeaderId,
  version: 1,
  contentHash: `sha256:${"1".repeat(64)}`,
});
const profileRef = Object.freeze({
  id: profileId,
  version: 1,
  contentHash: `sha256:${"2".repeat(64)}`,
});
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let repository: TypeOrmGitLabReconciliationRepository;

function observation(
  id: string,
  providerUpdatedAt: string,
  providerStatus: string,
  character: string,
): GitLabPipelineObservationInput {
  return {
    pipelineObservationId: id,
    scope,
    connectionRef,
    profileRef,
    externalPipelineId: "101",
    externalJobIds: ["1001"],
    providerStatus,
    providerRevisionToken: `${providerStatus}:${providerUpdatedAt}`,
    providerUpdatedAt,
    sourceCommitSha: "a".repeat(40),
    sourceRefHash: hash("3"),
    markerHash: hash("4"),
    normalizedJobSetHash: hash("5"),
    sourceKind: "RECONCILIATION",
    sourceRef: { id: `source:${id}`, version: 1, contentHash: hash("6") },
    observationHash: hash(character),
    observedAt: "2026-09-01T12:02:00.000Z",
  };
}

beforeAll(async () => {
  const { qaJiraGitLabLocalComposition, qaJiraGitLabLocalMigrationRegistry } =
    await import("../../../packages/runtime-composition/src/gitlab/composition.ts");
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaJiraGitLabLocalComposition.entities,
    migrations: migrationClasses(qaJiraGitLabLocalMigrationRegistry),
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  repository = new TypeOrmGitLabReconciliationRepository(source);
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("Feature 005 US4 durable outage reconciliation", () => {
  it("keeps duplicate/out-of-order observations as history while advancing only the monotonic head", async () => {
    const running = await repository.appendPipelineObservation(
      observation(
        "550e8400-e29b-41d4-a716-446655440311",
        "2026-09-01T12:00:00.000Z",
        "running",
        "7",
      ),
    );
    expect(running).toMatchObject({
      inserted: true,
      headAdvanced: true,
      head: { resource_version: 1 },
    });
    const duplicate = await repository.appendPipelineObservation(
      observation(
        "550e8400-e29b-41d4-a716-446655440312",
        "2026-09-01T12:00:00.000Z",
        "running",
        "7",
      ),
    );
    expect(duplicate).toMatchObject({ inserted: false, headAdvanced: false });
    const older = await repository.appendPipelineObservation(
      observation(
        "550e8400-e29b-41d4-a716-446655440313",
        "2026-09-01T11:59:00.000Z",
        "pending",
        "8",
      ),
    );
    expect(older).toMatchObject({
      inserted: true,
      headAdvanced: false,
      head: { current_observation_id: "550e8400-e29b-41d4-a716-446655440311" },
    });
    const terminal = await repository.appendPipelineObservation(
      observation(
        "550e8400-e29b-41d4-a716-446655440314",
        "2026-09-01T12:01:00.000Z",
        "success",
        "9",
      ),
    );
    expect(terminal).toMatchObject({
      inserted: true,
      headAdvanced: true,
      head: { current_observation_id: "550e8400-e29b-41d4-a716-446655440314", resource_version: 2 },
    });
    expect(await repository.pipelineHistory(scope, "101")).toHaveLength(3);
    expect(await repository.pipelineHead(scope, "101")).toMatchObject({
      provider_status: "success",
      observation_hash: hash("9"),
    });
  });

  it("survives repository restart and rejects a stale cursor fencing token", async () => {
    const cursor = await repository.ensureCursor({
      reconciliationCursorId: "550e8400-e29b-41d4-a716-446655440321",
      scope,
      profileRef,
      lane: "WEBHOOK_REPAIR",
      boundedWindowStart: "2026-09-01T12:00:00.000Z",
      boundedWindowEnd: "2026-09-01T12:02:00.000Z",
      nextEligibleAt: "2026-09-01T12:00:00.000Z",
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    const first = await repository.claimCursor({
      reconciliationCursorId: String(cursor.reconciliation_cursor_id),
      expectedResourceVersion: 1,
      leaseOwner: "worker-a",
      now: "2026-09-01T12:00:01.000Z",
      leaseSeconds: 30,
    });
    expect(first).toMatchObject({
      lease_owner: "worker-a",
      lease_token: "1",
      resource_version: "2",
    });
    await expect(
      repository.advanceCursor({
        reconciliationCursorId: String(cursor.reconciliation_cursor_id),
        expectedResourceVersion: 2,
        leaseOwner: "worker-b",
        leaseToken: 1,
        boundedWindowStart: "2026-09-01T12:00:30.000Z",
        boundedWindowEnd: "2026-09-01T12:02:30.000Z",
        nextEligibleAt: "2026-09-01T12:01:00.000Z",
        updatedAt: "2026-09-01T12:00:02.000Z",
      }),
    ).rejects.toMatchObject({
      code: "GITLAB_RECONCILIATION_FENCE_STALE",
    } satisfies Partial<GitLabReconciliationPersistenceError>);
    const advanced = await repository.advanceCursor({
      reconciliationCursorId: String(cursor.reconciliation_cursor_id),
      expectedResourceVersion: 2,
      leaseOwner: "worker-a",
      leaseToken: 1,
      boundedWindowStart: "2026-09-01T12:00:30.000Z",
      boundedWindowEnd: "2026-09-01T12:02:30.000Z",
      cursorValueHash: hash("a"),
      nextEligibleAt: "2026-09-01T12:01:00.000Z",
      updatedAt: "2026-09-01T12:00:02.000Z",
    });
    expect(advanced).toMatchObject({
      lease_owner: null,
      cursor_value_hash: hash("a"),
      resource_version: "3",
    });
    repository = new TypeOrmGitLabReconciliationRepository(source!);
    expect(
      await repository.cursorsDue("WEBHOOK_REPAIR", new Date("2026-09-01T12:01:00.000Z"), 10),
    ).toHaveLength(1);
  });

  it("persists closed auth degradation and bounded rate/server backoff as append-only snapshots", async () => {
    const policy = {
      maximumReadRetries: 2,
      minimumBackoffMs: 1_000,
      maximumBackoffMs: 30_000,
    } as const;
    const decisions = [
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 401,
        attempt: 1,
        observedAt: "2026-09-01T12:03:00.000Z",
        policy,
      }),
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 429,
        retryAfterSeconds: 11,
        attempt: 1,
        observedAt: "2026-09-01T12:04:00.000Z",
        policy,
      }),
      decideGitLabRateHealth({
        operation: "READ",
        httpStatus: 503,
        attempt: 2,
        observedAt: "2026-09-01T12:05:00.000Z",
        policy,
      }),
    ];
    for (const [index, decision] of decisions.entries()) {
      await repository.appendRateLimitSnapshot({
        rateLimitSnapshotId: `550e8400-e29b-41d4-a716-44665544033${index}`,
        scope,
        profileRef,
        lane: "READ",
        httpStatus: [401, 429, 503][index]!,
        ...(index === 1 ? { retryAfterSeconds: 11 } : {}),
        decision: decision.decision,
        ...(decision.nextEligibleAt === undefined
          ? {}
          : { nextEligibleAt: decision.nextEligibleAt }),
        ...(decision.errorCode === undefined ? {} : { errorCode: decision.errorCode }),
        observedAt: decision.observedAt,
        contentHash: hash(String.fromCharCode(98 + index)),
      });
    }
    expect(await repository.latestRateLimitSnapshot(scope, "READ")).toMatchObject({
      http_status: 503,
      decision: "BACKOFF",
    });
    await expect(
      source!.query(
        "UPDATE gitlab_rate_limit_snapshots SET decision='AVAILABLE' WHERE http_status=401",
      ),
    ).rejects.toThrow("APPEND_ONLY");
  });
});

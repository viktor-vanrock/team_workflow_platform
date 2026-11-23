import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type GitLabEffectClaimInput,
  gitLabEffectRecoveryMode,
  TypeOrmGitLabEffectRepository,
} from "../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { qaJiraGitLabLocalComposition } from "../../../packages/runtime-composition/src/gitlab/composition.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionHeaderId = "22222222-2222-4222-8222-222222222222";
const scope = Object.freeze({ workspaceId, connectionHeaderId, numericProjectId: 5001 });
let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let repository: TypeOrmGitLabEffectRepository;

function claimInput(ordinal: number): GitLabEffectClaimInput {
  return {
    effectReconciliationId: `30000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    workspaceId,
    commandId: `40000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    effectId: `qa:automation:effect-${ordinal}`,
    connectionHeaderId,
    connectionRef: { id: connectionHeaderId, version: 1, contentHash: digest("1") },
    profileRef: {
      id: "50000000-0000-4000-8000-000000000001",
      version: 1,
      contentHash: digest("2"),
    },
    numericProjectId: 5001,
    exactRefHash: digest("3"),
    expectedCommitSha: "a".repeat(40),
    triggerRequestHash: digest("4"),
    payloadHash: digest("5"),
    markerHash: digest(String((ordinal % 9) + 1)),
    creationWindowStart: "2026-09-01T08:00:00.000Z",
    creationWindowEnd: "2026-09-01T08:02:00.000Z",
    createdAt: "2026-09-01T08:00:00.000Z",
  };
}

beforeAll(async () => {
  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaJiraGitLabLocalComposition.entities,
    migrations: qaJiraGitLabLocalComposition.migrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  repository = new TypeOrmGitLabEffectRepository(source);
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("durable GitLab trigger reconciliation", () => {
  it("allows a bounded retry only while durable state proves no invocation marker", async () => {
    const claimed = await repository.claim(claimInput(1));
    expect(claimed).toMatchObject({
      replayed: false,
      record: { state: "NOT_STARTED", attemptCount: 0 },
    });
    expect(gitLabEffectRecoveryMode(claimed.record)).toBe("TRIGGER_ALLOWED");

    const preEffect = await repository.recordPreInvocationFailure(scope, claimed.record.effectId, {
      expectedResourceVersion: 1,
      retryAt: "2026-09-01T08:00:02.000Z",
      updatedAt: "2026-09-01T08:00:01.000Z",
    });
    expect(preEffect).toMatchObject({ state: "NOT_STARTED", attemptCount: 1, resourceVersion: 2 });
    expect(gitLabEffectRecoveryMode(preEffect)).toBe("TRIGGER_ALLOWED");

    const marked = await repository.markInvocationStarted(scope, preEffect.effectId, {
      expectedResourceVersion: 2,
      startedAt: "2026-09-01T08:00:03.000Z",
    });
    expect(marked).toMatchObject({ state: "EFFECT_STARTED", attemptCount: 2, resourceVersion: 3 });
    expect(gitLabEffectRecoveryMode(marked)).toBe("LOOKUP_ONLY");
    await expect(
      repository.markInvocationStarted(scope, marked.effectId, {
        expectedResourceVersion: 3,
        startedAt: "2026-09-01T08:00:04.000Z",
      }),
    ).resolves.toEqual(marked);
  });

  it("routes possible acceptance through bounded lookup and settles unresolved ambiguity", async () => {
    const claim = (await repository.claim(claimInput(2))).record;
    const marked = await repository.markInvocationStarted(scope, claim.effectId, {
      expectedResourceVersion: 1,
      startedAt: "2026-09-01T08:00:01.000Z",
    });
    const lookup = await repository.markLookupRequired(scope, marked.effectId, {
      expectedResourceVersion: 2,
      lookupQueryHash: digest("6"),
      updatedAt: "2026-09-01T08:00:02.000Z",
    });
    const zero = await repository.recordLookup(scope, lookup.effectId, {
      expectedResourceVersion: 3,
      effectLookupObservationId: "60000000-0000-4000-8000-000000000001",
      lookupQueryHash: digest("6"),
      observedWindowStart: "2026-09-01T08:00:00.000Z",
      observedWindowEnd: "2026-09-01T08:01:00.000Z",
      outcome: "ZERO",
      matchCommitmentHashes: [],
      observationHash: digest("7"),
      observedAt: "2026-09-01T08:01:00.000Z",
      final: false,
      nextLookupAt: "2026-09-01T08:01:10.000Z",
    });
    expect(zero).toMatchObject({ state: "LOOKUP_REQUIRED", matchCount: 0, resourceVersion: 4 });
    expect(gitLabEffectRecoveryMode(zero)).toBe("LOOKUP_ONLY");

    const ambiguous = await repository.recordLookup(scope, zero.effectId, {
      expectedResourceVersion: 4,
      effectLookupObservationId: "60000000-0000-4000-8000-000000000002",
      lookupQueryHash: digest("8"),
      observedWindowStart: "2026-09-01T08:01:00.000Z",
      observedWindowEnd: "2026-09-01T08:02:00.000Z",
      outcome: "MULTIPLE",
      matchCommitmentHashes: [digest("9"), digest("a")],
      observationHash: digest("b"),
      observedAt: "2026-09-01T08:02:00.000Z",
      final: true,
    });
    expect(ambiguous).toMatchObject({ state: "AMBIGUOUS", matchCount: 2, resourceVersion: 5 });
    expect(gitLabEffectRecoveryMode(ambiguous)).toBe("TERMINAL");
  });

  it("attaches and confirms only one exact receipt", async () => {
    const claim = (await repository.claim(claimInput(3))).record;
    const marked = await repository.markInvocationStarted(scope, claim.effectId, {
      expectedResourceVersion: 1,
      startedAt: "2026-09-01T08:00:01.000Z",
    });
    const found = await repository.recordLookup(scope, marked.effectId, {
      expectedResourceVersion: 2,
      effectLookupObservationId: "70000000-0000-4000-8000-000000000001",
      lookupQueryHash: digest("c"),
      observedWindowStart: "2026-09-01T08:00:00.000Z",
      observedWindowEnd: "2026-09-01T08:02:00.000Z",
      outcome: "EXACT_ONE",
      externalPipelineId: "901",
      receiptHash: digest("d"),
      matchCommitmentHashes: [digest("e")],
      observationHash: digest("f"),
      observedAt: "2026-09-01T08:01:00.000Z",
      final: true,
    });
    expect(found).toMatchObject({
      state: "ONE_FOUND",
      externalPipelineId: "901",
      receiptHash: digest("d"),
    });
    const confirmed = await repository.confirm(scope, found.effectId, {
      expectedResourceVersion: 3,
      externalPipelineId: "901",
      receiptHash: digest("d"),
      confirmedAt: "2026-09-01T08:01:01.000Z",
    });
    expect(confirmed).toMatchObject({
      state: "CONFIRMED",
      externalPipelineId: "901",
      resourceVersion: 4,
    });
    expect(gitLabEffectRecoveryMode(confirmed)).toBe("CONFIRMED");
  });
});

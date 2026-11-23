import { describe, expect, it } from "vitest";

import { GitLabController } from "../../../apps/mock-hub/src/gitlab/api/gitlab.controller.ts";
import {
  GitLabControlController,
  GitLabMockControlPolicy,
} from "../../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts";
import {
  gitLabMockMigrations,
  gitLabUs4ScenarioIds,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
} from "../../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { GitLabWebhookEmitter } from "../../../apps/mock-hub/src/gitlab/webhooks/gitlab-webhook-emitter.ts";
import { createMockHubDataSource } from "../../../apps/mock-hub/src/persistence/data-source.ts";
import { verifyAndNormalizeGitLabWebhook } from "../../../packages/connector-gitlab/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { gitLabUs4ScenarioCatalog } from "../../../tools/local/gitlab-scenario-catalog.mts";

function verifyMockPacket(packet: NonNullable<Awaited<ReturnType<GitLabWebhookEmitter["next"]>>>) {
  const receivedAt = new Date(Number(packet.headers.webhookTimestamp) * 1_000).toISOString();
  return verifyAndNormalizeGitLabWebhook({
    rawBody: packet.rawBody,
    contentType: packet.contentType,
    headers: packet.headers,
    secret: new TextEncoder().encode("mock-gitlab-webhook"),
    receivedAt,
    route: {
      connectionId: "550e8400-e29b-41d4-a716-446655440501",
      workspaceId: "550e8400-e29b-41d4-a716-446655440502",
      projectId: "550e8400-e29b-41d4-a716-446655440503",
      numericProjectId: 5001,
    },
    policy: {
      verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
      maxRawBytes: 1_048_576,
      freshnessSeconds: 300,
      dedupeHorizonSeconds: 86_400,
      eventKinds: ["PIPELINE_HOOK", "JOB_HOOK"],
    },
  });
}

describe("stateful Mock Hub GitLab foundation", () => {
  it("persists project/MR/commit fixtures and one-shot fault state across repository restart", async () => {
    const postgres = await startPostgres();
    try {
      const source = createMockHubDataSource(postgres.url, gitLabMockMigrations);
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      await seedGitLabRepository(source);
      const first = new TypeOrmGitLabRepository(source);
      expect(await first.project(5001)).toMatchObject({
        id: 5001,
        pathWithNamespace: "local/qa-smoke",
      });
      expect(await first.mergeRequest(5001, 17)).toMatchObject({
        iid: 17,
        headCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      expect(await first.commit(5001, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toMatchObject({
        projectId: 5001,
      });
      await first.setFault({
        projectId: 5001,
        operation: "PROJECT_READ",
        fault: "SERVER_500",
        remaining: 1,
      });

      const restarted = new TypeOrmGitLabRepository(source);
      await expect(restarted.project(5001)).rejects.toThrow("GITLAB_MOCK_SERVER_500");
      expect(await restarted.project(5001)).toMatchObject({ id: 5001 });
      await expect(restarted.project(5002)).rejects.toThrow("GITLAB_MOCK_PROJECT_SCOPE_FORBIDDEN");
      await source.destroy();
    } finally {
      await postgres.stop();
    }
  }, 120_000);

  it("persists every provider trigger effect and distinguishes pre-effect, possible-effect, ZERO, and MULTIPLE faults", async () => {
    const postgres = await startPostgres();
    try {
      const source = createMockHubDataSource(postgres.url, gitLabMockMigrations);
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      await seedGitLabRepository(source);
      const repository = new TypeOrmGitLabRepository(source);
      const request = {
        projectId: 5001,
        ref: "refs/heads/qa/smoke",
        pipelineName: "awp:attempt-1:request-1",
        inputs: {
          AWP_REQUEST_MARKER: `sha256:${"d".repeat(64)}`,
          AWP_SUITE_KEY: "smoke",
          AWP_ENVIRONMENT_REF: "environment:test:qa-1@17",
          AWP_COMMIT_SHA: "a".repeat(40),
        },
      } as const;

      const first = await repository.triggerPipeline(request);
      expect(first).toMatchObject({
        id: 102,
        name: request.pipelineName,
        sha: request.inputs.AWP_COMMIT_SHA,
        status: "pending",
      });
      expect(await repository.pipelines(5001, request.ref)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 102, marker_hash: request.inputs.AWP_REQUEST_MARKER }),
        ]),
      );

      await repository.setFault({
        projectId: 5001,
        operation: "PIPELINE_TRIGGER",
        fault: "TIMEOUT_BEFORE_INVOCATION",
        remaining: 1,
      });
      await expect(
        repository.triggerPipeline({
          ...request,
          pipelineName: "awp:attempt-2:request-2",
          inputs: { ...request.inputs, AWP_REQUEST_MARKER: `sha256:${"e".repeat(64)}` },
        }),
      ).rejects.toThrow("GITLAB_MOCK_TIMEOUT_BEFORE_INVOCATION");
      expect(
        (await repository.pipelines(5001, request.ref)).filter(({ id }) => Number(id) > 101),
      ).toHaveLength(1);

      await repository.setFault({
        projectId: 5001,
        operation: "PIPELINE_TRIGGER",
        fault: "TIMEOUT_AFTER_POSSIBLE_EFFECT",
        remaining: 1,
      });
      await expect(
        repository.triggerPipeline({
          ...request,
          pipelineName: "awp:attempt-3:request-3",
          inputs: { ...request.inputs, AWP_REQUEST_MARKER: `sha256:${"f".repeat(64)}` },
        }),
      ).rejects.toThrow("GITLAB_MOCK_TIMEOUT_AFTER_POSSIBLE_EFFECT");
      expect(
        (await repository.pipelines(5001, request.ref)).filter(({ id }) => Number(id) > 101),
      ).toHaveLength(2);

      await repository.setFault({
        projectId: 5001,
        operation: "PIPELINE_READ",
        fault: "LOOKUP_ZERO",
        remaining: 1,
      });
      expect(await repository.pipelines(5001, request.ref)).toEqual([]);
      await repository.setFault({
        projectId: 5001,
        operation: "PIPELINE_READ",
        fault: "LOOKUP_MULTIPLE",
        remaining: 1,
      });
      const multiple = await repository.pipelines(5001, request.ref);
      expect(multiple.length).toBeGreaterThan(3);

      const state = await repository.snapshot(5001);
      const calls = state.calls as readonly Readonly<Record<string, unknown>>[];
      expect(
        calls
          .filter(({ operation }) => operation === "PIPELINE_TRIGGER")
          .map(({ outcome }) => outcome),
      ).toEqual(["SUCCESS", "TIMEOUT_BEFORE_INVOCATION", "TIMEOUT_AFTER_POSSIBLE_EFFECT"]);
      expect(
        calls.find(({ outcome }) => outcome === "TIMEOUT_AFTER_POSSIBLE_EFFECT"),
      ).toMatchObject({
        effect_marker_hash: `sha256:${"f".repeat(64)}`,
        external_pipeline_id: "103",
      });
      await source.destroy();
    } finally {
      await postgres.stop();
    }
  }, 120_000);

  it("emits signed lost/duplicate/out-of-order deliveries and persists all six US4 one-shot fault plans", async () => {
    const postgres = await startPostgres();
    try {
      const source = createMockHubDataSource(postgres.url, gitLabMockMigrations);
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      await seedGitLabRepository(source);
      const repository = new TypeOrmGitLabRepository(source);
      const emitter = new GitLabWebhookEmitter(source);
      const control = new GitLabControlController(
        repository,
        new GitLabMockControlPolicy("local-gitlab-control", [5001]),
        emitter,
      );
      const api = new GitLabController(new TypeOrmGitLabRepository(source));

      expect(gitLabUs4ScenarioIds).toHaveLength(6);
      expect(Object.keys(gitLabUs4ScenarioCatalog)).toEqual(gitLabUs4ScenarioIds);

      await control.scenario("local-gitlab-control", {
        projectId: 5001,
        scenarioId: "us4-lost-webhook-reconciliation",
      });
      expect(await emitter.next(5001)).toBeUndefined();
      expect((await repository.snapshot(5001)).webhookDeliveries).toEqual([
        expect.objectContaining({ state: "DROPPED", delivery_attempt: 0 }),
      ]);

      await control.scenario("local-gitlab-control", {
        projectId: 5001,
        scenarioId: "us4-duplicate-webhook",
      });
      const duplicateFirst = (await emitter.next(5001))!;
      const duplicateSecond = (await emitter.next(5001))!;
      expect(verifyMockPacket(duplicateFirst)).toMatchObject({
        status: "ACCEPTED",
        signatureValid: true,
        eventKind: "PIPELINE_HOOK",
      });
      expect(duplicateSecond).toMatchObject({
        deliveryId: duplicateFirst.deliveryId,
        deliveryAttempt: 2,
        duplicate: true,
      });
      expect(Buffer.from(duplicateSecond.rawBody)).toEqual(Buffer.from(duplicateFirst.rawBody));
      expect(await emitter.next(5001)).toBeUndefined();

      await control.scenario("local-gitlab-control", {
        projectId: 5001,
        scenarioId: "us4-out-of-order-webhook",
      });
      const newer = (await emitter.next(5001))!;
      const older = (await emitter.next(5001))!;
      const newerVerified = verifyMockPacket(newer);
      const olderVerified = verifyMockPacket(older);
      expect(newerVerified).toMatchObject({ status: "ACCEPTED", eventKind: "JOB_HOOK" });
      expect(olderVerified).toMatchObject({
        status: "ACCEPTED",
        eventKind: "PIPELINE_HOOK",
        normalized: { externalStatus: "running" },
      });
      expect(Date.parse(newerVerified.normalized!.providerObservedAt)).toBeGreaterThan(
        Date.parse(olderVerified.normalized!.providerObservedAt),
      );

      for (const [scenarioId, status, fault] of [
        ["us4-gitlab-outage-manual-flow", 500, "SERVER_500"],
        ["us4-auth-revoked", 401, "AUTHENTICATION_401"],
        ["us4-rate-limit-recovery", 429, "RATE_LIMIT_429"],
      ] as const) {
        await control.scenario("local-gitlab-control", { projectId: 5001, scenarioId });
        const restartedApi = new GitLabController(new TypeOrmGitLabRepository(source));
        const headers = new Map<string, string>();
        await expect(
          restartedApi.pipeline("mock-gitlab-read", "5001", "101", {
            setHeader: (name, value) => headers.set(name, value),
          }),
        ).rejects.toMatchObject({ status });
        if (status === 429) expect(headers.get("Retry-After")).toBe("11");
        await expect(
          restartedApi.pipeline("mock-gitlab-read", "5001", "101"),
        ).resolves.toMatchObject({ id: 101 });
        const calls = (await repository.snapshot(5001)).calls as readonly Readonly<
          Record<string, unknown>
        >[];
        expect(calls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ operation: "PIPELINE_READ", outcome: fault }),
          ]),
        );
      }

      await repository.setFault({
        projectId: 5001,
        operation: "PIPELINE_READ",
        fault: "PERMISSION_403",
        remaining: 1,
      });
      await expect(api.pipeline("mock-gitlab-read", "5001", "101")).rejects.toMatchObject({
        status: 403,
      });
      await expect(api.pipeline("mock-gitlab-read", "5001", "101")).resolves.toMatchObject({
        id: 101,
      });
      await source.destroy();
    } finally {
      await postgres.stop();
    }
  }, 120_000);
});

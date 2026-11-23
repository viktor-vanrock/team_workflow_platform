import "../../apps/mock-hub/node_modules/reflect-metadata/Reflect.js";

import { createHash, createHmac, randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NestFactory } from "../../apps/mock-hub/node_modules/@nestjs/core/index.js";
import {
  GitLabControlController,
  GitLabMockControlPolicy,
} from "../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts";
import {
  gitLabMockMigrations,
  GitLabModule,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
} from "../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import { QaAutomatedSessionExecutor } from "../../packages/competency-qa/src/ui/automated-session-executor.tsx";
import {
  createGitLabDialect,
  createGitLabRestPipelineReadTransport,
  GitLabAuth,
  GitLabPipelineReader,
  GitLabRestClient,
} from "../../packages/connector-gitlab/src/index.ts";
import type {
  PipelineReadRequest,
  TrustedConnectorOperationContext,
} from "../../packages/connector-sdk/src/index.ts";
import {
  buildQaJiraGitLabLocalSeedConfiguration,
  type GitLabAuthoritativeReadHandler,
  loadEnvironment,
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
  qaJiraGitLabLocalSeedIds,
  runQaJiraGitLabLocalSeed,
  TypeOrmGitLabAuthoritativeReadOutboxWorker,
  TypeOrmGitLabWebhookAuthorityLoader,
  TypeOrmGitLabWebhookIngressService,
} from "../../packages/runtime-composition/src/index.ts";
import {
  executeUs3CleanPass,
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  type Us3DatabaseFixture,
} from "../support/002-us3-database.ts";

const digest = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const sourceCommitSha = "a".repeat(40);
const webhookSecret = new TextEncoder().encode("mock-gitlab-webhook");

let fixture: Us3DatabaseFixture | undefined;
let mockSource: ReturnType<typeof createMockHubDataSource> | undefined;
let mockApp: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let control: GitLabControlController;
let ingress: TypeOrmGitLabWebhookIngressService;
let reader: GitLabPipelineReader;
let now = new Date("2026-09-01T12:00:00.000Z");

function exactRef(ref: Readonly<{ id: string; version: number; contentHash: string }>) {
  if (!/^sha256:[a-f0-9]{64}$/.test(ref.contentHash))
    throw new Error("Expected an exact configuration digest");
  return { ...ref, contentHash: ref.contentHash as `sha256:${string}` };
}

function context(
  profileRef: Readonly<{ id: string; version: number; contentHash: string }>,
  connectionRef: Readonly<{ id: string; version: number; contentHash: string }>,
): TrustedConnectorOperationContext {
  return {
    scope: { kind: "PROJECT", workspaceId: fixture!.workspaceId, projectId: fixture!.projectId },
    actor: { kind: "SERVICE", principalId: "worker-us4", serviceKey: "gitlab-reconciliation" },
    correlationId: randomUUID(),
    causationId: randomUUID(),
    effectIdempotencyKey: `gitlab:read:${now.toISOString()}`,
    profileRef: { id: profileRef.id, version: profileRef.version },
    classification: { key: "INTERNAL", rank: 20 },
    signal: new AbortController().signal,
    authorizationBasisHash: digest("us4-auth"),
    configurationPins: [
      {
        logicalRole: "TEST_EXECUTION",
        capabilityKey: "test-executor.trigger-status",
        exactContractVersion: "1.0.0",
        bindingRef: {
          id: qaJiraGitLabLocalSeedIds.binding,
          version: 1,
          contentHash: digest("us4-binding"),
        },
        profileRef: exactRef(profileRef),
        connectionRef: exactRef(connectionRef),
        validationReportRef: {
          id: qaJiraGitLabLocalSeedIds.validation,
          version: 1,
          contentHash: digest("us4-validation"),
        },
        operationSetHash: digest("us4-operations"),
      },
    ],
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    telemetry: {
      correlationId: "us4-correlation",
      causationId: "us4-causation",
      operation: "pipeline.read",
    },
  };
}

function signedHeaders(deliveryId: string, rawBody: Uint8Array): Readonly<Record<string, string>> {
  const timestamp = String(now.getTime() / 1_000);
  const signature = createHmac("sha256", webhookSecret)
    .update(Buffer.concat([Buffer.from(`${deliveryId}.${timestamp}.`), Buffer.from(rawBody)]))
    .digest("base64");
  return Object.freeze({
    "webhook-id": deliveryId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  } as const);
}

async function webhook(deliveryId: string, status: string, updatedAt = now.toISOString()) {
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      object_kind: "pipeline",
      project: { id: 5001 },
      object_attributes: { id: 101, status, sha: sourceCommitSha, updated_at: updatedAt },
    }),
  );
  return await ingress.accept({
    connectionId: qaJiraGitLabLocalSeedIds.connection,
    rawBody,
    contentType: "application/json",
    headers: signedHeaders(deliveryId, rawBody),
    receivedAt: now,
  });
}

function operationalBrowserMarkup(
  input: Readonly<{
    connectionHealth: "BACKOFF" | "AUTH_DEGRADED";
    freshness: "PENDING" | "ERROR";
    reasonCode: "RATE_LIMITED" | "AUTH_REVOKED";
  }>,
): string {
  const attemptId = "attempt-us4-browser-state";
  const render = renderToStaticMarkup as (
    node: ReturnType<typeof QaAutomatedSessionExecutor>,
  ) => string;
  return render(
    QaAutomatedSessionExecutor({
      attempts: [
        {
          automationAttemptId: attemptId,
          testSessionId: fixture!.sessionId,
          planItemId: fixture!.planItemId,
          attemptNo: 1,
          reason: "INITIAL",
          rootAttemptId: attemptId,
          currentStatus: "RUNNING",
          currentStatusRevisionNo: 1,
          resourceVersion: 1,
          createdAt: now.toISOString(),
          execution: { state: "CONFIRMED" },
        },
      ],
      statusByAttempt: { [attemptId]: [] },
      operationalHealth: {
        connectionHealth: input.connectionHealth,
        freshness: input.freshness,
        executionActivity: "RECONCILING",
        reasonCodes: [input.reasonCode],
        ...(input.connectionHealth === "BACKOFF"
          ? { nextEligibleAt: new Date(now.getTime() + 1_000).toISOString() }
          : {}),
      },
      notice: "Automated execution is waiting for authoritative reconciliation.",
      manualHref: "/qa/manual-sessions",
      onLaunch: () => undefined,
      onReload: () => undefined,
    }),
  );
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture({
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  mockSource = createMockHubDataSource(fixture.postgres.url, gitLabMockMigrations);
  await mockSource.initialize();
  await mockSource.runMigrations({ transaction: "all" });
  await seedGitLabRepository(mockSource);
  mockApp = await NestFactory.create(GitLabModule.configured(mockSource), { logger: false });
  await mockApp.listen(0, "127.0.0.1");
  const server = mockApp.getHttpServer() as Readonly<{ address(): Readonly<{ port: number }> }>;
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  await runQaJiraGitLabLocalSeed(
    fixture.source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_DATABASE_URL: fixture.postgres.url,
      AWP_MOCK_HUB_URL: baseUrl,
      AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    }),
  );
  const mockRepository = new TypeOrmGitLabRepository(mockSource);
  control = new GitLabControlController(
    mockRepository,
    new GitLabMockControlPolicy("local-gitlab-control", [5001]),
  );
  await control.scenario("local-gitlab-control", {
    projectId: 5001,
    scenarioId: "us3-pass-review-required",
  });
  const configuration = buildQaJiraGitLabLocalSeedConfiguration(baseUrl);
  const auth = new GitLabAuth(
    configuration.connection,
    {
      async resolve() {
        return {
          metadata: {},
          async use(_observedAt, consumer) {
            return await consumer(new TextEncoder().encode("mock-gitlab-read"));
          },
        };
      },
    },
    { now: () => now },
  );
  const client = new GitLabRestClient({
    baseUrl,
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: [baseUrl],
    auth,
    clock: { now: () => now },
  });
  const dialect = createGitLabDialect({
    adapterFamily: "gitlab-rest-v4",
    apiFamily: "v4",
    edition: "EE",
    exactVersion: "18.1.0-mock.1",
    exactBuild: "mock-build-1",
    triggerDialect: "TYPED_INPUTS",
    webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
  });
  reader = new GitLabPipelineReader({
    profile: configuration.profile,
    authority: () => ({
      sourceCommitSha,
      suiteKey: "smoke",
      environmentRef: "environment:test:qa-1@17",
      targetSnapshotHash: digest("us4-target"),
      configurationPinSetHash: digest("us4-pins"),
    }),
    clock: { now: () => now },
    transport: createGitLabRestPipelineReadTransport(client, dialect),
  });
  ingress = new TypeOrmGitLabWebhookIngressService(
    fixture.source,
    new TypeOrmGitLabWebhookAuthorityLoader(fixture.source),
    {
      async resolve() {
        return webhookSecret;
      },
    },
  );
}, 180_000);

afterAll(async () => {
  await mockApp?.close();
  if (mockSource?.isInitialized) await mockSource.destroy();
  await stopUs3DatabaseFixture(fixture);
}, 180_000);

describe("Feature 005 US4 outage recovery through real adapter and stateful Mock Hub", () => {
  it("treats webhook as a hint, converges authoritatively, survives outage, and preserves manual QA continuity", async () => {
    const handler: GitLabAuthoritativeReadHandler = {
      async read({ workspaceId, envelope, observedAt }) {
        const request: PipelineReadRequest = {
          schemaVersion: "test-executor.trigger-status@1.0.0",
          messageType: "REQUEST",
          operation: "pipeline.read",
          automationAttemptId: envelope.receiptId,
          externalPipelineId: String(envelope.signal.externalPipelineId),
          targetSnapshotHash: digest("us4-target"),
          configurationPinSetHash: digest("us4-pins"),
        };
        const result = await reader.read(
          context(envelope.profileRef, envelope.connectionRef),
          request,
        );
        return {
          pipelineObservationId: randomUUID(),
          scope: {
            workspaceId,
            connectionHeaderId: envelope.connectionRef.id,
            numericProjectId: envelope.signal.numericGitLabProjectId,
          },
          connectionRef: envelope.connectionRef,
          profileRef: envelope.profileRef,
          externalPipelineId: result.externalPipelineId,
          externalJobIds: result.externalJobIds,
          providerStatus: result.providerState,
          providerRevisionToken: result.providerRevisionToken,
          providerUpdatedAt: result.providerUpdatedAt,
          sourceCommitSha: result.sourceCommitSha,
          sourceRefHash: digest("refs/heads/qa/smoke"),
          normalizedJobSetHash: digest(JSON.stringify(result.externalJobIds)),
          sourceKind: "RECONCILIATION",
          sourceRef: {
            id: envelope.receiptId,
            version: 1,
            contentHash: digest(envelope.signal.deliveryId),
          },
          observationHash: result.observationHash,
          observedAt,
        };
      },
    };
    const worker = new TypeOrmGitLabAuthoritativeReadOutboxWorker(fixture!.source, handler, {
      now: () => now,
    });

    const accepted = await webhook("us4-hint-running", "running", "2026-09-01T11:58:00.000Z");
    expect(accepted.status).toBe("ACCEPTED");
    await expect(worker.runOne()).resolves.toBe("RECONCILED");
    const [head] = (await fixture!.source.query(
      "SELECT observation.provider_status FROM gitlab_pipeline_projection_heads head JOIN gitlab_pipeline_observations observation ON observation.pipeline_observation_id=head.current_observation_id WHERE head.external_pipeline_id='101'",
    )) as readonly Readonly<{ provider_status: string }>[];
    expect(head?.provider_status).toBe("SUCCESS");
    await expect(
      webhook("us4-hint-running", "running", "2026-09-01T11:58:00.000Z"),
    ).resolves.toMatchObject({ status: "DUPLICATE", receiptId: accepted.receiptId });

    now = new Date("2026-09-01T12:01:00.000Z");
    await control.fault("local-gitlab-control", {
      projectId: 5001,
      operation: "PIPELINE_READ",
      fault: "SERVER_500",
      remaining: 1,
    });
    await webhook("us4-outage-500", "running");
    const outageOutcome = await worker.runOne();
    expect(outageOutcome).toBe("BACKOFF");
    const pendingMarkup = operationalBrowserMarkup({
      connectionHealth: "BACKOFF",
      freshness: "PENDING",
      reasonCode: "RATE_LIMITED",
    });
    expect(pendingMarkup).toContain("Подключение: Повтор отложен");
    expect(pendingMarkup).toContain("Актуальность: Ожидает решения");
    expect(pendingMarkup).toContain("Активность: Выполняется сверка");
    expect(pendingMarkup).toContain("Ограничено по частоте запросов");
    expect(pendingMarkup).toContain("Ручная проверка QA доступна");
    expect(pendingMarkup).toContain("/qa/manual-sessions");
    const manual = await executeUs3CleanPass(fixture!);
    expect(manual.reviewRequired).toMatchObject({ state: "REVIEW_REQUIRED" });
    const [pending] = (await fixture!.source.query(
      "SELECT state FROM event_outbox WHERE event_type='gitlab.authoritative-read.requested.v1' ORDER BY created_at DESC LIMIT 1",
    )) as readonly Readonly<{ state: string }>[];
    expect(pending?.state).toBe("READY");

    now = new Date("2026-09-01T12:01:02.000Z");
    await expect(worker.runOne()).resolves.toBe("RECONCILED");
    await control.fault("local-gitlab-control", {
      projectId: 5001,
      operation: "PIPELINE_READ",
      fault: "AUTHENTICATION_401",
      remaining: 1,
    });
    await webhook("us4-auth-revoked", "running");
    const authOutcome = await worker.runOne();
    expect(authOutcome).toBe("AUTH_DEGRADED");
    const errorMarkup = operationalBrowserMarkup({
      connectionHealth: "AUTH_DEGRADED",
      freshness: "ERROR",
      reasonCode: "AUTH_REVOKED",
    });
    expect(errorMarkup).toContain("Подключение: Проблемы с авторизацией");
    expect(errorMarkup).toContain("Актуальность: Ошибка");
    expect(errorMarkup).toContain("Авторизация отозвана");
    expect(errorMarkup).toContain("Открыть ручное выполнение сеанса");
    const [failed] = (await fixture!.source.query(
      "SELECT state FROM event_outbox WHERE event_type='gitlab.authoritative-read.requested.v1' ORDER BY created_at DESC LIMIT 1",
    )) as readonly Readonly<{ state: string }>[];
    expect(failed?.state).toBe("FAILED");
    const [session] = (await fixture!.source.query(
      "SELECT state FROM qa_test_sessions WHERE session_id=$1",
      [fixture!.sessionId],
    )) as readonly Readonly<{ state: string }>[];
    expect(session?.state).toBe("REVIEW_REQUIRED");
  }, 180_000);
});

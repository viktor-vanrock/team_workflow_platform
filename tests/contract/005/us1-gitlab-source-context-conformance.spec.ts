import "../../../apps/mock-hub/node_modules/reflect-metadata/Reflect.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NestFactory } from "../../../apps/mock-hub/node_modules/@nestjs/core/index.js";
import {
  gitLabMockMigrations,
  GitLabModule,
  seedGitLabRepository,
} from "../../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../../apps/mock-hub/src/persistence/data-source.ts";
import {
  createGitLabDialect,
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabRestClient,
  GitLabSourceContextHandler,
} from "../../../packages/connector-gitlab/src/index.ts";
import type { TrustedConnectorOperationContext } from "../../../packages/connector-sdk/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const headSha = "a".repeat(40);
let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createMockHubDataSource> | undefined;
let app:
  | Readonly<{
      close(): Promise<void>;
      listen(port: number, hostname: string): Promise<unknown>;
      getHttpServer(): { address(): unknown };
    }>
  | undefined;
let handler: GitLabSourceContextHandler;

function connection(): GitLabConnectionConfiguration {
  const common = {
    ownerRef: "team:qa",
    rotationPolicyRef: "policy:rotate",
    revocationRunbookRef: "runbook:revoke",
  };
  return {
    schemaVersion: "gitlab-connection-configuration@1.0.0",
    identityReferences: {
      read: {
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "read_api",
        nonHumanIdentityEvidenceRef: "evidence:read",
        reference: "secretref://gitlab/read",
        referenceFingerprint: digest("1"),
      },
      trigger: {
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "pipeline_trigger",
        nonHumanIdentityEvidenceRef: "evidence:trigger",
        reference: "secretref://gitlab/trigger",
        referenceFingerprint: digest("2"),
      },
      webhook: {
        ...common,
        identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
        keyVersionRef: "key:webhook:v1",
        reference: "secretref://gitlab/webhook",
        referenceFingerprint: digest("3"),
      },
    },
    operationIdentityRouting: {
      mergeRequestRead: "READ",
      commitRead: "READ",
      buildRead: "READ",
      pipelineTrigger: "TRIGGER",
      pipelineRead: "READ",
      pipelineLookup: "READ",
      artifactMetadata: "READ",
      artifactStream: "READ",
      webhookVerify: "WEBHOOK",
    },
    identitySeparationEvidenceHash: digest("4"),
  };
}

function context(): TrustedConnectorOperationContext {
  const bindingRef = { id: "binding-1", version: 1, contentHash: digest("5") };
  const exact = (id: string) => ({ id, version: 1, contentHash: digest("6") });
  const pins = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ].map(([logicalRole, capabilityKey]) => ({
    logicalRole: logicalRole!,
    capabilityKey: capabilityKey!,
    exactContractVersion: "1.0.0",
    bindingRef,
    profileRef: exact(`profile-${logicalRole}`),
    connectionRef: exact("connection-1"),
    validationReportRef: exact(`validation-${logicalRole}`),
    operationSetHash: digest("7"),
  }));
  return {
    scope: { kind: "PROJECT", workspaceId: "workspace-1", projectId: "project-1" },
    actor: { kind: "SERVICE", principalId: "worker-1", serviceKey: "qa-worker" },
    correlationId: "correlation-1",
    causationId: "causation-1",
    effectIdempotencyKey: "read-only",
    profileRef: { id: "profile-SOURCE_CONTEXT", version: 1 },
    classification: { key: "INTERNAL", rank: 20 },
    signal: new AbortController().signal,
    authorizationBasisHash: digest("8"),
    configurationPins: pins,
    deadlineAt: "2026-09-01T09:00:00.000Z",
    telemetry: {
      correlationId: "correlation-1",
      causationId: "causation-1",
      operation: "source-context.read",
    },
  };
}

beforeAll(async () => {
  postgres = await startPostgres();
  source = createMockHubDataSource(postgres.url, gitLabMockMigrations);
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await seedGitLabRepository(source);
  app = await NestFactory.create(GitLabModule.configured(source), { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const auth = new GitLabAuth(connection(), {
    async resolve() {
      return {
        metadata: {},
        async use(_now, consumer) {
          return await consumer(new TextEncoder().encode("mock-gitlab-read"));
        },
      };
    },
  });
  const client = new GitLabRestClient({
    baseUrl,
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: [baseUrl],
    auth,
  });
  handler = new GitLabSourceContextHandler({
    client,
    dialect: createGitLabDialect({
      adapterFamily: "gitlab-rest-v4",
      apiFamily: "v4",
      edition: "EE",
      exactVersion: "18.1.0-mock.1",
      exactBuild: "mock-build-1",
      triggerDialect: "TYPED_INPUTS",
      webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
    }),
    numericProjectId: 5001,
    clock: { now: () => new Date("2026-09-01T08:00:00.000Z") },
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("GitLab source-context real-adapter/stateful-Mock conformance", () => {
  it("reads bounded MR, commit and build facts through the fixed numeric project", async () => {
    const mr = await handler.read(context(), {
      schemaVersion: "source-context.read@1.0.0",
      messageType: "REQUEST",
      operation: "merge-request.read",
      selector: { sourceKind: "MERGE_REQUEST", sourceRef: "17" },
    });
    const commit = await handler.read(context(), {
      schemaVersion: "source-context.read@1.0.0",
      messageType: "REQUEST",
      operation: "commit.read",
      selector: { sourceKind: "COMMIT", sourceRef: headSha, expectedRevision: headSha },
    });
    const build = await handler.read(context(), {
      schemaVersion: "source-context.read@1.0.0",
      messageType: "REQUEST",
      operation: "build.read",
      selector: { sourceKind: "BUILD", sourceRef: "101" },
    });

    expect(mr.observation).toMatchObject({
      sourceKind: "MERGE_REQUEST",
      state: "OPEN",
      headCommitSha: headSha,
      sourceRevision: "refs/heads/qa/smoke",
      targetRevision: "refs/heads/main",
    });
    expect(commit.observation).toMatchObject({
      sourceKind: "COMMIT",
      commitSha: headSha,
      parentCommitShas: ["b".repeat(40)],
    });
    expect(build.observation).toMatchObject({
      sourceKind: "BUILD",
      state: "AVAILABLE",
      sourceCommitSha: headSha,
    });
    expect(
      [mr, commit, build].every(({ observation }) =>
        observation.observationHash.startsWith("sha256:"),
      ),
    ).toBe(true);
  });

  it("fails closed on revision drift, selector/operation mismatch and unbounded provider-like input", async () => {
    await expect(
      handler.read(context(), {
        schemaVersion: "source-context.read@1.0.0",
        messageType: "REQUEST",
        operation: "commit.read",
        selector: { sourceKind: "COMMIT", sourceRef: headSha, expectedRevision: "f".repeat(40) },
      }),
    ).rejects.toThrow("GITLAB_SOURCE_REVISION_MISMATCH");
    await expect(
      handler.read(context(), {
        schemaVersion: "source-context.read@1.0.0",
        messageType: "REQUEST",
        operation: "merge-request.read",
        selector: { sourceKind: "COMMIT", sourceRef: headSha },
      }),
    ).rejects.toThrow("GITLAB_SOURCE_OPERATION_SELECTOR_MISMATCH");
    await expect(
      handler.read(context(), {
        schemaVersion: "source-context.read@1.0.0",
        messageType: "REQUEST",
        operation: "merge-request.read",
        selector: { sourceKind: "MERGE_REQUEST", sourceRef: "../5002" },
      }),
    ).rejects.toThrow("GITLAB_SOURCE_REFERENCE_INVALID");
  });
});

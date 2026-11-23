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
  createGitLabRestPipelineReadTransport,
  type GitLabArtifactAuthority,
  GitLabAuth,
  GitLabCiArtifactError,
  GitLabCiArtifactHandler,
  type GitLabConnectionConfiguration,
  type GitLabMachineResultOutcome,
  GitLabPipelineReader,
  GitLabRestClient,
  type GitLabResultNormalizationRequest,
  GitLabResultNormalizer,
  mapGitLabPipelineStatus,
  normalizeGitLabMachineResult,
} from "../../../packages/connector-gitlab/src/index.ts";
import type {
  CiArtifactDescriptor,
  CiArtifactMetadataRequest,
  CiArtifactStreamRequest,
  PipelineReadRequest,
  TrustedConnectorOperationContext,
} from "../../../packages/connector-sdk/src/index.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { buildQaJiraGitLabLocalSeedConfiguration } from "../../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const commitSha = "a".repeat(40);
const markerHash = sha256("mock-result-request-marker");
const buildRef = "build:qa-api:2026.09.01.1";
const suiteKey = "smoke";
const environmentRef = "environment:test:qa-1@17";
const now = new Date("2026-09-01T08:00:00.000Z");

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createMockHubDataSource> | undefined;
let app:
  | Readonly<{
      close(): Promise<void>;
      listen(port: number, hostname: string): Promise<unknown>;
      getHttpServer(): { address(): unknown };
    }>
  | undefined;
let reader: GitLabPipelineReader;
let normalizer: GitLabResultNormalizer;
let artifacts: GitLabCiArtifactHandler;
let profile: ReturnType<typeof buildQaJiraGitLabLocalSeedConfiguration>["profile"];
let client: GitLabRestClient;
let dialect: ReturnType<typeof createGitLabDialect>;
let artifactAuthority: GitLabArtifactAuthority;
let persistedDescriptor: CiArtifactDescriptor | undefined;

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

function context(role: "TEST_EXECUTION" | "ARTIFACT_SOURCE"): TrustedConnectorOperationContext {
  const exact = (id: string, character: string) => ({
    id,
    version: 1,
    contentHash: digest(character),
  });
  const profileRef = exact("profile-1", "6");
  const bindingRef = exact("binding-1", "5");
  const pins = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ].map(([logicalRole, capabilityKey]) => ({
    logicalRole: logicalRole!,
    capabilityKey: capabilityKey!,
    exactContractVersion: "1.0.0",
    bindingRef,
    profileRef,
    connectionRef: exact("connection-1", "7"),
    validationReportRef: exact(`validation-${logicalRole}`, "8"),
    operationSetHash: digest("9"),
  }));
  return {
    scope: { kind: "PROJECT", workspaceId: "workspace-1", projectId: "project-1" },
    actor: { kind: "SERVICE", principalId: "worker-1", serviceKey: "qa-worker" },
    correlationId: "correlation-1",
    causationId: "causation-1",
    effectIdempotencyKey: "qa:automation:read-1",
    profileRef: { id: profileRef.id, version: profileRef.version },
    classification: { key: "INTERNAL", rank: 20 },
    signal: new AbortController().signal,
    authorizationBasisHash: digest("a"),
    configurationPins: pins,
    deadlineAt: "2026-09-01T09:00:00.000Z",
    telemetry: {
      correlationId: "correlation-1",
      causationId: "causation-1",
      operation: role === "TEST_EXECUTION" ? "pipeline.read" : "artifact.result-read",
    },
  };
}

const authority = Object.freeze({
  sourceCommitSha: commitSha,
  suiteKey,
  environmentRef,
  targetSnapshotHash: digest("b"),
  configurationPinSetHash: digest("c"),
});

function readRequest(): PipelineReadRequest {
  return {
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.read",
    automationAttemptId: "attempt-1",
    externalPipelineId: "101",
    targetSnapshotHash: authority.targetSnapshotHash,
    configurationPinSetHash: authority.configurationPinSetHash,
  };
}

function normalizationRequest(
  overrides: Partial<GitLabResultNormalizationRequest> = {},
): GitLabResultNormalizationRequest {
  return {
    automationAttemptId: "attempt-1",
    externalPipelineId: "101",
    externalJobId: "1001",
    sourceResultArtifactRef: "connector-artifact:result:101:1001",
    authority: {
      requestMarkerHash: markerHash,
      sourceCommitSha: commitSha,
      buildRef,
      suiteKey,
      environmentRef,
    },
    ...overrides,
  };
}

function resultBody(
  outcome: GitLabMachineResultOutcome,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "gitlab-pipeline-result@1.0.0",
    requestMarkerHash: markerHash,
    pipelineId: 101,
    jobId: 1001,
    commitSha,
    buildRef,
    suiteKey,
    environmentRef,
    startedAt: "2026-09-01T07:31:00.000Z",
    finishedAt: "2026-09-01T07:34:00.000Z",
    durationMs: 180_000,
    outcome,
    ...(outcome === "INFRA_FAILED" ? { infrastructureCode: "RUNNER_UNAVAILABLE" } : {}),
    ...(outcome === "CANCELLED" ? { cancellationReasonCode: "HUMAN_CANCELLED" } : {}),
    artifacts: [],
    ...overrides,
  };
}

function metadataRequest(): CiArtifactMetadataRequest {
  return {
    schemaVersion: "artifact.ci-read@1.0.0",
    messageType: "REQUEST",
    operation: "artifact.metadata",
    automationAttemptId: artifactAuthority.automationAttemptId,
    externalPipelineId: artifactAuthority.externalPipelineId,
    externalJobId: artifactAuthority.externalJobId,
    logicalArtifactKey: artifactAuthority.logicalArtifactKey,
    resultHash: artifactAuthority.resultHash,
  };
}

function streamRequest(descriptor: CiArtifactDescriptor): CiArtifactStreamRequest {
  return {
    schemaVersion: "artifact.ci-read@1.0.0",
    messageType: "REQUEST",
    operation: "artifact.stream",
    artifactReferenceId: "550e8400-e29b-41d4-a716-446655440001",
    descriptorId: descriptor.descriptorId,
    descriptorHash: descriptor.descriptorHash,
    expectedByteSize: descriptor.byteSize,
    expectedChecksum: descriptor.checksum,
    expectedClassification: descriptor.classification,
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
  profile = buildQaJiraGitLabLocalSeedConfiguration(baseUrl).profile;
  const auth = new GitLabAuth(connection(), {
    async resolve() {
      return {
        metadata: {},
        async use(_observedAt, consumer) {
          return await consumer(new TextEncoder().encode("mock-gitlab-read"));
        },
      };
    },
  });
  client = new GitLabRestClient({
    baseUrl,
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: [baseUrl],
    auth,
  });
  dialect = createGitLabDialect({
    adapterFamily: "gitlab-rest-v4",
    apiFamily: "v4",
    edition: "EE",
    exactVersion: "18.1.0-mock.1",
    exactBuild: "mock-build-1",
    triggerDialect: "TYPED_INPUTS",
    webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
  });
  reader = new GitLabPipelineReader({
    profile,
    authority: () => authority,
    clock: { now: () => now },
    transport: createGitLabRestPipelineReadTransport(client, dialect),
  });
  normalizer = new GitLabResultNormalizer({ profile, client, dialect, clock: { now: () => now } });
  const rows = (await source.query(
    "SELECT byte_size,checksum,classification,expires_at,created_at FROM mock_gitlab_artifacts WHERE project_id=5001 AND pipeline_id=101 AND job_id=1001 AND artifact_path='awp/results/result.json'",
  )) as readonly Record<string, unknown>[];
  const row = rows[0]!;
  artifactAuthority = Object.freeze({
    workItemId: "550e8400-e29b-41d4-a716-446655440010",
    testSessionId: "550e8400-e29b-41d4-a716-446655440011",
    automationAttemptId: "550e8400-e29b-41d4-a716-446655440012",
    externalPipelineId: "101",
    externalJobId: "1001",
    logicalArtifactKey: "machine-result",
    resultHash: String(row.checksum) as `sha256:${string}`,
    artifactPath: "awp/results/result.json",
    artifactKind: "RESULT",
    fileName: "result.json",
    mediaType: "application/json",
    byteSize: Number(row.byte_size),
    checksum: String(row.checksum) as `sha256:${string}`,
    classification: String(row.classification),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  });
  artifacts = new GitLabCiArtifactHandler({
    profile,
    client,
    dialect,
    clock: { now: () => now },
    metadataAuthority: () => artifactAuthority,
    streamAuthority: () => {
      if (!persistedDescriptor) throw new Error("TEST_DESCRIPTOR_NOT_PERSISTED");
      return {
        ...artifactAuthority,
        artifactReferenceId: "550e8400-e29b-41d4-a716-446655440001",
        descriptorId: persistedDescriptor.descriptorId,
        descriptorHash: persistedDescriptor.descriptorHash,
      };
    },
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("GitLab US3 result real-adapter/stateful-Mock conformance", () => {
  it("reads the exact project pipeline and relevant result job before accepting terminality", async () => {
    const observation = await reader.read(context("TEST_EXECUTION"), readRequest());
    expect(observation).toMatchObject({
      externalPipelineId: "101",
      externalJobIds: ["1001"],
      sourceCommitSha: commitSha,
      providerState: "SUCCESS",
      terminal: true,
      durationMs: 240_000,
    });
    expect(observation.resultDescriptorRef).toMatch(/^gitlab-result:5001:101:1001:sha256:/u);
    expect(observation.observationHash).toMatch(/^sha256:/u);
  });

  it("downloads the Profile-selected result path and validates the exact pinned schema and target", async () => {
    const normalized = await normalizer.downloadAndNormalize(
      context("ARTIFACT_SOURCE"),
      normalizationRequest(),
    );
    expect(normalized).toMatchObject({
      normalizationKind: "SCHEMA_VALIDATED",
      normalizationStatus: "VALID",
      outcome: "PASS",
      issueCodes: [],
    });
    if (normalized.normalizationKind === "SCHEMA_VALIDATED") {
      expect(normalized.result).toMatchObject({
        pipelineId: 101,
        jobId: 1001,
        commitSha,
        buildRef,
        suiteKey,
        environmentRef,
      });
      expect(normalized.expectedSchemaRef.digest).toBe(
        designContractRegistry.digest("urn:awp:schemas:005:gitlab-pipeline-result:v1"),
      );
    }
  });

  it("refreshes opaque artifact metadata and returns a checksum-verified authorized stream", async () => {
    const descriptor = await artifacts.metadata(context("ARTIFACT_SOURCE"), metadataRequest());
    persistedDescriptor = descriptor;
    expect(descriptor).toMatchObject({
      artifactKind: "RESULT",
      availability: "AVAILABLE",
      checksumSource: "CONNECTOR_CONTENT_SHA256",
      classification: "INTERNAL",
    });
    expect(JSON.stringify(descriptor)).not.toContain("awp/results/result.json");
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:005:capability:artifact-ci-read:v1",
        descriptor,
      ),
    ).toBe(descriptor);

    const streamed = await artifacts.stream(context("ARTIFACT_SOURCE"), streamRequest(descriptor));
    const reader = streamed.bytes.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(bytes.byteLength).toBe(descriptor.byteSize);
    expect(streamed.metadata).toMatchObject({
      availability: "AVAILABLE",
      checksum: descriptor.checksum,
      artifactReferenceId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:005:capability:artifact-ci-read:v1",
        streamed.metadata,
      ),
    ).toBe(streamed.metadata);
  });

  it("classifies provider-clock expiry and denies a mismatched stream checksum", async () => {
    const expiredHandler = new GitLabCiArtifactHandler({
      client,
      dialect,
      profile,
      clock: { now: () => now },
      metadataAuthority: () => ({ ...artifactAuthority, expiresAt: "2026-09-01T07:59:59.000Z" }),
      streamAuthority: () => {
        throw new Error("UNREACHABLE");
      },
    });
    const expired = await expiredHandler.metadata(context("ARTIFACT_SOURCE"), metadataRequest());
    expect(expired.availability).toBe("EXPIRED");

    expect(persistedDescriptor).toBeDefined();
    const checksumMismatch = { ...persistedDescriptor!, checksum: digest("f") };
    const mismatchedHandler = new GitLabCiArtifactHandler({
      client,
      dialect,
      profile,
      clock: { now: () => now },
      metadataAuthority: () => artifactAuthority,
      streamAuthority: () => ({
        ...artifactAuthority,
        checksum: digest("f"),
        artifactReferenceId: "550e8400-e29b-41d4-a716-446655440001",
        descriptorId: checksumMismatch.descriptorId,
        descriptorHash: checksumMismatch.descriptorHash,
      }),
    });
    const error = await mismatchedHandler
      .stream(context("ARTIFACT_SOURCE"), streamRequest(checksumMismatch))
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GitLabCiArtifactError);
    expect(error).toMatchObject({
      code: "GITLAB_ARTIFACT_CHECKSUM_MISMATCH",
      availability: "CHECKSUM_MISMATCH",
    });
  });

  it.each(["PASS", "ASSERTION_FAILED", "INFRA_FAILED", "TIMEOUT", "CANCELLED"] as const)(
    "keeps validated %s distinct from provider status",
    (outcome) => {
      const normalized = normalizeGitLabMachineResult({
        profile,
        request: normalizationRequest(),
        bytes: new TextEncoder().encode(JSON.stringify(resultBody(outcome))),
        observedAt: now,
      });
      expect(normalized).toMatchObject({
        normalizationKind: "SCHEMA_VALIDATED",
        outcome,
        issueCodes: [],
      });
    },
  );

  it("fails closed for schema drift, target mismatch, checksum mismatch and a missing result", async () => {
    const drift = normalizeGitLabMachineResult({
      profile,
      request: normalizationRequest(),
      bytes: new TextEncoder().encode(
        JSON.stringify(resultBody("PASS", { schemaVersion: "gitlab-pipeline-result@2.0.0" })),
      ),
      observedAt: now,
    });
    const target = normalizeGitLabMachineResult({
      profile,
      request: normalizationRequest(),
      bytes: new TextEncoder().encode(
        JSON.stringify(resultBody("PASS", { commitSha: "f".repeat(40) })),
      ),
      observedAt: now,
    });
    const checksum = normalizeGitLabMachineResult({
      profile,
      request: normalizationRequest({
        authority: { ...normalizationRequest().authority, expectedResultChecksum: digest("f") },
      }),
      bytes: new TextEncoder().encode(JSON.stringify(resultBody("PASS"))),
      observedAt: now,
    });
    const missing = await normalizer.downloadAndNormalize(
      context("ARTIFACT_SOURCE"),
      normalizationRequest({ externalJobId: "9999" }),
    );
    expect(drift).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "RESULT_SCHEMA_DRIFT",
    });
    expect(target).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "RESULT_TARGET_MISMATCH",
    });
    expect(checksum).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "ARTIFACT_CHECKSUM_MISMATCH",
    });
    expect(missing).toMatchObject({
      outcome: "INCOMPLETE",
      normalizationStatus: "MISSING",
      syntheticReasonCode: "RESULT_MISSING",
    });
  });

  it("maps unknown provider states without treating them as terminal", async () => {
    expect(mapGitLabPipelineStatus("future_state")).toBe("UNKNOWN");
    const unknownReader = new GitLabPipelineReader({
      profile,
      authority: () => authority,
      clock: { now: () => now },
      transport: {
        async readPipeline() {
          return {
            id: 101,
            sha: commitSha,
            ref: profile.trigger.ref,
            status: "future_state",
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          };
        },
        async readJobs() {
          return [];
        },
      },
    });
    await expect(
      unknownReader.read(context("TEST_EXECUTION"), readRequest()),
    ).resolves.toMatchObject({ providerState: "UNKNOWN", terminal: false });
  });

  it("retains retried result jobs and selects the latest exact result job deterministically", async () => {
    await source!.query(
      "UPDATE mock_gitlab_jobs SET status='failed',finished_at='2026-09-01T07:32:00.000Z' WHERE project_id=5001 AND job_id=1001",
    );
    await source!.query(
      "INSERT INTO mock_gitlab_jobs(project_id,pipeline_id,job_id,name,stage,status,environment_name,created_at,started_at,finished_at) VALUES(5001,101,1002,'awp:result','test','success','qa-1','2026-09-01T07:33:00.000Z','2026-09-01T07:34:00.000Z','2026-09-01T07:35:00.000Z')",
    );
    const observation = await reader.read(context("TEST_EXECUTION"), readRequest());
    expect(observation.externalJobIds).toEqual(["1001", "1002"]);
    expect(observation.resultDescriptorRef).toMatch(/^gitlab-result:5001:101:1002:sha256:/u);
  });
});

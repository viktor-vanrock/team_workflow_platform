import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type GitLabArtifactLocatorRevisionInput,
  GitLabArtifactPersistenceError,
  TypeOrmGitLabArtifactRepository,
} from "../../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import type {
  CiArtifactAvailability,
  CiArtifactDescriptor,
  TrustedConnectorOperationContext,
} from "../../../../packages/connector-sdk/src/index.ts";
import { ArtifactService } from "../../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
  TypeOrmArtifactRepository,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";
import { TypeOrmGitLabArtifactStorage } from "../../../../packages/runtime-composition/src/gitlab/artifact-storage.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const workspaceId = "550e8400-e29b-41d4-a716-446655440101";
const otherWorkspaceId = "550e8400-e29b-41d4-a716-446655440102";
const artifactReferenceId = "550e8400-e29b-41d4-a716-446655440103";
const connectionHeaderId = "550e8400-e29b-41d4-a716-446655440104";
const firstRevisionId = "550e8400-e29b-41d4-a716-446655440105";
const secondRevisionId = "550e8400-e29b-41d4-a716-446655440106";

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let repository: TypeOrmGitLabArtifactRepository;

function locator(
  overrides: Partial<GitLabArtifactLocatorRevisionInput> = {},
): GitLabArtifactLocatorRevisionInput {
  return {
    artifactLocatorRevisionId: firstRevisionId,
    scope: { workspaceId, numericProjectId: 5001 },
    coreArtifactReferenceId: artifactReferenceId,
    connectionHeaderId,
    connectionRef: { id: connectionHeaderId, version: 1, contentHash: digest("1") },
    profileRef: {
      id: "550e8400-e29b-41d4-a716-446655440107",
      version: 1,
      contentHash: digest("2"),
    },
    externalPipelineId: "101",
    externalJobId: "1001",
    artifactPathHash: digest("3"),
    sealedLocator: new TextEncoder().encode("sealed:gitlab:5001:101:1001:artifact"),
    checksum: digest("4"),
    byteSize: 512,
    mediaType: "application/json",
    artifactKind: "RESULT",
    classification: "INTERNAL",
    providerExpiresAt: "2026-09-08T08:00:00.000Z",
    descriptorHash: digest("5"),
    availability: "AVAILABLE",
    observedAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  const { qaJiraGitLabLocalComposition, qaJiraGitLabLocalMigrationRegistry } =
    await import("../../../../packages/runtime-composition/src/gitlab/composition.ts");
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaJiraGitLabLocalComposition.entities,
    migrations: migrationClasses(qaJiraGitLabLocalMigrationRegistry),
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  repository = new TypeOrmGitLabArtifactRepository(source);
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("GitLab artifact locator access and append-only persistence", () => {
  it("appends availability revisions while preserving exact descriptor metadata and hiding the sealed locator", async () => {
    const first = await repository.appendLocatorRevision(locator());
    expect(first).toMatchObject({
      artifact_locator_revision_id: firstRevisionId,
      availability: "AVAILABLE",
      sealed_locator: "[SEALED]",
    });
    expect(await repository.appendLocatorRevision(locator())).toEqual(first);

    const second = await repository.appendLocatorRevision(
      locator({
        artifactLocatorRevisionId: secondRevisionId,
        previousRevisionId: firstRevisionId,
        availability: "EXPIRED",
        observedAt: "2026-09-08T08:00:01.000Z",
      }),
    );
    expect(second).toMatchObject({
      artifact_locator_revision_id: secondRevisionId,
      previous_revision_id: firstRevisionId,
      availability: "EXPIRED",
      checksum: digest("4"),
      descriptor_hash: digest("5"),
      sealed_locator: "[SEALED]",
    });
    const history = await repository.locatorHistory(
      { workspaceId, numericProjectId: 5001 },
      artifactReferenceId,
    );
    expect(history.map(({ availability }) => availability)).toEqual(["AVAILABLE", "EXPIRED"]);
    expect(JSON.stringify(history)).not.toContain("sealed:gitlab");
    await expect(
      source!.query(
        "UPDATE gitlab_artifact_locator_revisions SET availability='MISSING' WHERE artifact_locator_revision_id=$1",
        [secondRevisionId],
      ),
    ).rejects.toThrow("APPEND_ONLY");
  });

  it("persists stream receipts without bytes and rejects descriptor mismatches", async () => {
    const streamed = await repository.appendStreamReceipt({
      artifactStreamReceiptId: "550e8400-e29b-41d4-a716-446655440108",
      scope: { workspaceId, numericProjectId: 5001 },
      authorizedRequestRef: {
        id: "550e8400-e29b-41d4-a716-446655440109",
        version: 1,
        contentHash: digest("6"),
      },
      artifactLocatorRevisionId: firstRevisionId,
      streamedChecksum: digest("4"),
      streamedBytes: 512,
      outcome: "STREAMED",
      correlationId: "550e8400-e29b-41d4-a716-446655440110",
      streamedAt: "2026-09-01T08:01:00.000Z",
    });
    expect(streamed).toMatchObject({
      outcome: "STREAMED",
      streamed_checksum: digest("4"),
      streamed_bytes: "512",
    });
    expect(Object.keys(streamed)).not.toContain("bytes");
    const receipts = await repository.streamReceipts(
      { workspaceId, numericProjectId: 5001 },
      firstRevisionId,
    );
    expect(receipts).toHaveLength(1);
    await expect(
      repository.appendStreamReceipt({
        artifactStreamReceiptId: "550e8400-e29b-41d4-a716-446655440111",
        scope: { workspaceId, numericProjectId: 5001 },
        authorizedRequestRef: {
          id: "550e8400-e29b-41d4-a716-446655440112",
          version: 1,
          contentHash: digest("7"),
        },
        artifactLocatorRevisionId: firstRevisionId,
        streamedChecksum: digest("f"),
        streamedBytes: 512,
        outcome: "STREAMED",
        correlationId: "550e8400-e29b-41d4-a716-446655440113",
        streamedAt: "2026-09-01T08:02:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "GITLAB_ARTIFACT_STREAM_DESCRIPTOR_MISMATCH",
    } satisfies Partial<GitLabArtifactPersistenceError>);
  });

  it("isolates workspace and numeric project reads", async () => {
    await expect(
      repository.latestLocator(
        { workspaceId: otherWorkspaceId, numericProjectId: 5001 },
        artifactReferenceId,
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository.latestLocator({ workspaceId, numericProjectId: 5002 }, artifactReferenceId),
    ).resolves.toBeUndefined();
    await expect(
      repository.appendStreamReceipt({
        artifactStreamReceiptId: "550e8400-e29b-41d4-a716-446655440114",
        scope: { workspaceId, numericProjectId: 5002 },
        authorizedRequestRef: {
          id: "550e8400-e29b-41d4-a716-446655440115",
          version: 1,
          contentHash: digest("8"),
        },
        artifactLocatorRevisionId: firstRevisionId,
        errorCode: "DENIED_SCOPE",
        outcome: "DENIED",
        correlationId: "550e8400-e29b-41d4-a716-446655440116",
        streamedAt: "2026-09-01T08:03:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "GITLAB_ARTIFACT_LOCATOR_NOT_FOUND" });
  });

  it("dispatches Core storage reads through GitLab and persists refresh, expiry, and stream receipts", async () => {
    const projectId = "550e8400-e29b-41d4-a716-446655440120";
    const identityId = "550e8400-e29b-41d4-a716-446655440121";
    const runtimeArtifactId = "550e8400-e29b-41d4-a716-446655440122";
    const ownerId = "550e8400-e29b-41d4-a716-446655440123";
    const attemptId = "550e8400-e29b-41d4-a716-446655440124";
    const reference = Object.freeze({
      providerKind: "GITLAB_CI",
      opaqueLocator: `gitlab-artifact-reference:${runtimeArtifactId}`,
      objectVersionOrEtag: digest("5"),
    });
    await source!.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'local','artifact-worker','SERVICE','Artifact Worker') ON CONFLICT DO NOTHING",
      [identityId],
    );
    await source!.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'artifact-runtime','Artifact Runtime','ACTIVE') ON CONFLICT DO NOTHING",
      [workspaceId],
    );
    await source!.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'artifact-runtime','Artifact Runtime','ACTIVE','INTERNAL') ON CONFLICT DO NOTHING",
      [projectId, workspaceId],
    );
    await source!.query(
      `INSERT INTO artifact_references(
      id,workspace_id,project_id,owner_entity_type,owner_entity_id,artifact_kind,storage_provider_kind,
      opaque_locator,object_version_or_etag,file_name,media_type,size_bytes,checksum_algorithm,checksum,
      classification_key,availability,created_by,created_at,expires_at
    ) VALUES($1,$2,$3,'AUTOMATION_ATTEMPT',$4,'RESULT','GITLAB_CI',$5,$6,'result.json','application/json',4,'SHA256',$7,'INTERNAL','AVAILABLE',$8,$9,$10)`,
      [
        runtimeArtifactId,
        workspaceId,
        projectId,
        ownerId,
        reference.opaqueLocator,
        reference.objectVersionOrEtag,
        digest("4"),
        identityId,
        "2026-09-01T08:00:00.000Z",
        "2026-09-08T08:00:00.000Z",
      ],
    );

    let availability: CiArtifactAvailability = "AVAILABLE";
    const descriptor = (): CiArtifactDescriptor =>
      Object.freeze({
        schemaVersion: "artifact.ci-read@1.0.0",
        messageType: "RESULT",
        operation: "artifact.metadata",
        descriptorId: "550e8400-e29b-41d4-a716-446655440125",
        descriptorHash: digest("5"),
        workItemId: "550e8400-e29b-41d4-a716-446655440126",
        testSessionId: "550e8400-e29b-41d4-a716-446655440127",
        automationAttemptId: attemptId,
        externalPipelineId: "301",
        externalJobId: "3001",
        artifactKind: "RESULT",
        opaqueLocatorHash: digest("3"),
        fileName: "result.json",
        mediaType: "application/json",
        byteSize: 4,
        checksum: digest("4"),
        checksumSource: "CONNECTOR_CONTENT_SHA256",
        classification: "INTERNAL",
        availability,
        sourceProfileRef: { id: "550e8400-e29b-41d4-a716-446655440107", version: 1 },
        sourceProfileHash: digest("2"),
        createdAt: "2026-09-01T08:00:00.000Z",
        expiresAt: "2026-09-08T08:00:00.000Z",
        provenanceHash: digest("a"),
      });
    const context: TrustedConnectorOperationContext = {
      scope: { kind: "PROJECT", workspaceId, projectId },
      actor: { kind: "SERVICE", principalId: identityId, serviceKey: "artifact-worker" },
      correlationId: "550e8400-e29b-41d4-a716-446655440128",
      causationId: "550e8400-e29b-41d4-a716-446655440129",
      effectIdempotencyKey: "artifact-read:test",
      profileRef: { id: "550e8400-e29b-41d4-a716-446655440107", version: 1 },
      classification: { key: "INTERNAL", rank: 10 },
      signal: new AbortController().signal,
      authorizationBasisHash: digest("b"),
      configurationPins: [],
      deadlineAt: "2026-09-01T09:00:00.000Z",
      telemetry: {
        correlationId: "550e8400-e29b-41d4-a716-446655440128",
        causationId: "550e8400-e29b-41d4-a716-446655440129",
        operation: "artifact.stream",
      },
    };
    const storage = new TypeOrmGitLabArtifactStorage(
      source!,
      {
        async materialize() {
          return {
            artifactReferenceId: runtimeArtifactId,
            scope: { workspaceId, projectId, numericProjectId: 5001 },
            context,
            metadataRequest: {
              schemaVersion: "artifact.ci-read@1.0.0",
              messageType: "REQUEST",
              operation: "artifact.metadata",
              automationAttemptId: attemptId,
              externalPipelineId: "301",
              externalJobId: "3001",
              logicalArtifactKey: "machine-result",
              resultHash: digest("4"),
            },
            locator: {
              connectionHeaderId,
              connectionRef: { id: connectionHeaderId, version: 1, contentHash: digest("1") },
              profileRef: {
                id: "550e8400-e29b-41d4-a716-446655440107",
                version: 1,
                contentHash: digest("2"),
              },
              artifactPathHash: digest("3"),
              sealedLocator: new TextEncoder().encode("sealed:runtime:5001:301:3001"),
            },
            authorizedRequestRef: {
              id: "550e8400-e29b-41d4-a716-446655440130",
              version: 1,
              contentHash: digest("6"),
            },
            port: {
              async metadata() {
                return descriptor();
              },
              async stream(_context, request) {
                const bytes = new Uint8Array([1, 2, 3, 4]);
                return {
                  metadata: {
                    schemaVersion: "artifact.ci-read@1.0.0",
                    messageType: "RESULT",
                    operation: "artifact.stream",
                    artifactReferenceId: request.artifactReferenceId,
                    mediaType: "application/json",
                    byteSize: 4,
                    checksum: digest("4"),
                    checksumSource: "CONNECTOR_CONTENT_SHA256",
                    classification: "INTERNAL",
                    availability: "AVAILABLE",
                    verifiedAt: "2026-09-01T08:01:00.000Z",
                    streamReceiptHash: digest("7"),
                  },
                  bytes: new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(bytes);
                      controller.close();
                    },
                  }),
                };
              },
            },
            streamRequest(value) {
              return {
                schemaVersion: "artifact.ci-read@1.0.0",
                messageType: "REQUEST",
                operation: "artifact.stream",
                artifactReferenceId: runtimeArtifactId,
                descriptorId: value.descriptorId,
                descriptorHash: value.descriptorHash,
                expectedByteSize: value.byteSize,
                expectedChecksum: value.checksum,
                expectedClassification: value.classification,
              };
            },
          };
        },
      },
      () => new Date("2026-09-01T08:01:00.000Z"),
    );

    const service = new ArtifactService(new TypeOrmArtifactRepository(source!), storage, {
      async authorizeScope() {
        return { allowed: true, reason: "ALLOW" };
      },
      async authorizeResource() {
        return { allowed: true, reason: "ALLOW" };
      },
    });
    const artifactContext = Object.freeze({
      actor: Object.freeze({
        kind: "HUMAN" as const,
        principalId: identityId,
        issuer: "local",
        subject: "artifact-reader",
      }),
      scope: Object.freeze({ kind: "PROJECT" as const, workspaceId, projectId }),
      correlationId: "550e8400-e29b-41d4-a716-446655440131",
      causationId: "550e8400-e29b-41d4-a716-446655440132",
    });
    await expect(
      service.getArtifactMetadata(artifactContext, runtimeArtifactId),
    ).resolves.toMatchObject({ id: runtimeArtifactId, storageProviderKind: "GITLAB_CI" });
    const streamed = await service.streamArtifactContent(artifactContext, runtimeArtifactId);
    const chunks: number[] = [];
    for await (const chunk of streamed.body) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3, 4]);
    const available = await repository.locatorHistory(
      { workspaceId, numericProjectId: 5001 },
      runtimeArtifactId,
    );
    expect(available.map(({ availability: state }) => state)).toEqual(["AVAILABLE"]);
    expect(
      await repository.streamReceipts(
        { workspaceId, numericProjectId: 5001 },
        String(available[0]!.artifact_locator_revision_id),
      ),
    ).toHaveLength(1);

    availability = "EXPIRED";
    await expect(storage.stream(reference)).rejects.toMatchObject({ availability: "EXPIRED" });
    const history = await repository.locatorHistory(
      { workspaceId, numericProjectId: 5001 },
      runtimeArtifactId,
    );
    expect(history.map(({ availability: state }) => state)).toEqual(["AVAILABLE", "EXPIRED"]);
    const [core] = (await source!.query(
      "SELECT availability,expires_at FROM artifact_references WHERE id=$1",
      [runtimeArtifactId],
    )) as readonly Record<string, unknown>[];
    expect(core).toMatchObject({ availability: "EXPIRED" });
    expect(
      await repository.streamReceipts(
        { workspaceId, numericProjectId: 5001 },
        String(history[1]!.artifact_locator_revision_id),
      ),
    ).toHaveLength(1);
  }, 120_000);
});

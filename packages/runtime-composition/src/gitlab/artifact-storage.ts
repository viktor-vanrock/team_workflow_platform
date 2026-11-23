import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  type GitLabArtifactLocatorAvailability,
  type GitLabArtifactLocatorRevisionInput,
  type GitLabArtifactStreamOutcome,
  TypeOrmGitLabArtifactRepository,
} from "@awp/connector-gitlab-persistence-typeorm";
import type {
  CiArtifactDescriptor,
  CiArtifactMetadataRequest,
  CiArtifactPort,
  CiArtifactStreamRequest,
  TrustedConnectorExactReference,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import type { Sha256Digest } from "@awp/platform-contracts";
import {
  type ArtifactStorageReference,
  ArtifactUnavailableError,
  type ObjectStoragePort,
} from "@awp/platform-core";

import {
  type GitLabAutomationObservability,
  recordGitLabAutomationPhase,
} from "./observability.ts";

const gitLabLocatorPrefix = "gitlab-artifact-reference:";
const classifications = Object.freeze([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const);

export interface GitLabArtifactStorageScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly numericProjectId: number;
}

export interface GitLabArtifactLocatorAuthority {
  readonly connectionHeaderId: string;
  readonly connectionRef: TrustedConnectorExactReference;
  readonly profileRef: TrustedConnectorExactReference;
  readonly artifactPathHash: Sha256Digest;
  readonly sealedLocator: Uint8Array;
}

export interface GitLabArtifactStorageMaterialization {
  readonly artifactReferenceId: string;
  readonly scope: GitLabArtifactStorageScope;
  readonly port: CiArtifactPort;
  readonly context: TrustedConnectorOperationContext;
  readonly metadataRequest: CiArtifactMetadataRequest;
  readonly locator: GitLabArtifactLocatorAuthority;
  readonly authorizedRequestRef: TrustedConnectorExactReference;
  streamRequest(descriptor: CiArtifactDescriptor): CiArtifactStreamRequest;
}

export interface GitLabArtifactStorageAuthority {
  materialize(reference: ArtifactStorageReference): Promise<GitLabArtifactStorageMaterialization>;
}

export interface GitLabArtifactRefreshReceipt {
  readonly descriptor: CiArtifactDescriptor;
  readonly locatorRevisionId: string;
}

export interface GitLabArtifactMetadataRefreshPort {
  refreshArtifactMetadata(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    artifactReferenceId: string,
  ): Promise<void>;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function queryRows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function artifactReferenceId(reference: ArtifactStorageReference): string {
  if (
    reference.providerKind !== "GITLAB_CI" ||
    !reference.opaqueLocator.startsWith(gitLabLocatorPrefix)
  ) {
    throw new Error("GITLAB_ARTIFACT_STORAGE_REFERENCE_INVALID");
  }
  const id = reference.opaqueLocator.slice(gitLabLocatorPrefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error("GITLAB_ARTIFACT_REFERENCE_ID_INVALID");
  }
  return id;
}

function classification(value: string): (typeof classifications)[number] {
  if (!(classifications as readonly string[]).includes(value))
    throw new Error("GITLAB_ARTIFACT_CLASSIFICATION_INVALID");
  return value as (typeof classifications)[number];
}

function coreAvailability(
  value: GitLabArtifactLocatorAvailability,
): "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE" {
  if (value === "AVAILABLE") return "AVAILABLE";
  if (value === "EXPIRED") return "EXPIRED";
  if (value === "CHECKSUM_MISMATCH") return "QUARANTINED";
  return "UNAVAILABLE";
}

function unavailable(value: GitLabArtifactLocatorAvailability): ArtifactUnavailableError {
  return new ArtifactUnavailableError(coreAvailability(value));
}

async function* asyncBytes(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function errorDetails(error: unknown): Readonly<{
  code: string;
  availability?: Exclude<GitLabArtifactLocatorAvailability, "AVAILABLE">;
}> {
  if (error !== null && typeof error === "object") {
    const candidate = error as Readonly<{ code?: unknown; availability?: unknown }>;
    const availability = candidate.availability;
    return Object.freeze({
      code:
        typeof candidate.code === "string" && candidate.code
          ? candidate.code
          : "GITLAB_ARTIFACT_PROVIDER_ERROR",
      ...(["EXPIRED", "MISSING", "CHECKSUM_MISMATCH"].includes(String(availability))
        ? { availability: availability as Exclude<GitLabArtifactLocatorAvailability, "AVAILABLE"> }
        : {}),
    });
  }
  return Object.freeze({ code: "GITLAB_ARTIFACT_PROVIDER_ERROR" });
}

function streamOutcome(details: ReturnType<typeof errorDetails>): GitLabArtifactStreamOutcome {
  return details.availability ?? (details.code.includes("DENIED") ? "DENIED" : "PROVIDER_ERROR");
}

export class TypeOrmGitLabArtifactStorage implements ObjectStoragePort {
  readonly #artifacts: TypeOrmGitLabArtifactRepository;

  constructor(
    private readonly source: DataSource,
    private readonly authority: GitLabArtifactStorageAuthority,
    private readonly now: () => Date = () => new Date(),
    private readonly observability?: GitLabAutomationObservability,
  ) {
    this.#artifacts = new TypeOrmGitLabArtifactRepository(source);
  }

  async refresh(reference: ArtifactStorageReference): Promise<GitLabArtifactRefreshReceipt> {
    const materialized = await this.#materialize(reference);
    return await this.#refreshMaterialized(materialized);
  }

  async refreshArtifactMetadata(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    id: string,
  ): Promise<void> {
    const rows = (await this.source.query(
      `
SELECT storage_provider_kind,opaque_locator,object_version_or_etag
FROM artifact_references
WHERE workspace_id=$1 AND project_id=$2 AND id=$3`,
      [scope.workspaceId, scope.projectId, id],
    )) as readonly Readonly<{
      storage_provider_kind: string;
      opaque_locator: string;
      object_version_or_etag: string;
    }>[];
    const row = rows[0];
    if (!row) throw new Error("GITLAB_ARTIFACT_CORE_REFERENCE_NOT_FOUND");
    if (row.storage_provider_kind !== "GITLAB_CI") return;
    await this.refresh(
      Object.freeze({
        providerKind: row.storage_provider_kind,
        opaqueLocator: row.opaque_locator,
        objectVersionOrEtag: row.object_version_or_etag,
      }),
    );
  }

  async #refreshMaterialized(
    materialized: GitLabArtifactStorageMaterialization,
  ): Promise<GitLabArtifactRefreshReceipt> {
    const descriptor = await materialized.port.metadata(
      materialized.context,
      materialized.metadataRequest,
    );
    this.#assertDescriptor(materialized, descriptor);
    const locatorRevisionId = await this.#persistLocator(
      materialized,
      descriptor,
      descriptor.availability,
    );
    recordGitLabAutomationPhase(this.observability, {
      phase: "ARTIFACT",
      outcome: descriptor.availability === "AVAILABLE" ? "AVAILABLE" : "EXPIRED",
      ...(descriptor.availability === "CHECKSUM_MISMATCH"
        ? { reasonCode: "CHECKSUM_MISMATCH" }
        : {}),
      correlationId: materialized.context.correlationId,
      causationId: materialized.context.causationId,
    });
    if (descriptor.availability === "AVAILABLE" && this.observability !== undefined) {
      const createdAt = Date.parse(descriptor.createdAt);
      if (!Number.isNaN(createdAt))
        this.observability.observeSlo(
          "TERMINAL_TO_ARTIFACT",
          Math.max(0, this.observability.now().getTime() - createdAt),
        );
    }
    return Object.freeze({ descriptor, locatorRevisionId });
  }

  async stream(
    reference: ArtifactStorageReference,
  ): Promise<Readonly<{ body: AsyncIterable<Uint8Array> }>> {
    const materialized = await this.#materialize(reference);
    const refreshed = await this.#refreshMaterialized(materialized);
    const streamedAt = this.now().toISOString();
    const receiptId = deterministicUuid(
      `gitlab-artifact-stream:${materialized.artifactReferenceId}:${refreshed.locatorRevisionId}:${materialized.authorizedRequestRef.contentHash}:${streamedAt}`,
    );
    if (refreshed.descriptor.availability !== "AVAILABLE") {
      await this.#artifacts.appendStreamReceipt({
        artifactStreamReceiptId: receiptId,
        scope: {
          workspaceId: materialized.scope.workspaceId,
          numericProjectId: materialized.scope.numericProjectId,
        },
        authorizedRequestRef: materialized.authorizedRequestRef,
        artifactLocatorRevisionId: refreshed.locatorRevisionId,
        outcome: refreshed.descriptor.availability,
        errorCode: `GITLAB_ARTIFACT_${refreshed.descriptor.availability}`,
        correlationId: materialized.context.correlationId,
        streamedAt,
      });
      throw unavailable(refreshed.descriptor.availability);
    }
    try {
      const request = materialized.streamRequest(refreshed.descriptor);
      if (request.artifactReferenceId !== materialized.artifactReferenceId)
        throw new Error("GITLAB_ARTIFACT_STREAM_SCOPE_INVALID");
      const streamed = await materialized.port.stream(materialized.context, request);
      if (
        streamed.metadata.artifactReferenceId !== materialized.artifactReferenceId ||
        streamed.metadata.checksum !== refreshed.descriptor.checksum ||
        streamed.metadata.byteSize !== refreshed.descriptor.byteSize ||
        streamed.metadata.classification !== refreshed.descriptor.classification
      )
        throw new Error("GITLAB_ARTIFACT_STREAM_METADATA_INVALID");
      await this.#artifacts.appendStreamReceipt({
        artifactStreamReceiptId: receiptId,
        scope: {
          workspaceId: materialized.scope.workspaceId,
          numericProjectId: materialized.scope.numericProjectId,
        },
        authorizedRequestRef: materialized.authorizedRequestRef,
        artifactLocatorRevisionId: refreshed.locatorRevisionId,
        streamedChecksum: streamed.metadata.checksum,
        streamedBytes: streamed.metadata.byteSize,
        outcome: "STREAMED",
        correlationId: materialized.context.correlationId,
        streamedAt,
      });
      return Object.freeze({ body: asyncBytes(streamed.bytes) });
    } catch (error) {
      const details = errorDetails(error);
      await this.#artifacts.appendStreamReceipt({
        artifactStreamReceiptId: receiptId,
        scope: {
          workspaceId: materialized.scope.workspaceId,
          numericProjectId: materialized.scope.numericProjectId,
        },
        authorizedRequestRef: materialized.authorizedRequestRef,
        artifactLocatorRevisionId: refreshed.locatorRevisionId,
        outcome: streamOutcome(details),
        errorCode: details.code,
        correlationId: materialized.context.correlationId,
        streamedAt,
      });
      if (details.availability) {
        await this.#persistLocator(materialized, refreshed.descriptor, details.availability);
        throw unavailable(details.availability);
      }
      throw error;
    }
  }

  async #materialize(
    reference: ArtifactStorageReference,
  ): Promise<GitLabArtifactStorageMaterialization> {
    const expectedId = artifactReferenceId(reference);
    const materialized = await this.authority.materialize(reference);
    if (
      materialized.artifactReferenceId !== expectedId ||
      materialized.context.scope.kind !== "PROJECT" ||
      materialized.context.scope.workspaceId !== materialized.scope.workspaceId ||
      materialized.context.scope.projectId !== materialized.scope.projectId ||
      materialized.context.actor.kind !== "SERVICE" ||
      !Number.isSafeInteger(materialized.scope.numericProjectId) ||
      materialized.scope.numericProjectId < 1 ||
      materialized.metadataRequest.automationAttemptId === ""
    )
      throw new Error("GITLAB_ARTIFACT_STORAGE_AUTHORITY_INVALID");
    return materialized;
  }

  #assertDescriptor(
    materialized: GitLabArtifactStorageMaterialization,
    descriptor: CiArtifactDescriptor,
  ): void {
    if (
      descriptor.automationAttemptId !== materialized.metadataRequest.automationAttemptId ||
      descriptor.externalPipelineId !== materialized.metadataRequest.externalPipelineId ||
      descriptor.externalJobId !== materialized.metadataRequest.externalJobId ||
      descriptor.sourceProfileRef.id !== materialized.locator.profileRef.id ||
      descriptor.sourceProfileRef.version !== materialized.locator.profileRef.version ||
      descriptor.sourceProfileHash !== materialized.locator.profileRef.contentHash
    )
      throw new Error("GITLAB_ARTIFACT_DESCRIPTOR_SCOPE_INVALID");
  }

  async #persistLocator(
    materialized: GitLabArtifactStorageMaterialization,
    descriptor: CiArtifactDescriptor,
    availability: GitLabArtifactLocatorAvailability,
  ): Promise<string> {
    const observedAt = this.now().toISOString();
    const scope = {
      workspaceId: materialized.scope.workspaceId,
      numericProjectId: materialized.scope.numericProjectId,
    };
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const artifacts = new TypeOrmGitLabArtifactRepository(manager);
      const previous = await artifacts.latestLocator(scope, materialized.artifactReferenceId);
      const previousRevisionId =
        previous === undefined ? undefined : String(previous.artifact_locator_revision_id);
      const stableDescriptorHash =
        previous === undefined
          ? descriptor.descriptorHash
          : (String(previous.descriptor_hash) as Sha256Digest);
      const revisionId = deterministicUuid(
        `gitlab-artifact-locator:${materialized.artifactReferenceId}:${stableDescriptorHash}:${availability}:${observedAt}`,
      );
      const input: GitLabArtifactLocatorRevisionInput = {
        artifactLocatorRevisionId: revisionId,
        scope,
        coreArtifactReferenceId: materialized.artifactReferenceId,
        connectionHeaderId: materialized.locator.connectionHeaderId,
        connectionRef: materialized.locator.connectionRef,
        profileRef: materialized.locator.profileRef,
        externalPipelineId: descriptor.externalPipelineId,
        externalJobId: descriptor.externalJobId,
        artifactPathHash: materialized.locator.artifactPathHash,
        sealedLocator: materialized.locator.sealedLocator,
        checksum: descriptor.checksum,
        byteSize: descriptor.byteSize,
        mediaType: descriptor.mediaType,
        artifactKind: descriptor.artifactKind,
        classification: classification(descriptor.classification),
        providerExpiresAt: descriptor.expiresAt,
        descriptorHash: stableDescriptorHash,
        availability,
        observedAt,
        ...(previousRevisionId === undefined ? {} : { previousRevisionId }),
      };
      await artifacts.appendLocatorRevision(input);
      const updated = queryRows<Readonly<{ id: string }>>(
        await manager.query(
          `
UPDATE artifact_references
SET availability=$4,object_version_or_etag=$5,expires_at=$6
WHERE workspace_id=$1 AND project_id=$2 AND id=$3
  AND storage_provider_kind='GITLAB_CI' AND checksum=$7 AND size_bytes=$8 AND classification_key=$9
RETURNING id`,
          [
            materialized.scope.workspaceId,
            materialized.scope.projectId,
            materialized.artifactReferenceId,
            coreAvailability(availability),
            stableDescriptorHash,
            descriptor.expiresAt,
            descriptor.checksum,
            descriptor.byteSize,
            descriptor.classification,
          ],
        ),
      );
      if (updated.length !== 1) throw new Error("GITLAB_ARTIFACT_CORE_REFERENCE_SCOPE_INVALID");
      return revisionId;
    });
  }
}

export class GitLabDispatchingObjectStorage implements ObjectStoragePort {
  constructor(private readonly gitlab: ObjectStoragePort) {}

  async stream(
    reference: ArtifactStorageReference,
  ): Promise<Readonly<{ body: AsyncIterable<Uint8Array> }>> {
    if (reference.providerKind !== "GITLAB_CI")
      throw new Error("GITLAB_ONLY_ARTIFACT_PROVIDER_REQUIRED");
    return await this.gitlab.stream(reference);
  }
}

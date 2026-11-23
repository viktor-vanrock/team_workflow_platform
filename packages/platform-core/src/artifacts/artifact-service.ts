import type { Sha256Digest } from "@awp/platform-contracts";

import type { AuthorizationDecision } from "../identity-access/authorization-policy.ts";
import {
  type ClassificationReference,
  requireProjectScope,
  type ResourceScope,
  type Uuid,
  type WorkspaceContext,
} from "../shared/primitives.ts";

export type ArtifactAvailability = "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";

export interface ArtifactStorageReference {
  readonly providerKind: string;
  readonly opaqueLocator: string;
  readonly objectVersionOrEtag: string;
}

export interface ArtifactReference {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly owner: Readonly<{ entityType: string; entityId: Uuid }>;
  readonly artifactKind: string;
  readonly storage: ArtifactStorageReference;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: Readonly<{ algorithm: "SHA256"; value: Sha256Digest }>;
  readonly classification: ClassificationReference;
  readonly availability: ArtifactAvailability;
  readonly createdBy: Uuid;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
}

export type ArtifactMetadata = Omit<ArtifactReference, "storage"> &
  Readonly<{
    objectVersionOrEtag: string;
    storageProviderKind: string;
  }>;

export interface ScopedArtifactRepository {
  get(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    id: Uuid,
  ): Promise<ArtifactReference | undefined>;
  save(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    reference: ArtifactReference,
  ): Promise<void>;
}

export interface ObjectStoragePort {
  stream(
    reference: ArtifactStorageReference,
  ): Promise<Readonly<{ body: AsyncIterable<Uint8Array> }>>;
}

export interface ArtifactAccessAuthorizer {
  authorizeScope(
    context: WorkspaceContext,
    permission: "artifact.read",
  ): Promise<AuthorizationDecision>;
  authorizeResource(
    context: WorkspaceContext,
    permission: "artifact.read",
    classification: ClassificationReference,
  ): Promise<AuthorizationDecision>;
}

export interface ArtifactContentStream {
  readonly body: AsyncIterable<Uint8Array>;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: Readonly<{ algorithm: "SHA256"; value: Sha256Digest }>;
}

export class ArtifactAccessDeniedError extends Error {
  readonly code = "ARTIFACT_ACCESS_DENIED";
  constructor(readonly reason: string) {
    super("ARTIFACT_ACCESS_DENIED");
  }
}

export class ArtifactNotFoundError extends Error {
  readonly code = "ARTIFACT_NOT_FOUND";
  constructor() {
    super("ARTIFACT_NOT_FOUND");
  }
}

export class ArtifactUnavailableError extends Error {
  readonly code = "ARTIFACT_UNAVAILABLE";
  constructor(readonly availability: ArtifactAvailability) {
    super("ARTIFACT_UNAVAILABLE");
  }
}

export class ArtifactService {
  constructor(
    private readonly repository: ScopedArtifactRepository,
    private readonly storage: ObjectStoragePort,
    private readonly authorization: ArtifactAccessAuthorizer,
  ) {}

  async getArtifactMetadata(
    context: WorkspaceContext,
    artifactId: Uuid,
  ): Promise<ArtifactMetadata> {
    const reference = await this.#authorizedReference(context, artifactId);
    return this.#metadata(reference);
  }

  async streamArtifactContent(
    context: WorkspaceContext,
    artifactId: Uuid,
  ): Promise<ArtifactContentStream> {
    const reference = await this.#authorizedReference(context, artifactId);
    if (reference.availability !== "AVAILABLE")
      throw new ArtifactUnavailableError(reference.availability);

    const recheck = await this.authorization.authorizeResource(
      context,
      "artifact.read",
      reference.classification,
    );
    if (!recheck.allowed) throw new ArtifactAccessDeniedError(recheck.reason);
    const stored = await this.storage.stream(reference.storage);

    return Object.freeze({
      body: stored.body,
      fileName: reference.fileName,
      mediaType: reference.mediaType,
      sizeBytes: reference.sizeBytes,
      checksum: reference.checksum,
    });
  }

  async #authorizedReference(
    context: WorkspaceContext,
    artifactId: Uuid,
  ): Promise<ArtifactReference> {
    const scope = requireProjectScope(context.scope);
    const scopeDecision = await this.authorization.authorizeScope(context, "artifact.read");
    if (!scopeDecision.allowed) throw new ArtifactAccessDeniedError(scopeDecision.reason);

    const reference = await this.repository.get(scope, artifactId);
    if (reference === undefined) throw new ArtifactNotFoundError();
    const resourceDecision = await this.authorization.authorizeResource(
      context,
      "artifact.read",
      reference.classification,
    );
    if (!resourceDecision.allowed) throw new ArtifactAccessDeniedError(resourceDecision.reason);
    return reference;
  }

  #metadata(reference: ArtifactReference): ArtifactMetadata {
    const { storage, ...metadata } = reference;
    return Object.freeze({
      ...metadata,
      objectVersionOrEtag: storage.objectVersionOrEtag,
      storageProviderKind: storage.providerKind,
    });
  }
}

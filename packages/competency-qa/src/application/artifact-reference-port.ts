import {
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";

export type QaArtifactAvailability = "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";

export interface QaGenericArtifactMetadata {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly owner: Readonly<{ entityType: string; entityId: string }>;
  readonly artifactKind: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: Readonly<{ algorithm: "SHA256"; value: `sha256:${string}` }>;
  readonly classification: Readonly<{ key: string; rank: number }>;
  readonly availability: QaArtifactAvailability;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly objectVersionOrEtag: string;
  readonly storageProviderKind: string;
}

export interface QaGenericArtifactMetadataPort {
  getArtifactMetadata(
    context: QaWorkspaceContext,
    artifactId: string,
  ): Promise<QaGenericArtifactMetadata>;
}

export interface QaArtifactReference {
  readonly artifactId: string;
  readonly owner: Readonly<{ entityType: string; entityId: string }>;
  readonly artifactKind: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: `sha256:${string}`;
  readonly dataClassificationKey: string;
  readonly availability: QaArtifactAvailability;
}

export class QaArtifactReferenceAdapter {
  constructor(private readonly artifacts: QaGenericArtifactMetadataPort) {}

  async resolve(
    context: QaWorkspaceContext,
    artifactId: string,
    expectedOwner?: Readonly<{ entityType: string; entityId: string }>,
  ): Promise<QaArtifactReference> {
    const scope = qaScopeFromContext(context);
    const metadata = await this.artifacts.getArtifactMetadata(context, artifactId);
    if (metadata.workspaceId !== scope.workspaceId || metadata.projectId !== scope.projectId) {
      throw new QaDomainError("QA_ARTIFACT_SCOPE_MISMATCH");
    }
    if (
      expectedOwner !== undefined &&
      (metadata.owner.entityType !== expectedOwner.entityType ||
        metadata.owner.entityId !== expectedOwner.entityId)
    ) {
      throw new QaDomainError("QA_ARTIFACT_OWNER_MISMATCH");
    }
    return Object.freeze({
      artifactId: metadata.id,
      owner: metadata.owner,
      artifactKind: metadata.artifactKind,
      mediaType: metadata.mediaType,
      sizeBytes: metadata.sizeBytes,
      checksum: metadata.checksum.value,
      dataClassificationKey: metadata.classification.key,
      availability: metadata.availability,
    });
  }
}

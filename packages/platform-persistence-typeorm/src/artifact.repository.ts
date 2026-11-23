import type {
  ArtifactReference,
  ResourceScope,
  ScopedArtifactRepository,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;

export class TypeOrmArtifactRepository
  extends ScopedRepositoryBase
  implements ScopedArtifactRepository
{
  async get(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    id: string,
  ): Promise<ArtifactReference | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      `SELECT a.*,c.rank classification_rank
      FROM artifact_references a JOIN classification_catalog c ON c.key=a.classification_key
      WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      owner: Object.freeze({
        entityType: String(row.owner_entity_type),
        entityId: String(row.owner_entity_id),
      }),
      artifactKind: String(row.artifact_kind),
      storage: Object.freeze({
        providerKind: String(row.storage_provider_kind),
        opaqueLocator: String(row.opaque_locator),
        objectVersionOrEtag: String(row.object_version_or_etag),
      }),
      fileName: String(row.file_name),
      mediaType: String(row.media_type),
      sizeBytes: Number(row.size_bytes),
      checksum: Object.freeze({
        algorithm: "SHA256" as const,
        value: String(row.checksum) as `sha256:${string}`,
      }),
      classification: Object.freeze({
        key: String(row.classification_key),
        rank: Number(row.classification_rank),
      }),
      availability: String(row.availability) as ArtifactReference["availability"],
      createdBy: String(row.created_by),
      createdAt: new Date(String(row.created_at)),
      ...(row.expires_at ? { expiresAt: new Date(String(row.expires_at)) } : {}),
    });
  }

  async save(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    reference: ArtifactReference,
  ): Promise<void> {
    this.assertEntityScope(scope, reference);
    if (!Number.isSafeInteger(reference.sizeBytes) || reference.sizeBytes < 0)
      throw new Error("ARTIFACT_SIZE_INVALID");
    await this.projectRows(
      scope,
      `INSERT INTO artifact_references(
      id,workspace_id,project_id,owner_entity_type,owner_entity_id,artifact_kind,storage_provider_kind,
      opaque_locator,object_version_or_etag,file_name,media_type,size_bytes,checksum_algorithm,checksum,
      classification_key,availability,created_by,created_at,expires_at
    ) VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [
        reference.id,
        reference.owner.entityType,
        reference.owner.entityId,
        reference.artifactKind,
        reference.storage.providerKind,
        reference.storage.opaqueLocator,
        reference.storage.objectVersionOrEtag,
        reference.fileName,
        reference.mediaType,
        reference.sizeBytes,
        reference.checksum.algorithm,
        reference.checksum.value,
        reference.classification.key,
        reference.availability,
        reference.createdBy,
        reference.createdAt,
        reference.expiresAt ?? null,
      ],
    );
  }
}

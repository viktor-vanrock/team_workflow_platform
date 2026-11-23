import type { DataSource } from "typeorm";

import type { QaPostCloseCorrectionMarker } from "../domain/post-close-correction.ts";

export class TypeOrmQaPostCloseCorrectionRepository {
  constructor(private readonly source: DataSource) {}

  async append(
    input: Readonly<{
      marker: QaPostCloseCorrectionMarker;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
      workItemId: string;
      sessionId: string;
      expectedManifestResourceVersion: number;
      revision: Readonly<{
        manifestId: string;
        content: unknown;
        signature: unknown;
        evidencePolicyRef: unknown;
      }>;
    }>,
  ): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const updated = (await manager.query(
        `UPDATE qa_evidence_manifests SET latest_revision_id=$1,revision_count=revision_count+1,resource_version=resource_version+1,updated_at=$2
         WHERE manifest_id=$3 AND workspace_id=$4 AND project_id=$5 AND work_item_id=$6 AND session_id=$7 AND resource_version=$8 AND latest_revision_id=$9 RETURNING manifest_id`,
        [
          input.marker.clericalRevisionRef.id,
          input.marker.recordedAt,
          input.revision.manifestId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          input.sessionId,
          input.expectedManifestResourceVersion,
          input.marker.previousRevisionRef.id,
        ],
      )) as readonly unknown[];
      if (updated.length === 0) throw new Error("QA_ETAG_MISMATCH");
      await manager.query(
        `INSERT INTO qa_evidence_manifest_revisions(manifest_revision_id,manifest_id,workspace_id,project_id,work_item_id,session_id,version,kind,previous_revision_id,previous_version,previous_content_hash,correction_reason,manifest,content_hash,signature,evidence_policy_ref,published_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'CLERICAL',$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          input.marker.clericalRevisionRef.id,
          input.revision.manifestId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          input.sessionId,
          input.marker.clericalRevisionRef.version,
          input.marker.previousRevisionRef.id,
          input.marker.previousRevisionRef.version,
          input.marker.previousRevisionRef.contentHash,
          input.marker.annotations.map(({ reason }) => reason).join("; "),
          JSON.stringify(input.revision.content),
          input.marker.clericalRevisionRef.contentHash,
          JSON.stringify(input.revision.signature),
          JSON.stringify(input.revision.evidencePolicyRef),
          input.marker.recordedAt,
        ],
      );
      await manager.query(
        `INSERT INTO qa_post_close_correction_markers(marker_id,workspace_id,project_id,work_item_id,session_id,manifest_id,previous_revision_ref,clerical_revision_ref,annotations,basis,actor,authorization_basis_hash,recorded_at,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'HUMAN',$10,$11,$12,$13)`,
        [
          input.marker.markerId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          input.sessionId,
          input.revision.manifestId,
          JSON.stringify(input.marker.previousRevisionRef),
          JSON.stringify(input.marker.clericalRevisionRef),
          JSON.stringify(input.marker.annotations),
          JSON.stringify(input.marker.actor),
          input.marker.authorizationBasisHash,
          input.marker.recordedAt,
          input.marker.clericalRevisionRef.contentHash,
        ],
      );
    });
  }
}

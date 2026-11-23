import type {
  QaEvidenceArtifactLink,
  QaEvidenceOwner,
} from "../application/evidence-artifact-service.ts";
import type { QaEvidenceManifestRevision } from "../domain/evidence-manifest.ts";
import { qaAggregateSnapshotHash, type QaContentHash, type QaScope } from "../domain/primitives.ts";
import type { QaSessionReview } from "../domain/session-review.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

const rows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class TypeOrmEvidenceReviewRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async attach(
    input: Readonly<{
      scope: QaScope;
      workItemId: string;
      sessionId: string;
      evidenceLinkId: string;
      artifactReferenceId: string;
      owner: QaEvidenceOwner;
      checksum: `sha256:${string}`;
      sizeBytes: number;
      mediaType: string;
      classificationKey: string;
      actorId: string;
      at: string;
    }>,
  ): Promise<QaEvidenceArtifactLink> {
    const ownerKind = input.owner.ownerType;
    const contentHash = qaAggregateSnapshotHash({ ...input, ownerKind } as never);
    await this.source.query(
      `INSERT INTO qa_evidence_artifact_links(evidence_link_id,workspace_id,project_id,work_item_id,session_id,artifact_reference_id,owner_kind,owner_session_id,owner_plan_item_id,owner_attempt_id,owner_observation_id,owner_finding_id,role,checksum,size_bytes,media_type,classification_key,availability_at_signing,attached_by,attached_at,finalized_at,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'EXECUTION_EVIDENCE',$13,$14,$15,$16,'AVAILABLE',$17,$18,$18,$19)`,
      [
        input.evidenceLinkId,
        input.scope.workspaceId,
        input.scope.projectId,
        input.workItemId,
        input.sessionId,
        input.artifactReferenceId,
        ownerKind,
        input.owner.ownerType === "SESSION" ? input.owner.ownerId : null,
        input.owner.ownerType === "PLAN_ITEM" ? input.owner.ownerId : null,
        input.owner.ownerType === "ATTEMPT" ? input.owner.ownerId : null,
        input.owner.ownerType === "OBSERVATION" ? input.owner.ownerId : null,
        input.owner.ownerType === "FINDING" ? input.owner.ownerId : null,
        input.checksum,
        input.sizeBytes,
        input.mediaType,
        input.classificationKey,
        input.actorId,
        input.at,
        contentHash,
      ],
    );
    return Object.freeze({
      evidenceArtifactLinkId: input.evidenceLinkId,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      owner: input.owner,
      artifactReferenceId: input.artifactReferenceId,
      checksum: input.checksum,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      dataClassificationKey: input.classificationKey,
      availability: "AVAILABLE",
      availabilityAtSigning: "AVAILABLE",
      attachedBy: input.actorId,
      finalizedAt: input.at,
    });
  }

  async evidence(scope: QaScope, linkId: string): Promise<QaEvidenceArtifactLink | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `SELECT e.*,a.availability FROM qa_evidence_artifact_links e JOIN artifact_references a ON a.workspace_id=e.workspace_id AND a.project_id=e.project_id AND a.id=e.artifact_reference_id WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.evidence_link_id=$3`,
        [scope.workspaceId, scope.projectId, linkId],
      ),
    );
    return found[0] ? this.#evidence(found[0]) : undefined;
  }
  async listEvidence(
    scope: QaScope,
    sessionId: string,
  ): Promise<readonly QaEvidenceArtifactLink[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `SELECT e.*,a.availability FROM qa_evidence_artifact_links e JOIN artifact_references a ON a.workspace_id=e.workspace_id AND a.project_id=e.project_id AND a.id=e.artifact_reference_id WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.session_id=$3 ORDER BY e.finalized_at,e.evidence_link_id`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(found.map((row) => this.#evidence(row)));
  }
  async manifestHeader(
    scope: QaScope,
    sessionId: string,
  ): Promise<
    | Readonly<{
        manifestId: string;
        resourceVersion: number;
        latestRevisionId: string;
        latestAdjudicativeRevisionId: string;
        revisionCount: number;
      }>
    | undefined
  > {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        "SELECT manifest_id,resource_version,latest_revision_id,latest_adjudicative_revision_id,revision_count FROM qa_evidence_manifests WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    const row = found[0];
    return row
      ? Object.freeze({
          manifestId: String(row.manifest_id),
          resourceVersion: Number(row.resource_version),
          latestRevisionId: String(row.latest_revision_id),
          latestAdjudicativeRevisionId: String(row.latest_adjudicative_revision_id),
          revisionCount: Number(row.revision_count),
        })
      : undefined;
  }
  async manifestRevisions(
    scope: QaScope,
    manifestId: string,
  ): Promise<readonly QaEvidenceManifestRevision[]> {
    const found = rows<Readonly<{ manifest: unknown }>>(
      await this.source.query(
        "SELECT manifest FROM qa_evidence_manifest_revisions WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3 ORDER BY version",
        [scope.workspaceId, scope.projectId, manifestId],
      ),
    );
    return Object.freeze(found.map(({ manifest }) => json<QaEvidenceManifestRevision>(manifest)));
  }
  async sessionReviews(scope: QaScope, sessionId: string): Promise<readonly QaSessionReview[]> {
    const found = rows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_session_reviews WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 ORDER BY version",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(found.map(({ content }) => json<QaSessionReview>(content)));
  }
  async resultEvidenceIds(scope: QaScope, resultRevisionId: string): Promise<readonly string[]> {
    const found = rows<Readonly<{ evidence_link_id: string }>>(
      await this.source.query(
        "SELECT evidence_link_id FROM qa_plan_item_result_evidence_memberships WHERE workspace_id=$1 AND project_id=$2 AND result_revision_id=$3 ORDER BY ordinal",
        [scope.workspaceId, scope.projectId, resultRevisionId],
      ),
    );
    return Object.freeze(found.map(({ evidence_link_id }) => evidence_link_id));
  }
  #evidence(row: Record<string, unknown>): QaEvidenceArtifactLink {
    const ownerKind = String(row.owner_kind);
    const owner: QaEvidenceOwner =
      ownerKind === "SESSION"
        ? { ownerType: "SESSION", ownerId: String(row.owner_session_id) }
        : ownerKind === "PLAN_ITEM"
          ? { ownerType: "PLAN_ITEM", ownerId: String(row.owner_plan_item_id) }
          : ownerKind === "ATTEMPT" || ownerKind === "MANUAL_ATTEMPT"
            ? { ownerType: "ATTEMPT", ownerId: String(row.owner_attempt_id) }
            : ownerKind === "FINDING"
              ? { ownerType: "FINDING", ownerId: String(row.owner_finding_id) }
              : { ownerType: "OBSERVATION", ownerId: String(row.owner_observation_id) };
    return Object.freeze({
      evidenceArtifactLinkId: String(row.evidence_link_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      workItemId: String(row.work_item_id),
      sessionId: String(row.session_id),
      owner,
      artifactReferenceId: String(row.artifact_reference_id),
      checksum: String(row.checksum) as QaContentHash,
      mediaType: String(row.media_type),
      sizeBytes: Number(row.size_bytes),
      dataClassificationKey: String(row.classification_key),
      availability: String(row.availability) === "AVAILABLE" ? "AVAILABLE" : "EXPIRED",
      availabilityAtSigning: "AVAILABLE",
      attachedBy: String(row.attached_by),
      finalizedAt: (row.finalized_at instanceof Date
        ? row.finalized_at
        : new Date(String(row.finalized_at))
      ).toISOString(),
    });
  }
}

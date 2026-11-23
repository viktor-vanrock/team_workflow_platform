import type { QaScope } from "../domain/primitives.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export interface StoredEvidenceManifestRevision extends QaScope {
  readonly manifestRevisionId: string;
  readonly manifestId: string;
  readonly version: number;
  readonly sessionId: string;
  readonly workItemId: string;
  readonly contentHash: string;
}

export interface StoredEvidencePackage extends QaScope {
  readonly packageId: string;
  readonly version: number;
  readonly workItemId: string;
  readonly contentHash: string;
}

function key(scope: QaScope, manifestId: string): string {
  return `${scope.workspaceId}:${scope.projectId}:${manifestId}`;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryEvidenceIntegrityRepository {
  readonly #revisions = new Map<string, StoredEvidenceManifestRevision[]>();
  readonly #packages = new Map<string, StoredEvidencePackage>();

  async appendManifest(revision: StoredEvidenceManifestRevision): Promise<void> {
    const storageKey = key(revision, revision.manifestId);
    const current = this.#revisions.get(storageKey) ?? [];
    if (
      current.some(
        ({ manifestRevisionId, version }) =>
          manifestRevisionId === revision.manifestRevisionId || version === revision.version,
      )
    ) {
      throw new Error("EVIDENCE_MANIFEST_REVISION_IMMUTABLE");
    }
    if (revision.version !== current.length + 1) throw new Error("EVIDENCE_MANIFEST_VERSION_GAP");
    this.#revisions.set(storageKey, [...current, clone(revision)]);
  }

  async manifestRevision(
    scope: QaScope,
    manifestId: string,
    version: number,
  ): Promise<StoredEvidenceManifestRevision | undefined> {
    return clone(
      this.#revisions.get(key(scope, manifestId))?.find((item) => item.version === version),
    );
  }
  async appendPackage(value: StoredEvidencePackage): Promise<void> {
    const storageKey = `${value.workspaceId}:${value.projectId}:${value.packageId}:${value.version}`;
    if (this.#packages.has(storageKey)) throw new Error("EVIDENCE_PACKAGE_IMMUTABLE");
    this.#packages.set(storageKey, clone(value));
  }
}

export class EvidenceIntegrityRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async manifestRevision(
    scope: QaScope,
    manifestId: string,
    version: number,
  ): Promise<StoredEvidenceManifestRevision | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM qa_evidence_manifest_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3 AND version=$4",
      [scope.workspaceId, scope.projectId, manifestId, version],
    )) as readonly { semantic_body: StoredEvidenceManifestRevision }[];
    return rows[0]?.semantic_body;
  }
  async appendPackage(value: StoredEvidencePackage, semanticBody: unknown): Promise<void> {
    await this.source.query(
      "INSERT INTO qa_evidence_packages(package_id,version,workspace_id,project_id,work_item_id,manifest_revision_refs,signature_refs,qa_verdict_ref,residual_risk_hash,package_policy_ref,created_by,created_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        value.packageId,
        value.version,
        value.workspaceId,
        value.projectId,
        value.workItemId,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({}),
        value.contentHash,
        JSON.stringify({}),
        JSON.stringify({}),
        new Date().toISOString(),
        JSON.stringify(semanticBody),
        value.contentHash,
      ],
    );
  }
}

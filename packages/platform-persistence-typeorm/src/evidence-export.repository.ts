import type { DataSource } from "typeorm";

import type { ProjectScope } from "@awp/platform-core";

export interface EvidenceExportRecord extends ProjectScope {
  readonly exportId: string;
  readonly status: "COMPLETED" | "DENIED" | "FAILED";
  readonly resultHash?: string;
  readonly safeReasonCode?: string;
  readonly subjectRef?: unknown;
  readonly requestedBy?: unknown;
  readonly authorizationBasisRef?: unknown;
  readonly redactionPolicyRef?: unknown;
  readonly exportPolicyRef?: unknown;
  readonly includedManifestRefs?: readonly unknown[];
  readonly includedArtifactRefs?: readonly unknown[];
  readonly correlationId?: string;
  readonly createdAt?: string;
  readonly contentHash?: string;
}

export class EvidenceExportRepository {
  constructor(private readonly source: DataSource) {}

  async byId(scope: ProjectScope, exportId: string): Promise<EvidenceExportRecord | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM evidence_export_records WHERE workspace_id=$1 AND project_id=$2 AND export_id=$3",
      [scope.workspaceId, scope.projectId, exportId],
    )) as readonly { semantic_body: EvidenceExportRecord }[];
    return rows[0]?.semantic_body;
  }
  async append(record: EvidenceExportRecord): Promise<void> {
    await this.source.query(
      `INSERT INTO evidence_export_records(export_id,workspace_id,project_id,subject_ref,requested_by,authorization_basis_ref,redaction_policy_ref,export_policy_ref,included_manifest_refs,included_artifact_refs,result_hash,status,safe_reason_code,correlation_id,created_at,semantic_body,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        record.exportId,
        record.workspaceId,
        record.projectId,
        JSON.stringify(record.subjectRef ?? {}),
        JSON.stringify(record.requestedBy ?? {}),
        JSON.stringify(record.authorizationBasisRef ?? {}),
        JSON.stringify(record.redactionPolicyRef ?? {}),
        JSON.stringify(record.exportPolicyRef ?? {}),
        JSON.stringify(record.includedManifestRefs ?? []),
        JSON.stringify(record.includedArtifactRefs ?? []),
        record.resultHash ?? null,
        record.status,
        record.safeReasonCode ?? null,
        record.correlationId ?? "correlation-unavailable",
        record.createdAt ?? new Date().toISOString(),
        JSON.stringify(record),
        record.contentHash ?? record.resultHash ?? `sha256:${"0".repeat(64)}`,
      ],
    );
  }
}

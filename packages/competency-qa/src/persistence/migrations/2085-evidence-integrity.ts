import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql, qaRevisionChainGuardSql } from "./immutability-helpers.ts";

export class QaEvidenceIntegrity20851700000002085 implements MigrationInterface {
  readonly name = "QaEvidenceIntegrity20851700000002085";

  async up(queryRunner: QueryRunner): Promise<void> {
    const lineageCheck = qaRevisionChainGuardSql({
      tableName: "qa_evidence_manifest_revisions_v2",
      previousIdColumn: "previous_revision_id",
      previousVersionColumn: "previous_version",
    });
    await queryRunner.query(`
      CREATE TABLE qa_target_snapshots_v2(
        snapshot_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        work_item_id uuid NOT NULL, session_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('MANUAL','AUTOMATED')),
        semantic_body jsonb NOT NULL, captured_at timestamptz NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(snapshot_id), UNIQUE(workspace_id,project_id,snapshot_id), UNIQUE(workspace_id,project_id,session_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );

      CREATE TABLE qa_evidence_manifest_headers_v2(
        manifest_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL, session_id uuid NOT NULL,
        current_revision integer NOT NULL CHECK(current_revision>=1), current_adjudicative_revision integer NOT NULL CHECK(current_adjudicative_revision>=1),
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(manifest_id), UNIQUE(workspace_id,project_id,manifest_id), UNIQUE(workspace_id,project_id,session_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );
      CREATE TABLE qa_evidence_manifest_revisions_v2(
        manifest_revision_id uuid NOT NULL, manifest_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1),
        kind text NOT NULL CHECK(kind IN ('INITIAL','SUBSTANTIVE_CORRECTION','CLERICAL')),
        previous_revision_id uuid NULL, previous_version integer NULL, previous_content_hash text NULL,
        correction_reason text NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL, session_id uuid NOT NULL,
        target_snapshot_id uuid NOT NULL, target_snapshot_hash text NOT NULL CHECK(target_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        effective_classification_key text NOT NULL REFERENCES classification_catalog(key), human_attestation jsonb NOT NULL,
        semantic_body jsonb NOT NULL, created_at timestamptz NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(manifest_revision_id), UNIQUE(workspace_id,project_id,manifest_id,version),
        UNIQUE(workspace_id,project_id,manifest_revision_id),
        UNIQUE(manifest_revision_id,workspace_id,project_id,version,content_hash),
        UNIQUE(manifest_revision_id,workspace_id,project_id,manifest_id,version,content_hash),
        FOREIGN KEY(workspace_id,project_id,manifest_id) REFERENCES qa_evidence_manifest_headers_v2(workspace_id,project_id,manifest_id),
        FOREIGN KEY(workspace_id,project_id,target_snapshot_id) REFERENCES qa_target_snapshots_v2(workspace_id,project_id,snapshot_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,manifest_id,previous_version,previous_content_hash)
          REFERENCES qa_evidence_manifest_revisions_v2(manifest_revision_id,workspace_id,project_id,manifest_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        ${lineageCheck},
        CHECK((kind='INITIAL' AND correction_reason IS NULL) OR (kind<>'INITIAL' AND correction_reason IS NOT NULL))
      );

      CREATE TABLE qa_evidence_manifest_artifact_memberships_v2(
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, manifest_revision_id uuid NOT NULL,
        ordinal integer NOT NULL CHECK(ordinal>=0), artifact_id uuid NOT NULL, checksum text NOT NULL,
        classification_key text NOT NULL REFERENCES classification_catalog(key), availability_at_signing text NOT NULL,
        retention_policy_ref jsonb NOT NULL,
        PRIMARY KEY(manifest_revision_id,ordinal), UNIQUE(workspace_id,project_id,manifest_revision_id,artifact_id),
        FOREIGN KEY(workspace_id,project_id,manifest_revision_id) REFERENCES qa_evidence_manifest_revisions_v2(workspace_id,project_id,manifest_revision_id),
        FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifact_references(workspace_id,project_id,id)
      );

      CREATE TABLE qa_evidence_signature_envelopes(
        signature_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        manifest_revision_id uuid NOT NULL, manifest_revision_version integer NOT NULL, manifest_content_hash text NOT NULL,
        payload_hash text NOT NULL CHECK(payload_hash ~ '^sha256:[a-f0-9]{64}$'), serialization text NOT NULL CHECK(serialization='JCS_RFC8785'),
        signature_format text NOT NULL CHECK(signature_format='JWS_DETACHED'), protected_header jsonb NOT NULL,
        signature text NOT NULL, signing_policy_ref jsonb NOT NULL, public_key_ref jsonb NOT NULL, signed_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(signature_id), UNIQUE(workspace_id,project_id,signature_id),
        UNIQUE(workspace_id,project_id,manifest_revision_id,signing_policy_ref),
        FOREIGN KEY(manifest_revision_id,workspace_id,project_id,manifest_revision_version,manifest_content_hash)
          REFERENCES qa_evidence_manifest_revisions_v2(manifest_revision_id,workspace_id,project_id,version,content_hash)
      );

      CREATE TABLE qa_evidence_packages(
        package_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        manifest_revision_refs jsonb NOT NULL, signature_refs jsonb NOT NULL, qa_verdict_ref jsonb NOT NULL,
        residual_risk_hash text NOT NULL CHECK(residual_risk_hash ~ '^sha256:[a-f0-9]{64}$'), package_policy_ref jsonb NOT NULL,
        created_by jsonb NOT NULL, created_at timestamptz NOT NULL, semantic_body jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(package_id,version), UNIQUE(workspace_id,project_id,package_id,version),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );

      UPDATE platform_schema_versions SET version=2085,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
    for (const table of [
      "qa_target_snapshots_v2",
      "qa_evidence_manifest_revisions_v2",
      "qa_evidence_manifest_artifact_memberships_v2",
      "qa_evidence_signature_envelopes",
      "qa_evidence_packages",
    ])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE qa_evidence_packages;
      DROP TABLE qa_evidence_signature_envelopes;
      DROP TABLE qa_evidence_manifest_artifact_memberships_v2;
      DROP TABLE qa_evidence_manifest_revisions_v2;
      DROP TABLE qa_evidence_manifest_headers_v2;
      DROP TABLE qa_target_snapshots_v2;
      UPDATE platform_schema_versions SET version=2080,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

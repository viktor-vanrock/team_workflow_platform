import type { MigrationInterface, QueryRunner } from "typeorm";

export class QaDefectProposals20951700000002095 implements MigrationInterface {
  readonly name = "QaDefectProposals20951700000002095";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE qa_defect_draft_proposals (
      proposal_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,
      session_id text NOT NULL,finding_id text NOT NULL,review_id text NOT NULL,review_version integer NOT NULL,review_hash text NOT NULL,
      classification_key text NOT NULL REFERENCES classification_catalog(key),created_by uuid NOT NULL REFERENCES identities(id),
      authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,content jsonb NOT NULL,
      proposal_hash text NOT NULL CHECK(proposal_hash ~ '^sha256:[a-f0-9]{64}$'),
      UNIQUE(workspace_id,project_id,proposal_id),CHECK(expires_at>created_at),
      FOREIGN KEY(review_id,workspace_id,project_id,work_item_id,session_id,finding_id)
        REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id),
      FOREIGN KEY(review_id,finding_id,review_version,review_hash)
        REFERENCES qa_finding_review_revisions(finding_review_revision_id,finding_id,version,content_hash)
    );
    CREATE INDEX qa_defect_proposal_scope ON qa_defect_draft_proposals(workspace_id,project_id,work_item_id,finding_id,created_at);
    CREATE FUNCTION qa_defect_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_DEFECT_PROPOSAL_IMMUTABLE'; END $$;
    CREATE TRIGGER qa_defect_proposal_guard BEFORE UPDATE OR DELETE ON qa_defect_draft_proposals FOR EACH ROW EXECUTE FUNCTION qa_defect_proposal_immutable();
    UPDATE platform_schema_versions SET version=2095,applied_at=clock_timestamp() WHERE namespace='pack:qa';`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE qa_defect_draft_proposals; DROP FUNCTION qa_defect_proposal_immutable(); UPDATE platform_schema_versions SET version=2090,applied_at=clock_timestamp() WHERE namespace='pack:qa';",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Incident decisions are source-owned immutable facts, never request booleans. */
export class M0195ProjectIncidentDispositions1700000000195 implements MigrationInterface {
  readonly name = "M0195ProjectIncidentDispositions1700000000195";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE UNIQUE INDEX project_onboarding_revision_scope_id ON project_onboarding_revisions(workspace_id,project_id,revision_id);
    CREATE TABLE project_incident_dispositions (
      disposition_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
      incident_ref text NOT NULL, onboarding_revision_id uuid NOT NULL,
      outcome text NOT NULL CHECK(outcome IN ('ACCEPTED','REJECTED')),
      actor_id uuid NOT NULL REFERENCES identities(id), created_at timestamptz NOT NULL,
      semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
      UNIQUE(workspace_id,project_id,disposition_id),
      FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
      FOREIGN KEY(workspace_id,project_id,onboarding_revision_id) REFERENCES project_onboarding_revisions(workspace_id,project_id,revision_id)
    );
    CREATE INDEX project_incident_disposition_current ON project_incident_dispositions(workspace_id,project_id,incident_ref,created_at DESC);
    CREATE TRIGGER project_incident_dispositions_append_only BEFORE UPDATE OR DELETE ON project_incident_dispositions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
    UPDATE platform_schema_versions SET version=195,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE project_incident_dispositions; DROP INDEX project_onboarding_revision_scope_id; UPDATE platform_schema_versions SET version=190,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable request snapshots with a leased, reconstructible worker cursor. */
export class M0200CapabilityProbeRequests1700000000200 implements MigrationInterface {
  readonly name = "M0200CapabilityProbeRequests1700000000200";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE UNIQUE INDEX integration_validation_report_scope_id ON integration_validation_reports(workspace_id,project_id,id);
    CREATE TABLE capability_probe_requests (
      request_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
      requested_by uuid NOT NULL REFERENCES identities(id), validation_report_id uuid NOT NULL,
      semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
      state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETED','REJECTED')),
      claim_token uuid, lease_until timestamptz, result_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(result_refs)='array'), safe_issue_code text,
      created_at timestamptz NOT NULL, completed_at timestamptz,
      UNIQUE(workspace_id,project_id,request_id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
      FOREIGN KEY(workspace_id,project_id,validation_report_id) REFERENCES integration_validation_reports(workspace_id,project_id,id),
      CHECK((state='RUNNING' AND claim_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'RUNNING' AND claim_token IS NULL AND lease_until IS NULL)),
      CHECK((state IN ('COMPLETED','REJECTED'))=(completed_at IS NOT NULL))
    );
    CREATE INDEX capability_probe_requests_due ON capability_probe_requests(state,lease_until,created_at);
    CREATE FUNCTION awp_probe_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' OR OLD.state IN ('COMPLETED','REJECTED') OR
        ROW(NEW.request_id,NEW.workspace_id,NEW.project_id,NEW.requested_by,NEW.validation_report_id,NEW.semantic_body,NEW.content_hash,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.request_id,OLD.workspace_id,OLD.project_id,OLD.requested_by,OLD.validation_report_id,OLD.semantic_body,OLD.content_hash,OLD.created_at)
      THEN RAISE EXCEPTION 'CAPABILITY_PROBE_REQUEST_IMMUTABLE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER capability_probe_request_immutable BEFORE UPDATE OR DELETE ON capability_probe_requests FOR EACH ROW EXECUTE FUNCTION awp_probe_request_immutable();
    UPDATE platform_schema_versions SET version=200,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE capability_probe_requests; DROP INDEX integration_validation_report_scope_id; DROP FUNCTION awp_probe_request_immutable(); UPDATE platform_schema_versions SET version=195,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}

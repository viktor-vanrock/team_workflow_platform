import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0165PilotHardening1700000000165 implements MigrationInterface {
  readonly name = "M0165PilotHardening1700000000165";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE pilot_record_revisions (
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, record_id uuid NOT NULL,
        kind text NOT NULL CHECK(kind IN ('GATE_EXECUTION','COHORT','RECOVERY','DEPLOYMENT','FENCE')),
        version integer NOT NULL CHECK(version>=1), schema_version integer NOT NULL CHECK(schema_version=1),
        actor_ref uuid NOT NULL REFERENCES identities(id), correlation_id text NOT NULL CHECK(length(correlation_id) BETWEEN 1 AND 255),
        created_at timestamptz NOT NULL, semantic_body jsonb NOT NULL CHECK(jsonb_typeof(semantic_body)='object'),
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(workspace_id,project_id,record_id,version),
        UNIQUE(workspace_id,project_id,record_id,kind,version,content_hash),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX pilot_record_scope_kind_created_idx ON pilot_record_revisions(workspace_id,project_id,kind,created_at DESC,record_id,version);
      CREATE TRIGGER pilot_record_revisions_append_only BEFORE UPDATE OR DELETE ON pilot_record_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE pilot_record_headers (
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, record_id uuid NOT NULL,
        kind text NOT NULL CHECK(kind IN ('GATE_EXECUTION','COHORT','RECOVERY','DEPLOYMENT','FENCE')),
        current_version integer NOT NULL CHECK(current_version>=1),
        current_hash text NOT NULL CHECK(current_hash ~ '^sha256:[a-f0-9]{64}$'),
        row_version bigint NOT NULL CHECK(row_version>=1),
        PRIMARY KEY(workspace_id,project_id,record_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(workspace_id,project_id,record_id,kind,current_version,current_hash)
          REFERENCES pilot_record_revisions(workspace_id,project_id,record_id,kind,version,content_hash)
      );
      CREATE INDEX pilot_header_scope_kind_idx ON pilot_record_headers(workspace_id,project_id,kind,record_id);
      CREATE FUNCTION awp_pilot_header_cas() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PILOT_HEADER_DELETE_FORBIDDEN'; END IF;
        IF NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id OR NEW.record_id<>OLD.record_id OR NEW.kind<>OLD.kind
          OR NEW.row_version<>OLD.row_version+1 OR NEW.current_version<>OLD.current_version+1
        THEN RAISE EXCEPTION 'PILOT_HEADER_CAS_REQUIRED'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pilot_header_cas BEFORE UPDATE OR DELETE ON pilot_record_headers FOR EACH ROW EXECUTE FUNCTION awp_pilot_header_cas();
      UPDATE platform_schema_versions SET version=165,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE pilot_record_headers; DROP FUNCTION awp_pilot_header_cas(); DROP TABLE pilot_record_revisions;
      UPDATE platform_schema_versions SET version=160,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
}

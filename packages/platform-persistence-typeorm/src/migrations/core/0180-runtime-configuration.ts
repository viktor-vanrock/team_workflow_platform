import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0180RuntimeConfiguration1700000000180 implements MigrationInterface {
  readonly name = "M0180RuntimeConfiguration1700000000180";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE runtime_configuration_revisions(
        workspace_id uuid NOT NULL REFERENCES workspaces(id),configuration_id text NOT NULL,version integer NOT NULL CHECK(version>0),
        kind text NOT NULL CHECK(kind IN ('INPUT_PACKAGE','IDENTITY_POLICY','SECRET_RESOLVER_POLICY','SIGNING_POLICY','TELEMETRY_POLICY','NETWORK_POLICY','ARTIFACT_POLICY','MODEL_POLICY','RECOVERY_POLICY','CONNECTOR_BINDING')),
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        publication_hash text NOT NULL CHECK(publication_hash ~ '^sha256:[a-f0-9]{64}$'),semantic_body jsonb NOT NULL,
        published_by uuid NOT NULL REFERENCES identities(id),published_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,configuration_id,version),UNIQUE(workspace_id,configuration_id,version,content_hash,kind),CHECK(valid_until>published_at)
      );
      CREATE TABLE runtime_configuration_projects(
        workspace_id uuid NOT NULL,configuration_id text NOT NULL,version integer NOT NULL,project_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,configuration_id,version,project_id),
        FOREIGN KEY(workspace_id,configuration_id,version) REFERENCES runtime_configuration_revisions(workspace_id,configuration_id,version),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE runtime_configuration_headers(
        workspace_id uuid NOT NULL,configuration_id text NOT NULL,kind text NOT NULL,current_version integer NOT NULL,current_hash text NOT NULL,
        state text NOT NULL CHECK(state IN ('PUBLISHED','REVOKED')),row_version bigint NOT NULL CHECK(row_version>0),
        PRIMARY KEY(workspace_id,configuration_id),
        FOREIGN KEY(workspace_id,configuration_id,current_version,current_hash,kind) REFERENCES runtime_configuration_revisions(workspace_id,configuration_id,version,content_hash,kind)
      );
      CREATE TABLE runtime_configuration_events(
        event_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,configuration_id text NOT NULL,version integer NOT NULL,
        action text NOT NULL CHECK(action IN ('PUBLISH','REVOKE')),actor_ref uuid NOT NULL REFERENCES identities(id),correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        FOREIGN KEY(workspace_id,configuration_id,version) REFERENCES runtime_configuration_revisions(workspace_id,configuration_id,version)
      );
      CREATE TRIGGER runtime_configuration_revisions_immutable BEFORE UPDATE OR DELETE ON runtime_configuration_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TRIGGER runtime_configuration_projects_immutable BEFORE UPDATE OR DELETE ON runtime_configuration_projects FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TRIGGER runtime_configuration_events_immutable BEFORE UPDATE OR DELETE ON runtime_configuration_events FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE FUNCTION guard_runtime_configuration_header() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RUNTIME_CONFIGURATION_DELETE_FORBIDDEN'; END IF;
        IF TG_OP='INSERT' THEN
          IF NEW.current_version<>1 OR NEW.row_version<>1 OR NEW.state<>'PUBLISHED' THEN RAISE EXCEPTION 'RUNTIME_CONFIGURATION_CAS_REQUIRED'; END IF;
        ELSIF (NEW.workspace_id,NEW.configuration_id,NEW.kind) IS DISTINCT FROM (OLD.workspace_id,OLD.configuration_id,OLD.kind)
          OR NEW.row_version<>OLD.row_version+1
          OR NOT ((NEW.current_version=OLD.current_version+1 AND NEW.state='PUBLISHED')
            OR (NEW.current_version=OLD.current_version AND NEW.current_hash=OLD.current_hash AND OLD.state='PUBLISHED' AND NEW.state='REVOKED'))
          THEN RAISE EXCEPTION 'RUNTIME_CONFIGURATION_CAS_REQUIRED';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER runtime_configuration_header_cas BEFORE INSERT OR UPDATE OR DELETE ON runtime_configuration_headers FOR EACH ROW EXECUTE FUNCTION guard_runtime_configuration_header();
      UPDATE platform_schema_versions SET version=180,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE runtime_configuration_events,runtime_configuration_headers,runtime_configuration_projects,runtime_configuration_revisions; DROP FUNCTION guard_runtime_configuration_header(); UPDATE platform_schema_versions SET version=175,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0175RuntimeRegistration1700000000175 implements MigrationInterface {
  readonly name = "M0175RuntimeRegistration1700000000175";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE pilot_runtime_registrations(
        instance_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
        deployment_id uuid NOT NULL, deployment_version integer NOT NULL CHECK(deployment_version>0),
        component text NOT NULL CHECK(component IN ('api','worker')),
        config_digest text NOT NULL CHECK(config_digest ~ '^sha256:[a-f0-9]{64}$'),
        image_digest text NOT NULL CHECK(image_digest ~ '^sha256:[a-f0-9]{64}$'),
        state text NOT NULL CHECK(state IN ('ACTIVE','STOPPED')),
        started_at timestamptz NOT NULL, refreshed_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL, row_version bigint NOT NULL DEFAULT 1,
        CHECK(row_version>0), CHECK(refreshed_at>=started_at), CHECK(expires_at>refreshed_at)
      );
      CREATE INDEX pilot_runtime_active_deployment_idx ON pilot_runtime_registrations(workspace_id,deployment_id,component,expires_at) WHERE state='ACTIVE';
      CREATE FUNCTION guard_pilot_runtime_registration() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DEPLOYMENT_REGISTRATION_DELETE_FORBIDDEN'; END IF;
        IF (NEW.instance_id,NEW.workspace_id,NEW.deployment_id,NEW.deployment_version,NEW.component,NEW.config_digest,NEW.image_digest,NEW.started_at)
          IS DISTINCT FROM (OLD.instance_id,OLD.workspace_id,OLD.deployment_id,OLD.deployment_version,OLD.component,OLD.config_digest,OLD.image_digest,OLD.started_at)
          THEN RAISE EXCEPTION 'DEPLOYMENT_REGISTRATION_IMMUTABLE'; END IF;
        IF NEW.row_version<>OLD.row_version+1 OR OLD.state='STOPPED' OR NEW.refreshed_at<OLD.refreshed_at
          OR (NEW.state='ACTIVE' AND OLD.expires_at<=clock_timestamp())
          THEN RAISE EXCEPTION 'DEPLOYMENT_REGISTRATION_FENCED'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_pilot_runtime_registration BEFORE UPDATE OR DELETE ON pilot_runtime_registrations FOR EACH ROW EXECUTE FUNCTION guard_pilot_runtime_registration();
      UPDATE platform_schema_versions SET version=175,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE pilot_runtime_registrations; DROP FUNCTION guard_pilot_runtime_registration(); UPDATE platform_schema_versions SET version=170,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}

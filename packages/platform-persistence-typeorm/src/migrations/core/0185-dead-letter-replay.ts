import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0185DeadLetterReplay1700000000185 implements MigrationInterface {
  readonly name = "M0185DeadLetterReplay1700000000185";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
CREATE TABLE pilot_dead_letters (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, command_id uuid NOT NULL,
  owner_ref uuid NOT NULL REFERENCES identities(id), first_failure_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, semantic_body jsonb NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY(workspace_id,project_id,command_id),
  FOREIGN KEY(workspace_id,project_id,command_id) REFERENCES connector_commands(workspace_id,project_id,id)
);
CREATE INDEX pilot_dead_letter_owner_idx ON pilot_dead_letters(workspace_id,project_id,owner_ref,command_id);
CREATE TRIGGER pilot_dead_letters_immutable BEFORE UPDATE OR DELETE ON pilot_dead_letters FOR EACH ROW EXECUTE FUNCTION awp_append_only();
CREATE TABLE pilot_replay_decisions (
  id uuid PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,command_id uuid NOT NULL,
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
  actor_ref uuid NOT NULL REFERENCES identities(id),request_hash text NOT NULL,
  semantic_body jsonb NOT NULL,content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE(workspace_id,project_id,command_id,request_key),
  FOREIGN KEY(workspace_id,project_id,command_id) REFERENCES pilot_dead_letters(workspace_id,project_id,command_id)
);
CREATE TRIGGER pilot_replay_decisions_immutable BEFORE UPDATE OR DELETE ON pilot_replay_decisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
UPDATE platform_schema_versions SET version=185,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE pilot_replay_decisions; DROP TABLE pilot_dead_letters; UPDATE platform_schema_versions SET version=180,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}

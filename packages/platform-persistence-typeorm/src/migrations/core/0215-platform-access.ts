import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0215PlatformAccess1700000000215 implements MigrationInterface {
  readonly name = "M0215PlatformAccess1700000000215";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE platform_user_profiles (
        principal_id uuid PRIMARY KEY REFERENCES identities(id),
        display_name text NOT NULL, username text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        last_authenticated_at timestamptz
      );
      CREATE TABLE platform_role_assignments (
        principal_id uuid NOT NULL REFERENCES identities(id),
        role_key text NOT NULL CHECK(role_key='access-administrator'),
        source text NOT NULL CHECK(source IN ('LOCAL_BOOTSTRAP','CORPORATE_GROUP')),
        revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(principal_id,role_key)
      );
      CREATE TABLE workspace_access_heads (
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        principal_id uuid NOT NULL REFERENCES identities(id),
        version integer NOT NULL DEFAULT 0 CHECK(version>=0),
        PRIMARY KEY(workspace_id,principal_id)
      );
      CREATE TABLE platform_access_changes (
        id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES identities(id),
        target_id uuid NOT NULL REFERENCES identities(id),
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        request_key uuid NOT NULL UNIQUE, request_hash text NOT NULL,
        before_json jsonb NOT NULL, after_json jsonb NOT NULL, reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX platform_access_change_target ON platform_access_changes(target_id,created_at DESC);
      CREATE TRIGGER platform_access_change_append_only BEFORE UPDATE OR DELETE ON platform_access_changes
        FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      INSERT INTO platform_user_profiles(principal_id,display_name,username)
        SELECT i.id,i.display_name,i.subject FROM identities i WHERE i.kind='HUMAN' AND EXISTS(
          SELECT 1 FROM workspace_memberships m WHERE m.principal_id=i.id AND m.state='ACTIVE'
          AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp()
          AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()));
      UPDATE platform_schema_versions SET version=215,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("PLATFORM_ACCESS_ROLLBACK_REQUIRES_FORWARD_MIGRATION");
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Customer access is represented by exact project role assignments and entitlements. */
export class M0220CustomerProjectDialogues1700000000220 implements MigrationInterface {
  readonly name = "M0220CustomerProjectDialogues1700000000220";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE customer_scope_migration_records (
        assignment_id uuid PRIMARY KEY, before_json jsonb NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      INSERT INTO customer_scope_migration_records(assignment_id,before_json)
        SELECT r.id,to_jsonb(r) FROM role_assignments r WHERE r.role_key='requester' AND r.project_id IS NULL AND r.effect='ALLOW' AND r.revoked_at IS NULL;
      CREATE TRIGGER customer_scope_migration_append_only BEFORE UPDATE OR DELETE ON customer_scope_migration_records
        FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from,valid_until,classification_ceiling_key)
      SELECT gen_random_uuid(),r.workspace_id,p.id,r.principal_id,'requester','ALLOW',r.permissions,r.valid_from,r.valid_until,r.classification_ceiling_key
      FROM role_assignments r JOIN projects p ON p.workspace_id=r.workspace_id
      WHERE r.role_key='requester' AND r.project_id IS NULL AND r.effect='ALLOW' AND r.revoked_at IS NULL
        AND (EXISTS(SELECT 1 FROM work_items w WHERE w.workspace_id=p.workspace_id AND w.project_id=p.id AND w.created_by=r.principal_id)
          OR EXISTS(SELECT 1 FROM intake_drafts d WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id AND d.created_by=r.principal_id)
          OR EXISTS(SELECT 1 FROM project_registry_revisions v WHERE v.workspace_id=p.workspace_id AND v.project_id=p.id AND v.version=p.current_registry_version AND v.owner_ids ? r.principal_id::text))
        AND NOT EXISTS(SELECT 1 FROM role_assignments a WHERE a.workspace_id=r.workspace_id AND a.project_id=p.id AND a.principal_id=r.principal_id AND a.role_key='requester' AND a.effect='ALLOW' AND a.revoked_at IS NULL);
      UPDATE role_assignments SET permissions='["project.request.create"]',project_access_scope='SELECTED_PROJECTS',row_version=row_version+1
        WHERE role_key='requester' AND project_id IS NULL AND effect='ALLOW' AND revoked_at IS NULL;
      INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,valid_until,classification_ceiling_key)
      SELECT gen_random_uuid(),s.workspace_id,s.principal_id,'requester','ALLOW','["project.request.create"]',s.valid_from,s.valid_until,s.ceiling
      FROM (SELECT DISTINCT ON(r.workspace_id,r.principal_id) r.workspace_id,r.principal_id,r.valid_from,r.valid_until,COALESCE(r.classification_ceiling_key,'PUBLIC') AS ceiling
        FROM role_assignments r JOIN classification_catalog c ON c.key=COALESCE(r.classification_ceiling_key,'PUBLIC')
        WHERE r.role_key='requester' AND r.project_id IS NOT NULL AND r.effect='ALLOW' AND r.revoked_at IS NULL
          AND r.valid_from<=clock_timestamp() AND (r.valid_until IS NULL OR r.valid_until>clock_timestamp())
          AND NOT EXISTS(SELECT 1 FROM role_assignments a WHERE a.workspace_id=r.workspace_id AND a.principal_id=r.principal_id AND a.role_key='requester' AND a.project_id IS NULL AND a.effect='ALLOW' AND a.revoked_at IS NULL)
        ORDER BY r.workspace_id,r.principal_id,c.rank DESC,r.id) s;
      ALTER TABLE role_assignments ADD CONSTRAINT requester_project_scope CHECK(
        role_key<>'requester' OR effect<>'ALLOW' OR revoked_at IS NOT NULL OR
        (project_access_scope='SELECTED_PROJECTS' AND (project_id IS NOT NULL OR permissions='["project.request.create"]'::jsonb)));
      CREATE TABLE project_registration_dialogues (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
        principal_id uuid NOT NULL REFERENCES identities(id),
        version integer NOT NULL DEFAULT 1, state text NOT NULL CHECK(state IN ('COLLECTING','READY','CREATED')),
        draft jsonb NOT NULL, messages jsonb NOT NULL, project_id uuid REFERENCES projects(id),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE(workspace_id,principal_id,id)
      );
      CREATE TABLE project_dialogue_commands (
        dialogue_id uuid NOT NULL REFERENCES project_registration_dialogues(id), request_key uuid NOT NULL,
        request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(dialogue_id,request_key)
      );
      CREATE TRIGGER project_dialogue_command_append_only BEFORE UPDATE OR DELETE ON project_dialogue_commands
        FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=220,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("CUSTOMER_PROJECT_ACCESS_REQUIRES_FORWARD_MIGRATION");
  }
}

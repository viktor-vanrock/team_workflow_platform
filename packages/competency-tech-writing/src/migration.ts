import type { MigrationInterface, QueryRunner } from "typeorm";

export class M1100TechWriting1700000001100 implements MigrationInterface {
  readonly name = "M1100TechWriting1700000001100";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE tech_writing_documents (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        author_id uuid NOT NULL REFERENCES identities(id), snapshot jsonb NOT NULL,
        UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK (snapshot->>'id'=id::text AND snapshot->>'workspaceId'=workspace_id::text AND snapshot->>'projectId'=project_id::text AND snapshot->'author'->>'id'=author_id::text)
      );
      CREATE TABLE tech_writing_history (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, document_id uuid NOT NULL,
        resource_version integer NOT NULL, entry jsonb NOT NULL, authorization_basis jsonb NOT NULL,
        UNIQUE(workspace_id,project_id,document_id,resource_version),
        FOREIGN KEY(workspace_id,project_id,document_id) REFERENCES tech_writing_documents(workspace_id,project_id,id)
      );
      CREATE FUNCTION tech_writing_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TECH_WRITING_HISTORY_IMMUTABLE'; END; $$;
      CREATE TRIGGER tech_writing_history_immutable BEFORE UPDATE OR DELETE ON tech_writing_history FOR EACH ROW EXECUTE FUNCTION tech_writing_immutable_history();
      INSERT INTO platform_schema_versions(namespace,version,applied_at) VALUES('pack:tech-writing',1100,clock_timestamp())
      ON CONFLICT(namespace) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at;
    `);
  }
  async down(): Promise<void> {
    throw new Error("TECH_WRITING_EXPAND_ONLY_ROLLBACK_KEEP_DATA");
  }
}
export const techWritingMigrations = Object.freeze([
  { order: 1100, owner: "pack:tech-writing" as const, migration: M1100TechWriting1700000001100 },
]);

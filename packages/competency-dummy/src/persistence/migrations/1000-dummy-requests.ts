import type { MigrationInterface, QueryRunner } from "typeorm";

export class M1000DummyRequests1700000001000 implements MigrationInterface {
  readonly name = "M1000DummyRequests1700000001000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dummy_requests (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        sample_name text NOT NULL, message text NOT NULL, history jsonb NOT NULL DEFAULT '[]'::jsonb,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,work_item_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );
      INSERT INTO platform_schema_versions(namespace,version,applied_at) VALUES('pack:dummy',1000,clock_timestamp())
        ON CONFLICT(namespace) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at;
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE dummy_requests; DELETE FROM platform_schema_versions WHERE namespace='pack:dummy';",
    );
  }
}

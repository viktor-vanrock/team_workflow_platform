import type { MigrationInterface, QueryRunner } from "typeorm";

export class M3000JiraDiscoveryProfiles1700000003000 implements MigrationInterface {
  readonly name = "M3000JiraDiscoveryProfiles1700000003000";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
  INSERT INTO platform_schema_versions(namespace,version,applied_at) VALUES('connector:jira',3000,clock_timestamp()) ON CONFLICT(namespace) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at;
  CREATE TABLE jira_discovery_snapshots(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,connection_ref jsonb NOT NULL,adapter_family text NOT NULL,adapter_contract_version text NOT NULL,edition text NOT NULL,exact_build text NOT NULL,api_flavor text NOT NULL,sanitized_metadata jsonb NOT NULL,schema_ref jsonb NOT NULL,content_hash text NOT NULL UNIQUE,validation_status text NOT NULL,collected_at timestamptz NOT NULL,expires_at timestamptz NULL);
  CREATE TABLE jira_profile_validation_details(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,profile_ref jsonb NOT NULL,candidate_content_hash text NOT NULL,discovery_snapshot_id uuid NOT NULL REFERENCES jira_discovery_snapshots(id),status text NOT NULL,issues jsonb NOT NULL,preview_hash text NULL,dry_run_hash text NULL,created_at timestamptz NOT NULL);
  CREATE INDEX jira_discovery_connection ON jira_discovery_snapshots(workspace_id,connection_ref,collected_at DESC);
`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE jira_profile_validation_details; DROP TABLE jira_discovery_snapshots; DELETE FROM platform_schema_versions WHERE namespace='connector:jira';",
    );
  }
}

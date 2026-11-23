import type { MigrationInterface, QueryRunner } from "typeorm";

export class M3010JiraWebhookRate1700000003010 implements MigrationInterface {
  readonly name = "M3010JiraWebhookRate1700000003010";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
  CREATE TABLE jira_webhook_normalizations(id uuid PRIMARY KEY,receipt_ref jsonb NOT NULL,connection_ref jsonb NOT NULL,adapter_family text NOT NULL,provider_delivery_id text NOT NULL,provider_retry_number integer NULL,event_type text NOT NULL,external_entity_id text NOT NULL,changelog_id text NULL,verification_mode text NOT NULL,verification_result text NOT NULL,secret_key_version_ref text NULL,normalization_hash text NOT NULL,status text NOT NULL CHECK(status IN ('ACCEPTED','DUPLICATE','REJECTED','SCOPE_PENDING')),reason_code text NULL,created_at timestamptz NOT NULL,UNIQUE(connection_ref,provider_delivery_id));
  CREATE TABLE jira_rate_limit_snapshots(id uuid PRIMARY KEY,connection_ref jsonb NOT NULL,lane text NOT NULL,reason text NULL,remaining integer NULL,reset_at timestamptz NULL,retry_after_seconds integer NULL,decision text NOT NULL,next_eligible_at timestamptz NULL,observed_at timestamptz NOT NULL);
  UPDATE platform_schema_versions SET version=3010,applied_at=clock_timestamp() WHERE namespace='connector:jira';
`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE jira_rate_limit_snapshots; DROP TABLE jira_webhook_normalizations; UPDATE platform_schema_versions SET version=3000 WHERE namespace='connector:jira';",
    );
  }
}

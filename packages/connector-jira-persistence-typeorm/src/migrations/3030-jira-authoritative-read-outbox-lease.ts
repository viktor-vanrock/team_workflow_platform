import type { MigrationInterface, QueryRunner } from "typeorm";

export class M3030JiraAuthoritativeReadOutboxLease1700000003030 implements MigrationInterface {
  readonly name = "M3030JiraAuthoritativeReadOutboxLease1700000003030";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_outbox
        ADD COLUMN lease_owner text NULL,
        ADD COLUMN lease_token bigint NOT NULL DEFAULT 0,
        ADD COLUMN lease_until timestamptz NULL,
        ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
      ALTER TABLE event_outbox
        ADD CONSTRAINT event_outbox_jira_authoritative_lease_shape CHECK (
          event_type <> 'jira.authoritative-read.requested.v1'
          OR state <> 'LEASED'
          OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_token > 0)
        ),
        ADD CONSTRAINT event_outbox_jira_authoritative_attempt_count CHECK (
          event_type <> 'jira.authoritative-read.requested.v1'
          OR attempt_count >= 0
        );
      CREATE INDEX event_outbox_jira_authoritative_delivery_idx
        ON event_outbox(state,lease_until,created_at,id)
        WHERE event_type='jira.authoritative-read.requested.v1'
          AND state IN ('READY','LEASED');
      UPDATE platform_schema_versions
         SET version=3030,applied_at=clock_timestamp()
       WHERE namespace='connector:jira';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX event_outbox_jira_authoritative_delivery_idx;
      ALTER TABLE event_outbox
        DROP CONSTRAINT event_outbox_jira_authoritative_attempt_count,
        DROP CONSTRAINT event_outbox_jira_authoritative_lease_shape,
        DROP COLUMN attempt_count,
        DROP COLUMN lease_until,
        DROP COLUMN lease_token,
        DROP COLUMN lease_owner;
      UPDATE platform_schema_versions
         SET version=3020,applied_at=clock_timestamp()
       WHERE namespace='connector:jira';
    `);
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class M3040JiraEffectLeaseOwner1700000003040 implements MigrationInterface {
  readonly name = "M3040JiraEffectLeaseOwner1700000003040";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE jira_effect_reconciliations
        ADD COLUMN lease_owner text NULL,
        ADD CONSTRAINT jira_effect_lease_shape CHECK (
          (lease_owner IS NULL AND lease_until IS NULL)
          OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_token > 0)
        );
      CREATE INDEX jira_effect_active_lease_idx
        ON jira_effect_reconciliations(lease_until,effect_id)
        WHERE lease_owner IS NOT NULL;
      UPDATE platform_schema_versions
         SET version=3040,applied_at=clock_timestamp()
       WHERE namespace='connector:jira';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX jira_effect_active_lease_idx;
      ALTER TABLE jira_effect_reconciliations
        DROP CONSTRAINT jira_effect_lease_shape,
        DROP COLUMN lease_owner;
      UPDATE platform_schema_versions
         SET version=3030,applied_at=clock_timestamp()
       WHERE namespace='connector:jira';
    `);
  }
}

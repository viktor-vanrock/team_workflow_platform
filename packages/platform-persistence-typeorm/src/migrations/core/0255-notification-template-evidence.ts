import type { MigrationInterface, QueryRunner } from "typeorm";

/** Nullable for pre-existing/local intents; corporate delivery requires complete evidence. */
export class M0255NotificationTemplateEvidence1700000000255 implements MigrationInterface {
  readonly name = "M0255NotificationTemplateEvidence1700000000255";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE notification_intents ADD COLUMN template_evidence jsonb NULL;
      ALTER TABLE notification_intents ADD CONSTRAINT notification_template_evidence_object
        CHECK (template_evidence IS NULL OR jsonb_typeof(template_evidence)='object');
      UPDATE platform_schema_versions SET version=255,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error("NOTIFICATION_EVIDENCE_ROLLBACK_TRANSACTION_REQUIRED");
    await runner.query("LOCK TABLE notification_intents IN ACCESS EXCLUSIVE MODE");
    const rows = (await runner.query(
      "SELECT EXISTS(SELECT 1 FROM notification_intents WHERE template_evidence IS NOT NULL) AS present",
    )) as readonly { present: boolean }[];
    if (rows[0]?.present)
      throw new Error("NOTIFICATION_EVIDENCE_ROLLBACK_REQUIRES_EXPLICIT_HANDLING");
    await runner.query(`ALTER TABLE notification_intents DROP CONSTRAINT notification_template_evidence_object;
      ALTER TABLE notification_intents DROP COLUMN template_evidence;
      UPDATE platform_schema_versions SET version=250,applied_at=clock_timestamp() WHERE namespace='core';`);
  }
}

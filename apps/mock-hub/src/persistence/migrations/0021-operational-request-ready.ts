import type { MigrationInterface, QueryRunner } from "typeorm";

export class OperationalRequestReady00211700000002001 implements MigrationInterface {
  readonly name = "OperationalRequestReady00211700000002001";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE operational_requests DROP CONSTRAINT operational_requests_normalized_status_check",
    );
    await queryRunner.query(
      "ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_normalized_status_check CHECK(normalized_status IN ('NEW','READY'))",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE operational_requests DROP CONSTRAINT operational_requests_normalized_status_check",
    );
    await queryRunner.query(
      "ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_normalized_status_check CHECK(normalized_status='NEW')",
    );
  }
}

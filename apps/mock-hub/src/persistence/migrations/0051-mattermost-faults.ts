import type { MigrationInterface, QueryRunner } from "typeorm";

export class MattermostFaults00511700000002051 implements MigrationInterface {
  readonly name = "MattermostFaults00511700000002051";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mattermost_mock_faults (
        singleton integer PRIMARY KEY CHECK(singleton = 1),
        fault text NOT NULL,
        remaining integer NOT NULL CHECK(remaining >= 0)
      );
      INSERT INTO mattermost_mock_faults(singleton, fault, remaining)
      VALUES (1, 'NORMAL', 0);
      CREATE TABLE mattermost_mock_callbacks (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        callback_kind text NOT NULL,
        connection_id text NOT NULL,
        external_user_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE mattermost_mock_callbacks; DROP TABLE mattermost_mock_faults;",
    );
  }
}

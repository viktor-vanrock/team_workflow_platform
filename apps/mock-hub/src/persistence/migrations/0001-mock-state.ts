import type { MigrationInterface, QueryRunner } from "typeorm";

export class MockState00011700000001000 implements MigrationInterface {
  readonly name = "MockState00011700000001000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
    CREATE TABLE mock_calls(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,effect_idempotency_key text NOT NULL,request_hash text NOT NULL,recorded_at timestamptz NOT NULL);
    CREATE TABLE mock_effects(effect_idempotency_key text PRIMARY KEY,request_hash text NOT NULL,effect_count integer NOT NULL CHECK(effect_count=1),external_record_id text NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL);
    CREATE TABLE mock_events(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_id text NOT NULL,scenario text NOT NULL,external_record_id text NOT NULL,recorded_at timestamptz NOT NULL);
    CREATE TABLE mock_scenario(singleton integer PRIMARY KEY CHECK(singleton=1),scenario text NOT NULL,applies_to_next integer NOT NULL CHECK(applies_to_next>=0));
    CREATE TABLE mock_seed_state(singleton integer PRIMARY KEY CHECK(singleton=1),seed integer NOT NULL);
    INSERT INTO mock_scenario VALUES(1,'SUCCESS',0); INSERT INTO mock_seed_state VALUES(1,0);
  `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE mock_seed_state; DROP TABLE mock_scenario; DROP TABLE mock_events; DROP TABLE mock_effects; DROP TABLE mock_calls;",
    );
  }
}

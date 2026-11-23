import type { MigrationInterface, QueryRunner } from "typeorm";

export class OperationalRequests00201700000002000 implements MigrationInterface {
  readonly name = "OperationalRequests00201700000002000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE operational_requests(
        external_entity_id text PRIMARY KEY,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        authority_scope_key text NOT NULL,
        natural_key text NOT NULL,
        source_draft_id uuid NOT NULL,
        request_kind text NOT NULL,
        summary text NOT NULL,
        description text NULL,
        acceptance_outcome text NULL,
        data_classification_key text NOT NULL,
        external_version bigint NOT NULL CHECK(external_version >= 1),
        raw_external_state text NOT NULL,
        normalized_status text NOT NULL CHECK(normalized_status = 'NEW'),
        profile_id uuid NOT NULL,
        profile_version integer NOT NULL CHECK(profile_version >= 1),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE(workspace_id, project_id, natural_key)
      );
      CREATE INDEX operational_requests_scope_idx
        ON operational_requests(workspace_id, project_id, external_entity_id);

      CREATE TABLE operational_request_effects(
        effect_idempotency_key text PRIMARY KEY,
        request_hash text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        profile_id uuid NOT NULL,
        profile_version integer NOT NULL CHECK(profile_version >= 1),
        external_entity_id text NOT NULL REFERENCES operational_requests(external_entity_id),
        result jsonb NOT NULL,
        effect_count integer NOT NULL CHECK(effect_count = 1),
        recorded_at timestamptz NOT NULL
      );
      CREATE INDEX operational_request_effects_scope_idx
        ON operational_request_effects(workspace_id, project_id, effect_idempotency_key);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE operational_request_effects;
      DROP TABLE operational_requests;
    `);
  }
}

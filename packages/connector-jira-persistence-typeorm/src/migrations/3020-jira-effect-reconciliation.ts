import type { MigrationInterface, QueryRunner } from "typeorm";

export class M3020JiraEffectReconciliation1700000003020 implements MigrationInterface {
  readonly name = "M3020JiraEffectReconciliation1700000003020";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
  CREATE TABLE jira_effect_reconciliations(id uuid PRIMARY KEY,command_id uuid NOT NULL,effect_id text NOT NULL UNIQUE,connection_ref jsonb NOT NULL,profile_ref jsonb NOT NULL,operation text NOT NULL,target_hash text NOT NULL,payload_hash text NOT NULL,marker text NOT NULL,external_entity_id text NULL,state text NOT NULL CHECK(state IN ('NOT_STARTED','LOOKUP_REQUIRED','ISSUE_FOUND','EFFECT_IN_PROGRESS','CONFIRMED','AMBIGUOUS','FAILED_FINAL')),lookup_query_hash text NULL,match_count integer NULL,receipt_hash text NULL,external_revision_token text NULL,attempt integer NOT NULL DEFAULT 0,next_retry_at timestamptz NULL,lease_token bigint NOT NULL DEFAULT 0,lease_until timestamptz NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
  CREATE TABLE jira_effect_sub_effects(effect_id uuid NOT NULL REFERENCES jira_effect_reconciliations(id),sequence integer NOT NULL,kind text NOT NULL CHECK(kind IN ('ISSUE_CREATE','FIELD_EDIT','TRANSITION','ISSUE_LINK','REMOTE_LINK','COMMENT','PROPERTY')),semantic_identity text NOT NULL,semantic_hash text NOT NULL,required boolean NOT NULL,external_identity text NULL,receipt_hash text NULL,state text NOT NULL CHECK(state IN ('PENDING','OBSERVED','APPLIED','CONFIRMED','CONFLICT','AMBIGUOUS','FAILED')),attempt integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(effect_id,sequence),UNIQUE(effect_id,semantic_identity));
  CREATE TABLE jira_ambiguity_resolutions(id uuid PRIMARY KEY,effect_id uuid NOT NULL REFERENCES jira_effect_reconciliations(id),candidates jsonb NOT NULL,decision text NOT NULL CHECK(decision IN ('ATTACH_EXACT_ISSUE','PROVE_ABSENT_AND_RETRY','ABANDON')),actor_id uuid NOT NULL,authorization_basis_hash text NOT NULL,reason_hash text NOT NULL,evidence_hash text NOT NULL,expected_resource_version bigint NOT NULL,created_at timestamptz NOT NULL);
  CREATE INDEX jira_effect_retry ON jira_effect_reconciliations(state,next_retry_at);
  UPDATE platform_schema_versions SET version=3020,applied_at=clock_timestamp() WHERE namespace='connector:jira';
`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE jira_ambiguity_resolutions; DROP TABLE jira_effect_sub_effects; DROP TABLE jira_effect_reconciliations; UPDATE platform_schema_versions SET version=3010 WHERE namespace='connector:jira';",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class GitLabMockWebhookFaultAudit00621700000002062 implements MigrationInterface {
  readonly name = "GitLabMockWebhookFaultAudit00621700000002062";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE mock_gitlab_call_audit(
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NULL REFERENCES mock_gitlab_projects(project_id),
  operation text NOT NULL,
  method text NOT NULL,
  request_hash text NOT NULL,
  effect_marker_hash text NULL,
  external_pipeline_id text NULL,
  outcome text NOT NULL,
  called_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE mock_gitlab_webhook_deliveries(
  delivery_id text PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES mock_gitlab_projects(project_id),
  event_kind text NOT NULL CHECK(event_kind IN ('PIPELINE_HOOK','JOB_HOOK')),
  body_bytes bytea NOT NULL,
  body_hash text NOT NULL,
  signature text NOT NULL,
  key_version_ref text NOT NULL,
  delivery_timestamp timestamptz NOT NULL,
  delivery_attempt integer NOT NULL DEFAULT 0 CHECK(delivery_attempt>=0),
  state text NOT NULL CHECK(state IN ('PENDING','DELIVERED','DROPPED','DUPLICATE','CONFLICT')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE mock_gitlab_faults(
  project_id bigint NOT NULL REFERENCES mock_gitlab_projects(project_id),
  operation text NOT NULL,
  fault text NOT NULL CHECK(fault IN ('NORMAL','TIMEOUT_BEFORE_INVOCATION','TIMEOUT_AFTER_POSSIBLE_EFFECT','AUTHENTICATION_401','PERMISSION_403','RATE_LIMIT_429','SERVER_500','NETWORK_LOSS','LOOKUP_ZERO','LOOKUP_MULTIPLE','WEBHOOK_DROP','WEBHOOK_DUPLICATE','WEBHOOK_OUT_OF_ORDER')),
  remaining integer NOT NULL DEFAULT 0 CHECK(remaining>=0),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,operation)
);
CREATE INDEX mock_gitlab_call_audit_project ON mock_gitlab_call_audit(project_id,operation,sequence);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE mock_gitlab_faults; DROP TABLE mock_gitlab_webhook_deliveries; DROP TABLE mock_gitlab_call_audit;",
    );
  }
}

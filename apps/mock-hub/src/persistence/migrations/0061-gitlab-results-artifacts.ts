import type { MigrationInterface, QueryRunner } from "typeorm";

export class GitLabMockPipelineArtifacts00611700000002061 implements MigrationInterface {
  readonly name = "GitLabMockPipelineArtifacts00611700000002061";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE mock_gitlab_machine_results(
  project_id bigint NOT NULL,
  pipeline_id bigint NOT NULL,
  job_id bigint NOT NULL,
  schema_id text NOT NULL,
  schema_version integer NOT NULL CHECK(schema_version>0),
  schema_digest text NOT NULL,
  result_body jsonb NOT NULL,
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,pipeline_id,job_id),
  FOREIGN KEY(project_id,pipeline_id,job_id) REFERENCES mock_gitlab_jobs(project_id,pipeline_id,job_id)
);

CREATE TABLE mock_gitlab_artifacts(
  project_id bigint NOT NULL,
  pipeline_id bigint NOT NULL,
  job_id bigint NOT NULL,
  artifact_path text NOT NULL,
  file_name text NOT NULL,
  media_type text NOT NULL,
  content_bytes bytea NOT NULL,
  byte_size bigint NOT NULL CHECK(byte_size>=0),
  checksum text NOT NULL,
  classification text NOT NULL CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,job_id,artifact_path),
  FOREIGN KEY(project_id,pipeline_id,job_id) REFERENCES mock_gitlab_jobs(project_id,pipeline_id,job_id)
);
CREATE INDEX mock_gitlab_artifacts_pipeline ON mock_gitlab_artifacts(project_id,pipeline_id,job_id);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE mock_gitlab_artifacts; DROP TABLE mock_gitlab_machine_results;",
    );
  }
}

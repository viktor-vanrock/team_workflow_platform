import type { MigrationInterface, QueryRunner } from "typeorm";

export class GitLabMockProjectState00601700000002060 implements MigrationInterface {
  readonly name = "GitLabMockProjectState00601700000002060";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE mock_gitlab_projects(
  project_id bigint PRIMARY KEY CHECK(project_id>0),
  path_with_namespace text NOT NULL UNIQUE,
  default_branch text NOT NULL,
  exact_ref text NOT NULL,
  edition text NOT NULL CHECK(edition IN ('CE','EE')),
  exact_version text NOT NULL,
  exact_build text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  jobs_enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL,
  lint_jobs jsonb NOT NULL,
  allowed_control_scope boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE mock_gitlab_commits(
  project_id bigint NOT NULL REFERENCES mock_gitlab_projects(project_id),
  commit_sha text NOT NULL,
  parent_commit_shas jsonb NOT NULL,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,commit_sha)
);

CREATE TABLE mock_gitlab_merge_requests(
  project_id bigint NOT NULL REFERENCES mock_gitlab_projects(project_id),
  iid bigint NOT NULL CHECK(iid>0),
  state text NOT NULL CHECK(state IN ('opened','merged','closed')),
  source_ref text NOT NULL,
  target_ref text NOT NULL,
  source_commit_sha text NOT NULL,
  target_commit_sha text NOT NULL,
  head_commit_sha text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,iid),
  FOREIGN KEY(project_id,head_commit_sha) REFERENCES mock_gitlab_commits(project_id,commit_sha)
);

CREATE TABLE mock_gitlab_pipelines(
  project_id bigint NOT NULL REFERENCES mock_gitlab_projects(project_id),
  pipeline_id bigint NOT NULL CHECK(pipeline_id>0),
  source text NOT NULL,
  ref text NOT NULL,
  commit_sha text NOT NULL,
  status text NOT NULL CHECK(status IN ('created','waiting_for_resource','preparing','pending','running','success','failed','canceled','skipped','manual','scheduled')),
  pipeline_name text NULL,
  marker_hash text NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY(project_id,pipeline_id),
  FOREIGN KEY(project_id,commit_sha) REFERENCES mock_gitlab_commits(project_id,commit_sha)
);

CREATE TABLE mock_gitlab_jobs(
  project_id bigint NOT NULL,
  pipeline_id bigint NOT NULL,
  job_id bigint NOT NULL CHECK(job_id>0),
  name text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL CHECK(status IN ('created','pending','running','success','failed','canceled','skipped','manual')),
  environment_name text NULL,
  allow_failure boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY(project_id,job_id),
  UNIQUE(project_id,pipeline_id,job_id),
  FOREIGN KEY(project_id,pipeline_id) REFERENCES mock_gitlab_pipelines(project_id,pipeline_id)
);
CREATE INDEX mock_gitlab_pipeline_ref_time ON mock_gitlab_pipelines(project_id,ref,created_at DESC);
CREATE INDEX mock_gitlab_jobs_pipeline ON mock_gitlab_jobs(project_id,pipeline_id,job_id);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE mock_gitlab_jobs;
DROP TABLE mock_gitlab_pipelines;
DROP TABLE mock_gitlab_merge_requests;
DROP TABLE mock_gitlab_commits;
DROP TABLE mock_gitlab_projects;
`);
  }
}

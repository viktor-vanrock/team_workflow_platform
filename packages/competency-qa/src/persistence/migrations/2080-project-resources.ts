import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaProjectResources20801700000002080 implements MigrationInterface {
  readonly name = "QaProjectResources20801700000002080";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_project_context_headers_v2(
        context_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1), current_published_version integer NULL,
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(context_id), UNIQUE(workspace_id,project_id,context_id), UNIQUE(workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE qa_project_context_revisions_v2(
        revision_id uuid NOT NULL, context_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1), state text NOT NULL CHECK(state IN ('PUBLISHED','RETIRED')),
        environment_refs jsonb NOT NULL, test_data_catalog_refs jsonb NOT NULL, account_pool_refs jsonb NOT NULL,
        policy_refs jsonb NOT NULL, maximum_classification_key text NOT NULL REFERENCES classification_catalog(key),
        resource_version bigint NOT NULL CHECK(resource_version>=1), published_at timestamptz NOT NULL, retired_at timestamptz NULL,
        created_by jsonb NOT NULL, published_by jsonb NOT NULL, semantic_body jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(revision_id), UNIQUE(workspace_id,project_id,context_id,version),
        FOREIGN KEY(workspace_id,project_id,context_id) REFERENCES qa_project_context_headers_v2(workspace_id,project_id,context_id)
      );

      CREATE TABLE qa_project_environment_headers(
        environment_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, environment_key text NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1), current_published_version integer NULL,
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(environment_id), UNIQUE(workspace_id,project_id,environment_id), UNIQUE(workspace_id,project_id,environment_key),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE qa_project_environment_revisions(
        revision_id uuid NOT NULL, environment_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1), environment_name text NOT NULL,
        environment_scope text NOT NULL CHECK(environment_scope IN ('LOCAL','NON_PROD','PREPROD')),
        owner_principal_id uuid NOT NULL REFERENCES identities(id), data_classification_key text NOT NULL REFERENCES classification_catalog(key),
        state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','RETIRED')), configuration_ref jsonb NOT NULL,
        allowed_test_data_policy_refs jsonb NOT NULL, created_by jsonb NOT NULL, created_at timestamptz NOT NULL,
        published_at timestamptz NULL, retired_at timestamptz NULL, semantic_body jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(revision_id), UNIQUE(workspace_id,project_id,environment_id,version),
        FOREIGN KEY(workspace_id,project_id,environment_id) REFERENCES qa_project_environment_headers(workspace_id,project_id,environment_id),
        CHECK((state='DRAFT' AND published_at IS NULL AND retired_at IS NULL)
          OR (state='PUBLISHED' AND published_at IS NOT NULL AND retired_at IS NULL)
          OR (state='RETIRED' AND published_at IS NOT NULL AND retired_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX qa_project_environment_one_published_idx ON qa_project_environment_revisions(workspace_id,project_id,environment_id) WHERE state='PUBLISHED';

      CREATE TABLE qa_test_data_catalog_entries(
        entry_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        entry_kind text NOT NULL CHECK(entry_kind IN ('DATASET','PREPARATION_PROCEDURE')), external_ref jsonb NOT NULL,
        owner_principal_id uuid NOT NULL REFERENCES identities(id), allowed_environment_refs jsonb NOT NULL,
        data_classification_key text NOT NULL REFERENCES classification_catalog(key), retention_policy_ref jsonb NOT NULL,
        state text NOT NULL CHECK(state IN ('PUBLISHED','RETIRED')), semantic_body jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(entry_id,version), UNIQUE(workspace_id,project_id,entry_id,version), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE qa_account_pool_references(
        pool_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        environment_ref jsonb NOT NULL, resolver_ref jsonb NOT NULL, owner_principal_id uuid NOT NULL REFERENCES identities(id),
        maximum_concurrent_leases integer NOT NULL CHECK(maximum_concurrent_leases>=1),
        maximum_lease_duration_seconds integer NOT NULL CHECK(maximum_lease_duration_seconds BETWEEN 1 AND 604800),
        data_classification_key text NOT NULL REFERENCES classification_catalog(key), state text NOT NULL CHECK(state IN ('PUBLISHED','RETIRED')),
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(pool_id,version), UNIQUE(workspace_id,project_id,pool_id,version), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE qa_test_account_leases(
        lease_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        pool_id uuid NOT NULL, pool_version integer NOT NULL, environment_ref jsonb NOT NULL, subject jsonb NOT NULL,
        leased_to_principal_id uuid NOT NULL REFERENCES identities(id), opaque_account_ref text NOT NULL,
        state text NOT NULL CHECK(state IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
        acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, released_at timestamptz NULL, revoked_at timestamptz NULL,
        reason_code text NULL, created_by jsonb NOT NULL, resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(lease_id,version), UNIQUE(workspace_id,project_id,lease_id,version),
        FOREIGN KEY(workspace_id,project_id,pool_id,pool_version) REFERENCES qa_account_pool_references(workspace_id,project_id,pool_id,version),
        CHECK(expires_at>acquired_at)
      );
      CREATE TABLE qa_test_account_lease_heads(
        lease_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1), pool_id uuid NOT NULL, pool_version integer NOT NULL,
        opaque_account_ref text NOT NULL, state text NOT NULL CHECK(state IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
        expires_at timestamptz NOT NULL, row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(lease_id), UNIQUE(workspace_id,project_id,lease_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(workspace_id,project_id,pool_id,pool_version) REFERENCES qa_account_pool_references(workspace_id,project_id,pool_id,version)
      );
      CREATE UNIQUE INDEX qa_test_account_one_active_slot_idx ON qa_test_account_lease_heads(workspace_id,project_id,pool_id,opaque_account_ref) WHERE state='ACTIVE';
      CREATE INDEX qa_test_account_lease_expiry_idx ON qa_test_account_leases(workspace_id,project_id,state,expires_at);

      UPDATE platform_schema_versions SET version=2080,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
    for (const table of [
      "qa_project_context_revisions_v2",
      "qa_project_environment_revisions",
      "qa_test_data_catalog_entries",
      "qa_account_pool_references",
      "qa_test_account_leases",
    ])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE qa_test_account_lease_heads;
      DROP TABLE qa_test_account_leases;
      DROP TABLE qa_account_pool_references;
      DROP TABLE qa_test_data_catalog_entries;
      DROP TABLE qa_project_environment_revisions;
      DROP TABLE qa_project_environment_headers;
      DROP TABLE qa_project_context_revisions_v2;
      DROP TABLE qa_project_context_headers_v2;
      UPDATE platform_schema_versions SET version=2070,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

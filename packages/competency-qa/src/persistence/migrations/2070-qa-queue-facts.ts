import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

/**
 * QA-owned, provider-neutral planning facts. This migration intentionally
 * contains schema operations only; projection reads happen in the QA runtime.
 */
export class QaQueueFacts20701700000002070 implements MigrationInterface {
  readonly name = "QaQueueFacts20701700000002070";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_queue_fact_heads(
        qa_queue_fact_head_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        current_revision_id uuid NOT NULL,
        current_revision_number integer NOT NULL CHECK(current_revision_number>=1),
        current_semantic_hash text NOT NULL CHECK(current_semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        resource_version bigint NOT NULL CHECK(resource_version>=1),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY(qa_queue_fact_head_id),
        UNIQUE(qa_queue_fact_head_id,workspace_id,project_id,work_item_id),
        UNIQUE(workspace_id,project_id,work_item_id),
        UNIQUE(current_revision_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id)
          REFERENCES work_items(workspace_id,project_id,id),
        CHECK(updated_at>=created_at)
      );

      CREATE TABLE qa_queue_fact_revisions(
        qa_queue_fact_revision_id uuid NOT NULL,
        qa_queue_fact_head_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        revision_number integer NOT NULL CHECK(revision_number>=1),
        previous_revision_id uuid NULL,
        previous_revision_number integer NULL,
        previous_semantic_hash text NULL CHECK(previous_semantic_hash IS NULL OR previous_semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        facts jsonb NOT NULL,
        source_set_hash text NOT NULL CHECK(source_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        semantic_hash text NOT NULL CHECK(semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        recorded_at timestamptz NOT NULL,
        correlation_id text NOT NULL CHECK(length(btrim(correlation_id)) BETWEEN 1 AND 512),
        causation_id text NOT NULL CHECK(length(btrim(causation_id)) BETWEEN 1 AND 512),
        PRIMARY KEY(qa_queue_fact_revision_id),
        UNIQUE(qa_queue_fact_revision_id,workspace_id,project_id,work_item_id),
        UNIQUE(qa_queue_fact_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,revision_number,semantic_hash),
        UNIQUE(qa_queue_fact_head_id,revision_number),
        FOREIGN KEY(qa_queue_fact_head_id,workspace_id,project_id,work_item_id)
          REFERENCES qa_queue_fact_heads(qa_queue_fact_head_id,workspace_id,project_id,work_item_id),
        FOREIGN KEY(previous_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,previous_revision_number,previous_semantic_hash)
          REFERENCES qa_queue_fact_revisions(qa_queue_fact_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,revision_number,semantic_hash)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(jsonb_typeof(facts)='object'),
        CHECK(
          (revision_number=1 AND previous_revision_id IS NULL AND previous_revision_number IS NULL AND previous_semantic_hash IS NULL)
          OR
          (revision_number>1 AND previous_revision_id IS NOT NULL AND previous_revision_number=revision_number-1 AND previous_semantic_hash IS NOT NULL)
        )
      );

      ALTER TABLE qa_queue_fact_heads
        ADD CONSTRAINT qa_queue_fact_head_current_revision_fk
          FOREIGN KEY(current_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,current_revision_number,current_semantic_hash)
          REFERENCES qa_queue_fact_revisions(qa_queue_fact_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,revision_number,semantic_hash)
          DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_queue_fact_current_indexes(
        qa_queue_fact_head_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        current_revision_id uuid NOT NULL,
        fact_kind text NOT NULL CHECK(fact_kind IN('READINESS','SESSION','AUTOMATION','VERDICT','REQUIRED_SESSION_PLAN')),
        fact_id text NOT NULL CHECK(length(btrim(fact_id)) BETWEEN 1 AND 512),
        fact_revision text NOT NULL CHECK(length(btrim(fact_revision)) BETWEEN 1 AND 128),
        fact_semantic_hash text NOT NULL CHECK(fact_semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        ordinal integer NOT NULL CHECK(ordinal>=0),
        PRIMARY KEY(qa_queue_fact_head_id,fact_kind,fact_id,fact_revision,fact_semantic_hash),
        UNIQUE(qa_queue_fact_head_id,ordinal),
        FOREIGN KEY(qa_queue_fact_head_id,workspace_id,project_id,work_item_id)
          REFERENCES qa_queue_fact_heads(qa_queue_fact_head_id,workspace_id,project_id,work_item_id)
          ON DELETE CASCADE,
        FOREIGN KEY(current_revision_id,workspace_id,project_id,work_item_id)
          REFERENCES qa_queue_fact_revisions(qa_queue_fact_revision_id,workspace_id,project_id,work_item_id)
          DEFERRABLE INITIALLY DEFERRED
      );

      CREATE INDEX qa_queue_fact_heads_scope_idx
        ON qa_queue_fact_heads(workspace_id,project_id,updated_at,work_item_id);
      CREATE INDEX qa_queue_fact_revision_scope_idx
        ON qa_queue_fact_revisions(workspace_id,project_id,work_item_id,revision_number DESC);
      CREATE INDEX qa_queue_fact_current_source_idx
        ON qa_queue_fact_current_indexes(workspace_id,project_id,fact_kind,fact_id,fact_revision,fact_semantic_hash);

      UPDATE platform_schema_versions
        SET version=2070,applied_at=clock_timestamp()
        WHERE namespace='pack:qa';
    `);
    await queryRunner.query(qaAppendOnlyGuardSql("qa_queue_fact_revisions"));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE qa_queue_fact_heads DROP CONSTRAINT IF EXISTS qa_queue_fact_head_current_revision_fk;
      DROP TABLE qa_queue_fact_current_indexes;
      DROP TABLE qa_queue_fact_revisions;
      DROP TABLE qa_queue_fact_heads;
      UPDATE platform_schema_versions SET version=2060,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

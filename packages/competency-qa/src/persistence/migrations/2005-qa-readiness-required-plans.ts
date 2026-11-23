import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaReadinessRequiredPlans20051700000002005 implements MigrationInterface {
  readonly name = "QaReadinessRequiredPlans20051700000002005";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_readiness_assessments(
        assessment_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        input_revision_id uuid NOT NULL,
        input_revision_version integer NOT NULL,
        input_content_hash text NOT NULL,
        extension_resource_version bigint NOT NULL,
        assessment_version integer NOT NULL,
        state text NOT NULL CHECK(state IN ('NEEDS_INFO','READY','READY_WITH_WAIVER')),
        input_fingerprint text NOT NULL,
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        evaluated_at timestamptz NOT NULL,
        PRIMARY KEY(assessment_id),
        UNIQUE(assessment_id, workspace_id, project_id),
        UNIQUE(workspace_id, project_id, work_item_id, assessment_version),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        FOREIGN KEY(input_revision_id,workspace_id,project_id) REFERENCES qa_request_input_revisions(input_revision_id,workspace_id,project_id)
      );

      CREATE TABLE qa_waivers(
        waiver_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        waiver_kind text NOT NULL CHECK(waiver_kind IN ('DOR','PLAN_ITEM','SESSION','REQUIRED_SESSION','FINDING')),
        rule_code text NULL,
        state text NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','EXPIRED','INVALIDATED','CONSUMED')),
        subject_hash text NOT NULL,
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        row_version bigint NOT NULL CHECK(row_version >= 1),
        PRIMARY KEY(waiver_id),
        UNIQUE(waiver_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK(waiver_kind <> 'DOR' OR rule_code = 'PROJECT_REGISTRY_NEEDS_REVIEW')
      );

      CREATE TABLE qa_required_session_plans(
        plan_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        extension_id uuid NOT NULL,
        current_version_id text NULL,
        current_version integer NULL,
        current_content_hash text NULL,
        resource_version bigint NOT NULL CHECK(resource_version >= 1),
        frozen_at timestamptz NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY(plan_id),
        UNIQUE(plan_id,workspace_id,project_id),
        UNIQUE(workspace_id,project_id,work_item_id),
        FOREIGN KEY(extension_id,workspace_id,project_id) REFERENCES qa_request_extensions(extension_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK((current_version_id IS NULL AND current_version IS NULL AND current_content_hash IS NULL) OR (current_version_id IS NOT NULL AND current_version IS NOT NULL AND current_content_hash IS NOT NULL))
      );

      CREATE TABLE qa_required_session_plan_versions(
        plan_version_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        plan_id text NOT NULL,
        version integer NOT NULL CHECK(version >= 1),
        previous_version_id text NULL,
        previous_version integer NULL,
        previous_content_hash text NULL,
        readiness_assessment_id text NOT NULL,
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        published_at timestamptz NOT NULL,
        PRIMARY KEY(plan_version_id),
        UNIQUE(plan_version_id,workspace_id,project_id),
        UNIQUE(plan_id,version),
        FOREIGN KEY(plan_id,workspace_id,project_id) REFERENCES qa_required_session_plans(plan_id,workspace_id,project_id),
        FOREIGN KEY(readiness_assessment_id,workspace_id,project_id) REFERENCES qa_readiness_assessments(assessment_id,workspace_id,project_id),
        CHECK((version=1 AND previous_version_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL) OR (version>1 AND previous_version_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL))
      );

      CREATE TABLE qa_required_session_plan_requirements(
        requirement_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        plan_version_id text NOT NULL,
        requirement_key text NOT NULL,
        ordinal integer NOT NULL CHECK(ordinal >= 1),
        mode text NOT NULL CHECK(mode='MANUAL'),
        minimum_session_count integer NOT NULL CHECK(minimum_session_count > 0),
        resolution text NOT NULL CHECK(resolution IN ('REQUIRED','WAIVED')),
        waiver_id text NULL,
        carried_from_requirement_id text NULL,
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        PRIMARY KEY(requirement_id),
        UNIQUE(requirement_id,workspace_id,project_id),
        UNIQUE(plan_version_id,requirement_key),
        UNIQUE(plan_version_id,ordinal),
        FOREIGN KEY(plan_version_id,workspace_id,project_id) REFERENCES qa_required_session_plan_versions(plan_version_id,workspace_id,project_id),
        FOREIGN KEY(waiver_id,workspace_id,project_id) REFERENCES qa_waivers(waiver_id,workspace_id,project_id),
        CHECK((resolution='REQUIRED' AND waiver_id IS NULL) OR (resolution='WAIVED' AND waiver_id IS NOT NULL))
      );

      ALTER TABLE qa_required_session_plans ADD CONSTRAINT qa_required_plan_current_fk
        FOREIGN KEY(current_version_id,workspace_id,project_id) REFERENCES qa_required_session_plan_versions(plan_version_id,workspace_id,project_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_request_extensions
        ADD COLUMN latest_readiness_assessment_id text NULL,
        ADD COLUMN current_required_session_plan_version_id text NULL,
        ADD COLUMN current_required_session_plan_content_hash text NULL;
      ALTER TABLE qa_request_extensions ADD CONSTRAINT qa_extension_latest_readiness_fk
        FOREIGN KEY(latest_readiness_assessment_id,workspace_id,project_id) REFERENCES qa_readiness_assessments(assessment_id,workspace_id,project_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_request_extensions ADD CONSTRAINT qa_extension_current_plan_fk
        FOREIGN KEY(current_required_session_plan_version_id,workspace_id,project_id) REFERENCES qa_required_session_plan_versions(plan_version_id,workspace_id,project_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE INDEX qa_readiness_scope_idx ON qa_readiness_assessments(workspace_id,project_id,work_item_id,assessment_version);
      CREATE INDEX qa_required_plan_scope_idx ON qa_required_session_plans(workspace_id,project_id,work_item_id);
      CREATE INDEX qa_required_plan_requirement_idx ON qa_required_session_plan_requirements(workspace_id,project_id,work_item_id,plan_version_id,ordinal);
    `);
    await queryRunner.query(qaAppendOnlyGuardSql("qa_readiness_assessments"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_required_session_plan_versions"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_required_session_plan_requirements"));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE qa_request_extensions DROP COLUMN current_required_session_plan_content_hash, DROP COLUMN current_required_session_plan_version_id, DROP COLUMN latest_readiness_assessment_id;
      DROP TABLE qa_required_session_plan_requirements;
      DROP TABLE qa_required_session_plan_versions;
      DROP TABLE qa_required_session_plans;
      DROP TABLE qa_waivers;
      DROP TABLE qa_readiness_assessments;
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_required_session_plan_requirements();
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_required_session_plan_versions();
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_readiness_assessments();
    `);
  }
}

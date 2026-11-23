import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaContextPolicyRequests20001700000002000 implements MigrationInterface {
  readonly name = "QaContextPolicyRequests20001700000002000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_project_contexts(
        id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        current_published_version_id uuid NULL,
        current_published_version integer NULL,
        current_published_content_hash text NULL,
        resource_version bigint NOT NULL CHECK(resource_version >= 1),
        frozen_at timestamptz NULL,
        PRIMARY KEY(id),
        UNIQUE(id, workspace_id, project_id),
        UNIQUE(workspace_id, project_id, id),
        FOREIGN KEY(workspace_id, project_id) REFERENCES projects(workspace_id, id)
      );
      CREATE TABLE qa_project_context_versions(
        id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        header_id uuid NOT NULL,
        version integer NOT NULL CHECK(version >= 1),
        content_hash text NOT NULL,
        previous_version_id uuid NULL,
        previous_version integer NULL,
        previous_content_hash text NULL,
        content jsonb NOT NULL,
        published_by jsonb NOT NULL,
        published_at timestamptz NOT NULL,
        PRIMARY KEY(id),
        UNIQUE(header_id, version),
        UNIQUE(id, workspace_id, project_id),
        FOREIGN KEY(header_id, workspace_id, project_id) REFERENCES qa_project_contexts(id, workspace_id, project_id),
        CHECK((version=1 AND previous_version_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL)
          OR (version>1 AND previous_version_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL))
      );
      ALTER TABLE qa_project_contexts ADD CONSTRAINT qa_project_context_current_fk
        FOREIGN KEY(current_published_version_id, workspace_id, project_id)
        REFERENCES qa_project_context_versions(id, workspace_id, project_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_risk_review_policies(
        id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        current_published_version_id uuid NULL,
        current_published_version integer NULL,
        current_published_content_hash text NULL,
        resource_version bigint NOT NULL CHECK(resource_version >= 1),
        frozen_at timestamptz NULL,
        PRIMARY KEY(id),
        UNIQUE(id, workspace_id, project_id),
        UNIQUE(workspace_id, project_id, id),
        FOREIGN KEY(workspace_id, project_id) REFERENCES projects(workspace_id, id)
      );
      CREATE TABLE qa_risk_review_policy_versions(
        id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        header_id uuid NOT NULL,
        version integer NOT NULL CHECK(version >= 1),
        content_hash text NOT NULL,
        previous_version_id uuid NULL,
        previous_version integer NULL,
        previous_content_hash text NULL,
        content jsonb NOT NULL,
        published_by jsonb NOT NULL,
        published_at timestamptz NOT NULL,
        PRIMARY KEY(id),
        UNIQUE(header_id, version),
        UNIQUE(id, workspace_id, project_id),
        FOREIGN KEY(header_id, workspace_id, project_id) REFERENCES qa_risk_review_policies(id, workspace_id, project_id),
        CHECK((version=1 AND previous_version_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL)
          OR (version>1 AND previous_version_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL))
      );
      ALTER TABLE qa_risk_review_policies ADD CONSTRAINT qa_risk_policy_current_fk
        FOREIGN KEY(current_published_version_id, workspace_id, project_id)
        REFERENCES qa_risk_review_policy_versions(id, workspace_id, project_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_request_extensions(
        extension_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        current_input_revision_id uuid NOT NULL,
        current_input_version integer NOT NULL,
        current_input_content_hash text NOT NULL,
        project_context_id uuid NOT NULL,
        project_context_version integer NOT NULL,
        project_context_content_hash text NOT NULL,
        dor_rule_set_ref jsonb NOT NULL,
        dod_rule_set_ref jsonb NOT NULL,
        evidence_policy_ref jsonb NOT NULL,
        risk_review_policy_ref jsonb NOT NULL,
        adjudicative_aggregate_hash text NOT NULL,
        completion_dispatch_guard jsonb NOT NULL,
        resource_version bigint NOT NULL CHECK(resource_version >= 1),
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        created_by jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        correlation_id uuid NOT NULL,
        PRIMARY KEY(extension_id),
        UNIQUE(extension_id, workspace_id, project_id),
        UNIQUE(workspace_id, project_id, work_item_id),
        FOREIGN KEY(workspace_id, project_id, work_item_id) REFERENCES work_items(workspace_id, project_id, id),
        FOREIGN KEY(project_context_id, workspace_id, project_id) REFERENCES qa_project_contexts(id, workspace_id, project_id)
      );

      CREATE TABLE qa_request_input_revisions(
        input_revision_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        version integer NOT NULL CHECK(version >= 1),
        previous_revision_id uuid NULL,
        previous_revision_version integer NULL,
        previous_content_hash text NULL,
        definition_key text NOT NULL CHECK(definition_key='qa.validation'),
        definition_version text NOT NULL CHECK(definition_version='1.0.0'),
        accepted_draft_id text NOT NULL,
        accepted_draft_version text NOT NULL,
        accepted_draft_content_hash text NOT NULL,
        external_request_id text NOT NULL,
        external_request_version text NOT NULL,
        external_request_content_hash text NOT NULL,
        operational_binding_id uuid NOT NULL,
        operational_binding_version integer NOT NULL CHECK(operational_binding_version >= 1),
        original_requester_ref jsonb NOT NULL,
        title text NOT NULL CHECK(length(title) > 0),
        request_kind text NOT NULL,
        data_classification_key text NOT NULL,
        content_hash text NOT NULL,
        content jsonb NOT NULL,
        recorded_by jsonb NOT NULL,
        authorization_basis_hash text NOT NULL,
        recorded_at timestamptz NOT NULL,
        correlation_id uuid NOT NULL,
        causation_id uuid NULL,
        PRIMARY KEY(input_revision_id),
        UNIQUE(workspace_id, project_id, work_item_id, version),
        UNIQUE(input_revision_id, workspace_id, project_id),
        FOREIGN KEY(workspace_id, project_id, work_item_id) REFERENCES work_items(workspace_id, project_id, id),
        CHECK((version=1 AND previous_revision_id IS NULL AND previous_revision_version IS NULL AND previous_content_hash IS NULL)
          OR (version>1 AND previous_revision_id IS NOT NULL AND previous_revision_version=version-1 AND previous_content_hash IS NOT NULL))
      );
      ALTER TABLE qa_request_extensions ADD CONSTRAINT qa_request_extension_current_input_fk
        FOREIGN KEY(current_input_revision_id, workspace_id, project_id)
        REFERENCES qa_request_input_revisions(input_revision_id, workspace_id, project_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE INDEX qa_project_context_scope_idx ON qa_project_contexts(workspace_id, project_id, id);
      CREATE INDEX qa_risk_policy_scope_idx ON qa_risk_review_policies(workspace_id, project_id, id);
      CREATE INDEX qa_request_extension_scope_idx ON qa_request_extensions(workspace_id, project_id, work_item_id);
      CREATE INDEX qa_request_input_history_idx ON qa_request_input_revisions(workspace_id, project_id, work_item_id, version);
    `);
    await queryRunner.query(qaAppendOnlyGuardSql("qa_project_context_versions"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_risk_review_policy_versions"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_request_input_revisions"));
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION qa_request_input_frozen_tuple_guard() RETURNS trigger
      LANGUAGE plpgsql AS $qa$
      DECLARE initial qa_request_input_revisions%ROWTYPE;
      BEGIN
        IF NEW.version = 1 THEN RETURN NEW; END IF;
        SELECT * INTO initial FROM qa_request_input_revisions
          WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND work_item_id=NEW.work_item_id AND version=1;
        IF NOT FOUND THEN RAISE EXCEPTION 'QA_INITIAL_INPUT_NOT_FOUND'; END IF;
        IF ROW(
          NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.definition_key,NEW.definition_version,
          NEW.accepted_draft_id,NEW.accepted_draft_version,NEW.accepted_draft_content_hash,
          NEW.external_request_id,NEW.external_request_version,NEW.external_request_content_hash,
          NEW.operational_binding_id,NEW.operational_binding_version,NEW.original_requester_ref,
          NEW.title,NEW.request_kind,NEW.data_classification_key
        ) IS DISTINCT FROM ROW(
          initial.workspace_id,initial.project_id,initial.work_item_id,initial.definition_key,initial.definition_version,
          initial.accepted_draft_id,initial.accepted_draft_version,initial.accepted_draft_content_hash,
          initial.external_request_id,initial.external_request_version,initial.external_request_content_hash,
          initial.operational_binding_id,initial.operational_binding_version,initial.original_requester_ref,
          initial.title,initial.request_kind,initial.data_classification_key
        ) THEN RAISE EXCEPTION 'QA_REQUEST_INPUT_FROZEN_TUPLE_DRIFT'; END IF;
        RETURN NEW;
      END;
      $qa$;
      CREATE TRIGGER qa_request_input_frozen_tuple
        BEFORE INSERT ON qa_request_input_revisions
        FOR EACH ROW EXECUTE FUNCTION qa_request_input_frozen_tuple_guard();
      INSERT INTO platform_schema_versions(namespace,version,applied_at)
      VALUES('pack:qa',2000,clock_timestamp())
      ON CONFLICT(namespace) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM platform_schema_versions WHERE namespace='pack:qa';
      DROP TABLE qa_request_extensions;
      DROP TABLE qa_request_input_revisions;
      DROP TABLE qa_risk_review_policy_versions;
      DROP TABLE qa_risk_review_policies;
      DROP TABLE qa_project_context_versions;
      DROP TABLE qa_project_contexts;
      DROP FUNCTION IF EXISTS qa_request_input_frozen_tuple_guard();
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_request_input_revisions();
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_risk_review_policy_versions();
      DROP FUNCTION IF EXISTS qa_append_only_guard_qa_project_context_versions();
    `);
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0155ProjectBindingEntitlements1700000000155 implements MigrationInterface {
  readonly name = "M0155ProjectBindingEntitlements1700000000155";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE project_entitlements ADD COLUMN current_version integer NOT NULL DEFAULT 1 CHECK(current_version>=1);
      CREATE TABLE project_entitlement_headers(
        entitlement_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, principal_id uuid NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1), current_effect text NOT NULL CHECK(current_effect IN ('ALLOW','DENY')),
        current_permissions jsonb NOT NULL, classification_ceiling_key text NOT NULL REFERENCES classification_catalog(key),
        valid_from timestamptz NOT NULL, valid_until timestamptz NULL, revoked_at timestamptz NULL,
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(entitlement_id), UNIQUE(workspace_id,project_id,entitlement_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE project_entitlement_revisions(
        revision_id uuid NOT NULL, entitlement_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1),
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, principal_id uuid NOT NULL,
        operation text NOT NULL CHECK(operation IN ('GRANT','REPLACE','REVOKE')), effect text NOT NULL CHECK(effect IN ('ALLOW','DENY')),
        permissions jsonb NOT NULL CHECK(jsonb_typeof(permissions)='array'), classification_ceiling_key text NOT NULL REFERENCES classification_catalog(key),
        valid_from timestamptz NOT NULL, valid_until timestamptz NULL, revoked_at timestamptz NULL,
        previous_revision_id uuid NULL, previous_version integer NULL, previous_content_hash text NULL,
        actor jsonb NOT NULL, reason text NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(revision_id), UNIQUE(workspace_id,project_id,entitlement_id,version),
        UNIQUE(revision_id,workspace_id,project_id,entitlement_id,version,content_hash),
        FOREIGN KEY(workspace_id,project_id,entitlement_id) REFERENCES project_entitlement_headers(workspace_id,project_id,entitlement_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,entitlement_id,previous_version,previous_content_hash)
          REFERENCES project_entitlement_revisions(revision_id,workspace_id,project_id,entitlement_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK((version=1 AND previous_revision_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL)
          OR (version>1 AND previous_revision_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL)),
        CHECK((operation<>'REVOKE') OR revoked_at IS NOT NULL)
      );
      CREATE TRIGGER project_entitlement_revisions_append_only BEFORE UPDATE OR DELETE ON project_entitlement_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE binding_functional_acceptances(
        acceptance_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        binding_ref jsonb NOT NULL, validation_report_ref jsonb NOT NULL, qa_project_context_ref jsonb NOT NULL,
        accepted_resource_refs jsonb NOT NULL, checklist_ref jsonb NOT NULL,
        outcome text NOT NULL CHECK(outcome IN ('ACCEPTED','REJECTED')), safe_issue_codes jsonb NOT NULL,
        accepted_by jsonb NOT NULL, accepted_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(acceptance_id), UNIQUE(workspace_id,project_id,acceptance_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TRIGGER binding_functional_acceptances_append_only BEFORE UPDATE OR DELETE ON binding_functional_acceptances FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE capability_probe_results(
        probe_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        binding_ref jsonb NOT NULL, profile_ref jsonb NOT NULL, connection_ref jsonb NOT NULL, mapping_ref jsonb NULL,
        validation_report_ref jsonb NOT NULL, logical_role text NOT NULL, capability_key text NOT NULL, exact_contract_version text NOT NULL,
        operation text NOT NULL, environment_scope text NOT NULL CHECK(environment_scope IN ('LOCAL','NON_PROD','PREPROD')),
        status text NOT NULL CHECK(status IN ('AVAILABLE','DEGRADED','UNAVAILABLE')), safe_issue_codes jsonb NOT NULL,
        observed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL, actor_kind text NOT NULL CHECK(actor_kind='SERVICE'),
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(probe_id), UNIQUE(workspace_id,project_id,probe_id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK(valid_until>observed_at)
      );
      CREATE INDEX capability_probe_current_idx ON capability_probe_results(workspace_id,project_id,capability_key,logical_role,valid_until DESC);
      CREATE TRIGGER capability_probe_results_append_only BEFORE UPDATE OR DELETE ON capability_probe_results FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE capability_mode_assessments(
        assessment_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        binding_ref jsonb NOT NULL, qa_project_context_ref jsonb NOT NULL, requirement_set_ref jsonb NOT NULL, probe_refs jsonb NOT NULL,
        manual_requirements text NOT NULL CHECK(manual_requirements IN ('SATISFIED','UNSATISFIED')),
        automation_requirements text NOT NULL CHECK(automation_requirements IN ('SATISFIED','UNSATISFIED')),
        pilot_messaging_requirement text NOT NULL CHECK(pilot_messaging_requirement IN ('SATISFIED','DEGRADED','UNSATISFIED')),
        derived_mode text NOT NULL CHECK(derived_mode IN ('MANUAL_ONLY','FULL_QA')), reason_codes jsonb NOT NULL,
        evaluated_at timestamptz NOT NULL, semantic_body jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(assessment_id), UNIQUE(workspace_id,project_id,assessment_id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TRIGGER capability_mode_assessments_append_only BEFORE UPDATE OR DELETE ON capability_mode_assessments FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE project_operational_action_candidates(
        action_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        action_kind text NOT NULL CHECK(action_kind IN ('BINDING_PUBLISH','BINDING_RETIRE','PROJECT_RESUME','ONBOARDING_PILOT_ACTIVATE')),
        target_ref jsonb NOT NULL, expected_onboarding_version bigint NOT NULL CHECK(expected_onboarding_version>=1), prerequisite_refs jsonb NOT NULL,
        initiator jsonb NOT NULL, reason text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(action_id), UNIQUE(workspace_id,project_id,action_id),
        FOREIGN KEY(workspace_id,project_id,action_id) REFERENCES platform_actions(workspace_id,project_id,id)
      );
      CREATE TRIGGER project_operational_action_candidates_append_only BEFORE UPDATE OR DELETE ON project_operational_action_candidates FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      ALTER TABLE project_integration_binding_revisions
        ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
        ADD COLUMN validation_report_id uuid NULL,
        ADD COLUMN configuration_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN resource_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN validated_at timestamptz NULL,
        ADD COLUMN published_at timestamptz NULL,
        ADD COLUMN retired_at timestamptz NULL;
      CREATE UNIQUE INDEX project_binding_one_published_idx ON project_integration_binding_revisions(workspace_id,project_id,header_id) WHERE status='PUBLISHED';

      INSERT INTO project_entitlement_headers(entitlement_id,workspace_id,project_id,principal_id,current_version,current_effect,current_permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,row_version)
        SELECT id,workspace_id,project_id,principal_id,1,effect,permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,row_version FROM project_entitlements;
      INSERT INTO project_entitlement_revisions(revision_id,entitlement_id,version,workspace_id,project_id,principal_id,operation,effect,permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,actor,reason,correlation_id,created_at,semantic_body,content_hash)
        SELECT id,id,1,workspace_id,project_id,principal_id,CASE WHEN revoked_at IS NULL THEN 'GRANT' ELSE 'REVOKE' END,effect,permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,
          jsonb_build_object('kind','SERVICE','serviceKey','feature-007-migration'),'Feature 007 entitlement bootstrap','feature-007-bootstrap',created_at,
          jsonb_build_object('entitlementId',id,'version',1,'effect',effect,'permissions',permissions),
          'sha256:'||md5(id::text||':entitlement')||md5(workspace_id::text||':'||project_id::text||':'||id::text)
        FROM project_entitlements;

      UPDATE platform_schema_versions SET version=155,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX project_binding_one_published_idx;
      ALTER TABLE project_integration_binding_revisions DROP COLUMN retired_at,DROP COLUMN published_at,DROP COLUMN validated_at,
        DROP COLUMN resource_refs,DROP COLUMN configuration_refs,DROP COLUMN validation_report_id,DROP COLUMN schema_version;
      DROP TABLE project_operational_action_candidates;
      DROP TABLE capability_mode_assessments;
      DROP TABLE capability_probe_results;
      DROP TABLE binding_functional_acceptances;
      DROP TABLE project_entitlement_revisions;
      DROP TABLE project_entitlement_headers;
      ALTER TABLE project_entitlements DROP COLUMN current_version;
      UPDATE platform_schema_versions SET version=150,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}

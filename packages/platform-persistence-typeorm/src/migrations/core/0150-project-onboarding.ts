import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0150ProjectOnboarding1700000000150 implements MigrationInterface {
  readonly name = "M0150ProjectOnboarding1700000000150";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE projects
        ADD COLUMN registration_status text NOT NULL DEFAULT 'ACTIVE' CHECK(registration_status IN ('ACTIVE','ARCHIVED')),
        ADD COLUMN current_registry_version integer NOT NULL DEFAULT 1 CHECK(current_registry_version>=1);

      CREATE TABLE project_registry_revisions(
        revision_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1), project_key text NOT NULL, project_name text NOT NULL,
        owner_ids jsonb NOT NULL CHECK(jsonb_typeof(owner_ids)='array'), criticality_key text NOT NULL,
        data_classification_key text NOT NULL REFERENCES classification_catalog(key),
        verification_status text NOT NULL CHECK(verification_status IN ('CURRENT','DUE','NEEDS_REVIEW')),
        last_verified_at timestamptz NULL, next_verification_at timestamptz NULL,
        reason text NOT NULL, created_by uuid NULL REFERENCES identities(id), created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(revision_id), UNIQUE(workspace_id,project_id,revision_id), UNIQUE(workspace_id,project_id,version),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX project_registry_revision_scope_idx ON project_registry_revisions(workspace_id,project_id,version DESC);
      CREATE TRIGGER project_registry_revisions_append_only BEFORE UPDATE OR DELETE ON project_registry_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE project_onboarding_headers(
        onboarding_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1),
        current_stage text NOT NULL CHECK(current_stage IN ('DRAFT','VALIDATING','NEEDS_FIX','SHADOW','PILOT_ACTIVE')),
        current_capability_mode text NOT NULL CHECK(current_capability_mode IN ('MANUAL_ONLY','FULL_QA')),
        current_operational_state text NOT NULL CHECK(current_operational_state IN ('ACTIVE','SUSPENDED')),
        intended_capability_mode text NOT NULL CHECK(intended_capability_mode IN ('MANUAL_ONLY','FULL_QA')),
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1), created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(onboarding_id), UNIQUE(workspace_id,project_id,onboarding_id), UNIQUE(workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE project_onboarding_revisions(
        revision_id uuid NOT NULL, onboarding_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1), onboarding_stage text NOT NULL CHECK(onboarding_stage IN ('DRAFT','VALIDATING','NEEDS_FIX','SHADOW','PILOT_ACTIVE')),
        qa_capability_mode text NOT NULL CHECK(qa_capability_mode IN ('MANUAL_ONLY','FULL_QA')),
        project_operational_state text NOT NULL CHECK(project_operational_state IN ('ACTIVE','SUSPENDED')),
        intended_capability_mode text NOT NULL CHECK(intended_capability_mode IN ('MANUAL_ONLY','FULL_QA')),
        project_registry_ref jsonb NOT NULL, binding_ref jsonb NULL, qa_project_context_ref jsonb NULL,
        starter_entitlement_set_hash text NOT NULL CHECK(starter_entitlement_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        gate_result_refs jsonb NOT NULL CHECK(jsonb_typeof(gate_result_refs)='array'),
        owner_set_hash text NOT NULL CHECK(owner_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        reason_code text NOT NULL, reason text NOT NULL, incident_ref text NULL, actor jsonb NOT NULL,
        correlation_id text NOT NULL, causation_id text NULL, created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(revision_id), UNIQUE(workspace_id,project_id,onboarding_id,version),
        FOREIGN KEY(workspace_id,project_id,onboarding_id) REFERENCES project_onboarding_headers(workspace_id,project_id,onboarding_id),
        CHECK((onboarding_stage NOT IN ('SHADOW','PILOT_ACTIVE')) OR (binding_ref IS NOT NULL AND qa_project_context_ref IS NOT NULL)),
        CHECK((project_operational_state='ACTIVE') OR incident_ref IS NOT NULL)
      );
      CREATE TRIGGER project_onboarding_revisions_append_only BEFORE UPDATE OR DELETE ON project_onboarding_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE project_onboarding_gate_results(
        gate_result_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        gate_kind text NOT NULL CHECK(gate_kind IN ('L0','C1','N2','P3')), check_key text NOT NULL, check_version text NOT NULL,
        subject_refs jsonb NOT NULL, outcome text NOT NULL CHECK(outcome IN ('PASS','FAIL','BLOCKED_INPUT')),
        safe_issue_codes jsonb NOT NULL, evidence_refs jsonb NOT NULL, evaluated_by jsonb NOT NULL,
        evaluated_at timestamptz NOT NULL, valid_until timestamptz NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(gate_result_id), UNIQUE(workspace_id,project_id,gate_result_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK(valid_until IS NULL OR valid_until>evaluated_at)
      );
      CREATE TRIGGER project_onboarding_gate_results_append_only BEFORE UPDATE OR DELETE ON project_onboarding_gate_results FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE workspace_project_rollout_leases(
        workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), holder_project_id uuid NOT NULL,
        lease_version bigint NOT NULL CHECK(lease_version>=1), acquired_by uuid NOT NULL REFERENCES identities(id),
        acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
        purpose text NOT NULL CHECK(purpose='FIRST_PILOT_ACTIVATION'), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        FOREIGN KEY(workspace_id,holder_project_id) REFERENCES projects(workspace_id,id), CHECK(expires_at>acquired_at)
      );

      INSERT INTO project_registry_revisions(
        revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,
        data_classification_key,verification_status,reason,created_at,semantic_body,content_hash
      ) SELECT id,workspace_id,id,1,key,name,'[]'::jsonb,'UNCLASSIFIED',classification_key,'NEEDS_REVIEW',
        'Feature 007 conservative historical bootstrap',created_at,
        jsonb_build_object('workspaceId',workspace_id,'projectId',id,'version',1,'key',key,'name',name,'ownerIds','[]'::jsonb,'verificationStatus','NEEDS_REVIEW'),
        'sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text)
      FROM projects;
      INSERT INTO project_onboarding_headers(
        onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,row_version,created_at,updated_at
      ) SELECT id,workspace_id,id,1,'DRAFT','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',1,created_at,created_at FROM projects;
      INSERT INTO project_onboarding_revisions(
        revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,
        project_registry_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,actor,correlation_id,created_at,semantic_body,content_hash
      ) SELECT id,id,workspace_id,id,1,'DRAFT','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',
        jsonb_build_object('id',id,'version',1,'contentHash','sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text)),
        'sha256:'||repeat('0',64),'[]'::jsonb,'sha256:'||repeat('0',64),'HISTORICAL_BOOTSTRAP','Conservative bootstrap without invented readiness',
        jsonb_build_object('kind','SERVICE','serviceKey','feature-007-migration'),'feature-007-bootstrap',created_at,
        jsonb_build_object('stage','DRAFT','qaCapabilityMode','MANUAL_ONLY','operationalState','ACTIVE','gateResultRefs','[]'::jsonb),
        'sha256:'||md5(id::text||':onboarding')||md5(workspace_id::text||':onboarding:'||id::text)
      FROM projects;

      UPDATE platform_schema_versions SET version=150,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE workspace_project_rollout_leases;
      DROP TABLE project_onboarding_gate_results;
      DROP TABLE project_onboarding_revisions;
      DROP TABLE project_onboarding_headers;
      DROP TABLE project_registry_revisions;
      ALTER TABLE projects DROP COLUMN current_registry_version, DROP COLUMN registration_status;
      UPDATE platform_schema_versions SET version=140,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}

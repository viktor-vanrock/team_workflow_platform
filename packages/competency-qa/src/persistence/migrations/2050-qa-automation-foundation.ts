import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaAutomationFoundation20501700000002050 implements MigrationInterface {
  readonly name = "QaAutomationFoundation20501700000002050";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $qa$ DECLARE constraint_name text; BEGIN
        FOR constraint_name IN
          SELECT conname FROM pg_constraint
          WHERE contype='c'
            AND conrelid IN (
              'qa_required_session_plan_requirements'::regclass,
              'qa_test_sessions'::regclass,
              'qa_plan_items'::regclass
            )
            AND pg_get_constraintdef(oid) ~* 'mode'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
            (SELECT conrelid::regclass FROM pg_constraint WHERE conname=constraint_name LIMIT 1),
            constraint_name);
        END LOOP;
      END $qa$;

      ALTER TABLE qa_required_session_plan_requirements
        ADD COLUMN contract_schema_version integer NOT NULL DEFAULT 1,
        ADD COLUMN automation_suite_binding_key text NULL,
        ADD COLUMN automation_suite_selection_policy jsonb NULL,
        ADD CONSTRAINT qa_requirement_mode_v2 CHECK(mode IN('MANUAL','AUTOMATED')),
        ADD CONSTRAINT qa_requirement_automation_shape CHECK(
          (mode='MANUAL' AND contract_schema_version=1 AND automation_suite_binding_key IS NULL AND automation_suite_selection_policy IS NULL)
          OR
          (mode='AUTOMATED' AND contract_schema_version=2 AND automation_suite_binding_key IS NOT NULL AND automation_suite_selection_policy IS NOT NULL
            AND automation_suite_binding_key ~ '^[a-z][a-z0-9._-]{0,127}$'
            AND jsonb_typeof(automation_suite_selection_policy)='object')
        );

      ALTER TABLE qa_test_sessions
        ADD COLUMN contract_schema_version integer NOT NULL DEFAULT 1,
        ADD COLUMN automation_suite_binding_id text NULL,
        ADD COLUMN automation_suite_binding_version integer NULL,
        ADD COLUMN automation_suite_binding_content_hash text NULL,
        ADD COLUMN automation_configuration_pin_set_hash text NULL,
        ADD COLUMN automation_parameter_set_hash text NULL,
        ADD COLUMN automation_replacement_reason text NULL,
        ADD CONSTRAINT qa_session_mode_v2 CHECK(mode IN('MANUAL','AUTOMATED')),
        ADD CONSTRAINT qa_session_automation_shape CHECK(
          (mode='MANUAL' AND contract_schema_version=1
            AND automation_suite_binding_id IS NULL
            AND automation_suite_binding_version IS NULL
            AND automation_suite_binding_content_hash IS NULL
            AND automation_configuration_pin_set_hash IS NULL
            AND automation_parameter_set_hash IS NULL
            AND automation_replacement_reason IS NULL)
          OR
          (mode='AUTOMATED' AND contract_schema_version=2
            AND automation_suite_binding_id IS NOT NULL
            AND automation_suite_binding_version >= 1
            AND automation_suite_binding_content_hash ~ '^sha256:[a-f0-9]{64}$'
            AND automation_configuration_pin_set_hash ~ '^sha256:[a-f0-9]{64}$'
            AND automation_parameter_set_hash ~ '^sha256:[a-f0-9]{64}$'
            AND (automation_replacement_reason IS NULL OR automation_replacement_reason IN('TARGET_CHANGED','REVIEW_FROZEN')))
        ),
        ADD CONSTRAINT qa_session_automation_replacement_shape CHECK(
          automation_replacement_reason IS NULL OR parent_session_id IS NOT NULL
        );

      ALTER TABLE qa_plan_items
        ADD COLUMN contract_schema_version integer NOT NULL DEFAULT 1,
        ADD CONSTRAINT qa_plan_item_mode_v2 CHECK(mode IN('MANUAL','AUTOMATED')),
        ADD CONSTRAINT qa_plan_item_contract_shape CHECK(
          (mode='MANUAL' AND contract_schema_version=1)
          OR (mode='AUTOMATED' AND contract_schema_version=2 AND ordinal=1)
        );

      CREATE TABLE qa_automation_suite_bindings(
        suite_binding_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        suite_key text NOT NULL CHECK(suite_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
        current_published_version integer NULL CHECK(current_published_version IS NULL OR current_published_version>=1),
        current_published_version_id text NULL,
        resource_version bigint NOT NULL CHECK(resource_version>=1),
        created_by jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY(suite_binding_id),
        UNIQUE(suite_binding_id,workspace_id,project_id),
        UNIQUE(workspace_id,project_id,suite_key),
        CHECK((current_published_version IS NULL)=(current_published_version_id IS NULL)),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );

      CREATE TABLE qa_automation_suite_binding_versions(
        suite_binding_version_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        suite_binding_id text NOT NULL,
        version integer NOT NULL CHECK(version>=1),
        state text NOT NULL CHECK(state IN('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
        owner_principal_id uuid NOT NULL REFERENCES identities(id),
        suite_definition_ref jsonb NOT NULL,
        suite_definition_hash text NOT NULL CHECK(suite_definition_hash ~ '^sha256:[a-f0-9]{64}$'),
        logical_pipeline_key text NOT NULL,
        source_ref_policy_ref jsonb NOT NULL,
        result_job_key text NOT NULL,
        logical_execution_contract_hash text NOT NULL CHECK(logical_execution_contract_hash ~ '^sha256:[a-f0-9]{64}$'),
        accepted_target_types jsonb NOT NULL,
        environment_policy_ref jsonb NOT NULL,
        allowed_parameter_schema_ref jsonb NOT NULL,
        allowed_parameter_schema_digest text NOT NULL CHECK(allowed_parameter_schema_digest ~ '^sha256:[a-f0-9]{64}$'),
        result_schema_ref jsonb NOT NULL,
        result_schema_digest text NOT NULL CHECK(result_schema_digest ~ '^sha256:[a-f0-9]{64}$'),
        result_source_contract jsonb NOT NULL,
        artifact_policy_ref jsonb NOT NULL,
        artifact_policy_content_hash text NOT NULL CHECK(artifact_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        retry_policy_ref jsonb NOT NULL,
        retry_policy_content_hash text NOT NULL CHECK(retry_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        quarantine_policy_ref jsonb NOT NULL,
        quarantine_policy_content_hash text NOT NULL CHECK(quarantine_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        required_capability_set_hash text NOT NULL CHECK(required_capability_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        validation_report_id text NULL,
        validation_report_content_hash text NULL,
        content jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        created_by jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        published_at timestamptz NULL,
        retired_at timestamptz NULL,
        PRIMARY KEY(suite_binding_version_id),
        UNIQUE(suite_binding_version_id,workspace_id,project_id),
        UNIQUE(suite_binding_version_id,workspace_id,project_id,suite_binding_id,version),
        UNIQUE(suite_binding_version_id,workspace_id,project_id,suite_binding_id,version,content_hash),
        UNIQUE(suite_binding_id,version),
        UNIQUE(suite_binding_id,workspace_id,project_id,version,content_hash),
        UNIQUE(suite_binding_id,version,content_hash),
        UNIQUE(suite_binding_id,content_hash),
        FOREIGN KEY(suite_binding_id,workspace_id,project_id)
          REFERENCES qa_automation_suite_bindings(suite_binding_id,workspace_id,project_id),
        CHECK(jsonb_typeof(accepted_target_types)='array' AND jsonb_array_length(accepted_target_types) BETWEEN 1 AND 3),
        CHECK((validation_report_id IS NULL)=(validation_report_content_hash IS NULL)),
        CHECK(
          (state='DRAFT' AND validation_report_id IS NULL AND published_at IS NULL AND retired_at IS NULL)
          OR (state='VALIDATED' AND validation_report_id IS NOT NULL AND published_at IS NULL AND retired_at IS NULL)
          OR (state='PUBLISHED' AND validation_report_id IS NOT NULL AND published_at IS NOT NULL AND retired_at IS NULL)
          OR (state='RETIRED' AND validation_report_id IS NOT NULL AND published_at IS NOT NULL AND retired_at IS NOT NULL)
        )
      );

      CREATE TABLE qa_automation_suite_validation_reports(
        report_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        suite_binding_id text NOT NULL,
        suite_binding_version_id text NOT NULL,
        suite_binding_version integer NOT NULL CHECK(suite_binding_version>=1),
        suite_content_hash text NOT NULL CHECK(suite_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        status text NOT NULL CHECK(status IN('VALID','INVALID')),
        core_binding_ref jsonb NOT NULL,
        profile_pin_set_hash text NOT NULL CHECK(profile_pin_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        gitlab_discovery_snapshot_ref jsonb NOT NULL,
        gitlab_discovery_snapshot_hash text NOT NULL CHECK(gitlab_discovery_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        suite_probe_ref jsonb NOT NULL,
        suite_probe_hash text NOT NULL CHECK(suite_probe_hash ~ '^sha256:[a-f0-9]{64}$'),
        checks jsonb NOT NULL,
        issues jsonb NOT NULL,
        validated_by jsonb NOT NULL,
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(report_id),
        UNIQUE(report_id,workspace_id,project_id),
        UNIQUE(report_id,workspace_id,project_id,suite_binding_version_id,content_hash),
        FOREIGN KEY(suite_binding_version_id,workspace_id,project_id,suite_binding_id,suite_binding_version,suite_content_hash)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_version_id,workspace_id,project_id,suite_binding_id,version,content_hash),
        CHECK(jsonb_typeof(checks)='array' AND jsonb_array_length(checks)=10),
        CHECK(jsonb_typeof(issues)='array')
      );

      ALTER TABLE qa_automation_suite_binding_versions
        ADD CONSTRAINT qa_suite_version_validation_report_fk
          FOREIGN KEY(validation_report_id,workspace_id,project_id,suite_binding_version_id,validation_report_content_hash)
          REFERENCES qa_automation_suite_validation_reports(report_id,workspace_id,project_id,suite_binding_version_id,content_hash)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_automation_suite_bindings
        ADD CONSTRAINT qa_suite_current_published_fk
          FOREIGN KEY(current_published_version_id,workspace_id,project_id,suite_binding_id,current_published_version)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_version_id,workspace_id,project_id,suite_binding_id,version)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_test_sessions
        ADD CONSTRAINT qa_session_automation_suite_fk
          FOREIGN KEY(automation_suite_binding_id,workspace_id,project_id,automation_suite_binding_version,automation_suite_binding_content_hash)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_id,workspace_id,project_id,version,content_hash)
          DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_automation_session_configuration_pins(
        pin_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
        logical_role text NOT NULL CHECK(logical_role IN('SOURCE_CONTEXT','TEST_EXECUTION','ARTIFACT_SOURCE')),
        capability_key text NOT NULL CHECK(capability_key IN('source-context.read','test-executor.trigger-status','artifact.ci-read')),
        exact_contract_version text NOT NULL CHECK(exact_contract_version='1.0.0'),
        operation_set_hash text NOT NULL CHECK(operation_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        project_integration_binding_id uuid NOT NULL,
        project_integration_binding_version integer NOT NULL CHECK(project_integration_binding_version>=1),
        project_integration_binding_content_hash text NOT NULL CHECK(project_integration_binding_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        profile_id uuid NOT NULL,
        profile_version integer NOT NULL CHECK(profile_version>=1),
        profile_content_hash text NOT NULL CHECK(profile_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        connection_id uuid NOT NULL,
        connection_version integer NOT NULL CHECK(connection_version>=1),
        connection_content_hash text NOT NULL CHECK(connection_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        mapping_ref jsonb NULL,
        external_scope_hash text NOT NULL CHECK(external_scope_hash ~ '^sha256:[a-f0-9]{64}$'),
        validation_report_id text NOT NULL,
        validation_report_content_hash text NOT NULL CHECK(validation_report_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        pin_content_hash text NOT NULL CHECK(pin_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL,
        PRIMARY KEY(pin_id),
        UNIQUE(pin_id,workspace_id,project_id),
        UNIQUE(session_id,logical_role),
        UNIQUE(session_id,ordinal),
        FOREIGN KEY(session_id,workspace_id,project_id)
          REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id)
          REFERENCES work_items(workspace_id,project_id,id),
        CHECK(
          (logical_role='SOURCE_CONTEXT' AND capability_key='source-context.read' AND ordinal=1)
          OR (logical_role='TEST_EXECUTION' AND capability_key='test-executor.trigger-status' AND ordinal=2)
          OR (logical_role='ARTIFACT_SOURCE' AND capability_key='artifact.ci-read' AND ordinal=3)
        )
      );

      CREATE TABLE qa_attempt_identities(
        attempt_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        plan_item_id text NOT NULL,
        mode text NOT NULL CHECK(mode IN('MANUAL','AUTOMATED')),
        attempt_no integer NOT NULL CHECK(attempt_no>=1),
        target_snapshot_hash text NOT NULL CHECK(target_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        scope_snapshot_hash text NOT NULL CHECK(scope_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        trigger_kind text NOT NULL CHECK(trigger_kind IN('HUMAN_MANUAL','HUMAN_LAUNCH','HUMAN_RERUN','AUTO_INFRA_RETRY')),
        initiator_kind text NOT NULL CHECK(initiator_kind IN('HUMAN','SERVICE')),
        initiator_principal_id text NOT NULL,
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        identity_content_hash text NOT NULL CHECK(identity_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(attempt_id),
        UNIQUE(attempt_id,workspace_id,project_id),
        UNIQUE(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        UNIQUE(attempt_id,workspace_id,project_id,plan_item_id,identity_content_hash),
        UNIQUE(workspace_id,project_id,plan_item_id,attempt_no),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(plan_item_id,workspace_id,project_id) REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK(
          (mode='MANUAL' AND trigger_kind='HUMAN_MANUAL' AND initiator_kind='HUMAN')
          OR (mode='AUTOMATED' AND trigger_kind IN('HUMAN_LAUNCH','HUMAN_RERUN') AND initiator_kind='HUMAN')
          OR (mode='AUTOMATED' AND trigger_kind='AUTO_INFRA_RETRY' AND initiator_kind='SERVICE')
        )
      );

      INSERT INTO qa_attempt_identities(
        attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,
        mode,attempt_no,target_snapshot_hash,scope_snapshot_hash,trigger_kind,
        initiator_kind,initiator_principal_id,authorization_basis_hash,
        correlation_id,causation_id,created_at,identity_content_hash
      )
      SELECT
        a.attempt_id,a.workspace_id,a.project_id,a.work_item_id,a.session_id,a.plan_item_id,
        'MANUAL',a.attempt_no,a.target_snapshot_hash,s.scope_hash,'HUMAN_MANUAL',
        'HUMAN',COALESCE(NULLIF(a.actor->>'principalId',''),'legacy-human'),a.content_hash,
        'legacy-manual:'||a.attempt_id,'legacy-manual:'||a.attempt_id,a.started_at,a.content_hash
      FROM qa_manual_attempts a
      JOIN qa_test_sessions s
        ON s.session_id=a.session_id AND s.workspace_id=a.workspace_id AND s.project_id=a.project_id
      ORDER BY a.workspace_id,a.project_id,a.plan_item_id,a.attempt_no;

      DO $qa$ DECLARE manual_count bigint; identity_count bigint; BEGIN
        SELECT count(*) INTO manual_count FROM qa_manual_attempts;
        SELECT count(*) INTO identity_count FROM qa_attempt_identities WHERE mode='MANUAL';
        IF manual_count<>identity_count THEN RAISE EXCEPTION 'QA_MANUAL_ATTEMPT_BACKFILL_COUNT_MISMATCH'; END IF;
        IF EXISTS(
          SELECT 1 FROM qa_manual_attempts a
          LEFT JOIN qa_attempt_identities i ON i.attempt_id=a.attempt_id
          WHERE i.attempt_id IS NULL OR i.mode<>'MANUAL' OR i.attempt_no<>a.attempt_no
            OR i.target_snapshot_hash<>a.target_snapshot_hash OR i.identity_content_hash<>a.content_hash
        ) THEN RAISE EXCEPTION 'QA_MANUAL_ATTEMPT_BACKFILL_HASH_MISMATCH'; END IF;
      END $qa$;

      ALTER TABLE qa_manual_attempts
        ADD CONSTRAINT qa_manual_attempt_identity_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_attempt_identities(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED;

      CREATE OR REPLACE FUNCTION qa_guard_attempt_identity_insert() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE session_mode text; plan_mode text; next_no integer;
      BEGIN
        SELECT s.mode,p.mode INTO session_mode,plan_mode
        FROM qa_test_sessions s
        JOIN qa_plan_items p ON p.session_id=s.session_id
        WHERE s.session_id=NEW.session_id AND p.plan_item_id=NEW.plan_item_id
          AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id
          AND p.workspace_id=NEW.workspace_id AND p.project_id=NEW.project_id
          AND s.work_item_id=NEW.work_item_id AND p.work_item_id=NEW.work_item_id
        FOR UPDATE OF s,p;
        IF session_mode IS NULL OR session_mode<>NEW.mode OR plan_mode<>NEW.mode THEN
          RAISE EXCEPTION 'QA_ATTEMPT_MODE_SCOPE_MISMATCH';
        END IF;
        SELECT COALESCE(max(attempt_no),0)+1 INTO next_no
        FROM qa_attempt_identities
        WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND plan_item_id=NEW.plan_item_id;
        NEW.attempt_no := next_no;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_attempt_identity_insert_guard
        BEFORE INSERT ON qa_attempt_identities
        FOR EACH ROW EXECUTE FUNCTION qa_guard_attempt_identity_insert();

      CREATE OR REPLACE FUNCTION qa_assert_automation_session_foundation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_id text; subject_mode text; pin_count integer; plan_count integer;
      BEGIN
        subject_id := COALESCE(NEW.session_id,OLD.session_id);
        SELECT mode INTO subject_mode FROM qa_test_sessions WHERE session_id=subject_id;
        SELECT count(*) INTO pin_count FROM qa_automation_session_configuration_pins WHERE session_id=subject_id;
        SELECT count(*) INTO plan_count FROM qa_plan_items WHERE session_id=subject_id;
        IF subject_mode='MANUAL' AND pin_count<>0 THEN RAISE EXCEPTION 'QA_MANUAL_SESSION_AUTOMATION_PINS_FORBIDDEN'; END IF;
        IF subject_mode='AUTOMATED' THEN
          IF pin_count<>3 OR plan_count<>1 THEN RAISE EXCEPTION 'QA_AUTOMATION_SESSION_FOUNDATION_INCOMPLETE'; END IF;
          IF EXISTS(
            SELECT required_role FROM unnest(ARRAY['SOURCE_CONTEXT','TEST_EXECUTION','ARTIFACT_SOURCE']) required_role
            WHERE NOT EXISTS(SELECT 1 FROM qa_automation_session_configuration_pins p WHERE p.session_id=subject_id AND p.logical_role=required_role)
          ) THEN RAISE EXCEPTION 'QA_AUTOMATION_CONFIGURATION_ROLE_MISSING'; END IF;
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_automation_session_foundation_guard
        AFTER INSERT OR UPDATE ON qa_test_sessions
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION qa_assert_automation_session_foundation();
      CREATE CONSTRAINT TRIGGER qa_automation_pin_foundation_guard
        AFTER INSERT OR UPDATE OR DELETE ON qa_automation_session_configuration_pins
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION qa_assert_automation_session_foundation();
      CREATE CONSTRAINT TRIGGER qa_automation_plan_foundation_guard
        AFTER INSERT OR UPDATE OR DELETE ON qa_plan_items
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION qa_assert_automation_session_foundation();

      CREATE OR REPLACE FUNCTION qa_guard_suite_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY:qa_automation_suite_binding_versions'; END IF;
        IF ROW(NEW.suite_binding_version_id,NEW.workspace_id,NEW.project_id,NEW.suite_binding_id,NEW.version,
          NEW.owner_principal_id,NEW.suite_definition_ref,NEW.suite_definition_hash,NEW.logical_pipeline_key,
          NEW.source_ref_policy_ref,NEW.result_job_key,NEW.logical_execution_contract_hash,NEW.accepted_target_types,
          NEW.environment_policy_ref,NEW.allowed_parameter_schema_ref,NEW.allowed_parameter_schema_digest,
          NEW.result_schema_ref,NEW.result_schema_digest,NEW.result_source_contract,NEW.artifact_policy_ref,
          NEW.artifact_policy_content_hash,NEW.retry_policy_ref,NEW.retry_policy_content_hash,NEW.quarantine_policy_ref,
          NEW.quarantine_policy_content_hash,NEW.required_capability_set_hash,NEW.content,NEW.content_hash,NEW.created_by,NEW.created_at)
          IS DISTINCT FROM
          ROW(OLD.suite_binding_version_id,OLD.workspace_id,OLD.project_id,OLD.suite_binding_id,OLD.version,
          OLD.owner_principal_id,OLD.suite_definition_ref,OLD.suite_definition_hash,OLD.logical_pipeline_key,
          OLD.source_ref_policy_ref,OLD.result_job_key,OLD.logical_execution_contract_hash,OLD.accepted_target_types,
          OLD.environment_policy_ref,OLD.allowed_parameter_schema_ref,OLD.allowed_parameter_schema_digest,
          OLD.result_schema_ref,OLD.result_schema_digest,OLD.result_source_contract,OLD.artifact_policy_ref,
          OLD.artifact_policy_content_hash,OLD.retry_policy_ref,OLD.retry_policy_content_hash,OLD.quarantine_policy_ref,
          OLD.quarantine_policy_content_hash,OLD.required_capability_set_hash,OLD.content,OLD.content_hash,OLD.created_by,OLD.created_at)
        THEN RAISE EXCEPTION 'QA_AUTOMATION_SUITE_CONTENT_IMMUTABLE'; END IF;
        IF NOT((OLD.state='DRAFT' AND NEW.state='VALIDATED') OR (OLD.state='VALIDATED' AND NEW.state='PUBLISHED') OR (OLD.state='PUBLISHED' AND NEW.state='RETIRED')) THEN
          RAISE EXCEPTION 'QA_AUTOMATION_SUITE_STATE_TRANSITION_INVALID';
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_suite_version_mutation_guard
        BEFORE UPDATE OR DELETE ON qa_automation_suite_binding_versions
        FOR EACH ROW EXECUTE FUNCTION qa_guard_suite_version_mutation();

      CREATE INDEX qa_automation_suite_scope_idx ON qa_automation_suite_bindings(workspace_id,project_id,suite_key);
      CREATE INDEX qa_automation_suite_version_scope_idx ON qa_automation_suite_binding_versions(workspace_id,project_id,suite_binding_id,version);
      CREATE INDEX qa_automation_validation_scope_idx ON qa_automation_suite_validation_reports(workspace_id,project_id,suite_binding_id,created_at);
      CREATE INDEX qa_automation_pin_scope_idx ON qa_automation_session_configuration_pins(workspace_id,project_id,session_id,ordinal);
      CREATE INDEX qa_attempt_identity_scope_idx ON qa_attempt_identities(workspace_id,project_id,session_id,plan_item_id,attempt_no);

      UPDATE platform_schema_versions
        SET version=2050,applied_at=clock_timestamp()
        WHERE namespace='pack:qa';
    `);

    for (const table of [
      "qa_automation_suite_validation_reports",
      "qa_automation_session_configuration_pins",
      "qa_attempt_identities",
    ])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS qa_attempt_identity_insert_guard ON qa_attempt_identities;
      DROP FUNCTION IF EXISTS qa_guard_attempt_identity_insert();
      DROP TRIGGER IF EXISTS qa_automation_session_foundation_guard ON qa_test_sessions;
      DROP TRIGGER IF EXISTS qa_automation_pin_foundation_guard ON qa_automation_session_configuration_pins;
      DROP TRIGGER IF EXISTS qa_automation_plan_foundation_guard ON qa_plan_items;
      DROP FUNCTION IF EXISTS qa_assert_automation_session_foundation();
      DROP TRIGGER IF EXISTS qa_suite_version_mutation_guard ON qa_automation_suite_binding_versions;
      DROP FUNCTION IF EXISTS qa_guard_suite_version_mutation();
      ALTER TABLE qa_manual_attempts DROP CONSTRAINT IF EXISTS qa_manual_attempt_identity_fk;
      DROP TABLE qa_attempt_identities;
      DROP TABLE qa_automation_session_configuration_pins;
      ALTER TABLE qa_test_sessions DROP CONSTRAINT IF EXISTS qa_session_automation_suite_fk;
      ALTER TABLE qa_automation_suite_bindings DROP CONSTRAINT IF EXISTS qa_suite_current_published_fk;
      ALTER TABLE qa_automation_suite_binding_versions DROP CONSTRAINT IF EXISTS qa_suite_version_validation_report_fk;
      DROP TABLE qa_automation_suite_validation_reports;
      DROP TABLE qa_automation_suite_binding_versions;
      DROP TABLE qa_automation_suite_bindings;

      ALTER TABLE qa_plan_items
        DROP CONSTRAINT IF EXISTS qa_plan_item_contract_shape,
        DROP CONSTRAINT IF EXISTS qa_plan_item_mode_v2,
        DROP COLUMN IF EXISTS contract_schema_version,
        ADD CONSTRAINT qa_plan_items_mode_check CHECK(mode='MANUAL');
      ALTER TABLE qa_test_sessions
        DROP CONSTRAINT IF EXISTS qa_session_automation_replacement_shape,
        DROP CONSTRAINT IF EXISTS qa_session_automation_shape,
        DROP CONSTRAINT IF EXISTS qa_session_mode_v2,
        DROP COLUMN IF EXISTS automation_replacement_reason,
        DROP COLUMN IF EXISTS automation_parameter_set_hash,
        DROP COLUMN IF EXISTS automation_configuration_pin_set_hash,
        DROP COLUMN IF EXISTS automation_suite_binding_content_hash,
        DROP COLUMN IF EXISTS automation_suite_binding_version,
        DROP COLUMN IF EXISTS automation_suite_binding_id,
        DROP COLUMN IF EXISTS contract_schema_version,
        ADD CONSTRAINT qa_test_sessions_mode_check CHECK(mode='MANUAL');
      ALTER TABLE qa_required_session_plan_requirements
        DROP CONSTRAINT IF EXISTS qa_requirement_automation_shape,
        DROP CONSTRAINT IF EXISTS qa_requirement_mode_v2,
        DROP COLUMN IF EXISTS automation_suite_selection_policy,
        DROP COLUMN IF EXISTS automation_suite_binding_key,
        DROP COLUMN IF EXISTS contract_schema_version,
        ADD CONSTRAINT qa_required_session_plan_requirements_mode_check CHECK(mode='MANUAL');
      UPDATE platform_schema_versions SET version=2040,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

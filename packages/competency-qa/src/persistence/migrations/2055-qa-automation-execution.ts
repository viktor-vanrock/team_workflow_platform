import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaAutomationExecution20551700000002055 implements MigrationInterface {
  readonly name = "QaAutomationExecution20551700000002055";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_automation_launch_requests(
        launch_request_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        plan_item_id text NOT NULL,
        request_key_hash text NOT NULL CHECK(request_key_hash ~ '^sha256:[a-f0-9]{64}$'),
        request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
        confirmation_hash text NULL CHECK(confirmation_hash IS NULL OR confirmation_hash ~ '^sha256:[a-f0-9]{64}$'),
        confirmed_session_resource_version bigint NULL CHECK(confirmed_session_resource_version IS NULL OR confirmed_session_resource_version>=1),
        confirmed_at timestamptz NULL,
        origin text NOT NULL CHECK(origin IN('HUMAN_LAUNCH','HUMAN_RERUN','AUTO_INFRA_RETRY')),
        decision text NOT NULL CHECK(decision IN('ACCEPTED','REJECTED')),
        attempt_id text NULL,
        connector_command_id uuid NULL,
        effect_idempotency_key text NULL,
        rejection_reason_code text NULL CHECK(rejection_reason_code IS NULL OR rejection_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        initiator_kind text NOT NULL CHECK(initiator_kind IN('HUMAN','SERVICE')),
        initiator_principal_id text NOT NULL,
        causal_human_principal_id text NOT NULL,
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(launch_request_id),
        UNIQUE(launch_request_id,workspace_id,project_id),
        UNIQUE(launch_request_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        UNIQUE(workspace_id,project_id,session_id,request_key_hash),
        UNIQUE(attempt_id),
        UNIQUE(connector_command_id),
        UNIQUE(effect_idempotency_key),
        FOREIGN KEY(session_id,workspace_id,project_id)
          REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(plan_item_id,workspace_id,project_id)
          REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id)
          REFERENCES work_items(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id,connector_command_id)
          REFERENCES connector_commands(workspace_id,project_id,id)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(length(btrim(effect_idempotency_key)) BETWEEN 1 AND 256 OR effect_idempotency_key IS NULL),
        CHECK(
          (origin IN('HUMAN_LAUNCH','HUMAN_RERUN') AND initiator_kind='HUMAN'
            AND confirmation_hash IS NOT NULL AND confirmed_session_resource_version IS NOT NULL AND confirmed_at IS NOT NULL)
          OR
          (origin='AUTO_INFRA_RETRY' AND initiator_kind='SERVICE'
            AND confirmation_hash IS NULL AND confirmed_session_resource_version IS NULL AND confirmed_at IS NULL)
        ),
        CHECK(
          (decision='ACCEPTED' AND attempt_id IS NOT NULL AND connector_command_id IS NOT NULL
            AND effect_idempotency_key IS NOT NULL AND rejection_reason_code IS NULL)
          OR
          (decision='REJECTED' AND attempt_id IS NULL AND connector_command_id IS NULL
            AND effect_idempotency_key IS NULL AND rejection_reason_code IS NOT NULL)
        )
      );

      CREATE TABLE qa_automation_attempts(
        attempt_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        plan_item_id text NOT NULL,
        attempt_no integer NOT NULL CHECK(attempt_no>=1),
        launch_request_id text NOT NULL,
        root_attempt_id text NOT NULL,
        predecessor_attempt_id text NULL,
        lineage_kind text NOT NULL CHECK(lineage_kind IN('INITIAL','HUMAN_RERUN','AUTO_INFRA_RETRY')),
        request_key_hash text NOT NULL CHECK(request_key_hash ~ '^sha256:[a-f0-9]{64}$'),
        request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
        suite_binding_id text NOT NULL,
        suite_binding_version integer NOT NULL CHECK(suite_binding_version>=1),
        suite_binding_content_hash text NOT NULL CHECK(suite_binding_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        target_snapshot_ref text NOT NULL CHECK(length(btrim(target_snapshot_ref)) BETWEEN 1 AND 512),
        target_snapshot_hash text NOT NULL CHECK(target_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        scope_snapshot_hash text NOT NULL CHECK(scope_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
        parameter_set_hash text NOT NULL CHECK(parameter_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        configuration_pin_set_hash text NOT NULL CHECK(configuration_pin_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        result_schema_ref jsonb NOT NULL,
        result_schema_digest text NOT NULL CHECK(result_schema_digest ~ '^sha256:[a-f0-9]{64}$'),
        artifact_policy_ref text NOT NULL CHECK(length(btrim(artifact_policy_ref)) BETWEEN 1 AND 512),
        artifact_policy_content_hash text NOT NULL CHECK(artifact_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        retry_policy_ref text NOT NULL CHECK(length(btrim(retry_policy_ref)) BETWEEN 1 AND 512),
        retry_policy_content_hash text NOT NULL CHECK(retry_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        quarantine_policy_ref text NOT NULL CHECK(length(btrim(quarantine_policy_ref)) BETWEEN 1 AND 512),
        quarantine_policy_content_hash text NOT NULL CHECK(quarantine_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        connector_command_id uuid NOT NULL,
        effect_idempotency_key text NOT NULL CHECK(length(btrim(effect_idempotency_key)) BETWEEN 1 AND 256),
        initiating_human_principal_id text NOT NULL,
        executing_service_principal_id text NOT NULL,
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        current_status_revision_id text NOT NULL,
        current_status_revision_no integer NOT NULL CHECK(current_status_revision_no>=1),
        current_status text NOT NULL CHECK(current_status IN('CREATED','TRIGGER_PENDING','RUNNING','TERMINAL')),
        terminal_result_id text NULL,
        resource_version bigint NOT NULL CHECK(resource_version>=1),
        created_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        identity_content_hash text NOT NULL CHECK(identity_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(attempt_id),
        UNIQUE(attempt_id,workspace_id,project_id),
        UNIQUE(attempt_id,workspace_id,project_id,work_item_id,session_id),
        UNIQUE(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        UNIQUE(attempt_id,workspace_id,project_id,plan_item_id,identity_content_hash),
        UNIQUE(launch_request_id),
        UNIQUE(connector_command_id),
        UNIQUE(effect_idempotency_key),
        UNIQUE(current_status_revision_id),
        UNIQUE(terminal_result_id),
        FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_attempt_identities(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(launch_request_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_automation_launch_requests(launch_request_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(suite_binding_id,suite_binding_version,suite_binding_content_hash)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_id,version,content_hash),
        FOREIGN KEY(workspace_id,project_id,connector_command_id)
          REFERENCES connector_commands(workspace_id,project_id,id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(root_attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(predecessor_attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(
          (lineage_kind='INITIAL' AND predecessor_attempt_id IS NULL AND root_attempt_id=attempt_id AND attempt_no=1)
          OR
          (lineage_kind IN('HUMAN_RERUN','AUTO_INFRA_RETRY') AND predecessor_attempt_id IS NOT NULL
            AND predecessor_attempt_id<>attempt_id AND root_attempt_id<>attempt_id AND attempt_no>1)
        ),
        CHECK((current_status='TERMINAL')=(terminal_result_id IS NOT NULL)),
        CHECK(jsonb_typeof(result_schema_ref)='object')
      );

      CREATE TABLE qa_automation_attempt_status_revisions(
        status_revision_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        attempt_id text NOT NULL,
        revision_no integer NOT NULL CHECK(revision_no>=1),
        previous_revision_id text NULL,
        previous_state_hash text NULL CHECK(previous_state_hash IS NULL OR previous_state_hash ~ '^sha256:[a-f0-9]{64}$'),
        state text NOT NULL CHECK(state IN('CREATED','TRIGGER_PENDING','RUNNING','TERMINAL')),
        external_authority_hash text NOT NULL CHECK(external_authority_hash ~ '^sha256:[a-f0-9]{64}$'),
        external_pipeline_id text NULL CHECK(external_pipeline_id IS NULL OR length(external_pipeline_id) BETWEEN 1 AND 128),
        external_job_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        provider_status text NOT NULL CHECK(provider_status IN(
          'NOT_OBSERVED','CREATED','WAITING_FOR_RESOURCE','PREPARING','PENDING','RUNNING',
          'SUCCESS','FAILED','CANCELED','SKIPPED','MANUAL','SCHEDULED','UNKNOWN'
        )),
        provider_revision_token text NOT NULL CHECK(length(provider_revision_token) BETWEEN 1 AND 256),
        provider_updated_at timestamptz NULL,
        source_kind text NOT NULL CHECK(source_kind IN('COMMAND_RECEIPT','WEBHOOK_SIGNAL','POLL_READ','RECONCILIATION_READ','SYNTHETIC_FAILURE')),
        source_receipt_ref text NOT NULL CHECK(length(btrim(source_receipt_ref)) BETWEEN 1 AND 512),
        source_receipt_hash text NOT NULL CHECK(source_receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
        result_id text NULL,
        result_content_hash text NULL CHECK(result_content_hash IS NULL OR result_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        observed_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL,
        content jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(status_revision_id),
        UNIQUE(status_revision_id,workspace_id,project_id,attempt_id),
        UNIQUE(status_revision_id,workspace_id,project_id,attempt_id,revision_no),
        UNIQUE(status_revision_id,workspace_id,project_id,attempt_id,revision_no,content_hash),
        UNIQUE(attempt_id,revision_no),
        UNIQUE(attempt_id,source_receipt_hash,provider_revision_token,content_hash),
        FOREIGN KEY(attempt_id,workspace_id,project_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,attempt_id)
          REFERENCES qa_automation_attempt_status_revisions(status_revision_id,workspace_id,project_id,attempt_id)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(jsonb_typeof(external_job_ids)='array' AND jsonb_array_length(external_job_ids)<=64),
        CHECK(
          (revision_no=1 AND previous_revision_id IS NULL AND previous_state_hash IS NULL)
          OR (revision_no>1 AND previous_revision_id IS NOT NULL AND previous_state_hash IS NOT NULL)
        ),
        CHECK(
          (state='TERMINAL' AND result_id IS NOT NULL AND result_content_hash IS NOT NULL)
          OR (state<>'TERMINAL' AND result_id IS NULL AND result_content_hash IS NULL)
        )
      );

      CREATE TABLE qa_automation_attempt_results(
        result_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        attempt_id text NOT NULL,
        attempt_no integer NOT NULL CHECK(attempt_no>=1),
        normalization_kind text NOT NULL CHECK(normalization_kind IN('SCHEMA_VALIDATED','SYNTHETIC_INCOMPLETE')),
        result_schema_ref jsonb NOT NULL,
        result_schema_digest text NOT NULL CHECK(result_schema_digest ~ '^sha256:[a-f0-9]{64}$'),
        observed_result_schema_ref jsonb NULL,
        observed_result_schema_digest text NULL CHECK(observed_result_schema_digest IS NULL OR observed_result_schema_digest ~ '^sha256:[a-f0-9]{64}$'),
        technical_outcome text NOT NULL CHECK(technical_outcome IN('PASS','ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','CANCELLED','INCOMPLETE')),
        infrastructure_error_code text NULL CHECK(infrastructure_error_code IS NULL OR infrastructure_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        cancellation_reason_code text NULL CHECK(cancellation_reason_code IS NULL OR cancellation_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        synthetic_reason_code text NULL CHECK(synthetic_reason_code IS NULL OR synthetic_reason_code IN(
          'TRIGGER_AMBIGUOUS','PIPELINE_IDENTITY_MISSING','RESULT_MISSING','RESULT_TOO_LARGE',
          'RESULT_SCHEMA_UNKNOWN','RESULT_SCHEMA_DRIFT','RESULT_SCOPE_MISMATCH','RESULT_TARGET_MISMATCH',
          'ARTIFACT_CHECKSUM_MISMATCH','ARTIFACT_EXPIRED','PROVIDER_STATUS_UNKNOWN'
        )),
        external_pipeline_id text NULL CHECK(external_pipeline_id IS NULL OR length(external_pipeline_id) BETWEEN 1 AND 128),
        external_job_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        commit_sha text NULL CHECK(commit_sha IS NULL OR commit_sha ~ '^[a-f0-9]{40}$'),
        build_ref text NULL CHECK(build_ref IS NULL OR length(btrim(build_ref)) BETWEEN 1 AND 512),
        merge_request_ref text NULL CHECK(merge_request_ref IS NULL OR length(btrim(merge_request_ref)) BETWEEN 1 AND 512),
        environment_ref text NOT NULL CHECK(length(btrim(environment_ref)) BETWEEN 1 AND 512),
        suite_ref jsonb NOT NULL,
        queued_at timestamptz NULL,
        started_at timestamptz NULL,
        completed_at timestamptz NOT NULL,
        duration_ms bigint NULL CHECK(duration_ms IS NULL OR duration_ms>=0),
        artifact_descriptor_set_hash text NOT NULL CHECK(artifact_descriptor_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        artifact_sync_state text NOT NULL CHECK(artifact_sync_state IN('COMPLETE','PARTIAL','UNAVAILABLE','EXPIRED')),
        source_result_artifact_ref text NULL CHECK(source_result_artifact_ref IS NULL OR length(btrim(source_result_artifact_ref)) BETWEEN 1 AND 512),
        normalization_report jsonb NOT NULL,
        received_at timestamptz NOT NULL,
        content jsonb NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(result_id),
        UNIQUE(result_id,workspace_id,project_id),
        UNIQUE(result_id,workspace_id,project_id,attempt_id),
        UNIQUE(result_id,workspace_id,project_id,attempt_id,content_hash),
        UNIQUE(result_id,workspace_id,project_id,attempt_id,artifact_descriptor_set_hash),
        UNIQUE(attempt_id),
        FOREIGN KEY(attempt_id,workspace_id,project_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id),
        CHECK(jsonb_typeof(result_schema_ref)='object' AND jsonb_typeof(suite_ref)='object'
          AND jsonb_typeof(normalization_report)='object' AND jsonb_typeof(external_job_ids)='array'
          AND jsonb_array_length(external_job_ids)<=64),
        CHECK(
          (normalization_kind='SCHEMA_VALIDATED' AND technical_outcome<>'INCOMPLETE'
            AND synthetic_reason_code IS NULL AND source_result_artifact_ref IS NOT NULL
            AND external_pipeline_id IS NOT NULL AND jsonb_array_length(external_job_ids)>=1
            AND commit_sha IS NOT NULL AND duration_ms IS NOT NULL)
          OR
          (normalization_kind='SYNTHETIC_INCOMPLETE' AND technical_outcome='INCOMPLETE'
            AND synthetic_reason_code IS NOT NULL)
        ),
        CHECK((technical_outcome='CANCELLED')=(cancellation_reason_code IS NOT NULL)),
        CHECK(technical_outcome NOT IN('PASS','ASSERTION_FAILED','TIMEOUT','CANCELLED') OR infrastructure_error_code IS NULL),
        CHECK(queued_at IS NULL OR started_at IS NULL OR queued_at<=started_at),
        CHECK(started_at IS NULL OR started_at<=completed_at)
      );

      CREATE TABLE qa_automation_artifact_memberships(
        membership_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        attempt_id text NOT NULL,
        result_id text NOT NULL,
        artifact_descriptor_set_hash text NOT NULL CHECK(artifact_descriptor_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 64),
        artifact_reference_id uuid NOT NULL,
        external_authority_hash text NOT NULL CHECK(external_authority_hash ~ '^sha256:[a-f0-9]{64}$'),
        external_pipeline_id text NOT NULL CHECK(length(external_pipeline_id) BETWEEN 1 AND 128),
        external_job_id text NOT NULL CHECK(length(external_job_id) BETWEEN 1 AND 128),
        logical_path text NOT NULL CHECK(length(logical_path) BETWEEN 1 AND 512 AND logical_path !~ '(^/|\\.\\.)'),
        external_descriptor_hash text NOT NULL CHECK(external_descriptor_hash ~ '^sha256:[a-f0-9]{64}$'),
        checksum text NOT NULL CHECK(checksum ~ '^sha256:[a-f0-9]{64}$'),
        checksum_source text NOT NULL CHECK(checksum_source IN('MACHINE_RESULT_MANIFEST','CONNECTOR_CONTENT_SHA256')),
        size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 104857600),
        media_type text NOT NULL CHECK(length(media_type) BETWEEN 1 AND 128),
        artifact_kind text NOT NULL CHECK(artifact_kind IN('RESULT','REPORT','LOG','SCREENSHOT','TRACE','OTHER')),
        classification_key text NOT NULL REFERENCES classification_catalog(key),
        source_profile_ref jsonb NOT NULL,
        source_profile_content_hash text NOT NULL CHECK(source_profile_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        retention_policy_ref text NOT NULL CHECK(length(btrim(retention_policy_ref)) BETWEEN 1 AND 512),
        availability_at_result text NOT NULL CHECK(availability_at_result IN('AVAILABLE','MISSING','EXPIRED','CHECKSUM_MISMATCH')),
        opaque_locator_hash text NOT NULL CHECK(opaque_locator_hash ~ '^sha256:[a-f0-9]{64}$'),
        expires_at timestamptz NOT NULL,
        registered_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(membership_id),
        UNIQUE(result_id,artifact_reference_id),
        UNIQUE(result_id,ordinal),
        UNIQUE(membership_id,workspace_id,project_id,attempt_id,result_id),
        FOREIGN KEY(result_id,workspace_id,project_id,attempt_id,artifact_descriptor_set_hash)
          REFERENCES qa_automation_attempt_results(result_id,workspace_id,project_id,attempt_id,artifact_descriptor_set_hash)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(workspace_id,project_id,artifact_reference_id)
          REFERENCES artifact_references(workspace_id,project_id,id),
        CHECK(jsonb_typeof(source_profile_ref)='object'),
        CHECK((artifact_kind='RESULT' AND checksum_source='CONNECTOR_CONTENT_SHA256')
          OR (artifact_kind<>'RESULT' AND checksum_source='MACHINE_RESULT_MANIFEST'))
      );

      CREATE TABLE qa_automation_retry_decisions(
        retry_decision_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        attempt_id text NOT NULL,
        attempt_result_id text NOT NULL,
        decision text NOT NULL CHECK(decision IN('NOT_APPLICABLE','DENIED','SCHEDULED')),
        reason_code text NOT NULL CHECK(reason_code IN(
          'OUTCOME_INELIGIBLE','INFRA_CODE_MISSING','INFRA_CODE_NOT_ALLOWLISTED','RETRY_BUDGET_EXHAUSTED',
          'AUTHORIZATION_DENIED','QUARANTINE_ACTIVE','POLICY_DENIED','CONFIGURATION_PIN_CHANGED',
          'TARGET_CHANGED','SCHEDULED_ALLOWLISTED_INFRA'
        )),
        retry_policy_ref text NOT NULL CHECK(length(btrim(retry_policy_ref)) BETWEEN 1 AND 512),
        retry_policy_content_hash text NOT NULL CHECK(retry_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        infrastructure_code text NULL CHECK(infrastructure_code IS NULL OR infrastructure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        automatic_retry_budget integer NOT NULL DEFAULT 1 CHECK(automatic_retry_budget=1),
        automatic_retry_ordinal integer NULL CHECK(automatic_retry_ordinal IS NULL OR automatic_retry_ordinal=1),
        successor_attempt_id text NULL,
        successor_launch_request_id text NULL,
        authorization_recheck_hash text NOT NULL CHECK(authorization_recheck_hash ~ '^sha256:[a-f0-9]{64}$'),
        decided_by_kind text NOT NULL CHECK(decided_by_kind='SERVICE'),
        decided_by_principal_id text NOT NULL,
        decided_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(retry_decision_id),
        UNIQUE(retry_decision_id,workspace_id,project_id),
        UNIQUE(attempt_id),
        UNIQUE(attempt_result_id),
        UNIQUE(successor_attempt_id),
        UNIQUE(successor_launch_request_id),
        FOREIGN KEY(attempt_result_id,workspace_id,project_id,attempt_id)
          REFERENCES qa_automation_attempt_results(result_id,workspace_id,project_id,attempt_id),
        FOREIGN KEY(successor_attempt_id,workspace_id,project_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(successor_launch_request_id,workspace_id,project_id)
          REFERENCES qa_automation_launch_requests(launch_request_id,workspace_id,project_id)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(
          (decision='SCHEDULED' AND reason_code='SCHEDULED_ALLOWLISTED_INFRA'
            AND infrastructure_code IS NOT NULL AND automatic_retry_ordinal=1
            AND successor_attempt_id IS NOT NULL AND successor_launch_request_id IS NOT NULL)
          OR
          (decision='NOT_APPLICABLE' AND reason_code IN(
            'OUTCOME_INELIGIBLE','INFRA_CODE_MISSING','INFRA_CODE_NOT_ALLOWLISTED','RETRY_BUDGET_EXHAUSTED'
          ) AND automatic_retry_ordinal IS NULL AND successor_attempt_id IS NULL AND successor_launch_request_id IS NULL)
          OR
          (decision='DENIED' AND reason_code IN(
            'AUTHORIZATION_DENIED','QUARANTINE_ACTIVE','POLICY_DENIED','CONFIGURATION_PIN_CHANGED','TARGET_CHANGED'
          ) AND automatic_retry_ordinal IS NULL AND successor_attempt_id IS NULL AND successor_launch_request_id IS NULL)
        )
      );

      ALTER TABLE qa_automation_launch_requests
        ADD CONSTRAINT qa_launch_accepted_attempt_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_automation_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_automation_attempts
        ADD CONSTRAINT qa_automation_attempt_status_head_fk
          FOREIGN KEY(current_status_revision_id,workspace_id,project_id,attempt_id,current_status_revision_no)
          REFERENCES qa_automation_attempt_status_revisions(status_revision_id,workspace_id,project_id,attempt_id,revision_no)
          DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT qa_automation_attempt_terminal_result_fk
          FOREIGN KEY(terminal_result_id,workspace_id,project_id,attempt_id)
          REFERENCES qa_automation_attempt_results(result_id,workspace_id,project_id,attempt_id)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_automation_attempt_status_revisions
        ADD CONSTRAINT qa_automation_status_result_fk
          FOREIGN KEY(result_id,workspace_id,project_id,attempt_id,result_content_hash)
          REFERENCES qa_automation_attempt_results(result_id,workspace_id,project_id,attempt_id,content_hash)
          DEFERRABLE INITIALLY DEFERRED;

      DO $qa$ DECLARE constraint_row record; BEGIN
        FOR constraint_row IN
          SELECT conrelid::regclass AS relation_name,conname
          FROM pg_constraint
          WHERE contype='f'
            AND conrelid IN('qa_observations'::regclass,'qa_plan_item_result_attempt_memberships'::regclass,'qa_evidence_artifact_links'::regclass)
            AND pg_get_constraintdef(oid) ~* 'REFERENCES qa_manual_attempts'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.relation_name,constraint_row.conname);
        END LOOP;
        FOR constraint_row IN
          SELECT conrelid::regclass AS relation_name,conname
          FROM pg_constraint
          WHERE contype='c' AND conrelid='qa_evidence_artifact_links'::regclass
            AND pg_get_constraintdef(oid) ~* 'owner_kind'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',constraint_row.relation_name,constraint_row.conname);
        END LOOP;
      END $qa$;

      ALTER TABLE qa_observations
        ADD CONSTRAINT qa_observation_attempt_identity_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_attempt_identities(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_plan_item_result_attempt_memberships
        ADD CONSTRAINT qa_result_attempt_identity_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_attempt_identities(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_evidence_artifact_links
        ADD CONSTRAINT qa_evidence_attempt_identity_fk
          FOREIGN KEY(owner_attempt_id,workspace_id,project_id)
          REFERENCES qa_attempt_identities(attempt_id,workspace_id,project_id)
          DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT qa_evidence_owner_kind_v2 CHECK(owner_kind IN('SESSION','PLAN_ITEM','MANUAL_ATTEMPT','ATTEMPT','OBSERVATION','FINDING')),
        ADD CONSTRAINT qa_evidence_owner_shape_v2 CHECK(
          (owner_kind='SESSION' AND owner_session_id IS NOT NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind='PLAN_ITEM' AND owner_session_id IS NULL AND owner_plan_item_id IS NOT NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind IN('MANUAL_ATTEMPT','ATTEMPT') AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NOT NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind='OBSERVATION' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NOT NULL AND owner_finding_id IS NULL)
          OR (owner_kind='FINDING' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NOT NULL)
        );

      CREATE OR REPLACE FUNCTION qa_guard_evidence_owner_kind_v2() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF NEW.owner_kind='MANUAL_ATTEMPT' THEN RAISE EXCEPTION 'QA_LEGACY_EVIDENCE_OWNER_KIND_FORBIDDEN'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_evidence_owner_kind_v2_guard
        BEFORE INSERT ON qa_evidence_artifact_links
        FOR EACH ROW EXECUTE FUNCTION qa_guard_evidence_owner_kind_v2();

      CREATE OR REPLACE FUNCTION qa_assert_attempt_child_v2() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_id text; identity_mode text; manual_count integer; automation_count integer;
      BEGIN
        subject_id := COALESCE(NEW.attempt_id,OLD.attempt_id);
        SELECT mode INTO identity_mode FROM qa_attempt_identities WHERE attempt_id=subject_id;
        IF identity_mode IS NULL THEN RETURN NULL; END IF;
        SELECT count(*) INTO manual_count FROM qa_manual_attempts WHERE attempt_id=subject_id;
        SELECT count(*) INTO automation_count FROM qa_automation_attempts WHERE attempt_id=subject_id;
        IF (identity_mode='MANUAL' AND (manual_count<>1 OR automation_count<>0))
          OR (identity_mode='AUTOMATED' AND (manual_count<>0 OR automation_count<>1)) THEN
          RAISE EXCEPTION 'QA_ATTEMPT_MODE_CHILD_MISMATCH';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_attempt_identity_child_guard
        AFTER INSERT OR UPDATE OR DELETE ON qa_attempt_identities
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_attempt_child_v2();
      CREATE CONSTRAINT TRIGGER qa_manual_attempt_child_guard
        AFTER INSERT OR UPDATE OR DELETE ON qa_manual_attempts
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_attempt_child_v2();
      CREATE CONSTRAINT TRIGGER qa_automation_attempt_child_guard
        AFTER INSERT OR UPDATE OR DELETE ON qa_automation_attempts
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_attempt_child_v2();

      CREATE OR REPLACE FUNCTION qa_guard_automation_attempt_mutation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE head_row qa_automation_attempt_status_revisions%ROWTYPE;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY:qa_automation_attempts'; END IF;
        IF TG_OP='UPDATE' AND ROW(
          NEW.attempt_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.session_id,NEW.plan_item_id,
          NEW.attempt_no,NEW.launch_request_id,NEW.root_attempt_id,NEW.predecessor_attempt_id,NEW.lineage_kind,
          NEW.request_key_hash,NEW.request_hash,NEW.suite_binding_id,NEW.suite_binding_version,NEW.suite_binding_content_hash,
          NEW.target_snapshot_ref,NEW.target_snapshot_hash,NEW.scope_snapshot_hash,NEW.parameter_set_hash,NEW.configuration_pin_set_hash,
          NEW.result_schema_ref,NEW.result_schema_digest,NEW.artifact_policy_ref,NEW.artifact_policy_content_hash,
          NEW.retry_policy_ref,NEW.retry_policy_content_hash,NEW.quarantine_policy_ref,NEW.quarantine_policy_content_hash,
          NEW.connector_command_id,NEW.effect_idempotency_key,NEW.initiating_human_principal_id,NEW.executing_service_principal_id,
          NEW.authorization_basis_hash,NEW.created_at,NEW.correlation_id,NEW.causation_id,NEW.identity_content_hash
        ) IS DISTINCT FROM ROW(
          OLD.attempt_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.session_id,OLD.plan_item_id,
          OLD.attempt_no,OLD.launch_request_id,OLD.root_attempt_id,OLD.predecessor_attempt_id,OLD.lineage_kind,
          OLD.request_key_hash,OLD.request_hash,OLD.suite_binding_id,OLD.suite_binding_version,OLD.suite_binding_content_hash,
          OLD.target_snapshot_ref,OLD.target_snapshot_hash,OLD.scope_snapshot_hash,OLD.parameter_set_hash,OLD.configuration_pin_set_hash,
          OLD.result_schema_ref,OLD.result_schema_digest,OLD.artifact_policy_ref,OLD.artifact_policy_content_hash,
          OLD.retry_policy_ref,OLD.retry_policy_content_hash,OLD.quarantine_policy_ref,OLD.quarantine_policy_content_hash,
          OLD.connector_command_id,OLD.effect_idempotency_key,OLD.initiating_human_principal_id,OLD.executing_service_principal_id,
          OLD.authorization_basis_hash,OLD.created_at,OLD.correlation_id,OLD.causation_id,OLD.identity_content_hash
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_ATTEMPT_IDENTITY_IMMUTABLE'; END IF;
        IF TG_OP='UPDATE' THEN
          IF NEW.current_status_revision_no<>OLD.current_status_revision_no+1 OR NEW.resource_version<>OLD.resource_version+1 THEN
            RAISE EXCEPTION 'QA_AUTOMATION_ATTEMPT_HEAD_CAS_INVALID';
          END IF;
          SELECT * INTO head_row FROM qa_automation_attempt_status_revisions
            WHERE status_revision_id=NEW.current_status_revision_id AND attempt_id=NEW.attempt_id;
          IF NOT FOUND OR head_row.revision_no<>NEW.current_status_revision_no OR head_row.state<>NEW.current_status
            OR head_row.result_id IS DISTINCT FROM NEW.terminal_result_id THEN
            RAISE EXCEPTION 'QA_AUTOMATION_ATTEMPT_HEAD_MISMATCH';
          END IF;
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_automation_attempt_mutation_guard
        BEFORE UPDATE OR DELETE ON qa_automation_attempts
        FOR EACH ROW EXECUTE FUNCTION qa_guard_automation_attempt_mutation();

      CREATE OR REPLACE FUNCTION qa_guard_automation_status_insert() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE attempt_row qa_automation_attempts%ROWTYPE; prior_row qa_automation_attempt_status_revisions%ROWTYPE;
      BEGIN
        SELECT * INTO attempt_row FROM qa_automation_attempts WHERE attempt_id=NEW.attempt_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NEW; END IF;
        IF NEW.revision_no=1 THEN
          IF EXISTS(SELECT 1 FROM qa_automation_attempt_status_revisions WHERE attempt_id=NEW.attempt_id) THEN
            RAISE EXCEPTION 'QA_AUTOMATION_STATUS_REVISION_DUPLICATE';
          END IF;
          IF NEW.previous_revision_id IS NOT NULL OR NEW.state<>'CREATED' THEN
            RAISE EXCEPTION 'QA_AUTOMATION_STATUS_INITIAL_INVALID';
          END IF;
        ELSE
          SELECT * INTO prior_row FROM qa_automation_attempt_status_revisions
            WHERE status_revision_id=NEW.previous_revision_id AND attempt_id=NEW.attempt_id FOR UPDATE;
          IF NOT FOUND OR prior_row.revision_no<>NEW.revision_no-1 OR prior_row.content_hash<>NEW.previous_state_hash THEN
            RAISE EXCEPTION 'QA_AUTOMATION_STATUS_CHAIN_INVALID';
          END IF;
          IF NOT(
            (prior_row.state='CREATED' AND NEW.state='TRIGGER_PENDING')
            OR (prior_row.state='TRIGGER_PENDING' AND NEW.state IN('RUNNING','TERMINAL'))
            OR (prior_row.state='RUNNING' AND NEW.state='TERMINAL')
          ) THEN RAISE EXCEPTION 'QA_AUTOMATION_STATUS_TRANSITION_INVALID'; END IF;
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_automation_status_insert_guard
        BEFORE INSERT ON qa_automation_attempt_status_revisions
        FOR EACH ROW EXECUTE FUNCTION qa_guard_automation_status_insert();

      CREATE OR REPLACE FUNCTION qa_assert_automation_attempt_integrity() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_id text; attempt_row qa_automation_attempts%ROWTYPE; status_row qa_automation_attempt_status_revisions%ROWTYPE;
        identity_row qa_attempt_identities%ROWTYPE; launch_row qa_automation_launch_requests%ROWTYPE; command_effect text;
      BEGIN
        subject_id := COALESCE(NEW.attempt_id,OLD.attempt_id);
        SELECT * INTO attempt_row FROM qa_automation_attempts WHERE attempt_id=subject_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO identity_row FROM qa_attempt_identities WHERE attempt_id=subject_id;
        SELECT * INTO launch_row FROM qa_automation_launch_requests WHERE launch_request_id=attempt_row.launch_request_id;
        SELECT effect_idempotency_key INTO command_effect FROM connector_commands WHERE id=attempt_row.connector_command_id;
        SELECT * INTO status_row FROM qa_automation_attempt_status_revisions WHERE status_revision_id=attempt_row.current_status_revision_id;
        IF identity_row.mode<>'AUTOMATED' OR identity_row.attempt_no<>attempt_row.attempt_no
          OR identity_row.target_snapshot_hash<>attempt_row.target_snapshot_hash
          OR identity_row.scope_snapshot_hash<>attempt_row.scope_snapshot_hash
          OR launch_row.decision<>'ACCEPTED' OR launch_row.attempt_id<>attempt_row.attempt_id
          OR launch_row.request_key_hash<>attempt_row.request_key_hash OR launch_row.request_hash<>attempt_row.request_hash
          OR launch_row.connector_command_id<>attempt_row.connector_command_id
          OR launch_row.effect_idempotency_key<>attempt_row.effect_idempotency_key
          OR command_effect<>attempt_row.effect_idempotency_key
          OR status_row.attempt_id<>attempt_row.attempt_id OR status_row.revision_no<>attempt_row.current_status_revision_no
          OR status_row.state<>attempt_row.current_status OR status_row.result_id IS DISTINCT FROM attempt_row.terminal_result_id THEN
          RAISE EXCEPTION 'QA_AUTOMATION_ATTEMPT_INTEGRITY_MISMATCH';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_automation_attempt_integrity_guard
        AFTER INSERT OR UPDATE ON qa_automation_attempts
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_attempt_integrity();
      CREATE CONSTRAINT TRIGGER qa_automation_status_integrity_guard
        AFTER INSERT ON qa_automation_attempt_status_revisions
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_attempt_integrity();
      CREATE CONSTRAINT TRIGGER qa_automation_launch_integrity_guard
        AFTER INSERT ON qa_automation_launch_requests
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_attempt_integrity();

      CREATE OR REPLACE FUNCTION qa_assert_automation_terminal_result() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_id text; result_row qa_automation_attempt_results%ROWTYPE; attempt_row qa_automation_attempts%ROWTYPE;
        session_target_hash text; session_scope_hash text;
      BEGIN
        subject_id := COALESCE(
          to_jsonb(NEW)->>'result_id',to_jsonb(NEW)->>'terminal_result_id',
          to_jsonb(OLD)->>'result_id',to_jsonb(OLD)->>'terminal_result_id'
        );
        SELECT * INTO result_row FROM qa_automation_attempt_results WHERE result_id=subject_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO attempt_row FROM qa_automation_attempts WHERE attempt_id=result_row.attempt_id;
        SELECT target_hash,scope_hash INTO session_target_hash,session_scope_hash
          FROM qa_test_sessions WHERE session_id=attempt_row.session_id;
        IF attempt_row.current_status<>'TERMINAL' OR attempt_row.terminal_result_id<>result_row.result_id
          OR result_row.attempt_no<>attempt_row.attempt_no
          OR attempt_row.target_snapshot_hash<>session_target_hash OR attempt_row.scope_snapshot_hash<>session_scope_hash
          OR attempt_row.result_schema_digest<>result_row.result_schema_digest THEN
          RAISE EXCEPTION 'QA_AUTOMATION_TERMINAL_RESULT_MISMATCH';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_automation_result_terminal_guard
        AFTER INSERT ON qa_automation_attempt_results
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_terminal_result();
      CREATE CONSTRAINT TRIGGER qa_automation_attempt_terminal_guard
        AFTER INSERT OR UPDATE ON qa_automation_attempts
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_terminal_result();

      CREATE OR REPLACE FUNCTION qa_assert_result_attempt_content_v2() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE membership_row qa_plan_item_result_attempt_memberships%ROWTYPE; identity_mode text; expected_hash text;
      BEGIN
        SELECT * INTO membership_row FROM qa_plan_item_result_attempt_memberships
          WHERE membership_id=COALESCE(NEW.membership_id,OLD.membership_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT mode INTO identity_mode FROM qa_attempt_identities WHERE attempt_id=membership_row.attempt_id;
        IF identity_mode='MANUAL' THEN
          SELECT content_hash INTO expected_hash FROM qa_manual_attempts WHERE attempt_id=membership_row.attempt_id AND state='COMPLETED';
        ELSE
          SELECT content_hash INTO expected_hash FROM qa_automation_attempt_results WHERE attempt_id=membership_row.attempt_id;
        END IF;
        IF expected_hash IS NULL OR expected_hash<>membership_row.attempt_content_hash THEN
          RAISE EXCEPTION 'QA_RESULT_ATTEMPT_CONTENT_HASH_MISMATCH';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_result_attempt_content_guard_v2
        AFTER INSERT ON qa_plan_item_result_attempt_memberships
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_result_attempt_content_v2();

      CREATE INDEX qa_automation_launch_scope_idx
        ON qa_automation_launch_requests(workspace_id,project_id,session_id,created_at);
      CREATE INDEX qa_automation_attempt_scope_idx
        ON qa_automation_attempts(workspace_id,project_id,session_id,plan_item_id,attempt_no);
      CREATE INDEX qa_automation_attempt_live_head_idx
        ON qa_automation_attempts(workspace_id,project_id,current_status,created_at)
        WHERE current_status<>'TERMINAL';
      CREATE INDEX qa_automation_status_scope_idx
        ON qa_automation_attempt_status_revisions(workspace_id,project_id,attempt_id,revision_no);
      CREATE INDEX qa_automation_result_operations_idx
        ON qa_automation_attempt_results(workspace_id,project_id,technical_outcome,completed_at);
      CREATE INDEX qa_automation_artifact_scope_idx
        ON qa_automation_artifact_memberships(workspace_id,project_id,attempt_id,result_id,ordinal);

      UPDATE platform_schema_versions
        SET version=2055,applied_at=clock_timestamp()
        WHERE namespace='pack:qa';
    `);

    for (const table of [
      "qa_automation_launch_requests",
      "qa_automation_attempt_status_revisions",
      "qa_automation_attempt_results",
      "qa_automation_artifact_memberships",
      "qa_automation_retry_decisions",
    ])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS qa_result_attempt_content_guard_v2 ON qa_plan_item_result_attempt_memberships;
      DROP FUNCTION IF EXISTS qa_assert_result_attempt_content_v2();
      DROP TRIGGER IF EXISTS qa_evidence_owner_kind_v2_guard ON qa_evidence_artifact_links;
      DROP FUNCTION IF EXISTS qa_guard_evidence_owner_kind_v2();
      ALTER TABLE qa_evidence_artifact_links
        DROP CONSTRAINT IF EXISTS qa_evidence_attempt_identity_fk,
        DROP CONSTRAINT IF EXISTS qa_evidence_owner_shape_v2,
        DROP CONSTRAINT IF EXISTS qa_evidence_owner_kind_v2,
        ADD CONSTRAINT qa_evidence_owner_kind_v1 CHECK(owner_kind IN('SESSION','PLAN_ITEM','MANUAL_ATTEMPT','OBSERVATION','FINDING')),
        ADD CONSTRAINT qa_evidence_owner_shape_v1 CHECK(
          (owner_kind='SESSION' AND owner_session_id IS NOT NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind='PLAN_ITEM' AND owner_session_id IS NULL AND owner_plan_item_id IS NOT NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind='MANUAL_ATTEMPT' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NOT NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL)
          OR (owner_kind='OBSERVATION' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NOT NULL AND owner_finding_id IS NULL)
          OR (owner_kind='FINDING' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NOT NULL)
        ),
        ADD CONSTRAINT qa_evidence_manual_attempt_fk
          FOREIGN KEY(owner_attempt_id,workspace_id,project_id)
          REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id);
      ALTER TABLE qa_plan_item_result_attempt_memberships
        DROP CONSTRAINT IF EXISTS qa_result_attempt_identity_fk,
        ADD CONSTRAINT qa_result_manual_attempt_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,plan_item_id,attempt_content_hash)
          REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id,plan_item_id,content_hash)
          DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_observations
        DROP CONSTRAINT IF EXISTS qa_observation_attempt_identity_fk,
        ADD CONSTRAINT qa_observation_manual_attempt_fk
          FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id)
          REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id);

      DROP TRIGGER IF EXISTS qa_automation_attempt_terminal_guard ON qa_automation_attempts;
      DROP TRIGGER IF EXISTS qa_automation_result_terminal_guard ON qa_automation_attempt_results;
      DROP FUNCTION IF EXISTS qa_assert_automation_terminal_result();
      DROP TRIGGER IF EXISTS qa_automation_launch_integrity_guard ON qa_automation_launch_requests;
      DROP TRIGGER IF EXISTS qa_automation_status_integrity_guard ON qa_automation_attempt_status_revisions;
      DROP TRIGGER IF EXISTS qa_automation_attempt_integrity_guard ON qa_automation_attempts;
      DROP FUNCTION IF EXISTS qa_assert_automation_attempt_integrity();
      DROP TRIGGER IF EXISTS qa_automation_status_insert_guard ON qa_automation_attempt_status_revisions;
      DROP FUNCTION IF EXISTS qa_guard_automation_status_insert();
      DROP TRIGGER IF EXISTS qa_automation_attempt_mutation_guard ON qa_automation_attempts;
      DROP FUNCTION IF EXISTS qa_guard_automation_attempt_mutation();
      DROP TRIGGER IF EXISTS qa_automation_attempt_child_guard ON qa_automation_attempts;
      DROP TRIGGER IF EXISTS qa_manual_attempt_child_guard ON qa_manual_attempts;
      DROP TRIGGER IF EXISTS qa_attempt_identity_child_guard ON qa_attempt_identities;
      DROP FUNCTION IF EXISTS qa_assert_attempt_child_v2();

      ALTER TABLE qa_automation_launch_requests DROP CONSTRAINT IF EXISTS qa_launch_accepted_attempt_fk;
      ALTER TABLE qa_automation_attempt_status_revisions DROP CONSTRAINT IF EXISTS qa_automation_status_result_fk;
      ALTER TABLE qa_automation_attempts
        DROP CONSTRAINT IF EXISTS qa_automation_attempt_terminal_result_fk,
        DROP CONSTRAINT IF EXISTS qa_automation_attempt_status_head_fk;
      DROP TABLE qa_automation_retry_decisions;
      DROP TABLE qa_automation_artifact_memberships;
      DROP TABLE qa_automation_attempt_results;
      DROP TABLE qa_automation_attempt_status_revisions;
      DROP TABLE qa_automation_attempts;
      DROP TABLE qa_automation_launch_requests;

      CREATE OR REPLACE FUNCTION qa_assert_plan_item_result_complete() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; attempt_count integer; observation_count integer;
        current_leaf_count integer; negative_attempts integer; covered_negative_attempts integer; pass_sources integer;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO attempt_count FROM qa_plan_item_result_attempt_memberships WHERE result_revision_id=result_row.result_revision_id;
        SELECT count(*) INTO observation_count FROM qa_plan_item_result_observation_memberships WHERE result_revision_id=result_row.result_revision_id;
        IF result_row.result='NOT_RUN' THEN
          IF attempt_count<>0 OR observation_count<>0 OR EXISTS(SELECT 1 FROM qa_manual_attempts WHERE plan_item_id=result_row.plan_item_id)
          THEN RAISE EXCEPTION 'QA_RESULT_NOT_RUN_SET_INVALID'; END IF;
          RETURN NULL;
        END IF;
        IF attempt_count<>result_row.maximum_attempt_no OR attempt_count=0 OR observation_count=0 THEN RAISE EXCEPTION 'QA_RESULT_COMPLETE_SET_INVALID'; END IF;
        IF EXISTS(
          SELECT 1 FROM generate_series(1,result_row.maximum_attempt_no) expected_no
          WHERE NOT EXISTS(
            SELECT 1 FROM qa_plan_item_result_attempt_memberships membership
            JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
            WHERE membership.result_revision_id=result_row.result_revision_id AND attempt.attempt_no=expected_no AND attempt.state='COMPLETED'
          )
        ) THEN RAISE EXCEPTION 'QA_RESULT_ATTEMPT_SEQUENCE_GAPPED'; END IF;
        SELECT count(*) INTO current_leaf_count FROM qa_observations observation
          JOIN qa_plan_item_result_attempt_memberships membership
            ON membership.result_revision_id=result_row.result_revision_id AND membership.attempt_id=observation.attempt_id
          WHERE NOT EXISTS(SELECT 1 FROM qa_observations successor WHERE successor.corrects_observation_id=observation.observation_id);
        IF current_leaf_count<>observation_count THEN RAISE EXCEPTION 'STALE_OBSERVATION_SET'; END IF;
        SELECT count(*) INTO negative_attempts FROM qa_plan_item_result_attempt_memberships membership
          JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND attempt.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE');
        SELECT count(DISTINCT attempt.attempt_id) INTO covered_negative_attempts
          FROM qa_plan_item_result_attempt_memberships membership
          JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
          JOIN qa_plan_item_result_observation_memberships observation_membership
            ON observation_membership.result_revision_id=membership.result_revision_id AND observation_membership.attempt_id=attempt.attempt_id
          JOIN qa_observations observation ON observation.observation_id=observation_membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND attempt.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE') AND observation.kind IN('NEGATIVE','AMBIGUOUS');
        IF negative_attempts<>covered_negative_attempts THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        IF result_row.result IN('FAIL','BLOCKED','INCONCLUSIVE') AND NOT EXISTS(
          SELECT 1 FROM qa_plan_item_result_observation_memberships membership
          JOIN qa_observations observation ON observation.observation_id=membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND observation.kind IN('NEGATIVE','AMBIGUOUS')
        ) THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        SELECT count(*) INTO pass_sources FROM qa_plan_item_result_observation_memberships membership
          JOIN qa_observations observation ON observation.observation_id=membership.observation_id
          JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND observation.kind='POSITIVE' AND attempt.result='PASS';
        IF result_row.result='PASS' AND pass_sources=0 THEN RAISE EXCEPTION 'QA_RESULT_PASS_SOURCE_REQUIRED'; END IF;
        IF EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships membership JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id WHERE membership.result_revision_id=result_row.result_revision_id AND attempt.result='ASSERTION_FAILED')
          AND EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships membership JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id WHERE membership.result_revision_id=result_row.result_revision_id AND attempt.result='PASS') THEN
          IF NOT(result_row.review_flags ? 'FLAKY_SUSPECTED') THEN RAISE EXCEPTION 'QA_FLAKY_FLAG_REQUIRED'; END IF;
          IF result_row.result NOT IN('INCONCLUSIVE','PASS') OR (result_row.result='PASS' AND result_row.flaky_finding_id IS NULL)
          THEN RAISE EXCEPTION 'QA_FLAKY_DISPOSITION_BASIS_REQUIRED'; END IF;
        END IF;
        RETURN NULL;
      END;$qa$;

      CREATE OR REPLACE FUNCTION qa_assert_attempt_lineage_decision() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; failed_count integer; covered_count integer;
        review_stage text; review_hash text;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND OR result_row.result<>'PASS' OR NOT(result_row.review_flags ? 'FLAKY_SUSPECTED') THEN RETURN NULL; END IF;
        SELECT stage,active_membership_set_hash INTO review_stage,review_hash FROM qa_finding_review_revisions
          WHERE finding_review_revision_id=result_row.flaky_disposed_review_id AND finding_id=result_row.flaky_finding_id
            AND version=result_row.flaky_disposed_review_version AND content_hash=result_row.flaky_disposed_review_content_hash;
        IF review_stage IS DISTINCT FROM 'DISPOSED' OR review_hash IS DISTINCT FROM result_row.flaky_membership_set_hash
        THEN RAISE EXCEPTION 'QA_FLAKY_FINDING_BASIS_STALE'; END IF;
        SELECT count(*) INTO failed_count FROM qa_plan_item_result_attempt_memberships membership
          JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND attempt.result='ASSERTION_FAILED';
        SELECT count(DISTINCT membership.failed_attempt_id) INTO covered_count
          FROM qa_plan_item_result_flaky_observation_memberships membership
          JOIN qa_observations observation ON observation.observation_id=membership.observation_id AND observation.attempt_id=membership.failed_attempt_id
          JOIN qa_finding_observations finding_membership ON finding_membership.membership_id=membership.finding_membership_id
            AND finding_membership.finding_id=membership.finding_id AND finding_membership.observation_id=membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND membership.finding_id=result_row.flaky_finding_id
            AND observation.kind IN('NEGATIVE','AMBIGUOUS') AND finding_membership.state='ACTIVE';
        IF failed_count=0 OR failed_count<>covered_count THEN RAISE EXCEPTION 'QA_FLAKY_FINDING_COVERAGE_INVALID'; END IF;
        RETURN NULL;
      END;$qa$;

      CREATE OR REPLACE FUNCTION qa_assert_negative_evidence_membership() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; result_evidence_count integer; uncovered_attempts integer;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO result_evidence_count FROM qa_plan_item_result_evidence_memberships WHERE result_revision_id=result_row.result_revision_id;
        IF result_row.result IN('FAIL','BLOCKED','INCONCLUSIVE') AND result_evidence_count=0 THEN RAISE EXCEPTION 'QA_RESULT_EVIDENCE_REQUIRED'; END IF;
        SELECT count(*) INTO uncovered_attempts FROM qa_plan_item_result_attempt_memberships membership
          JOIN qa_manual_attempts attempt ON attempt.attempt_id=membership.attempt_id
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND attempt.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE')
            AND NOT EXISTS(
              SELECT 1 FROM qa_evidence_artifact_links evidence
              WHERE evidence.workspace_id=attempt.workspace_id AND evidence.project_id=attempt.project_id
                AND evidence.session_id=attempt.session_id AND evidence.owner_kind='MANUAL_ATTEMPT' AND evidence.owner_attempt_id=attempt.attempt_id
            );
        IF uncovered_attempts>0 THEN RAISE EXCEPTION 'QA_ATTEMPT_EVIDENCE_REQUIRED'; END IF;
        RETURN NULL;
      END;$qa$;
      DROP FUNCTION IF EXISTS qa_attempt_terminal_outcome_v2(text);
      UPDATE platform_schema_versions SET version=2050,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

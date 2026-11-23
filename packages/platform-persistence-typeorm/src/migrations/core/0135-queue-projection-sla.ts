import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0135QueueProjectionSla1700000000135 implements MigrationInterface {
  readonly name = "M0135QueueProjectionSla1700000000135";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE queue_projection_generations (
        generation_id uuid NOT NULL, workspace_id uuid NOT NULL,
        state text NOT NULL CHECK(state IN ('BUILDING','VALIDATING','ACTIVE','SUPERSEDED','FAILED')),
        source_high_watermarks jsonb NOT NULL, input_set_hash text NOT NULL, output_set_hash text NULL,
        subject_count bigint NOT NULL DEFAULT 0 CHECK(subject_count >= 0), stage_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
        started_at timestamptz NOT NULL, validated_at timestamptz NULL, activated_at timestamptz NULL,
        failed_at timestamptz NULL, failure_code text NULL,
        PRIMARY KEY(generation_id), UNIQUE(workspace_id,generation_id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE UNIQUE INDEX queue_projection_one_active_idx ON queue_projection_generations(workspace_id) WHERE state='ACTIVE';
      CREATE UNIQUE INDEX queue_projection_one_building_idx ON queue_projection_generations(workspace_id) WHERE state IN ('BUILDING','VALIDATING');

      CREATE TABLE queue_entry_heads (
        queue_entry_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        subject_kind text NOT NULL CHECK(subject_kind IN ('CANDIDATE','DRAFT','WORK_ITEM')),
        candidate_id uuid NULL, draft_id uuid NULL, work_item_id uuid NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0 CHECK(resource_version >= 0),
        next_temporal_evaluation_at timestamptz NULL, suppressed_by_work_item_id uuid NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(queue_entry_id), UNIQUE(workspace_id,project_id,queue_entry_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK(num_nonnulls(candidate_id,draft_id,work_item_id)=1),
        CHECK((subject_kind='CANDIDATE' AND candidate_id IS NOT NULL) OR (subject_kind='DRAFT' AND draft_id IS NOT NULL) OR (subject_kind='WORK_ITEM' AND work_item_id IS NOT NULL))
      );
      CREATE UNIQUE INDEX queue_entry_candidate_live_idx ON queue_entry_heads(workspace_id,project_id,candidate_id) WHERE candidate_id IS NOT NULL AND suppressed_by_work_item_id IS NULL;
      CREATE UNIQUE INDEX queue_entry_draft_live_idx ON queue_entry_heads(workspace_id,project_id,draft_id) WHERE draft_id IS NOT NULL AND suppressed_by_work_item_id IS NULL;
      CREATE UNIQUE INDEX queue_entry_work_item_live_idx ON queue_entry_heads(workspace_id,project_id,work_item_id) WHERE work_item_id IS NOT NULL AND suppressed_by_work_item_id IS NULL;
      CREATE INDEX queue_entry_temporal_due_idx ON queue_entry_heads(next_temporal_evaluation_at,workspace_id,project_id) WHERE next_temporal_evaluation_at IS NOT NULL AND suppressed_by_work_item_id IS NULL;

      CREATE TABLE queue_entry_revisions (
        queue_entry_revision_id uuid NOT NULL, queue_entry_id uuid NOT NULL, generation_id uuid NOT NULL,
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, revision_number bigint NOT NULL CHECK(revision_number >= 1),
        previous_revision_id uuid NULL, subject_kind text NOT NULL, subject_ref jsonb NOT NULL,
        stage text NOT NULL CHECK(stage IN ('CANDIDATE','BACKLOG','READY','ACTIVE','COMPLETED')),
        stage_details jsonb NOT NULL, stage_reason_codes jsonb NOT NULL,
        operational_facet jsonb NOT NULL, qa_facet jsonb NOT NULL, control_facet jsonb NOT NULL,
        capacity_facet jsonb NOT NULL, sla_facet jsonb NOT NULL, ordering_facet jsonb NOT NULL,
        consistency_warnings jsonb NOT NULL, freshness jsonb NOT NULL,
        source_refs jsonb NOT NULL, source_set_hash text NOT NULL, policy_facet_ref jsonb NOT NULL,
        derivation_rule_ref jsonb NOT NULL, input_fingerprint text NOT NULL, calculated_at timestamptz NOT NULL,
        reconciled_at timestamptz NULL, semantic_hash text NOT NULL,
        PRIMARY KEY(queue_entry_revision_id), UNIQUE(workspace_id,project_id,queue_entry_id,revision_number),
        UNIQUE(workspace_id,project_id,queue_entry_id,generation_id,semantic_hash),
        FOREIGN KEY(workspace_id,project_id,queue_entry_id) REFERENCES queue_entry_heads(workspace_id,project_id,queue_entry_id),
        FOREIGN KEY(workspace_id,generation_id) REFERENCES queue_projection_generations(workspace_id,generation_id)
      );
      CREATE INDEX queue_entry_stage_order_idx ON queue_entry_revisions(workspace_id,project_id,stage,calculated_at,queue_entry_id);
      CREATE TRIGGER queue_entry_revisions_append_only BEFORE UPDATE OR DELETE ON queue_entry_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE sla_clock_heads (
        sla_clock_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        goal text NOT NULL CHECK(goal IN ('READY_TO_FIRST_QA_START','READY_TO_SIGNED_VERDICT')),
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0, current_clock_cycle integer NOT NULL DEFAULT 0,
        next_temporal_evaluation_at timestamptz NULL,
        temporal_claim_token uuid NULL, temporal_claimed_until timestamptz NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(sla_clock_id), UNIQUE(workspace_id,project_id,sla_clock_id), UNIQUE(workspace_id,project_id,work_item_id,goal),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK(resource_version >= 0), CHECK(current_clock_cycle >= 0)
      );
      CREATE INDEX sla_clock_temporal_due_idx ON sla_clock_heads(next_temporal_evaluation_at,workspace_id,project_id) WHERE next_temporal_evaluation_at IS NOT NULL;
      CREATE TABLE sla_clock_revisions (
        sla_clock_revision_id uuid NOT NULL, sla_clock_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        transition_kind text NOT NULL CHECK(transition_kind IN ('START','PAUSE','RESUME','STOP')),
        state text NOT NULL CHECK(state IN ('RUNNING','PAUSED','STOPPED')),
        goal text NOT NULL, clock_cycle integer NOT NULL CHECK(clock_cycle >= 1), calendar_ref jsonb NOT NULL, policy_ref jsonb NOT NULL, start_source_ref jsonb NOT NULL,
        transition_source_ref jsonb NOT NULL, target_business_seconds bigint NULL, warning_thresholds jsonb NOT NULL,
        accumulated_business_seconds bigint NOT NULL CHECK(accumulated_business_seconds >= 0),
        last_started_at timestamptz NULL, stopped_at timestamptz NULL, public_transition jsonb NOT NULL,
        input_fingerprint text NOT NULL, semantic_hash text NOT NULL, recorded_at timestamptz NOT NULL,
        PRIMARY KEY(sla_clock_revision_id), UNIQUE(workspace_id,project_id,sla_clock_id,revision_number),
        FOREIGN KEY(workspace_id,project_id,sla_clock_id) REFERENCES sla_clock_heads(workspace_id,project_id,sla_clock_id)
      );
      CREATE TRIGGER sla_clock_revisions_append_only BEFORE UPDATE OR DELETE ON sla_clock_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TABLE sla_clock_segment_heads (
        segment_id uuid NOT NULL, sla_clock_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        clock_cycle integer NOT NULL CHECK(clock_cycle >= 1), ordinal integer NOT NULL CHECK(ordinal >= 1), state text NOT NULL CHECK(state IN ('RUNNING','PAUSED')),
        current_revision_id uuid NOT NULL, resource_version bigint NOT NULL DEFAULT 1, is_open boolean NOT NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(segment_id), UNIQUE(workspace_id,project_id,segment_id), UNIQUE(workspace_id,project_id,sla_clock_id,ordinal),
        FOREIGN KEY(workspace_id,project_id,sla_clock_id) REFERENCES sla_clock_heads(workspace_id,project_id,sla_clock_id),
        CHECK(resource_version >= 1)
      );
      CREATE UNIQUE INDEX sla_clock_one_open_segment_idx ON sla_clock_segment_heads(workspace_id,project_id,sla_clock_id) WHERE is_open;
      CREATE TABLE sla_clock_segments (
        segment_revision_id uuid NOT NULL, segment_id uuid NOT NULL, sla_clock_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        revision_number integer NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        clock_cycle integer NOT NULL CHECK(clock_cycle >= 1), ordinal integer NOT NULL CHECK(ordinal >= 1), state text NOT NULL CHECK(state IN ('RUNNING','PAUSED')),
        started_at timestamptz NOT NULL, ended_at timestamptz NULL, start_revision_id uuid NOT NULL, end_revision_id uuid NULL,
        business_seconds bigint NOT NULL CHECK(business_seconds >= 0), semantic_hash text NOT NULL,
        PRIMARY KEY(segment_revision_id), UNIQUE(workspace_id,project_id,segment_id,revision_number),
        FOREIGN KEY(workspace_id,project_id,segment_id) REFERENCES sla_clock_segment_heads(workspace_id,project_id,segment_id),
        CHECK(ended_at IS NULL OR ended_at >= started_at)
      );
      CREATE TRIGGER sla_clock_segments_append_only BEFORE UPDATE OR DELETE ON sla_clock_segments FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE sla_threshold_emissions (
        emission_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, sla_clock_id uuid NOT NULL,
        clock_cycle integer NOT NULL CHECK(clock_cycle >= 1), policy_facet_hash text NOT NULL,
        clock_revision_ref jsonb NOT NULL, threshold_key text NOT NULL, threshold_kind text NOT NULL CHECK(threshold_kind IN ('WARNING','BREACH')),
        reached_at timestamptz NOT NULL, notification_intent_id text NULL, notification_creation_hash text NULL,
        payload jsonb NOT NULL, semantic_hash text NOT NULL,
        PRIMARY KEY(emission_id), UNIQUE(workspace_id,project_id,sla_clock_id,clock_cycle,policy_facet_hash,threshold_kind,threshold_key),
        FOREIGN KEY(workspace_id,project_id,sla_clock_id) REFERENCES sla_clock_heads(workspace_id,project_id,sla_clock_id)
      );
      CREATE TRIGGER sla_threshold_emissions_append_only BEFORE UPDATE OR DELETE ON sla_threshold_emissions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE sla_rollout_verification_receipts (
        receipt_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        goal text NOT NULL CHECK(goal IN ('READY_TO_FIRST_QA_START','READY_TO_SIGNED_VERDICT')),
        policy_enable_epoch_hash text NOT NULL, policy_ref jsonb NOT NULL, calendar_ref jsonb NOT NULL, mapping_ref jsonb NOT NULL,
        operational_projection_ref jsonb NOT NULL, external_revision_token text NOT NULL, authority_fields_hash text NOT NULL,
        observed_normalized_status text NOT NULL, provider_observed_at timestamptz NOT NULL, verifier_run_ref jsonb NOT NULL,
        reducer_disposition text NOT NULL CHECK(reducer_disposition='DUPLICATE'), confirmed_at timestamptz NOT NULL,
        public_receipt jsonb NOT NULL, semantic_hash text NOT NULL,
        PRIMARY KEY(receipt_id), UNIQUE(workspace_id,project_id,receipt_id),
        UNIQUE(workspace_id,project_id,work_item_id,goal,policy_enable_epoch_hash),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TRIGGER sla_rollout_verification_append_only BEFORE UPDATE OR DELETE ON sla_rollout_verification_receipts FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=135,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE sla_rollout_verification_receipts;
      DROP TABLE sla_threshold_emissions;
      DROP TABLE sla_clock_segments;
      DROP TABLE sla_clock_segment_heads;
      DROP TABLE sla_clock_revisions;
      DROP TABLE sla_clock_heads;
      DROP TABLE queue_entry_revisions;
      DROP TABLE queue_entry_heads;
      DROP TABLE queue_projection_generations;
      UPDATE platform_schema_versions SET version=130,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}

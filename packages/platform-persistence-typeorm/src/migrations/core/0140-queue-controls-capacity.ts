import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0140QueueControlsCapacity1700000000140 implements MigrationInterface {
  readonly name = "M0140QueueControlsCapacity1700000000140";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE approvals ADD COLUMN subject_schema_id text NOT NULL DEFAULT 'urn:awp:contracts:commands:approval-subject:v1';
      ALTER TABLE approvals ADD COLUMN subject_schema_version integer NOT NULL DEFAULT 1 CHECK(subject_schema_version IN (1,2));

      CREATE TABLE work_item_queue_control_heads (
        control_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0 CHECK(resource_version >= 0),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(control_id), UNIQUE(workspace_id,project_id,control_id), UNIQUE(workspace_id,project_id,work_item_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE work_item_queue_control_revisions (
        control_revision_id uuid NOT NULL, control_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        service_class text NOT NULL CHECK(service_class IN ('STANDARD','FIXED_DATE','EXPEDITE')),
        planning_values jsonb NOT NULL, accepted_source_refs jsonb NOT NULL, dependency_source_set_hash text NOT NULL,
        expiry_at timestamptz NULL, accepted_action_ref jsonb NOT NULL, reason text NOT NULL,
        semantic_hash text NOT NULL, recorded_at timestamptz NOT NULL, recorded_by uuid NOT NULL REFERENCES identities(id),
        PRIMARY KEY(control_revision_id), UNIQUE(workspace_id,project_id,control_id,revision_number),
        FOREIGN KEY(workspace_id,project_id,control_id) REFERENCES work_item_queue_control_heads(workspace_id,project_id,control_id)
      );
      CREATE TRIGGER work_item_queue_control_revisions_append_only BEFORE UPDATE OR DELETE ON work_item_queue_control_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE queue_order_scope_heads (
        order_scope_id uuid NOT NULL, workspace_id uuid NOT NULL, scope_kind text NOT NULL CHECK(scope_kind IN ('PROJECT','AUTHORIZED_PORTFOLIO')),
        project_id uuid NULL, authorized_project_set_hash text NOT NULL, current_revision bigint NOT NULL DEFAULT 0,
        resource_version bigint NOT NULL DEFAULT 0, queue_epoch bigint NOT NULL DEFAULT 1 CHECK(queue_epoch >= 1),
        base_visible_set_hash text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(order_scope_id), UNIQUE(workspace_id,order_scope_id),
        CHECK((scope_kind='PROJECT' AND project_id IS NOT NULL) OR (scope_kind='AUTHORIZED_PORTFOLIO' AND project_id IS NULL)),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE UNIQUE INDEX queue_order_project_scope_idx ON queue_order_scope_heads(workspace_id,project_id) WHERE scope_kind='PROJECT';
      CREATE UNIQUE INDEX queue_order_portfolio_scope_idx ON queue_order_scope_heads(workspace_id,authorized_project_set_hash) WHERE scope_kind='AUTHORIZED_PORTFOLIO';
      CREATE TABLE queue_order_scope_projects (
        workspace_id uuid NOT NULL, order_scope_id uuid NOT NULL, project_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,order_scope_id,project_id),
        FOREIGN KEY(workspace_id,order_scope_id) REFERENCES queue_order_scope_heads(workspace_id,order_scope_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX queue_order_scope_project_reverse_idx ON queue_order_scope_projects(workspace_id,project_id,order_scope_id);
      CREATE TABLE queue_order_overrides (
        override_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, order_scope_id uuid NOT NULL,
        work_item_id uuid NOT NULL, move_sequence bigint NOT NULL CHECK(move_sequence >= 1), placement text NOT NULL CHECK(placement IN ('FIRST','LAST','BEFORE','AFTER')),
        anchor_project_id uuid NULL, anchor_work_item_id uuid NULL, queue_epoch bigint NOT NULL,
        base_visible_set_hash text NOT NULL, action_candidate_ref jsonb NOT NULL, semantic_hash text NOT NULL,
        effective_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, superseded_at timestamptz NULL,
        PRIMARY KEY(override_id), UNIQUE(workspace_id,project_id,override_id), UNIQUE(workspace_id,order_scope_id,move_sequence),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(workspace_id,order_scope_id) REFERENCES queue_order_scope_heads(workspace_id,order_scope_id),
        CHECK(expires_at > effective_at),
        CHECK((placement IN ('BEFORE','AFTER') AND anchor_project_id IS NOT NULL AND anchor_work_item_id IS NOT NULL)
          OR (placement IN ('FIRST','LAST') AND anchor_project_id IS NULL AND anchor_work_item_id IS NULL))
      );
      CREATE INDEX queue_order_override_effective_idx ON queue_order_overrides(workspace_id,order_scope_id,effective_at,expires_at);
      CREATE TRIGGER queue_order_overrides_append_only BEFORE UPDATE OR DELETE ON queue_order_overrides FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE queue_order_invalidation_heads (
        invalidation_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(invalidation_id), UNIQUE(workspace_id,project_id,invalidation_id), UNIQUE(workspace_id,project_id,work_item_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE queue_order_invalidation_revisions (
        invalidation_revision_id uuid NOT NULL, invalidation_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        reason_code text NOT NULL, source_ref jsonb NOT NULL, occurred_at timestamptz NOT NULL, semantic_hash text NOT NULL,
        PRIMARY KEY(invalidation_revision_id), UNIQUE(workspace_id,project_id,invalidation_id,revision_number),
        FOREIGN KEY(workspace_id,project_id,invalidation_id) REFERENCES queue_order_invalidation_heads(workspace_id,project_id,invalidation_id)
      );
      CREATE TRIGGER queue_order_invalidation_revisions_append_only BEFORE UPDATE OR DELETE ON queue_order_invalidation_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE queue_action_candidates (
        action_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        action_kind text NOT NULL CHECK(action_kind IN ('QUEUE_CONTROL_ACCEPT','QUEUE_ORDER_OVERRIDE','SERVICE_CLASS_EXPEDITE','EXPEDITE_CAPACITY_OVERRIDE','WIP_ADMISSION_OVERRIDE')),
        public_schema_id text NOT NULL, public_schema_version integer NOT NULL CHECK(public_schema_version=1),
        public_candidate jsonb NOT NULL, public_intent_hash text NOT NULL,
        private_schema_id text NOT NULL, private_schema_version integer NOT NULL CHECK(private_schema_version=1),
        private_witness jsonb NOT NULL, action_hash text NOT NULL,
        initiator_authorization_basis jsonb NOT NULL, initiator_authorization_basis_hash text NOT NULL,
        expires_at timestamptz NULL, created_at timestamptz NOT NULL,
        PRIMARY KEY(action_id), UNIQUE(workspace_id,project_id,action_id),
        FOREIGN KEY(workspace_id,project_id,action_id) REFERENCES platform_actions(workspace_id,project_id,id),
        CHECK(public_schema_id='urn:awp:schemas:006:queue-action-candidate:v1'),
        CHECK(private_schema_id='urn:awp:schemas:006:queue-control-action:v1')
      );
      CREATE TRIGGER queue_action_candidates_append_only BEFORE UPDATE OR DELETE ON queue_action_candidates FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE workspace_capacity_heads (
        capacity_head_id uuid NOT NULL, workspace_id uuid NOT NULL, current_revision bigint NOT NULL DEFAULT 0,
        resource_version bigint NOT NULL DEFAULT 0, policy_ref jsonb NOT NULL, state text NOT NULL CHECK(state IN ('MEASURE_ONLY','ENFORCED','REBUILDING','ERROR')),
        human_occupied_count integer NOT NULL DEFAULT 0 CHECK(human_occupied_count >= 0),
        review_reserved_count integer NOT NULL DEFAULT 0 CHECK(review_reserved_count >= 0),
        human_committed_count integer NOT NULL DEFAULT 0 CHECK(human_committed_count >= 0),
        forced_external_count integer NOT NULL DEFAULT 0 CHECK(forced_external_count >= 0),
        active_expedite_count integer NOT NULL DEFAULT 0 CHECK(active_expedite_count >= 0),
        claim_set_hash text NOT NULL, reservation_set_hash text NOT NULL, expedite_set_hash text NOT NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(capacity_head_id), UNIQUE(workspace_id,capacity_head_id), UNIQUE(workspace_id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE workspace_capacity_reconciliation_checkpoints (
        checkpoint_id uuid NOT NULL, workspace_id uuid NOT NULL, policy_ref jsonb NOT NULL,
        projection_generation_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('RUNNING','BLOCKED','PASSED')),
        cursor_work_item_id uuid NULL, subject_count integer NOT NULL DEFAULT 0 CHECK(subject_count >= 0),
        reconciled_count integer NOT NULL DEFAULT 0 CHECK(reconciled_count >= 0),
        skipped_count integer NOT NULL DEFAULT 0 CHECK(skipped_count >= 0), failure_code text NULL,
        started_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, validated_at timestamptz NULL,
        PRIMARY KEY(checkpoint_id), UNIQUE(workspace_id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE capacity_scope_projection_heads (
        capacity_projection_id uuid NOT NULL, workspace_id uuid NOT NULL, scope_kind text NOT NULL CHECK(scope_kind IN ('PROJECT','AUTHORIZED_PORTFOLIO')),
        project_id uuid NULL, authorized_project_set_hash text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0, reconciled_capacity_version bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(capacity_projection_id), UNIQUE(workspace_id,capacity_projection_id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK((scope_kind='PROJECT' AND project_id IS NOT NULL) OR (scope_kind='AUTHORIZED_PORTFOLIO' AND project_id IS NULL))
      );
      CREATE UNIQUE INDEX capacity_projection_project_scope_idx ON capacity_scope_projection_heads(workspace_id,project_id) WHERE scope_kind='PROJECT';
      CREATE UNIQUE INDEX capacity_projection_portfolio_scope_idx ON capacity_scope_projection_heads(workspace_id,authorized_project_set_hash) WHERE scope_kind='AUTHORIZED_PORTFOLIO';
      CREATE TABLE capacity_scope_projection_revisions (
        capacity_projection_revision_id uuid NOT NULL, capacity_projection_id uuid NOT NULL, workspace_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        authorized_project_set_hash text NOT NULL, policy_facet_ref jsonb NOT NULL,
        human_occupied_count integer NOT NULL CHECK(human_occupied_count >= 0), review_reserved_count integer NOT NULL CHECK(review_reserved_count >= 0),
        human_committed_count integer NOT NULL CHECK(human_committed_count >= 0), forced_external_count integer NOT NULL CHECK(forced_external_count >= 0),
        active_expedite_count integer NOT NULL CHECK(active_expedite_count >= 0), safe_body jsonb NOT NULL,
        semantic_hash text NOT NULL, recorded_at timestamptz NOT NULL,
        PRIMARY KEY(capacity_projection_revision_id), UNIQUE(workspace_id,capacity_projection_id,revision_number),
        UNIQUE(workspace_id,capacity_projection_id,semantic_hash),
        FOREIGN KEY(workspace_id,capacity_projection_id) REFERENCES capacity_scope_projection_heads(workspace_id,capacity_projection_id)
      );
      CREATE TRIGGER capacity_scope_projection_revisions_append_only BEFORE UPDATE OR DELETE ON capacity_scope_projection_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TABLE capacity_scope_projection_projects (
        workspace_id uuid NOT NULL, capacity_projection_id uuid NOT NULL, project_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,capacity_projection_id,project_id),
        FOREIGN KEY(workspace_id,capacity_projection_id) REFERENCES capacity_scope_projection_heads(workspace_id,capacity_projection_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX capacity_scope_project_reverse_idx ON capacity_scope_projection_projects(workspace_id,project_id,capacity_projection_id);

      CREATE TABLE work_item_human_wip_claims (
        claim_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL, session_ids jsonb NOT NULL,
        state text NOT NULL CHECK(state IN ('ACTIVE','RELEASED_BLOCK','RELEASED_TERMINAL')),
        source_ref jsonb NOT NULL, cause_set jsonb NOT NULL, cause_set_hash text NOT NULL, acquired_at timestamptz NOT NULL, released_at timestamptz NULL,
        semantic_hash text NOT NULL, PRIMARY KEY(claim_id), UNIQUE(workspace_id,project_id,claim_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(previous_revision_id) REFERENCES work_item_human_wip_claims(claim_id),
        UNIQUE(workspace_id,project_id,work_item_id,revision_number),
        CHECK((state='ACTIVE' AND released_at IS NULL) OR (state IN ('RELEASED_BLOCK','RELEASED_TERMINAL') AND released_at IS NOT NULL))
      );
      CREATE INDEX human_wip_claim_current_idx ON work_item_human_wip_claims(workspace_id,project_id,work_item_id,revision_number DESC);
      CREATE TRIGGER work_item_human_wip_claims_append_only BEFORE UPDATE OR DELETE ON work_item_human_wip_claims FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE review_capacity_reservations (
        reservation_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL, session_ids jsonb NOT NULL,
        state text NOT NULL CHECK(state IN ('HELD','COVERED_BY_CLAIM','CONVERTED','RELEASED')),
        source_ref jsonb NOT NULL, cause_set jsonb NOT NULL, cause_set_hash text NOT NULL, reserved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, completed_at timestamptz NULL,
        semantic_hash text NOT NULL, PRIMARY KEY(reservation_id), UNIQUE(workspace_id,project_id,reservation_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(previous_revision_id) REFERENCES review_capacity_reservations(reservation_id),
        UNIQUE(workspace_id,project_id,work_item_id,revision_number), CHECK(expires_at > reserved_at),
        CHECK((state IN ('HELD','COVERED_BY_CLAIM') AND completed_at IS NULL) OR (state IN ('CONVERTED','RELEASED') AND completed_at IS NOT NULL))
      );
      CREATE INDEX review_reservation_current_idx ON review_capacity_reservations(workspace_id,project_id,work_item_id,revision_number DESC);
      CREATE INDEX review_reservation_expiry_idx ON review_capacity_reservations(workspace_id,expires_at,revision_number DESC);
      CREATE TRIGGER review_capacity_reservations_append_only BEFORE UPDATE OR DELETE ON review_capacity_reservations FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE capacity_admission_decisions (
        decision_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        request_key_hash text NOT NULL, request_hash text NOT NULL, activity_kind text NOT NULL,
        outcome text NOT NULL CHECK(outcome IN ('ADMITTED','DENIED','ADMITTED_WITH_EXACT_OVERRIDE','NON_DISCRETIONARY_APPLIED','NON_DISCRETIONARY_OVERFLOW','NO_CHANGE')),
        policy_facet_ref jsonb NOT NULL, authorization_scope_witness_hash text NOT NULL,
        before_ref jsonb NOT NULL, after_ref jsonb NOT NULL, action_candidate_ref jsonb NULL, approval_ref jsonb NULL,
        committed_effect_refs jsonb NOT NULL, violations jsonb NOT NULL, warnings jsonb NOT NULL,
        decided_at timestamptz NOT NULL, semantic_hash text NOT NULL,
        PRIMARY KEY(decision_id), UNIQUE(workspace_id,project_id,decision_id), UNIQUE(workspace_id,project_id,request_key_hash),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX capacity_admission_work_item_idx ON capacity_admission_decisions(workspace_id,project_id,work_item_id,decided_at DESC);
      CREATE TRIGGER capacity_admission_decisions_append_only BEFORE UPDATE OR DELETE ON capacity_admission_decisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=140,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE capacity_admission_decisions;
      DROP TABLE review_capacity_reservations;
      DROP TABLE work_item_human_wip_claims;
      DROP TABLE capacity_scope_projection_projects;
      DROP TABLE capacity_scope_projection_revisions;
      DROP TABLE capacity_scope_projection_heads;
      DROP TABLE workspace_capacity_reconciliation_checkpoints;
      DROP TABLE workspace_capacity_heads;
      DROP TABLE queue_action_candidates;
      DROP TABLE queue_order_invalidation_revisions;
      DROP TABLE queue_order_invalidation_heads;
      DROP TABLE queue_order_overrides;
      DROP TABLE queue_order_scope_projects;
      DROP TABLE queue_order_scope_heads;
      DROP TABLE work_item_queue_control_revisions;
      DROP TABLE work_item_queue_control_heads;
      ALTER TABLE approvals DROP COLUMN subject_schema_version;
      ALTER TABLE approvals DROP COLUMN subject_schema_id;
      UPDATE platform_schema_versions SET version=135,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}

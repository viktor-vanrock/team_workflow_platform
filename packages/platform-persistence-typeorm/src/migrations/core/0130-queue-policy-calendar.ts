import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0130QueuePolicyCalendar1700000000130 implements MigrationInterface {
  readonly name = "M0130QueuePolicyCalendar1700000000130";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE workspace_business_calendar_heads (
        calendar_id uuid NOT NULL, workspace_id uuid NOT NULL, calendar_key text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0 CHECK(resource_version >= 0),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(calendar_id), UNIQUE(workspace_id,calendar_id), UNIQUE(workspace_id,calendar_key),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE workspace_business_calendar_revisions (
        calendar_revision_id uuid NOT NULL, calendar_id uuid NOT NULL, workspace_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        time_zone text NOT NULL, weekly_intervals jsonb NOT NULL, date_overrides jsonb NOT NULL,
        valid_from date NOT NULL, valid_through date NULL, dst_algorithm_ref jsonb NOT NULL, dst_rules jsonb NOT NULL,
        source_kind text NOT NULL CHECK(source_kind IN ('MANUAL','ICS_IMPORT')),
        source_ref text NOT NULL, source_hash text NOT NULL, owner_principal_id uuid NOT NULL REFERENCES identities(id),
        effective_from timestamptz NOT NULL, published_at timestamptz NOT NULL, published_by uuid NOT NULL REFERENCES identities(id),
        semantic_hash text NOT NULL CHECK(semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(calendar_revision_id), UNIQUE(workspace_id,calendar_revision_id), UNIQUE(workspace_id,calendar_id,calendar_revision_id), UNIQUE(workspace_id,calendar_id,revision_number),
        FOREIGN KEY(workspace_id,calendar_id) REFERENCES workspace_business_calendar_heads(workspace_id,calendar_id),
        CHECK(valid_through IS NULL OR valid_through >= valid_from), CHECK(jsonb_typeof(weekly_intervals)='array'), CHECK(jsonb_typeof(date_overrides)='array')
      );
      CREATE INDEX workspace_business_calendar_effective_idx ON workspace_business_calendar_revisions(workspace_id,calendar_id,effective_from DESC);
      CREATE TRIGGER workspace_business_calendar_revisions_append_only BEFORE UPDATE OR DELETE ON workspace_business_calendar_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE workspace_queue_policy_heads (
        queue_policy_id uuid NOT NULL, workspace_id uuid NOT NULL, policy_key text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0 CHECK(resource_version >= 0),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(queue_policy_id), UNIQUE(workspace_id,queue_policy_id), UNIQUE(workspace_id,policy_key),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE workspace_queue_policy_revisions (
        policy_revision_id uuid NOT NULL, queue_policy_id uuid NOT NULL, workspace_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        mode text NOT NULL CHECK(mode IN ('MEASURE_ONLY','ENFORCED')),
        calendar_revision_id uuid NOT NULL, calendar_semantic_hash text NOT NULL,
        comparator_ref jsonb NOT NULL, stage_rule_ref jsonb NOT NULL, status_mapping_ref jsonb NOT NULL,
        service_class_rules jsonb NOT NULL, workspace_human_wip_limit integer NULL, active_expedite_limit integer NULL,
        external_active_consumes_wip jsonb NOT NULL, block_reason_rules jsonb NOT NULL, sla_goals jsonb NOT NULL,
        aging_bands jsonb NOT NULL, project_entries jsonb NOT NULL, baseline_evidence_ref jsonb NULL,
        effective_from timestamptz NOT NULL, published_at timestamptz NOT NULL, published_by uuid NOT NULL REFERENCES identities(id),
        semantic_hash text NOT NULL CHECK(semantic_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(policy_revision_id), UNIQUE(workspace_id,queue_policy_id,policy_revision_id), UNIQUE(workspace_id,queue_policy_id,revision_number),
        FOREIGN KEY(workspace_id,queue_policy_id) REFERENCES workspace_queue_policy_heads(workspace_id,queue_policy_id),
        FOREIGN KEY(workspace_id,calendar_revision_id) REFERENCES workspace_business_calendar_revisions(workspace_id,calendar_revision_id),
        CHECK((mode='MEASURE_ONLY' AND workspace_human_wip_limit IS NULL AND active_expedite_limit IS NULL AND baseline_evidence_ref IS NULL)
          OR (mode='ENFORCED' AND workspace_human_wip_limit > 0 AND active_expedite_limit > 0 AND baseline_evidence_ref IS NOT NULL))
      );
      CREATE INDEX workspace_queue_policy_effective_idx ON workspace_queue_policy_revisions(workspace_id,queue_policy_id,effective_from DESC);
      CREATE TRIGGER workspace_queue_policy_revisions_append_only BEFORE UPDATE OR DELETE ON workspace_queue_policy_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE workspace_queue_configuration_requests (
        workspace_id uuid NOT NULL, actor_principal_id uuid NOT NULL REFERENCES identities(id), operation text NOT NULL,
        idempotency_key_hash text NOT NULL, request_hash text NOT NULL, expected_header_version bigint NOT NULL,
        draft_semantic_hash text NOT NULL, authorization_basis_hash text NOT NULL,
        outcome text NOT NULL CHECK(outcome IN ('PENDING','PUBLISHED','CONFLICT','REJECTED')),
        published_revision_ref jsonb NULL, audit_ref jsonb NULL, created_at timestamptz NOT NULL, completed_at timestamptz NULL,
        PRIMARY KEY(workspace_id,actor_principal_id,operation,idempotency_key_hash), FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );

      CREATE TABLE workspace_queue_policy_view_heads (
        policy_view_id uuid NOT NULL, workspace_id uuid NOT NULL, policy_key text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0, reconciled_source_revision bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(policy_view_id), UNIQUE(workspace_id,policy_view_id), UNIQUE(workspace_id,policy_key), FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE workspace_queue_policy_view_revisions (
        policy_view_revision_id uuid NOT NULL, policy_view_id uuid NOT NULL, workspace_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        source_policy_revision_id uuid NOT NULL, safe_body jsonb NOT NULL, semantic_hash text NOT NULL,
        recorded_at timestamptz NOT NULL, PRIMARY KEY(policy_view_revision_id),
        UNIQUE(workspace_id,policy_view_id,revision_number), UNIQUE(workspace_id,policy_view_id,semantic_hash),
        FOREIGN KEY(workspace_id,policy_view_id) REFERENCES workspace_queue_policy_view_heads(workspace_id,policy_view_id)
      );
      CREATE TRIGGER workspace_queue_policy_view_revisions_append_only BEFORE UPDATE OR DELETE ON workspace_queue_policy_view_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE project_queue_policy_facet_heads (
        policy_facet_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, policy_key text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0, reconciled_source_revision bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(policy_facet_id), UNIQUE(workspace_id,project_id,policy_facet_id), UNIQUE(workspace_id,project_id,policy_key),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE project_queue_policy_facet_revisions (
        policy_facet_revision_id uuid NOT NULL, policy_facet_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        source_policy_revision_id uuid NOT NULL, safe_body jsonb NOT NULL, semantic_hash text NOT NULL, recorded_at timestamptz NOT NULL,
        PRIMARY KEY(policy_facet_revision_id), UNIQUE(workspace_id,project_id,policy_facet_id,revision_number),
        UNIQUE(workspace_id,project_id,policy_facet_id,semantic_hash),
        FOREIGN KEY(workspace_id,project_id,policy_facet_id) REFERENCES project_queue_policy_facet_heads(workspace_id,project_id,policy_facet_id)
      );
      CREATE TRIGGER project_queue_policy_facet_revisions_append_only BEFORE UPDATE OR DELETE ON project_queue_policy_facet_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE authorized_scope_queue_policy_facet_heads (
        authorized_facet_id uuid NOT NULL, workspace_id uuid NOT NULL, authorized_project_set_hash text NOT NULL, policy_key text NOT NULL,
        current_revision_id uuid NULL, resource_version bigint NOT NULL DEFAULT 0, reconciled_source_revision bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(authorized_facet_id), UNIQUE(workspace_id,authorized_facet_id), UNIQUE(workspace_id,authorized_project_set_hash,policy_key),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      CREATE TABLE authorized_scope_queue_policy_facet_revisions (
        authorized_facet_revision_id uuid NOT NULL, authorized_facet_id uuid NOT NULL, workspace_id uuid NOT NULL,
        revision_number bigint NOT NULL CHECK(revision_number >= 1), previous_revision_id uuid NULL,
        source_policy_revision_id uuid NOT NULL, safe_body jsonb NOT NULL, semantic_hash text NOT NULL, recorded_at timestamptz NOT NULL,
        PRIMARY KEY(authorized_facet_revision_id), UNIQUE(workspace_id,authorized_facet_id,revision_number), UNIQUE(workspace_id,authorized_facet_id,semantic_hash),
        FOREIGN KEY(workspace_id,authorized_facet_id) REFERENCES authorized_scope_queue_policy_facet_heads(workspace_id,authorized_facet_id)
      );
      CREATE TRIGGER authorized_scope_queue_policy_facet_revisions_append_only BEFORE UPDATE OR DELETE ON authorized_scope_queue_policy_facet_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TABLE authorized_scope_queue_policy_facet_projects (
        workspace_id uuid NOT NULL, authorized_facet_id uuid NOT NULL, project_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,authorized_facet_id,project_id),
        FOREIGN KEY(workspace_id,authorized_facet_id) REFERENCES authorized_scope_queue_policy_facet_heads(workspace_id,authorized_facet_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE INDEX authorized_policy_facet_project_reverse_idx ON authorized_scope_queue_policy_facet_projects(workspace_id,project_id,authorized_facet_id);
      UPDATE platform_schema_versions SET version=130,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE authorized_scope_queue_policy_facet_projects;
      DROP TABLE authorized_scope_queue_policy_facet_revisions;
      DROP TABLE authorized_scope_queue_policy_facet_heads;
      DROP TABLE project_queue_policy_facet_revisions;
      DROP TABLE project_queue_policy_facet_heads;
      DROP TABLE workspace_queue_policy_view_revisions;
      DROP TABLE workspace_queue_policy_view_heads;
      DROP TABLE workspace_queue_configuration_requests;
      DROP TABLE workspace_queue_policy_revisions;
      DROP TABLE workspace_queue_policy_heads;
      DROP TABLE workspace_business_calendar_revisions;
      DROP TABLE workspace_business_calendar_heads;
      UPDATE platform_schema_versions SET version=120,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}

-- Read-only preflight for an existing Core 185+ database, before migration 0190.
-- Run with: psql -X --set ON_ERROR_STOP=1 --file <this-file>
-- Connection/TLS credentials come from the deployment's approved libpq service.
-- No row contents are emitted, modified or deleted. NULL project scope is valid.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  target_table text;
  orphan_count bigint;
  total_orphans bigint := 0;
  core_version integer;
BEGIN
  SELECT version INTO STRICT core_version
    FROM platform_schema_versions WHERE namespace = 'core';
  IF core_version < 185 THEN
    RAISE EXCEPTION 'Apply the approved migrations through Core 185 before this preflight (current: %)', core_version;
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'action_provenance_records', 'agent_runs', 'agent_tool_invocations',
    'external_interaction_receipts', 'intake_candidate_decisions',
    'intake_candidate_source_observations', 'intake_candidates',
    'intake_draft_confirmations', 'intake_draft_revisions', 'interaction_intents',
    'interaction_presentation_secrets', 'notification_intents',
    'operational_import_intents', 'queue_order_scope_heads', 'reconciliation_cursors'
  ] LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I AS child
        WHERE child.project_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM projects AS parent
             WHERE parent.workspace_id = child.workspace_id
               AND parent.id = child.project_id
          )', target_table
    ) INTO orphan_count;
    RAISE NOTICE '%: % orphan project-scope rows', target_table, orphan_count;
    total_orphans := total_orphans + orphan_count;
  END LOOP;

  IF total_orphans > 0 THEN
    RAISE EXCEPTION '0190 preflight failed: % orphan project-scope rows; data owner review required', total_orphans;
  END IF;
END
$preflight$;

ROLLBACK;

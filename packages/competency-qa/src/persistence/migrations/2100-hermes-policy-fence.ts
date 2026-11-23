import type { MigrationInterface, QueryRunner } from "typeorm";

export class QaHermesPolicyFence21001700000002100 implements MigrationInterface {
  readonly name = "QaHermesPolicyFence21001700000002100";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
ALTER TABLE qa_triage_assessments ADD COLUMN model_policy_ref jsonb NULL;
ALTER TABLE qa_session_plan_proposals ADD COLUMN model_policy_ref jsonb NULL;
CREATE FUNCTION qa_hermes_policy_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_ref jsonb; policy_state text; valid_until timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-config:'||NEW.workspace_id::text||':hermes:'||NEW.project_id::text,0));
  SELECT jsonb_build_object('id',h.configuration_id,'version',h.current_version,'contentHash',h.current_hash),h.state,r.valid_until
    INTO policy_ref,policy_state,valid_until
  FROM runtime_configuration_headers h JOIN runtime_configuration_revisions r
    ON (r.workspace_id,r.configuration_id,r.version,r.content_hash)=(h.workspace_id,h.configuration_id,h.current_version,h.current_hash)
  WHERE h.workspace_id=NEW.workspace_id AND h.configuration_id='hermes:'||NEW.project_id::text AND h.kind='MODEL_POLICY'
    AND r.semantic_body->'document'->>'schemaVersion'='hermes-evaluation-policy@1.0.0'
  FOR SHARE OF h;
  IF NEW.state='CURRENT' THEN
    IF policy_ref IS NOT NULL THEN
      IF policy_state<>'PUBLISHED' OR valid_until<=clock_timestamp() OR NEW.model_policy_ref IS DISTINCT FROM policy_ref THEN RAISE EXCEPTION 'QA_HERMES_POLICY_CHANGED'; END IF;
    ELSIF NEW.model_policy_ref IS NOT NULL THEN RAISE EXCEPTION 'QA_HERMES_POLICY_CHANGED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qa_triage_model_policy_guard BEFORE INSERT ON qa_triage_assessments FOR EACH ROW EXECUTE FUNCTION qa_hermes_policy_insert_guard();
CREATE TRIGGER qa_session_plan_model_policy_guard BEFORE INSERT ON qa_session_plan_proposals FOR EACH ROW EXECUTE FUNCTION qa_hermes_policy_insert_guard();
UPDATE platform_schema_versions SET version=2100,applied_at=clock_timestamp() WHERE namespace='pack:qa';`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER qa_triage_model_policy_guard ON qa_triage_assessments; DROP TRIGGER qa_session_plan_model_policy_guard ON qa_session_plan_proposals;
DROP FUNCTION qa_hermes_policy_insert_guard(); ALTER TABLE qa_triage_assessments DROP COLUMN model_policy_ref;
ALTER TABLE qa_session_plan_proposals DROP COLUMN model_policy_ref; UPDATE platform_schema_versions SET version=2095,applied_at=clock_timestamp() WHERE namespace='pack:qa';`);
  }
}

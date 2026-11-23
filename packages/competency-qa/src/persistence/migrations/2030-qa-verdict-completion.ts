import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaVerdictCompletion20301700000002030 implements MigrationInterface {
  readonly name = "QaVerdictCompletion20301700000002030";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_verdicts(
        verdict_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1),verdict text NOT NULL CHECK(verdict IN('PASS','FAIL','BLOCKED','INCONCLUSIVE')),
        residual_risk jsonb NOT NULL,effective_risk text NOT NULL CHECK(effective_risk IN('ORDINARY','HIGH','CRITICAL')),
        required_session_plan_ref jsonb NOT NULL,session_review_refs jsonb NOT NULL,evidence_manifest_refs jsonb NOT NULL,finding_outcome_refs jsonb NOT NULL,
        dod_rule_set_ref jsonb NOT NULL,risk_policy_ref jsonb NOT NULL,aggregate_snapshot_hash text NOT NULL,content_hash text NOT NULL,
        supersedes_verdict_id text NULL,revision_reason text NULL,state text NOT NULL CHECK(state IN('DRAFT','PARTIALLY_SIGNED','SIGNED','SUPERSEDED')),
        signed_at timestamptz NULL,superseded_by_verdict_id text NULL,supersession_reason text NULL,superseded_at timestamptz NULL,
        created_by jsonb NOT NULL,created_at timestamptz NOT NULL,resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),
        PRIMARY KEY(verdict_id),UNIQUE(verdict_id,workspace_id,project_id,work_item_id),UNIQUE(verdict_id,version,content_hash),UNIQUE(workspace_id,project_id,work_item_id,version),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        FOREIGN KEY(supersedes_verdict_id) REFERENCES qa_verdicts(verdict_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(superseded_by_verdict_id) REFERENCES qa_verdicts(verdict_id) DEFERRABLE INITIALLY DEFERRED,
        CHECK(jsonb_typeof(residual_risk)='object' AND jsonb_typeof(session_review_refs)='array' AND jsonb_array_length(session_review_refs)>0 AND jsonb_typeof(evidence_manifest_refs)='array' AND jsonb_array_length(evidence_manifest_refs)>0 AND jsonb_typeof(finding_outcome_refs)='array'),
        CHECK((version=1 AND supersedes_verdict_id IS NULL AND revision_reason IS NULL) OR (version>1 AND supersedes_verdict_id IS NOT NULL AND length(btrim(revision_reason)) BETWEEN 1 AND 2000)),
        CHECK((state IN('DRAFT','PARTIALLY_SIGNED') AND signed_at IS NULL AND superseded_by_verdict_id IS NULL AND supersession_reason IS NULL AND superseded_at IS NULL) OR
          (state='SIGNED' AND signed_at IS NOT NULL AND superseded_by_verdict_id IS NULL AND supersession_reason IS NULL AND superseded_at IS NULL) OR
          (state='SUPERSEDED' AND signed_at IS NOT NULL AND superseded_by_verdict_id IS NOT NULL AND length(btrim(supersession_reason)) BETWEEN 1 AND 2000 AND superseded_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX qa_verdict_one_unsigned_current ON qa_verdicts(workspace_id,project_id,work_item_id) WHERE state IN('DRAFT','PARTIALLY_SIGNED');

      CREATE TABLE qa_verdict_signatures(
        signature_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,verdict_id text NOT NULL,
        role text NOT NULL CHECK(role IN('PRIMARY','LEAD_COSIGN')),verdict_content_hash text NOT NULL,signer jsonb NOT NULL,authorization_basis_hash text NOT NULL,
        action_ref jsonb NULL,signed_at timestamptz NOT NULL,correlation_id uuid NULL,causation_id uuid NULL,
        PRIMARY KEY(signature_id),UNIQUE(verdict_id,role),UNIQUE(verdict_id,signature_id),
        FOREIGN KEY(verdict_id,workspace_id,project_id,work_item_id) REFERENCES qa_verdicts(verdict_id,workspace_id,project_id,work_item_id) DEFERRABLE INITIALLY DEFERRED,
        CHECK((role='PRIMARY' AND action_ref IS NULL) OR (role='LEAD_COSIGN' AND action_ref IS NOT NULL))
      );

      CREATE TABLE qa_dod_assessments(
        assessment_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,version integer NOT NULL CHECK(version>=1),
        state text NOT NULL CHECK(state IN('BLOCKED','READY_TO_CLOSE','SATISFIED')),blocker_codes jsonb NOT NULL,warning_codes jsonb NOT NULL,inventory jsonb NOT NULL,
        aggregate_input_hash text NOT NULL,rule_set_ref jsonb NOT NULL,risk_policy_ref jsonb NOT NULL,evaluated_by text NOT NULL,evaluated_at timestamptz NOT NULL,
        completion_confirmation_ref jsonb NULL,content_hash text NOT NULL,
        PRIMARY KEY(assessment_id),UNIQUE(assessment_id,workspace_id,project_id,work_item_id),UNIQUE(workspace_id,project_id,work_item_id,version),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK(jsonb_typeof(blocker_codes)='array' AND jsonb_typeof(warning_codes)='array' AND jsonb_typeof(inventory)='object'),
        CHECK((state='BLOCKED' AND jsonb_array_length(blocker_codes)>0 AND completion_confirmation_ref IS NULL) OR
          (state='READY_TO_CLOSE' AND jsonb_array_length(blocker_codes)=0 AND completion_confirmation_ref IS NULL) OR
          (state='SATISFIED' AND jsonb_array_length(blocker_codes)=0 AND completion_confirmation_ref IS NOT NULL))
      );

      CREATE TABLE qa_completion_candidates(
        candidate_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,candidate_number integer NOT NULL CHECK(candidate_number>=1),
        version integer NOT NULL DEFAULT 1 CHECK(version=1),ready_to_close_dod_ref jsonb NOT NULL,verdict_ref jsonb NOT NULL,required_session_plan_ref jsonb NOT NULL,
        summary jsonb NOT NULL,summary_content_hash text NOT NULL,aggregate_snapshot_hash text NOT NULL,expected_external_state text NOT NULL,expected_external_version text NOT NULL,
        binding_ref jsonb NOT NULL,profile_refs jsonb NOT NULL,initiated_by jsonb NOT NULL,created_at timestamptz NOT NULL,content_hash text NOT NULL,
        state text NOT NULL CHECK(state IN('CANDIDATE','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED','CONFIRMED','REJECTED','INVALIDATED','FAILED')),
        approval_ref jsonb NULL,approved_by text NULL,approved_authorization_basis_hash text NULL,approved_at timestamptz NULL,command_ref jsonb NULL,effect_key_hash text NULL,dispatched_at timestamptz NULL,
        terminal_from_state text NULL,terminal_reason text NULL,failure_code text NULL,confirmation_ref jsonb NULL,summary_receipt jsonb NULL,confirmed_at timestamptz NULL,
        resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),
        PRIMARY KEY(candidate_id),UNIQUE(candidate_id,workspace_id,project_id,work_item_id),UNIQUE(candidate_id,version,content_hash),UNIQUE(workspace_id,project_id,work_item_id,candidate_number),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK(jsonb_typeof(summary)='object' AND jsonb_typeof(profile_refs)='array' AND jsonb_array_length(profile_refs)>0),
        CHECK((state='CANDIDATE' AND approval_ref IS NULL AND command_ref IS NULL AND terminal_from_state IS NULL) OR
          (state='AWAITING_APPROVAL' AND approval_ref IS NOT NULL AND approved_by IS NULL AND command_ref IS NULL AND terminal_from_state IS NULL) OR
          (state='AUTHORIZED' AND approval_ref IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND command_ref IS NULL AND terminal_from_state IS NULL) OR
          (state='DISPATCHED' AND approval_ref IS NOT NULL AND approved_by IS NOT NULL AND command_ref IS NOT NULL AND effect_key_hash IS NOT NULL AND dispatched_at IS NOT NULL AND terminal_from_state IS NULL) OR
          (state='REJECTED' AND terminal_from_state='AWAITING_APPROVAL' AND terminal_reason IS NOT NULL AND command_ref IS NULL) OR
          (state='INVALIDATED' AND terminal_from_state IN('CANDIDATE','AWAITING_APPROVAL','AUTHORIZED') AND terminal_reason IS NOT NULL AND command_ref IS NULL) OR
          (state='FAILED' AND terminal_from_state='DISPATCHED' AND terminal_reason IS NOT NULL AND failure_code IS NOT NULL AND command_ref IS NOT NULL AND effect_key_hash IS NOT NULL AND confirmation_ref IS NULL) OR
          (state='CONFIRMED' AND terminal_from_state='DISPATCHED' AND terminal_reason IS NULL AND failure_code IS NULL AND command_ref IS NOT NULL AND effect_key_hash IS NOT NULL AND confirmation_ref IS NOT NULL AND summary_receipt IS NOT NULL AND confirmed_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX qa_completion_one_live_candidate ON qa_completion_candidates(workspace_id,project_id,work_item_id) WHERE state IN('CANDIDATE','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED');

      CREATE TABLE qa_final_close_confirmations(
        confirmation_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,candidate_id text NOT NULL,
        candidate_version integer NOT NULL,candidate_content_hash text NOT NULL,required_session_plan_ref jsonb NOT NULL,verdict_ref jsonb NOT NULL,ready_to_close_dod_ref jsonb NOT NULL,
        approval_ref jsonb NOT NULL,command_ref jsonb NOT NULL,summary_digest text NOT NULL,summary_receipt jsonb NOT NULL,raw_external_state text NOT NULL,external_version text NOT NULL,
        normalized_status text NOT NULL CHECK(normalized_status='DONE'),confirmed_at timestamptz NOT NULL,content_hash text NOT NULL,
        PRIMARY KEY(confirmation_id),UNIQUE(workspace_id,project_id,candidate_id),UNIQUE(workspace_id,project_id,command_ref),
        FOREIGN KEY(candidate_id,workspace_id,project_id,work_item_id) REFERENCES qa_completion_candidates(candidate_id,workspace_id,project_id,work_item_id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE qa_post_close_correction_markers(
        marker_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,manifest_id text NOT NULL,
        previous_revision_ref jsonb NOT NULL,clerical_revision_ref jsonb NOT NULL,annotations jsonb NOT NULL,basis text NOT NULL CHECK(basis='HUMAN'),actor jsonb NOT NULL,
        authorization_basis_hash text NOT NULL,recorded_at timestamptz NOT NULL,content_hash text NOT NULL,
        PRIMARY KEY(marker_id),UNIQUE(workspace_id,project_id,manifest_id,clerical_revision_ref),
        FOREIGN KEY(manifest_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifests(manifest_id,workspace_id,project_id,work_item_id,session_id),
        CHECK(jsonb_typeof(annotations)='array' AND jsonb_array_length(annotations)>0)
      );

      ALTER TABLE qa_request_extensions ADD COLUMN latest_dod_assessment_id text NULL,ADD COLUMN completion_in_flight_candidate_id text NULL;
      ALTER TABLE qa_request_extensions ADD CONSTRAINT qa_extension_latest_dod_fk FOREIGN KEY(latest_dod_assessment_id,workspace_id,project_id,work_item_id) REFERENCES qa_dod_assessments(assessment_id,workspace_id,project_id,work_item_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_request_extensions ADD CONSTRAINT qa_extension_completion_in_flight_fk FOREIGN KEY(completion_in_flight_candidate_id,workspace_id,project_id,work_item_id) REFERENCES qa_completion_candidates(candidate_id,workspace_id,project_id,work_item_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE OR REPLACE FUNCTION qa_guard_verdict_projection() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF ROW(NEW.verdict_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.version,NEW.verdict,NEW.residual_risk,NEW.effective_risk,NEW.required_session_plan_ref,NEW.session_review_refs,NEW.evidence_manifest_refs,NEW.finding_outcome_refs,NEW.dod_rule_set_ref,NEW.risk_policy_ref,NEW.aggregate_snapshot_hash,NEW.content_hash,NEW.supersedes_verdict_id,NEW.revision_reason,NEW.created_by,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.verdict_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.version,OLD.verdict,OLD.residual_risk,OLD.effective_risk,OLD.required_session_plan_ref,OLD.session_review_refs,OLD.evidence_manifest_refs,OLD.finding_outcome_refs,OLD.dod_rule_set_ref,OLD.risk_policy_ref,OLD.aggregate_snapshot_hash,OLD.content_hash,OLD.supersedes_verdict_id,OLD.revision_reason,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'QA_VERDICT_IMMUTABLE_CONTENT'; END IF;
        IF NOT((OLD.state='DRAFT' AND NEW.state IN('PARTIALLY_SIGNED','SIGNED')) OR (OLD.state='PARTIALLY_SIGNED' AND NEW.state='SIGNED') OR (OLD.state='SIGNED' AND NEW.state='SUPERSEDED')) THEN RAISE EXCEPTION 'QA_VERDICT_TRANSITION_INVALID'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_verdict_projection_guard BEFORE UPDATE ON qa_verdicts FOR EACH ROW EXECUTE FUNCTION qa_guard_verdict_projection();

      CREATE OR REPLACE FUNCTION qa_guard_completion_projection() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF ROW(NEW.candidate_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.candidate_number,NEW.version,NEW.ready_to_close_dod_ref,NEW.verdict_ref,NEW.required_session_plan_ref,NEW.summary,NEW.summary_content_hash,NEW.aggregate_snapshot_hash,NEW.expected_external_state,NEW.expected_external_version,NEW.binding_ref,NEW.profile_refs,NEW.initiated_by,NEW.created_at,NEW.content_hash)
          IS DISTINCT FROM ROW(OLD.candidate_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.candidate_number,OLD.version,OLD.ready_to_close_dod_ref,OLD.verdict_ref,OLD.required_session_plan_ref,OLD.summary,OLD.summary_content_hash,OLD.aggregate_snapshot_hash,OLD.expected_external_state,OLD.expected_external_version,OLD.binding_ref,OLD.profile_refs,OLD.initiated_by,OLD.created_at,OLD.content_hash) THEN RAISE EXCEPTION 'QA_COMPLETION_IMMUTABLE_CONTENT'; END IF;
        IF NOT((OLD.state='CANDIDATE' AND NEW.state IN('AWAITING_APPROVAL','INVALIDATED')) OR (OLD.state='AWAITING_APPROVAL' AND NEW.state IN('AUTHORIZED','REJECTED','INVALIDATED')) OR (OLD.state='AUTHORIZED' AND NEW.state IN('DISPATCHED','INVALIDATED')) OR (OLD.state='DISPATCHED' AND NEW.state IN('CONFIRMED','FAILED'))) THEN RAISE EXCEPTION 'QA_COMPLETION_TRANSITION_INVALID'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_completion_projection_guard BEFORE UPDATE ON qa_completion_candidates FOR EACH ROW EXECUTE FUNCTION qa_guard_completion_projection();
    `);
    for (const table of [
      "qa_verdict_signatures",
      "qa_dod_assessments",
      "qa_final_close_confirmations",
      "qa_post_close_correction_markers",
    ]) {
      await queryRunner.query(qaAppendOnlyGuardSql(table));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE qa_request_extensions DROP CONSTRAINT IF EXISTS qa_extension_completion_in_flight_fk,DROP CONSTRAINT IF EXISTS qa_extension_latest_dod_fk,DROP COLUMN IF EXISTS completion_in_flight_candidate_id,DROP COLUMN IF EXISTS latest_dod_assessment_id;
      DROP TRIGGER IF EXISTS qa_completion_projection_guard ON qa_completion_candidates;DROP FUNCTION IF EXISTS qa_guard_completion_projection();
      DROP TRIGGER IF EXISTS qa_verdict_projection_guard ON qa_verdicts;DROP FUNCTION IF EXISTS qa_guard_verdict_projection();
      DROP TABLE qa_post_close_correction_markers;DROP TABLE qa_final_close_confirmations;DROP TABLE qa_completion_candidates;DROP TABLE qa_dod_assessments;DROP TABLE qa_verdict_signatures;DROP TABLE qa_verdicts;
    `);
  }
}

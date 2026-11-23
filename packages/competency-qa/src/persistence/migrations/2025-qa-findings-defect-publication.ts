import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaFindingsDefectPublication20251700000002025 implements MigrationInterface {
  readonly name = "QaFindingsDefectPublication20251700000002025";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_findings(
        finding_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,
        state text NOT NULL CHECK(state IN('DRAFT','CLASSIFIED','DISPOSED','FROZEN')),
        current_review_revision_id text NULL,latest_historical_review_revision_id text NULL,frozen_review_revision_id text NULL,
        classification text NULL CHECK(classification IS NULL OR classification IN('PRODUCT','INFRA','INCONCLUSIVE','DUPLICATE','ACCEPTED_RISK')),
        frozen_membership_set_hash text NULL,created_by jsonb NOT NULL,created_at timestamptz NOT NULL,frozen_at timestamptz NULL,
        resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),content jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY(finding_id),UNIQUE(finding_id,workspace_id,project_id),UNIQUE(finding_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK((state='DRAFT' AND current_review_revision_id IS NULL AND classification IS NULL AND frozen_review_revision_id IS NULL AND frozen_membership_set_hash IS NULL AND frozen_at IS NULL) OR
          (state IN('CLASSIFIED','DISPOSED') AND current_review_revision_id IS NOT NULL AND classification IS NOT NULL AND frozen_review_revision_id IS NULL AND frozen_membership_set_hash IS NULL AND frozen_at IS NULL) OR
          (state='FROZEN' AND current_review_revision_id IS NOT NULL AND classification IS NOT NULL AND frozen_review_revision_id=current_review_revision_id AND frozen_membership_set_hash IS NOT NULL AND frozen_at IS NOT NULL))
      );

      CREATE TABLE qa_finding_observations(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,
        finding_id text NOT NULL,observation_id text NOT NULL,state text NOT NULL CHECK(state IN('ACTIVE','RELEASED')),
        assigned_by jsonb NOT NULL,assigned_at timestamptz NOT NULL,released_by jsonb NULL,released_at timestamptz NULL,release_reason text NULL,
        resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),
        PRIMARY KEY(membership_id),UNIQUE(membership_id,workspace_id,project_id,work_item_id,session_id,finding_id),
        FOREIGN KEY(finding_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(observation_id,workspace_id,project_id) REFERENCES qa_observations(observation_id,workspace_id,project_id),
        CHECK((state='ACTIVE' AND released_by IS NULL AND released_at IS NULL AND release_reason IS NULL) OR
          (state='RELEASED' AND released_by IS NOT NULL AND released_at IS NOT NULL AND length(btrim(release_reason)) BETWEEN 1 AND 2000))
      );
      CREATE UNIQUE INDEX qa_finding_one_active_membership_per_observation ON qa_finding_observations(workspace_id,project_id,observation_id) WHERE state='ACTIVE';
      CREATE INDEX qa_finding_active_memberships ON qa_finding_observations(workspace_id,project_id,session_id,finding_id,membership_id) WHERE state='ACTIVE';

      CREATE TABLE qa_finding_review_revisions(
        finding_review_revision_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,finding_id text NOT NULL,
        version integer NOT NULL CHECK(version>=1),previous_revision_id text NULL,previous_version integer NULL,previous_content_hash text NULL,
        stage text NOT NULL CHECK(stage IN('CLASSIFIED','DISPOSED','FROZEN')),classification text NOT NULL CHECK(classification IN('PRODUCT','INFRA','INCONCLUSIVE','DUPLICATE','ACCEPTED_RISK')),
        severity text NOT NULL CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')),summary text NOT NULL,affected_target_hash text NOT NULL,
        classification_actor jsonb NOT NULL,classification_reason text NOT NULL,classification_at timestamptz NOT NULL,
        disposition_decision text NULL CHECK(disposition_decision IS NULL OR disposition_decision IN('CREATE_DEFECT','DUPLICATE','NOT_A_BUG','ACCEPTED_RISK','DEFERRED','WAIVED')),
        disposition_actor jsonb NULL,disposition_reason text NULL,disposition_at timestamptz NULL,duplicate_defect_ref jsonb NULL,accepted_risk_action_ref jsonb NULL,waiver_action_ref jsonb NULL,
        frozen_at timestamptz NULL,active_membership_set_hash text NOT NULL,observation_membership_ids jsonb NOT NULL,evidence_ref_hash text NOT NULL,policy_ref jsonb NOT NULL,content_hash text NOT NULL,content jsonb NOT NULL,
        PRIMARY KEY(finding_review_revision_id),UNIQUE(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id),
        UNIQUE(finding_review_revision_id,finding_id,version,content_hash),UNIQUE(finding_id,version),
        FOREIGN KEY(finding_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(previous_revision_id,finding_id,previous_version,previous_content_hash) REFERENCES qa_finding_review_revisions(finding_review_revision_id,finding_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK(jsonb_typeof(observation_membership_ids)='array' AND jsonb_array_length(observation_membership_ids)>0),
        CHECK(length(btrim(summary)) BETWEEN 1 AND 2000 AND length(btrim(classification_reason)) BETWEEN 1 AND 2000),
        CHECK((version=1 AND stage='CLASSIFIED' AND previous_revision_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL) OR (version>1 AND previous_revision_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL)),
        CHECK((stage='CLASSIFIED' AND disposition_decision IS NULL AND disposition_actor IS NULL AND disposition_reason IS NULL AND disposition_at IS NULL AND frozen_at IS NULL) OR
          (stage='DISPOSED' AND disposition_decision IS NOT NULL AND disposition_actor IS NOT NULL AND length(btrim(disposition_reason)) BETWEEN 1 AND 2000 AND disposition_at IS NOT NULL AND frozen_at IS NULL) OR
          (stage='FROZEN' AND disposition_decision IS NOT NULL AND disposition_actor IS NOT NULL AND length(btrim(disposition_reason)) BETWEEN 1 AND 2000 AND disposition_at IS NOT NULL AND frozen_at IS NOT NULL)),
        CHECK((disposition_decision='DUPLICATE' AND duplicate_defect_ref IS NOT NULL) OR (disposition_decision IS DISTINCT FROM 'DUPLICATE' AND duplicate_defect_ref IS NULL)),
        CHECK((disposition_decision='ACCEPTED_RISK' AND accepted_risk_action_ref IS NOT NULL) OR (disposition_decision IS DISTINCT FROM 'ACCEPTED_RISK' AND accepted_risk_action_ref IS NULL)),
        CHECK((disposition_decision='WAIVED' AND waiver_action_ref IS NOT NULL) OR (disposition_decision IS DISTINCT FROM 'WAIVED' AND waiver_action_ref IS NULL)),
        CHECK((classification='PRODUCT' AND (disposition_decision IS NULL OR disposition_decision IN('CREATE_DEFECT','DEFERRED','WAIVED'))) OR
          (classification='INFRA' AND (disposition_decision IS NULL OR disposition_decision IN('NOT_A_BUG','DEFERRED','WAIVED'))) OR
          (classification='INCONCLUSIVE' AND (disposition_decision IS NULL OR disposition_decision IN('DEFERRED','WAIVED'))) OR
          (classification='DUPLICATE' AND (disposition_decision IS NULL OR disposition_decision='DUPLICATE')) OR
          (classification='ACCEPTED_RISK' AND (disposition_decision IS NULL OR disposition_decision='ACCEPTED_RISK')))
      );
      ALTER TABLE qa_findings
        ADD CONSTRAINT qa_finding_current_review_fk FOREIGN KEY(current_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT qa_finding_latest_historical_review_fk FOREIGN KEY(latest_historical_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT qa_finding_frozen_review_fk FOREIGN KEY(frozen_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) DEFERRABLE INITIALLY DEFERRED;

      ALTER TABLE qa_plan_item_result_revisions
        ADD COLUMN flaky_finding_id text NULL,ADD COLUMN flaky_disposed_review_id text NULL,ADD COLUMN flaky_disposed_review_version integer NULL,ADD COLUMN flaky_disposed_review_content_hash text NULL,
        ADD COLUMN flaky_membership_set_hash text NULL,ADD COLUMN flaky_failed_attempt_set_hash text NULL,ADD COLUMN flaky_observation_set_hash text NULL,
        ADD COLUMN flaky_policy_key text NULL,ADD COLUMN flaky_policy_version text NULL,ADD COLUMN flaky_policy_hash text NULL;
      DO $qa$ DECLARE constraint_name text; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='qa_plan_item_result_revisions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%FLAKY_SUSPECTED%result%INCONCLUSIVE%';
        IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE qa_plan_item_result_revisions DROP CONSTRAINT %I',constraint_name); END IF;
      END $qa$;
      ALTER TABLE qa_plan_item_result_revisions ADD CONSTRAINT qa_result_flaky_basis_shape CHECK(
        ((review_flags ? 'FLAKY_SUSPECTED') IS FALSE AND flaky_finding_id IS NULL AND flaky_disposed_review_id IS NULL AND flaky_disposed_review_version IS NULL AND flaky_disposed_review_content_hash IS NULL AND flaky_membership_set_hash IS NULL AND flaky_failed_attempt_set_hash IS NULL AND flaky_observation_set_hash IS NULL AND flaky_policy_key IS NULL AND flaky_policy_version IS NULL AND flaky_policy_hash IS NULL)
        OR ((review_flags ? 'FLAKY_SUSPECTED') IS TRUE AND result='INCONCLUSIVE' AND flaky_finding_id IS NULL)
        OR ((review_flags ? 'FLAKY_SUSPECTED') IS TRUE AND result='PASS' AND flaky_finding_id IS NOT NULL AND flaky_disposed_review_id IS NOT NULL AND flaky_disposed_review_version IS NOT NULL AND flaky_disposed_review_content_hash IS NOT NULL AND flaky_membership_set_hash IS NOT NULL AND flaky_failed_attempt_set_hash IS NOT NULL AND flaky_observation_set_hash IS NOT NULL AND flaky_policy_key IS NOT NULL AND flaky_policy_version IS NOT NULL AND flaky_policy_hash IS NOT NULL)
      );
      ALTER TABLE qa_plan_item_result_revisions ADD CONSTRAINT qa_result_flaky_finding_review_fk FOREIGN KEY(flaky_disposed_review_id,workspace_id,project_id,work_item_id,session_id,flaky_finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_plan_item_result_flaky_observation_memberships(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,
        result_revision_id text NOT NULL,finding_id text NOT NULL,finding_membership_id text NOT NULL,failed_attempt_id text NOT NULL,observation_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=1),
        PRIMARY KEY(membership_id),UNIQUE(result_revision_id,failed_attempt_id,observation_id),UNIQUE(result_revision_id,ordinal),
        FOREIGN KEY(result_revision_id,workspace_id,project_id,plan_item_id) REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(failed_attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id) REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,failed_attempt_id) REFERENCES qa_observations(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(finding_membership_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_observations(membership_id,workspace_id,project_id,work_item_id,session_id,finding_id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE qa_defect_drafts(
        defect_draft_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,finding_id text NOT NULL,frozen_finding_review_id text NOT NULL,
        version integer NOT NULL CHECK(version>=1),predecessor_draft_id text NULL,predecessor_terminal_state text NULL,replacement_reason text NULL,
        state text NOT NULL CHECK(state IN('DRAFT','READY_FOR_APPROVAL','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED','LINKED','REJECTED','INVALIDATED','FAILED')),
        payload jsonb NOT NULL,provenance jsonb NOT NULL,content_hash text NOT NULL,accepted_by jsonb NULL,accepted_at timestamptz NULL,rejection_reason text NULL,rejected_by jsonb NULL,rejected_at timestamptz NULL,
        binding_ref jsonb NULL,profile_refs jsonb NULL,approval_ref jsonb NULL,command_ref jsonb NULL,effect_key_hash text NULL,defect_link_id text NULL,
        terminal_from_state text NULL,invalidation_reason text NULL,failure_code text NULL,terminal_reason text NULL,
        resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),created_by jsonb NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
        PRIMARY KEY(defect_draft_id),UNIQUE(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id),UNIQUE(finding_id,version),UNIQUE(defect_draft_id,finding_id,version,content_hash),
        FOREIGN KEY(finding_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(frozen_finding_review_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id),
        FOREIGN KEY(predecessor_draft_id) REFERENCES qa_defect_drafts(defect_draft_id),
        CHECK(jsonb_typeof(payload)='object' AND jsonb_typeof(provenance)='object'),
        CHECK((version=1 AND predecessor_draft_id IS NULL AND predecessor_terminal_state IS NULL AND replacement_reason IS NULL) OR (version>1 AND predecessor_draft_id IS NOT NULL AND predecessor_terminal_state IN('FAILED','INVALIDATED') AND length(btrim(replacement_reason)) BETWEEN 1 AND 2000)),
        CHECK((state='DRAFT' AND accepted_by IS NULL AND accepted_at IS NULL AND binding_ref IS NULL AND profile_refs IS NULL AND approval_ref IS NULL AND command_ref IS NULL AND effect_key_hash IS NULL AND defect_link_id IS NULL AND terminal_from_state IS NULL AND rejection_reason IS NULL AND invalidation_reason IS NULL AND failure_code IS NULL AND terminal_reason IS NULL) OR
          (state='READY_FOR_APPROVAL' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND binding_ref IS NULL AND profile_refs IS NULL AND approval_ref IS NULL AND command_ref IS NULL AND effect_key_hash IS NULL AND defect_link_id IS NULL AND terminal_from_state IS NULL) OR
          (state IN('AWAITING_APPROVAL','AUTHORIZED') AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND binding_ref IS NOT NULL AND profile_refs IS NOT NULL AND approval_ref IS NOT NULL AND effect_key_hash IS NULL AND defect_link_id IS NULL AND terminal_from_state IS NULL) OR
          (state='DISPATCHED' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND binding_ref IS NOT NULL AND profile_refs IS NOT NULL AND approval_ref IS NOT NULL AND command_ref IS NOT NULL AND effect_key_hash IS NOT NULL AND defect_link_id IS NULL AND terminal_from_state IS NULL) OR
          (state='LINKED' AND defect_link_id IS NOT NULL AND terminal_from_state IS NULL) OR
          (state='REJECTED' AND rejection_reason IS NOT NULL AND terminal_from_state IN('DRAFT','READY_FOR_APPROVAL')) OR
          (state='INVALIDATED' AND invalidation_reason IS NOT NULL AND terminal_from_state IN('DRAFT','READY_FOR_APPROVAL','AWAITING_APPROVAL','AUTHORIZED')) OR
          (state='FAILED' AND failure_code IS NOT NULL AND terminal_reason IS NOT NULL AND terminal_from_state IN('DRAFT','READY_FOR_APPROVAL','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED')))
      );
      CREATE UNIQUE INDEX qa_defect_one_active_draft ON qa_defect_drafts(workspace_id,project_id,finding_id) WHERE state IN('DRAFT','READY_FOR_APPROVAL','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED');

      CREATE TABLE qa_defect_links(
        defect_link_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,finding_id text NOT NULL,frozen_finding_review_id text NOT NULL,defect_draft_id text NOT NULL,
        command_ref jsonb NOT NULL,approval_ref jsonb NOT NULL,confirmation_receipt_ref jsonb NOT NULL,operational_result_ref jsonb NOT NULL,effect_key_hash text NOT NULL,
        external_entity_id text NOT NULL,external_display_key text NOT NULL,external_version text NOT NULL,raw_external_state text NOT NULL,normalized_status text NOT NULL CHECK(normalized_status='NEW'),
        binding_ref jsonb NOT NULL,profile_refs jsonb NOT NULL,confirmed_by jsonb NOT NULL,authorization_basis_hash text NOT NULL,linked_at timestamptz NOT NULL,correlation_id uuid NOT NULL,causation_id uuid NOT NULL,content_hash text NOT NULL,
        PRIMARY KEY(defect_link_id),UNIQUE(workspace_id,project_id,finding_id),UNIQUE(workspace_id,project_id,defect_draft_id),UNIQUE(workspace_id,project_id,effect_key_hash),
        FOREIGN KEY(finding_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_defect_drafts(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id),
        FOREIGN KEY(frozen_finding_review_id,workspace_id,project_id,work_item_id,session_id,finding_id) REFERENCES qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id)
      );

      DO $qa$ DECLARE constraint_name text; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='qa_evidence_artifact_links'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%owner_kind%SESSION%PLAN_ITEM%';
        IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE qa_evidence_artifact_links DROP CONSTRAINT %I',constraint_name); END IF;
      END $qa$;
      ALTER TABLE qa_evidence_artifact_links ADD COLUMN owner_finding_id text NULL;
      ALTER TABLE qa_evidence_artifact_links ADD CONSTRAINT qa_evidence_finding_owner_fk FOREIGN KEY(owner_finding_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id);
      ALTER TABLE qa_evidence_artifact_links ADD CONSTRAINT qa_evidence_owner_shape_2025 CHECK(
        (owner_kind='SESSION' AND owner_session_id IS NOT NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL) OR
        (owner_kind='PLAN_ITEM' AND owner_session_id IS NULL AND owner_plan_item_id IS NOT NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL) OR
        (owner_kind='MANUAL_ATTEMPT' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NOT NULL AND owner_observation_id IS NULL AND owner_finding_id IS NULL) OR
        (owner_kind='OBSERVATION' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NOT NULL AND owner_finding_id IS NULL) OR
        (owner_kind='FINDING' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL AND owner_finding_id IS NOT NULL));
      DO $qa$ DECLARE constraint_name text; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='qa_evidence_artifact_links'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%owner_kind%IN (%';
        IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE qa_evidence_artifact_links DROP CONSTRAINT %I',constraint_name); END IF;
      END $qa$;
      ALTER TABLE qa_evidence_artifact_links ADD CONSTRAINT qa_evidence_owner_kind_2025 CHECK(owner_kind IN('SESSION','PLAN_ITEM','MANUAL_ATTEMPT','OBSERVATION','FINDING'));

      CREATE OR REPLACE FUNCTION qa_guard_defect_draft_chain() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE head qa_defect_drafts%ROWTYPE;
      BEGIN
        IF TG_OP='INSERT' THEN
          SELECT * INTO head FROM qa_defect_drafts WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND finding_id=NEW.finding_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
          IF NOT FOUND THEN
            IF NEW.version<>1 OR NEW.predecessor_draft_id IS NOT NULL THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_CHAIN_GAP'; END IF;
          ELSE
            IF head.state IN('REJECTED','LINKED') OR head.defect_link_id IS NOT NULL OR EXISTS(SELECT 1 FROM qa_defect_links l WHERE l.workspace_id=head.workspace_id AND l.project_id=head.project_id AND l.finding_id=head.finding_id) THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_CHAIN_FINAL'; END IF;
            IF head.state NOT IN('FAILED','INVALIDATED') THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_ACTIVE_HEAD_EXISTS'; END IF;
            IF NEW.version<>head.version+1 OR NEW.predecessor_draft_id<>head.defect_draft_id OR NEW.predecessor_terminal_state<>head.state THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_CHAIN_GAP'; END IF;
          END IF;
          RETURN NEW;
        END IF;
        IF ROW(NEW.defect_draft_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.session_id,NEW.finding_id,NEW.frozen_finding_review_id,NEW.version,NEW.predecessor_draft_id,NEW.predecessor_terminal_state,NEW.replacement_reason,NEW.payload,NEW.provenance,NEW.content_hash,NEW.created_by,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.defect_draft_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.session_id,OLD.finding_id,OLD.frozen_finding_review_id,OLD.version,OLD.predecessor_draft_id,OLD.predecessor_terminal_state,OLD.replacement_reason,OLD.payload,OLD.provenance,OLD.content_hash,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_IMMUTABLE_CONTENT'; END IF;
        IF NOT((OLD.state='DRAFT' AND NEW.state IN('READY_FOR_APPROVAL','REJECTED','INVALIDATED','FAILED')) OR
          (OLD.state='READY_FOR_APPROVAL' AND NEW.state IN('AWAITING_APPROVAL','REJECTED','INVALIDATED','FAILED')) OR
          (OLD.state='AWAITING_APPROVAL' AND NEW.state IN('AUTHORIZED','INVALIDATED','FAILED')) OR
          (OLD.state='AUTHORIZED' AND NEW.state IN('DISPATCHED','INVALIDATED','FAILED')) OR
          (OLD.state='DISPATCHED' AND NEW.state IN('LINKED','FAILED'))) THEN RAISE EXCEPTION 'QA_DEFECT_DRAFT_TRANSITION_INVALID'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_defect_draft_chain_guard BEFORE INSERT OR UPDATE ON qa_defect_drafts FOR EACH ROW EXECUTE FUNCTION qa_guard_defect_draft_chain();

      CREATE OR REPLACE FUNCTION qa_guard_finding_membership_mutation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE finding_state text;
      BEGIN
        SELECT state INTO finding_state FROM qa_findings WHERE finding_id=COALESCE(NEW.finding_id,OLD.finding_id) FOR UPDATE;
        IF finding_state='FROZEN' THEN RAISE EXCEPTION 'QA_FINDING_FROZEN'; END IF;
        IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NOT(OLD.state='ACTIVE' AND NEW.state='RELEASED' AND ROW(NEW.membership_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.session_id,NEW.finding_id,NEW.observation_id,NEW.assigned_by,NEW.assigned_at) IS NOT DISTINCT FROM ROW(OLD.membership_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.session_id,OLD.finding_id,OLD.observation_id,OLD.assigned_by,OLD.assigned_at))) THEN RAISE EXCEPTION 'APPEND_ONLY:qa_finding_observations'; END IF;
        RETURN COALESCE(NEW,OLD);
      END;$qa$;
      CREATE TRIGGER qa_finding_membership_mutation_guard BEFORE UPDATE OR DELETE ON qa_finding_observations FOR EACH ROW EXECUTE FUNCTION qa_guard_finding_membership_mutation();

      CREATE OR REPLACE FUNCTION qa_assert_plan_item_result_complete() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; attempt_count integer; observation_count integer; current_leaf_count integer; negative_attempts integer; covered_negative_attempts integer; pass_sources integer;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO attempt_count FROM qa_plan_item_result_attempt_memberships WHERE result_revision_id=result_row.result_revision_id;
        SELECT count(*) INTO observation_count FROM qa_plan_item_result_observation_memberships WHERE result_revision_id=result_row.result_revision_id;
        IF result_row.result='NOT_RUN' THEN IF attempt_count<>0 OR observation_count<>0 OR EXISTS(SELECT 1 FROM qa_manual_attempts WHERE plan_item_id=result_row.plan_item_id) THEN RAISE EXCEPTION 'QA_RESULT_NOT_RUN_SET_INVALID'; END IF; RETURN NULL; END IF;
        IF attempt_count<>result_row.maximum_attempt_no OR attempt_count=0 OR observation_count=0 THEN RAISE EXCEPTION 'QA_RESULT_COMPLETE_SET_INVALID'; END IF;
        IF EXISTS(SELECT 1 FROM generate_series(1,result_row.maximum_attempt_no) n WHERE NOT EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships m JOIN qa_manual_attempts a ON a.attempt_id=m.attempt_id WHERE m.result_revision_id=result_row.result_revision_id AND a.attempt_no=n AND a.state='COMPLETED')) THEN RAISE EXCEPTION 'QA_RESULT_ATTEMPT_SEQUENCE_GAPPED'; END IF;
        SELECT count(*) INTO current_leaf_count FROM qa_observations o JOIN qa_plan_item_result_attempt_memberships am ON am.result_revision_id=result_row.result_revision_id AND am.attempt_id=o.attempt_id WHERE NOT EXISTS(SELECT 1 FROM qa_observations successor WHERE successor.corrects_observation_id=o.observation_id);
        IF current_leaf_count<>observation_count THEN RAISE EXCEPTION 'STALE_OBSERVATION_SET'; END IF;
        SELECT count(*) INTO negative_attempts FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE');
        SELECT count(DISTINCT a.attempt_id) INTO covered_negative_attempts FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id JOIN qa_plan_item_result_observation_memberships om ON om.result_revision_id=am.result_revision_id AND om.attempt_id=a.attempt_id JOIN qa_observations o ON o.observation_id=om.observation_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE') AND o.kind IN('NEGATIVE','AMBIGUOUS');
        IF negative_attempts<>covered_negative_attempts THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        IF result_row.result IN('FAIL','BLOCKED','INCONCLUSIVE') AND NOT EXISTS(SELECT 1 FROM qa_plan_item_result_observation_memberships om JOIN qa_observations o ON o.observation_id=om.observation_id WHERE om.result_revision_id=result_row.result_revision_id AND o.kind IN('NEGATIVE','AMBIGUOUS')) THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        SELECT count(*) INTO pass_sources FROM qa_plan_item_result_observation_memberships om JOIN qa_observations o ON o.observation_id=om.observation_id JOIN qa_manual_attempts a ON a.attempt_id=om.attempt_id WHERE om.result_revision_id=result_row.result_revision_id AND o.kind='POSITIVE' AND a.result='PASS';
        IF result_row.result='PASS' AND pass_sources=0 THEN RAISE EXCEPTION 'QA_RESULT_PASS_SOURCE_REQUIRED'; END IF;
        IF EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result='ASSERTION_FAILED') AND EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result='PASS') THEN
          IF NOT(result_row.review_flags ? 'FLAKY_SUSPECTED') THEN RAISE EXCEPTION 'QA_FLAKY_FLAG_REQUIRED'; END IF;
          IF result_row.result NOT IN('INCONCLUSIVE','PASS') OR (result_row.result='PASS' AND result_row.flaky_finding_id IS NULL) THEN RAISE EXCEPTION 'QA_FLAKY_DISPOSITION_BASIS_REQUIRED'; END IF;
        END IF;
        RETURN NULL;
      END;$qa$;

      CREATE OR REPLACE FUNCTION qa_assert_attempt_lineage_decision() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; failed_count integer; covered_count integer; review_stage text; review_hash text;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND OR result_row.result<>'PASS' OR NOT(result_row.review_flags ? 'FLAKY_SUSPECTED') THEN RETURN NULL; END IF;
        SELECT stage,active_membership_set_hash INTO review_stage,review_hash FROM qa_finding_review_revisions WHERE finding_review_revision_id=result_row.flaky_disposed_review_id AND finding_id=result_row.flaky_finding_id AND version=result_row.flaky_disposed_review_version AND content_hash=result_row.flaky_disposed_review_content_hash;
        IF review_stage IS DISTINCT FROM 'DISPOSED' OR review_hash IS DISTINCT FROM result_row.flaky_membership_set_hash THEN RAISE EXCEPTION 'QA_FLAKY_FINDING_BASIS_STALE'; END IF;
        SELECT count(*) INTO failed_count FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result='ASSERTION_FAILED';
        SELECT count(DISTINCT fm.failed_attempt_id) INTO covered_count FROM qa_plan_item_result_flaky_observation_memberships fm JOIN qa_observations o ON o.observation_id=fm.observation_id AND o.attempt_id=fm.failed_attempt_id JOIN qa_finding_observations fo ON fo.membership_id=fm.finding_membership_id AND fo.finding_id=fm.finding_id AND fo.observation_id=fm.observation_id WHERE fm.result_revision_id=result_row.result_revision_id AND fm.finding_id=result_row.flaky_finding_id AND o.kind IN('NEGATIVE','AMBIGUOUS') AND fo.state='ACTIVE';
        IF failed_count=0 OR failed_count<>covered_count THEN RAISE EXCEPTION 'QA_FLAKY_FINDING_COVERAGE_INVALID'; END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_flaky_result_basis_guard AFTER INSERT ON qa_plan_item_result_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_attempt_lineage_decision();
      CREATE CONSTRAINT TRIGGER qa_flaky_membership_basis_guard AFTER INSERT ON qa_plan_item_result_flaky_observation_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_attempt_lineage_decision();

      CREATE OR REPLACE FUNCTION qa_assert_session_reviewable(input_session_id text) RETURNS boolean LANGUAGE plpgsql AS $qa$
      DECLARE missing_observations integer; incomplete_findings integer;
      BEGIN
        SELECT count(*) INTO missing_observations FROM qa_observations o WHERE o.session_id=input_session_id AND o.kind IN('NEGATIVE','AMBIGUOUS') AND NOT EXISTS(SELECT 1 FROM qa_observations s WHERE s.corrects_observation_id=o.observation_id) AND NOT EXISTS(SELECT 1 FROM qa_finding_observations fo WHERE fo.observation_id=o.observation_id AND fo.state='ACTIVE');
        IF missing_observations>0 THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        SELECT count(*) INTO incomplete_findings FROM qa_findings f WHERE f.session_id=input_session_id AND (f.state<>'DISPOSED' OR NOT EXISTS(SELECT 1 FROM qa_finding_observations fo WHERE fo.finding_id=f.finding_id AND fo.state='ACTIVE') OR NOT EXISTS(SELECT 1 FROM qa_finding_review_revisions r WHERE r.finding_review_revision_id=f.current_review_revision_id AND r.stage='DISPOSED'));
        IF incomplete_findings>0 THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        RETURN true;
      END;$qa$;
    `);
    for (const table of ["qa_finding_review_revisions", "qa_defect_links"])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION qa_ao_flaky_members() RETURNS trigger LANGUAGE plpgsql AS $qa$ BEGIN RAISE EXCEPTION 'APPEND_ONLY:%',TG_TABLE_NAME; END;$qa$;
      CREATE TRIGGER qa_ao_flaky_members_trigger BEFORE UPDATE OR DELETE ON qa_plan_item_result_flaky_observation_memberships FOR EACH ROW EXECUTE FUNCTION qa_ao_flaky_members();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS qa_defect_draft_chain_guard ON qa_defect_drafts;DROP FUNCTION IF EXISTS qa_guard_defect_draft_chain();
      DROP FUNCTION IF EXISTS qa_assert_session_reviewable(text);DROP FUNCTION IF EXISTS qa_assert_attempt_lineage_decision();DROP FUNCTION IF EXISTS qa_guard_finding_membership_mutation();
      ALTER TABLE qa_evidence_artifact_links DROP CONSTRAINT IF EXISTS qa_evidence_owner_shape_2025,DROP CONSTRAINT IF EXISTS qa_evidence_owner_kind_2025,DROP CONSTRAINT IF EXISTS qa_evidence_finding_owner_fk,DROP COLUMN IF EXISTS owner_finding_id;
      ALTER TABLE qa_evidence_artifact_links ADD CONSTRAINT qa_evidence_artifact_links_owner_kind_check CHECK(owner_kind IN('SESSION','PLAN_ITEM','MANUAL_ATTEMPT','OBSERVATION'));
      ALTER TABLE qa_evidence_artifact_links ADD CONSTRAINT qa_evidence_owner_shape_2020 CHECK((owner_kind='SESSION' AND owner_session_id IS NOT NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL) OR (owner_kind='PLAN_ITEM' AND owner_session_id IS NULL AND owner_plan_item_id IS NOT NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL) OR (owner_kind='MANUAL_ATTEMPT' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NOT NULL AND owner_observation_id IS NULL) OR (owner_kind='OBSERVATION' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NOT NULL));
      DROP TABLE qa_defect_links;DROP TABLE qa_defect_drafts;DROP TABLE qa_plan_item_result_flaky_observation_memberships;
      ALTER TABLE qa_plan_item_result_revisions DROP CONSTRAINT IF EXISTS qa_result_flaky_finding_review_fk,DROP CONSTRAINT IF EXISTS qa_result_flaky_basis_shape,
        DROP COLUMN flaky_policy_hash,DROP COLUMN flaky_policy_version,DROP COLUMN flaky_policy_key,DROP COLUMN flaky_observation_set_hash,DROP COLUMN flaky_failed_attempt_set_hash,DROP COLUMN flaky_membership_set_hash,DROP COLUMN flaky_disposed_review_content_hash,DROP COLUMN flaky_disposed_review_version,DROP COLUMN flaky_disposed_review_id,DROP COLUMN flaky_finding_id;
      ALTER TABLE qa_findings DROP CONSTRAINT IF EXISTS qa_finding_current_review_fk,DROP CONSTRAINT IF EXISTS qa_finding_latest_historical_review_fk,DROP CONSTRAINT IF EXISTS qa_finding_frozen_review_fk;
      DROP TABLE qa_finding_review_revisions;DROP TABLE qa_finding_observations;DROP TABLE qa_findings;
    `);
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

export class QaAutomationReviewQuarantine20601700000002060 implements MigrationInterface {
  readonly name = "QaAutomationReviewQuarantine20601700000002060";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_automation_quarantines(
        quarantine_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        subject_kind text NOT NULL CHECK(subject_kind IN('SUITE_BINDING_VERSION','INFRASTRUCTURE_CODE')),
        suite_binding_id text NULL,
        suite_binding_version integer NULL CHECK(suite_binding_version IS NULL OR suite_binding_version>=1),
        suite_binding_content_hash text NULL CHECK(suite_binding_content_hash IS NULL OR suite_binding_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        infrastructure_code text NULL CHECK(infrastructure_code IS NULL OR infrastructure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        current_revision_id text NOT NULL,
        current_revision_no integer NOT NULL CHECK(current_revision_no>=1),
        current_revision_hash text NOT NULL CHECK(current_revision_hash ~ '^sha256:[a-f0-9]{64}$'),
        current_action text NOT NULL CHECK(current_action IN('ACTIVATE','LIFT')),
        current_expires_at timestamptz NULL,
        resource_version bigint NOT NULL CHECK(resource_version>=1),
        created_by_principal_id uuid NOT NULL REFERENCES identities(id),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY(quarantine_id),
        UNIQUE(quarantine_id,workspace_id,project_id),
        UNIQUE(current_revision_id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(suite_binding_id,suite_binding_version,suite_binding_content_hash)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_id,version,content_hash),
        CHECK(
          (subject_kind='SUITE_BINDING_VERSION' AND suite_binding_id IS NOT NULL
            AND suite_binding_version IS NOT NULL AND suite_binding_content_hash IS NOT NULL
            AND infrastructure_code IS NULL)
          OR
          (subject_kind='INFRASTRUCTURE_CODE' AND suite_binding_id IS NULL
            AND suite_binding_version IS NULL AND suite_binding_content_hash IS NULL
            AND infrastructure_code IS NOT NULL)
        ),
        CHECK((current_action='ACTIVATE')=(current_expires_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX qa_quarantine_suite_subject_once
        ON qa_automation_quarantines(workspace_id,project_id,suite_binding_id,suite_binding_version,suite_binding_content_hash)
        WHERE subject_kind='SUITE_BINDING_VERSION';
      CREATE UNIQUE INDEX qa_quarantine_infrastructure_subject_once
        ON qa_automation_quarantines(workspace_id,project_id,infrastructure_code)
        WHERE subject_kind='INFRASTRUCTURE_CODE';

      CREATE TABLE qa_automation_quarantine_revisions(
        quarantine_revision_id text NOT NULL,
        quarantine_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        revision_no integer NOT NULL CHECK(revision_no>=1),
        previous_revision_id text NULL,
        previous_revision_hash text NULL CHECK(previous_revision_hash IS NULL OR previous_revision_hash ~ '^sha256:[a-f0-9]{64}$'),
        subject_kind text NOT NULL CHECK(subject_kind IN('SUITE_BINDING_VERSION','INFRASTRUCTURE_CODE')),
        suite_binding_id text NULL,
        suite_binding_version integer NULL CHECK(suite_binding_version IS NULL OR suite_binding_version>=1),
        suite_binding_content_hash text NULL CHECK(suite_binding_content_hash IS NULL OR suite_binding_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        infrastructure_code text NULL CHECK(infrastructure_code IS NULL OR infrastructure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        action text NOT NULL CHECK(action IN('ACTIVATE','LIFT')),
        owner_principal_id uuid NOT NULL REFERENCES identities(id),
        reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1024),
        evidence_refs jsonb NOT NULL,
        evidence_set_hash text NOT NULL CHECK(evidence_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        policy_ref text NOT NULL CHECK(length(btrim(policy_ref)) BETWEEN 1 AND 512),
        policy_content_hash text NOT NULL CHECK(policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        maximum_lifetime_seconds integer NOT NULL CHECK(maximum_lifetime_seconds BETWEEN 1 AND 31536000),
        expires_at timestamptz NULL,
        actor_kind text NOT NULL CHECK(actor_kind='HUMAN'),
        actor_principal_id uuid NOT NULL REFERENCES identities(id),
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(quarantine_revision_id),
        UNIQUE(quarantine_revision_id,workspace_id,project_id,quarantine_id),
        UNIQUE(quarantine_revision_id,workspace_id,project_id,quarantine_id,revision_no,content_hash),
        UNIQUE(quarantine_id,revision_no),
        FOREIGN KEY(quarantine_id,workspace_id,project_id)
          REFERENCES qa_automation_quarantines(quarantine_id,workspace_id,project_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,quarantine_id)
          REFERENCES qa_automation_quarantine_revisions(quarantine_revision_id,workspace_id,project_id,quarantine_id)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(suite_binding_id,suite_binding_version,suite_binding_content_hash)
          REFERENCES qa_automation_suite_binding_versions(suite_binding_id,version,content_hash),
        CHECK(jsonb_typeof(evidence_refs)='array' AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 32),
        CHECK(
          (subject_kind='SUITE_BINDING_VERSION' AND suite_binding_id IS NOT NULL
            AND suite_binding_version IS NOT NULL AND suite_binding_content_hash IS NOT NULL
            AND infrastructure_code IS NULL)
          OR
          (subject_kind='INFRASTRUCTURE_CODE' AND suite_binding_id IS NULL
            AND suite_binding_version IS NULL AND suite_binding_content_hash IS NULL
            AND infrastructure_code IS NOT NULL)
        ),
        CHECK(
          (revision_no=1 AND previous_revision_id IS NULL AND previous_revision_hash IS NULL AND action='ACTIVATE')
          OR (revision_no>1 AND previous_revision_id IS NOT NULL AND previous_revision_hash IS NOT NULL)
        ),
        CHECK(
          (action='ACTIVATE' AND expires_at IS NOT NULL AND expires_at>created_at
            AND expires_at<=created_at+make_interval(secs=>maximum_lifetime_seconds))
          OR (action='LIFT' AND expires_at IS NULL)
        )
      );
      ALTER TABLE qa_automation_quarantines
        ADD CONSTRAINT qa_quarantine_current_revision_fk
          FOREIGN KEY(current_revision_id,workspace_id,project_id,quarantine_id,current_revision_no,current_revision_hash)
          REFERENCES qa_automation_quarantine_revisions(quarantine_revision_id,workspace_id,project_id,quarantine_id,revision_no,content_hash)
          DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_automation_review_freezes(
        freeze_id text NOT NULL,
        workspace_id uuid NOT NULL,
        project_id uuid NOT NULL,
        work_item_id uuid NOT NULL,
        session_id text NOT NULL,
        plan_item_id text NOT NULL,
        source_kind text NOT NULL CHECK(source_kind IN('PLAN_ITEM_RESULT','SESSION_REVIEW')),
        plan_item_result_revision_id text NOT NULL,
        plan_item_result_version integer NOT NULL CHECK(plan_item_result_version>=1),
        plan_item_result_content_hash text NOT NULL CHECK(plan_item_result_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        session_review_id text NULL,
        session_review_version integer NULL CHECK(session_review_version IS NULL OR session_review_version>=1),
        session_review_content_hash text NULL CHECK(session_review_content_hash IS NULL OR session_review_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        attempt_set_hash text NOT NULL CHECK(attempt_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        maximum_attempt_no integer NOT NULL CHECK(maximum_attempt_no>=1),
        attempt_count integer NOT NULL CHECK(attempt_count>=1),
        result_set_hash text NOT NULL CHECK(result_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        retry_decision_set_hash text NOT NULL CHECK(retry_decision_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        artifact_descriptor_set_hash text NOT NULL CHECK(artifact_descriptor_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        observation_set_hash text NOT NULL CHECK(observation_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        finding_set_hash text NOT NULL CHECK(finding_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        evidence_set_hash text NOT NULL CHECK(evidence_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        adjudicative_manifest_revision_id text NOT NULL,
        adjudicative_manifest_content_hash text NOT NULL CHECK(adjudicative_manifest_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        quarantine_warning_set_hash text NOT NULL CHECK(quarantine_warning_set_hash ~ '^sha256:[a-f0-9]{64}$'),
        risk_policy_ref text NOT NULL CHECK(length(btrim(risk_policy_ref)) BETWEEN 1 AND 512),
        risk_policy_content_hash text NOT NULL CHECK(risk_policy_content_hash ~ '^sha256:[a-f0-9]{64}$'),
        frozen_by_kind text NOT NULL CHECK(frozen_by_kind='HUMAN'),
        frozen_by_principal_id uuid NOT NULL REFERENCES identities(id),
        authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        frozen_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        causation_id text NOT NULL,
        content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(freeze_id),
        UNIQUE(freeze_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        UNIQUE(workspace_id,project_id,session_id,plan_item_id),
        UNIQUE(plan_item_result_revision_id),
        FOREIGN KEY(session_id,workspace_id,project_id)
          REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(plan_item_id,workspace_id,project_id)
          REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(plan_item_result_revision_id,workspace_id,project_id,plan_item_id,plan_item_result_version,plan_item_result_content_hash)
          REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id,version,content_hash)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(session_review_id,session_id,session_review_version,session_review_content_hash)
          REFERENCES qa_session_reviews(session_review_id,session_id,version,content_hash)
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(adjudicative_manifest_revision_id,workspace_id,project_id,work_item_id,session_id)
          REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,workspace_id,project_id,work_item_id,session_id)
          DEFERRABLE INITIALLY DEFERRED,
        CHECK(maximum_attempt_no=attempt_count),
        CHECK(
          (source_kind='PLAN_ITEM_RESULT' AND session_review_id IS NULL
            AND session_review_version IS NULL AND session_review_content_hash IS NULL)
          OR
          (source_kind='SESSION_REVIEW' AND session_review_id IS NOT NULL
            AND session_review_version IS NOT NULL AND session_review_content_hash IS NOT NULL)
        )
      );

      CREATE OR REPLACE FUNCTION qa_guard_quarantine_revision_insert() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE header_row qa_automation_quarantines%ROWTYPE; prior_row qa_automation_quarantine_revisions%ROWTYPE;
      BEGIN
        SELECT * INTO header_row FROM qa_automation_quarantines WHERE quarantine_id=NEW.quarantine_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NEW; END IF;
        IF ROW(NEW.subject_kind,NEW.suite_binding_id,NEW.suite_binding_version,NEW.suite_binding_content_hash,NEW.infrastructure_code)
          IS DISTINCT FROM ROW(header_row.subject_kind,header_row.suite_binding_id,header_row.suite_binding_version,header_row.suite_binding_content_hash,header_row.infrastructure_code)
        THEN RAISE EXCEPTION 'QA_QUARANTINE_SUBJECT_MISMATCH'; END IF;
        IF NEW.revision_no=1 THEN
          IF NEW.action<>'ACTIVATE' OR EXISTS(SELECT 1 FROM qa_automation_quarantine_revisions WHERE quarantine_id=NEW.quarantine_id) THEN
            RAISE EXCEPTION 'QA_QUARANTINE_INITIAL_REVISION_INVALID';
          END IF;
        ELSE
          SELECT * INTO prior_row FROM qa_automation_quarantine_revisions
            WHERE quarantine_revision_id=NEW.previous_revision_id AND quarantine_id=NEW.quarantine_id FOR UPDATE;
          IF NOT FOUND OR prior_row.revision_no<>NEW.revision_no-1 OR prior_row.content_hash<>NEW.previous_revision_hash
            OR prior_row.action=NEW.action THEN
            RAISE EXCEPTION 'QA_QUARANTINE_REVISION_CHAIN_INVALID';
          END IF;
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_quarantine_revision_insert_guard
        BEFORE INSERT ON qa_automation_quarantine_revisions
        FOR EACH ROW EXECUTE FUNCTION qa_guard_quarantine_revision_insert();

      CREATE OR REPLACE FUNCTION qa_guard_quarantine_header_mutation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE revision_row qa_automation_quarantine_revisions%ROWTYPE;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY:qa_automation_quarantines'; END IF;
        IF ROW(NEW.quarantine_id,NEW.workspace_id,NEW.project_id,NEW.subject_kind,NEW.suite_binding_id,
          NEW.suite_binding_version,NEW.suite_binding_content_hash,NEW.infrastructure_code,NEW.created_by_principal_id,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.quarantine_id,OLD.workspace_id,OLD.project_id,OLD.subject_kind,OLD.suite_binding_id,
          OLD.suite_binding_version,OLD.suite_binding_content_hash,OLD.infrastructure_code,OLD.created_by_principal_id,OLD.created_at)
        THEN RAISE EXCEPTION 'QA_QUARANTINE_IDENTITY_IMMUTABLE'; END IF;
        IF NEW.current_revision_no<>OLD.current_revision_no+1 OR NEW.resource_version<>OLD.resource_version+1 THEN
          RAISE EXCEPTION 'QA_QUARANTINE_HEAD_CAS_INVALID';
        END IF;
        SELECT * INTO revision_row FROM qa_automation_quarantine_revisions
          WHERE quarantine_revision_id=NEW.current_revision_id AND quarantine_id=NEW.quarantine_id;
        IF NOT FOUND OR revision_row.revision_no<>NEW.current_revision_no OR revision_row.content_hash<>NEW.current_revision_hash
          OR revision_row.action<>NEW.current_action OR revision_row.expires_at IS DISTINCT FROM NEW.current_expires_at THEN
          RAISE EXCEPTION 'QA_QUARANTINE_HEAD_MISMATCH';
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_quarantine_header_mutation_guard
        BEFORE UPDATE OR DELETE ON qa_automation_quarantines
        FOR EACH ROW EXECUTE FUNCTION qa_guard_quarantine_header_mutation();

      CREATE OR REPLACE FUNCTION qa_assert_quarantine_head() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_id text; header_row qa_automation_quarantines%ROWTYPE; revision_row qa_automation_quarantine_revisions%ROWTYPE;
      BEGIN
        subject_id := COALESCE(NEW.quarantine_id,OLD.quarantine_id);
        SELECT * INTO header_row FROM qa_automation_quarantines WHERE quarantine_id=subject_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO revision_row FROM qa_automation_quarantine_revisions WHERE quarantine_revision_id=header_row.current_revision_id;
        IF NOT FOUND OR revision_row.quarantine_id<>header_row.quarantine_id
          OR revision_row.revision_no<>header_row.current_revision_no OR revision_row.content_hash<>header_row.current_revision_hash
          OR revision_row.action<>header_row.current_action OR revision_row.expires_at IS DISTINCT FROM header_row.current_expires_at THEN
          RAISE EXCEPTION 'QA_QUARANTINE_HEAD_MISMATCH';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_quarantine_header_integrity_guard
        AFTER INSERT OR UPDATE ON qa_automation_quarantines
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_quarantine_head();
      CREATE CONSTRAINT TRIGGER qa_quarantine_revision_integrity_guard
        AFTER INSERT ON qa_automation_quarantine_revisions
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_quarantine_head();

      CREATE OR REPLACE FUNCTION qa_attempt_terminal_outcome_v2(input_attempt_id text) RETURNS text LANGUAGE sql STABLE AS $qa$
        SELECT CASE identity.mode
          WHEN 'MANUAL' THEN (SELECT manual.result FROM qa_manual_attempts manual WHERE manual.attempt_id=identity.attempt_id AND manual.state='COMPLETED')
          WHEN 'AUTOMATED' THEN (SELECT automated.technical_outcome FROM qa_automation_attempt_results automated WHERE automated.attempt_id=identity.attempt_id)
        END
        FROM qa_attempt_identities identity WHERE identity.attempt_id=input_attempt_id
      $qa$;

      CREATE OR REPLACE FUNCTION qa_assert_plan_item_result_complete() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; attempt_count integer; observation_count integer;
        current_leaf_count integer; negative_attempts integer; covered_negative_attempts integer; pass_sources integer;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO attempt_count FROM qa_plan_item_result_attempt_memberships WHERE result_revision_id=result_row.result_revision_id;
        SELECT count(*) INTO observation_count FROM qa_plan_item_result_observation_memberships WHERE result_revision_id=result_row.result_revision_id;
        IF result_row.result='NOT_RUN' THEN
          IF attempt_count<>0 OR observation_count<>0 OR EXISTS(SELECT 1 FROM qa_attempt_identities WHERE plan_item_id=result_row.plan_item_id)
          THEN RAISE EXCEPTION 'QA_RESULT_NOT_RUN_SET_INVALID'; END IF;
          RETURN NULL;
        END IF;
        IF attempt_count<>result_row.maximum_attempt_no OR attempt_count=0 OR observation_count=0 THEN
          RAISE EXCEPTION 'QA_RESULT_COMPLETE_SET_INVALID';
        END IF;
        IF EXISTS(
          SELECT 1 FROM generate_series(1,result_row.maximum_attempt_no) expected_no
          WHERE NOT EXISTS(
            SELECT 1 FROM qa_plan_item_result_attempt_memberships membership
            JOIN qa_attempt_identities identity ON identity.attempt_id=membership.attempt_id
            WHERE membership.result_revision_id=result_row.result_revision_id
              AND identity.attempt_no=expected_no AND qa_attempt_terminal_outcome_v2(identity.attempt_id) IS NOT NULL
          )
        ) THEN RAISE EXCEPTION 'QA_RESULT_ATTEMPT_SEQUENCE_GAPPED'; END IF;
        SELECT count(*) INTO current_leaf_count FROM qa_observations observation
          JOIN qa_plan_item_result_attempt_memberships membership
            ON membership.result_revision_id=result_row.result_revision_id AND membership.attempt_id=observation.attempt_id
          WHERE NOT EXISTS(SELECT 1 FROM qa_observations successor WHERE successor.corrects_observation_id=observation.observation_id);
        IF current_leaf_count<>observation_count THEN RAISE EXCEPTION 'STALE_OBSERVATION_SET'; END IF;
        SELECT count(*) INTO negative_attempts FROM qa_plan_item_result_attempt_memberships membership
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND qa_attempt_terminal_outcome_v2(membership.attempt_id) IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE');
        SELECT count(DISTINCT membership.attempt_id) INTO covered_negative_attempts
          FROM qa_plan_item_result_attempt_memberships membership
          JOIN qa_plan_item_result_observation_memberships observation_membership
            ON observation_membership.result_revision_id=membership.result_revision_id AND observation_membership.attempt_id=membership.attempt_id
          JOIN qa_observations observation ON observation.observation_id=observation_membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND qa_attempt_terminal_outcome_v2(membership.attempt_id) IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE')
            AND observation.kind IN('NEGATIVE','AMBIGUOUS');
        IF negative_attempts<>covered_negative_attempts THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        IF result_row.result IN('FAIL','BLOCKED','INCONCLUSIVE') AND NOT EXISTS(
          SELECT 1 FROM qa_plan_item_result_observation_memberships membership
          JOIN qa_observations observation ON observation.observation_id=membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND observation.kind IN('NEGATIVE','AMBIGUOUS')
        ) THEN RAISE EXCEPTION 'FINDING_REQUIRED'; END IF;
        SELECT count(*) INTO pass_sources FROM qa_plan_item_result_observation_memberships membership
          JOIN qa_observations observation ON observation.observation_id=membership.observation_id
          WHERE membership.result_revision_id=result_row.result_revision_id AND observation.kind='POSITIVE'
            AND qa_attempt_terminal_outcome_v2(membership.attempt_id)='PASS';
        IF result_row.result='PASS' AND pass_sources=0 THEN RAISE EXCEPTION 'QA_RESULT_PASS_SOURCE_REQUIRED'; END IF;
        IF EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships membership WHERE membership.result_revision_id=result_row.result_revision_id AND qa_attempt_terminal_outcome_v2(membership.attempt_id)='ASSERTION_FAILED')
          AND EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships membership WHERE membership.result_revision_id=result_row.result_revision_id AND qa_attempt_terminal_outcome_v2(membership.attempt_id)='PASS') THEN
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
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND qa_attempt_terminal_outcome_v2(membership.attempt_id)='ASSERTION_FAILED';
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
          JOIN qa_attempt_identities identity ON identity.attempt_id=membership.attempt_id
          WHERE membership.result_revision_id=result_row.result_revision_id
            AND qa_attempt_terminal_outcome_v2(identity.attempt_id) IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE')
            AND NOT EXISTS(
              SELECT 1 FROM qa_evidence_artifact_links evidence
              WHERE evidence.workspace_id=identity.workspace_id AND evidence.project_id=identity.project_id
                AND evidence.session_id=identity.session_id AND evidence.owner_attempt_id=identity.attempt_id
                AND evidence.owner_kind IN('MANUAL_ATTEMPT','ATTEMPT')
            );
        IF uncovered_attempts>0 THEN RAISE EXCEPTION 'QA_ATTEMPT_EVIDENCE_REQUIRED'; END IF;
        RETURN NULL;
      END;$qa$;

      CREATE OR REPLACE FUNCTION qa_guard_automation_session_transition() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF OLD.mode<>'AUTOMATED' THEN RETURN NEW; END IF;
        IF OLD.state=NEW.state THEN RETURN NEW; END IF;
        IF NOT(
          (OLD.state='PLANNED' AND NEW.state IN('READY','BLOCKED','CANCELLED'))
          OR (OLD.state='READY' AND NEW.state IN('RUNNING','BLOCKED','CANCELLED'))
          OR (OLD.state='RUNNING' AND NEW.state IN('REVIEW_REQUIRED','BLOCKED'))
          OR (OLD.state='REVIEW_REQUIRED' AND NEW.state IN('COMPLETED','BLOCKED'))
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_SESSION_TRANSITION_INVALID'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_automation_session_transition_guard
        BEFORE UPDATE OF state ON qa_test_sessions
        FOR EACH ROW EXECUTE FUNCTION qa_guard_automation_session_transition();

      CREATE OR REPLACE FUNCTION qa_assert_automation_session_review_state() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE subject_session_id text; session_mode text; session_state text;
      BEGIN
        SELECT session_id INTO subject_session_id FROM qa_automation_attempts WHERE attempt_id=COALESCE(NEW.attempt_id,OLD.attempt_id);
        SELECT mode,state INTO session_mode,session_state FROM qa_test_sessions WHERE session_id=subject_session_id;
        IF session_mode='AUTOMATED' AND session_state NOT IN('REVIEW_REQUIRED','COMPLETED','BLOCKED') THEN
          RAISE EXCEPTION 'QA_AUTOMATION_TERMINAL_REVIEW_REQUIRED';
        END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_automation_result_review_state_guard
        AFTER INSERT ON qa_automation_attempt_results
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_session_review_state();

      CREATE OR REPLACE FUNCTION qa_guard_attempt_after_review_freeze() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF EXISTS(
          SELECT 1 FROM qa_automation_review_freezes review_freeze
          WHERE review_freeze.workspace_id=NEW.workspace_id AND review_freeze.project_id=NEW.project_id
            AND review_freeze.session_id=NEW.session_id AND review_freeze.plan_item_id=NEW.plan_item_id
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_ATTEMPT_SET_FROZEN'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_automation_attempt_review_freeze_guard
        BEFORE INSERT ON qa_automation_attempts
        FOR EACH ROW EXECUTE FUNCTION qa_guard_attempt_after_review_freeze();

      CREATE OR REPLACE FUNCTION qa_assert_automation_review_freeze() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE session_mode text; session_state text; plan_state text; latest_result_id text;
        result_attempt_set_hash text; result_maximum_attempt_no integer; actual_attempt_count integer;
      BEGIN
        SELECT mode,state INTO session_mode,session_state FROM qa_test_sessions WHERE session_id=NEW.session_id FOR UPDATE;
        SELECT state,latest_result_revision_id INTO plan_state,latest_result_id FROM qa_plan_items WHERE plan_item_id=NEW.plan_item_id FOR UPDATE;
        SELECT attempt_set_hash,maximum_attempt_no INTO result_attempt_set_hash,result_maximum_attempt_no
          FROM qa_plan_item_result_revisions WHERE result_revision_id=NEW.plan_item_result_revision_id;
        SELECT count(*) INTO actual_attempt_count FROM qa_automation_attempts WHERE session_id=NEW.session_id AND plan_item_id=NEW.plan_item_id;
        IF session_mode<>'AUTOMATED' OR session_state<>'REVIEW_REQUIRED' OR plan_state<>'TERMINAL'
          OR latest_result_id<>NEW.plan_item_result_revision_id
          OR result_attempt_set_hash<>NEW.attempt_set_hash OR result_maximum_attempt_no<>NEW.maximum_attempt_no
          OR actual_attempt_count<>NEW.attempt_count OR actual_attempt_count<>NEW.maximum_attempt_no THEN
          RAISE EXCEPTION 'QA_AUTOMATION_REVIEW_FREEZE_STALE';
        END IF;
        IF EXISTS(
          SELECT 1 FROM generate_series(1,NEW.maximum_attempt_no) expected_no
          WHERE NOT EXISTS(
            SELECT 1 FROM qa_automation_attempts attempt
            WHERE attempt.session_id=NEW.session_id AND attempt.plan_item_id=NEW.plan_item_id
              AND attempt.attempt_no=expected_no AND attempt.current_status='TERMINAL'
              AND attempt.terminal_result_id IS NOT NULL
          )
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_REVIEW_ATTEMPT_SET_INCOMPLETE'; END IF;
        IF EXISTS(
          SELECT 1 FROM qa_automation_attempts attempt
          WHERE attempt.session_id=NEW.session_id AND attempt.plan_item_id=NEW.plan_item_id
            AND (
              NOT EXISTS(SELECT 1 FROM qa_automation_attempt_results result WHERE result.attempt_id=attempt.attempt_id)
              OR NOT EXISTS(SELECT 1 FROM qa_automation_retry_decisions retry WHERE retry.attempt_id=attempt.attempt_id)
              OR NOT EXISTS(SELECT 1 FROM connector_commands command WHERE command.id=attempt.connector_command_id AND command.state IN('CONFIRMED','CONFLICT','FAILED','CANCELLED'))
              OR NOT EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships membership WHERE membership.result_revision_id=NEW.plan_item_result_revision_id AND membership.attempt_id=attempt.attempt_id)
            )
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_REVIEW_ATTEMPT_UNSETTLED'; END IF;
        IF EXISTS(
          SELECT 1 FROM qa_automation_retry_decisions retry
          JOIN qa_automation_attempts attempt ON attempt.attempt_id=retry.attempt_id
          WHERE attempt.session_id=NEW.session_id AND attempt.plan_item_id=NEW.plan_item_id
            AND retry.decision='SCHEDULED'
            AND NOT EXISTS(SELECT 1 FROM qa_automation_attempts successor WHERE successor.attempt_id=retry.successor_attempt_id)
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_RETRY_SUCCESSOR_MISSING'; END IF;
        IF EXISTS(
          SELECT 1 FROM connector_target_execution_lanes lane
          JOIN qa_automation_attempts attempt ON attempt.connector_command_id=lane.active_command_id
          WHERE attempt.session_id=NEW.session_id AND attempt.plan_item_id=NEW.plan_item_id AND lane.state<>'RELEASED'
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_EXECUTION_LANE_ACTIVE'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_automation_review_freeze_insert_guard
        BEFORE INSERT ON qa_automation_review_freezes
        FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_review_freeze();

      CREATE OR REPLACE FUNCTION qa_assert_automation_session_completion() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE plan_row qa_plan_items%ROWTYPE; freeze_row qa_automation_review_freezes%ROWTYPE;
        review_execution_set_hash text; attempt_count integer;
      BEGIN
        IF NEW.mode<>'AUTOMATED' OR NEW.state<>'COMPLETED' THEN RETURN NULL; END IF;
        SELECT * INTO plan_row FROM qa_plan_items WHERE session_id=NEW.session_id;
        SELECT * INTO freeze_row FROM qa_automation_review_freezes WHERE session_id=NEW.session_id AND plan_item_id=plan_row.plan_item_id;
        SELECT execution_set_hash INTO review_execution_set_hash FROM qa_session_reviews WHERE session_review_id=NEW.latest_session_review_id;
        SELECT count(*) INTO attempt_count FROM qa_automation_attempts WHERE session_id=NEW.session_id;
        IF freeze_row.freeze_id IS NULL OR plan_row.state<>'TERMINAL'
          OR plan_row.latest_result_revision_id<>freeze_row.plan_item_result_revision_id
          OR NEW.adjudicative_manifest_revision_id<>freeze_row.adjudicative_manifest_revision_id
          OR review_execution_set_hash<>freeze_row.attempt_set_hash OR attempt_count<>freeze_row.attempt_count
          OR NOT qa_assert_session_reviewable(NEW.session_id) THEN
          RAISE EXCEPTION 'QA_AUTOMATION_SESSION_COMPLETION_BLOCKED';
        END IF;
        IF EXISTS(
          SELECT 1 FROM qa_automation_attempts attempt
          WHERE attempt.session_id=NEW.session_id AND (
            attempt.current_status<>'TERMINAL' OR attempt.terminal_result_id IS NULL
            OR NOT EXISTS(SELECT 1 FROM qa_automation_retry_decisions retry WHERE retry.attempt_id=attempt.attempt_id)
            OR NOT EXISTS(SELECT 1 FROM connector_commands command WHERE command.id=attempt.connector_command_id AND command.state IN('CONFIRMED','CONFLICT','FAILED','CANCELLED'))
          )
        ) THEN RAISE EXCEPTION 'QA_AUTOMATION_SESSION_EXECUTION_UNSETTLED'; END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_automation_session_completion_guard
        AFTER INSERT OR UPDATE ON qa_test_sessions
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_automation_session_completion();

      CREATE INDEX qa_quarantine_scope_idx
        ON qa_automation_quarantines(workspace_id,project_id,subject_kind,updated_at);
      CREATE INDEX qa_quarantine_expiry_idx
        ON qa_automation_quarantines(workspace_id,project_id,current_expires_at)
        WHERE current_action='ACTIVATE';
      CREATE INDEX qa_automation_review_freeze_scope_idx
        ON qa_automation_review_freezes(workspace_id,project_id,session_id,plan_item_id,frozen_at);

      UPDATE platform_schema_versions
        SET version=2060,applied_at=clock_timestamp()
        WHERE namespace='pack:qa';
    `);

    for (const table of ["qa_automation_quarantine_revisions", "qa_automation_review_freezes"])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS qa_automation_session_completion_guard ON qa_test_sessions;
      DROP FUNCTION IF EXISTS qa_assert_automation_session_completion();
      DROP TRIGGER IF EXISTS qa_automation_review_freeze_insert_guard ON qa_automation_review_freezes;
      DROP FUNCTION IF EXISTS qa_assert_automation_review_freeze();
      DROP TRIGGER IF EXISTS qa_automation_attempt_review_freeze_guard ON qa_automation_attempts;
      DROP FUNCTION IF EXISTS qa_guard_attempt_after_review_freeze();
      DROP TRIGGER IF EXISTS qa_automation_result_review_state_guard ON qa_automation_attempt_results;
      DROP FUNCTION IF EXISTS qa_assert_automation_session_review_state();
      DROP TRIGGER IF EXISTS qa_automation_session_transition_guard ON qa_test_sessions;
      DROP FUNCTION IF EXISTS qa_guard_automation_session_transition();
      DROP TRIGGER IF EXISTS qa_quarantine_revision_integrity_guard ON qa_automation_quarantine_revisions;
      DROP TRIGGER IF EXISTS qa_quarantine_header_integrity_guard ON qa_automation_quarantines;
      DROP FUNCTION IF EXISTS qa_assert_quarantine_head();
      DROP TRIGGER IF EXISTS qa_quarantine_header_mutation_guard ON qa_automation_quarantines;
      DROP FUNCTION IF EXISTS qa_guard_quarantine_header_mutation();
      DROP TRIGGER IF EXISTS qa_quarantine_revision_insert_guard ON qa_automation_quarantine_revisions;
      DROP FUNCTION IF EXISTS qa_guard_quarantine_revision_insert();
      ALTER TABLE qa_automation_quarantines DROP CONSTRAINT IF EXISTS qa_quarantine_current_revision_fk;
      DROP TABLE qa_automation_review_freezes;
      DROP TABLE qa_automation_quarantine_revisions;
      DROP TABLE qa_automation_quarantines;
      UPDATE platform_schema_versions SET version=2055,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}

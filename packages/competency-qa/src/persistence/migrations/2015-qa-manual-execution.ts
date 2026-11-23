import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

const shortAppendOnlyGuardSql = (tableName: string, key: string) => `
CREATE OR REPLACE FUNCTION "qa_ao_${key}"() RETURNS trigger LANGUAGE plpgsql AS $qa$
BEGIN RAISE EXCEPTION 'APPEND_ONLY:%', TG_TABLE_NAME; END;$qa$;
CREATE TRIGGER "qa_ao_${key}_trigger" BEFORE UPDATE OR DELETE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "qa_ao_${key}"();`;

export class QaManualExecution20151700000002015 implements MigrationInterface {
  readonly name = "QaManualExecution20151700000002015";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $qa$ DECLARE constraint_name text; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint
        WHERE conrelid='qa_plan_items'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%state%PLANNED%';
        IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE qa_plan_items DROP CONSTRAINT %I',constraint_name); END IF;
      END $qa$;
      ALTER TABLE qa_plan_items
        ADD COLUMN latest_result_revision_id text NULL,
        ADD COLUMN waiver_id text NULL,
        ADD CONSTRAINT qa_plan_item_execution_state CHECK(state IN('PLANNED','RUNNING','TERMINAL','WAIVED')),
        ADD CONSTRAINT qa_plan_item_waiver_state CHECK((state='WAIVED')=(waiver_id IS NOT NULL)),
        ADD CONSTRAINT qa_plan_item_waiver_fk FOREIGN KEY(waiver_id,workspace_id,project_id) REFERENCES qa_waivers(waiver_id,workspace_id,project_id);

      CREATE TABLE qa_manual_attempts(
        attempt_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,
        attempt_no integer NOT NULL CHECK(attempt_no>=1),state text NOT NULL CHECK(state IN('RUNNING','COMPLETED')),target_snapshot_hash text NOT NULL,
        actor jsonb NOT NULL,started_at timestamptz NOT NULL,ended_at timestamptz NULL,result text NULL CHECK(result IS NULL OR result IN('PASS','ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','CANCELLED','INCOMPLETE')),
        cancellation_reason text NULL,notes text NULL,content_hash text NOT NULL,content jsonb NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>=1),
        PRIMARY KEY(attempt_id),UNIQUE(attempt_id,workspace_id,project_id),UNIQUE(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        UNIQUE(attempt_id,workspace_id,project_id,plan_item_id,content_hash),UNIQUE(workspace_id,project_id,plan_item_id,attempt_no),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(plan_item_id,workspace_id,project_id) REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        CHECK((state='RUNNING' AND ended_at IS NULL AND result IS NULL AND cancellation_reason IS NULL) OR (state='COMPLETED' AND ended_at IS NOT NULL AND result IS NOT NULL)),
        CHECK((result='CANCELLED' AND cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason)) BETWEEN 1 AND 2000) OR (result IS DISTINCT FROM 'CANCELLED' AND cancellation_reason IS NULL)),
        CHECK(notes IS NULL OR length(notes)<=4000)
      );

      CREATE TABLE qa_observations(
        observation_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,attempt_id text NOT NULL,
        kind text NOT NULL CHECK(kind IN('POSITIVE','NEGATIVE','AMBIGUOUS','INFORMATIONAL')),expected_outcome text NOT NULL,actual_outcome text NOT NULL,severity text NOT NULL CHECK(severity IN('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
        notes text NULL,artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,corrects_observation_id text NULL,corrects_content_hash text NULL,correction_reason text NULL,
        actor jsonb NOT NULL,observed_at timestamptz NOT NULL,content_hash text NOT NULL,content jsonb NOT NULL,resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version=1),
        PRIMARY KEY(observation_id),UNIQUE(observation_id,workspace_id,project_id),UNIQUE(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id),
        UNIQUE(observation_id,workspace_id,project_id,plan_item_id,attempt_id,content_hash),UNIQUE(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id,content_hash),
        FOREIGN KEY(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id) REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id),
        FOREIGN KEY(corrects_observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id,corrects_content_hash)
          REFERENCES qa_observations(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK((corrects_observation_id IS NULL AND corrects_content_hash IS NULL AND correction_reason IS NULL) OR (corrects_observation_id IS NOT NULL AND corrects_content_hash IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 1 AND 2000)),
        CHECK(corrects_observation_id IS NULL OR corrects_observation_id<>observation_id),
        CHECK(length(btrim(expected_outcome)) BETWEEN 1 AND 4000),CHECK(length(btrim(actual_outcome)) BETWEEN 1 AND 10000),CHECK(notes IS NULL OR length(notes)<=4000)
      );
      CREATE UNIQUE INDEX qa_observation_one_successor ON qa_observations(workspace_id,project_id,corrects_observation_id) WHERE corrects_observation_id IS NOT NULL;

      CREATE TABLE qa_plan_item_result_revisions(
        result_revision_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,
        version integer NOT NULL CHECK(version>=1),previous_revision_id text NULL,previous_version integer NULL,previous_content_hash text NULL,correction_reason text NULL,
        result text NOT NULL CHECK(result IN('PASS','FAIL','BLOCKED','NOT_RUN','INCONCLUSIVE')),attempt_set_hash text NOT NULL,observation_set_hash text NOT NULL,maximum_attempt_no integer NOT NULL CHECK(maximum_attempt_no>=0),
        review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,evidence_link_set_hash text NOT NULL,waiver_id text NULL,actual_outcome text NOT NULL,decision_reason text NOT NULL,
        content_hash text NOT NULL,content jsonb NOT NULL,recorded_by jsonb NOT NULL,recorded_at timestamptz NOT NULL,
        PRIMARY KEY(result_revision_id),UNIQUE(result_revision_id,workspace_id,project_id,plan_item_id),UNIQUE(result_revision_id,workspace_id,project_id,plan_item_id,version,content_hash),
        UNIQUE(workspace_id,project_id,plan_item_id,version),
        FOREIGN KEY(plan_item_id,workspace_id,project_id) REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,plan_item_id,previous_version,previous_content_hash)
          REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(waiver_id,workspace_id,project_id) REFERENCES qa_waivers(waiver_id,workspace_id,project_id),
        CHECK((version=1 AND previous_revision_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL AND correction_reason IS NULL) OR (version>1 AND previous_revision_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 1 AND 2000)),
        CHECK((result='NOT_RUN' AND maximum_attempt_no=0 AND waiver_id IS NOT NULL) OR (result<>'NOT_RUN' AND maximum_attempt_no>0 AND waiver_id IS NULL)),
        CHECK(jsonb_typeof(review_flags)='array'),CHECK(length(btrim(actual_outcome)) BETWEEN 1 AND 10000),CHECK(length(btrim(decision_reason)) BETWEEN 1 AND 4000),
        CHECK((review_flags ? 'FLAKY_SUSPECTED') IS FALSE OR result='INCONCLUSIVE')
      );
      CREATE TABLE qa_plan_item_result_attempt_memberships(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,result_revision_id text NOT NULL,attempt_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=1),attempt_content_hash text NOT NULL,
        PRIMARY KEY(membership_id),UNIQUE(result_revision_id,attempt_id),UNIQUE(result_revision_id,ordinal),
        FOREIGN KEY(result_revision_id,workspace_id,project_id,plan_item_id) REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(attempt_id,workspace_id,project_id,plan_item_id,attempt_content_hash) REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id,plan_item_id,content_hash) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TABLE qa_plan_item_result_observation_memberships(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,result_revision_id text NOT NULL,observation_id text NOT NULL,attempt_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=1),observation_content_hash text NOT NULL,
        PRIMARY KEY(membership_id),UNIQUE(result_revision_id,observation_id),UNIQUE(result_revision_id,ordinal),
        FOREIGN KEY(result_revision_id,workspace_id,project_id,plan_item_id) REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(observation_id,workspace_id,project_id,plan_item_id,attempt_id,observation_content_hash) REFERENCES qa_observations(observation_id,workspace_id,project_id,plan_item_id,attempt_id,content_hash) DEFERRABLE INITIALLY DEFERRED
      );
      ALTER TABLE qa_plan_items ADD CONSTRAINT qa_plan_item_latest_result_fk FOREIGN KEY(latest_result_revision_id,workspace_id,project_id,plan_item_id) REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE INDEX qa_manual_attempt_scope_idx ON qa_manual_attempts(workspace_id,project_id,session_id,plan_item_id,attempt_no);
      CREATE INDEX qa_observation_scope_idx ON qa_observations(workspace_id,project_id,session_id,plan_item_id,attempt_id);
      CREATE INDEX qa_result_scope_idx ON qa_plan_item_result_revisions(workspace_id,project_id,session_id,plan_item_id,version);

      CREATE OR REPLACE FUNCTION qa_enforce_plan_item_structure_uow() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE owning_session_id text; owning_started_at timestamptz; structural_change boolean;
      BEGIN
        owning_session_id := COALESCE(NEW.session_id,OLD.session_id);
        SELECT started_at INTO owning_started_at FROM qa_test_sessions WHERE session_id=owning_session_id;
        IF TG_OP IN('INSERT','DELETE') THEN
          IF owning_started_at IS NOT NULL THEN RAISE EXCEPTION 'SESSION_SNAPSHOT_LOCKED'; END IF;
          IF current_setting('awp.qa_structure_mutation',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'QA_PLAN_ITEM_UOW_REQUIRED'; END IF;
          IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
        structural_change := ROW(NEW.ordinal,NEW.mode,NEW.title,NEW.instructions,NEW.expected_outcome,NEW.definition_ref,NEW.definition_hash,NEW.created_by,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.ordinal,OLD.mode,OLD.title,OLD.instructions,OLD.expected_outcome,OLD.definition_ref,OLD.definition_hash,OLD.created_by,OLD.created_at);
        IF structural_change THEN
          IF owning_started_at IS NOT NULL THEN RAISE EXCEPTION 'SESSION_SNAPSHOT_LOCKED'; END IF;
          IF current_setting('awp.qa_structure_mutation',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'QA_PLAN_ITEM_UOW_REQUIRED'; END IF;
        ELSIF ROW(NEW.state,NEW.latest_result_revision_id,NEW.waiver_id,NEW.resource_version,NEW.content_hash,NEW.content,NEW.updated_at) IS DISTINCT FROM ROW(OLD.state,OLD.latest_result_revision_id,OLD.waiver_id,OLD.resource_version,OLD.content_hash,OLD.content,OLD.updated_at)
          AND current_setting('awp.qa_execution_mutation',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'QA_PLAN_ITEM_EXECUTION_UOW_REQUIRED';
        END IF;
        RETURN NEW;
      END;$qa$;

      CREATE OR REPLACE FUNCTION qa_guard_manual_attempt_mutation() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE item_state text; session_state text;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY:qa_manual_attempts'; END IF;
        SELECT p.state,s.state INTO item_state,session_state FROM qa_plan_items p JOIN qa_test_sessions s ON s.session_id=p.session_id WHERE p.plan_item_id=COALESCE(NEW.plan_item_id,OLD.plan_item_id) FOR UPDATE OF p,s;
        IF item_state IN('TERMINAL','WAIVED') THEN RAISE EXCEPTION 'QA_PLAN_ITEM_EXECUTION_CLOSED'; END IF;
        IF session_state<>'RUNNING' THEN RAISE EXCEPTION 'QA_SESSION_EXECUTION_STATE_INVALID'; END IF;
        IF TG_OP='UPDATE' AND (OLD.state<>'RUNNING' OR NEW.state<>'COMPLETED' OR ROW(NEW.attempt_id,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.session_id,NEW.plan_item_id,NEW.attempt_no,NEW.target_snapshot_hash,NEW.started_at) IS DISTINCT FROM ROW(OLD.attempt_id,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.session_id,OLD.plan_item_id,OLD.attempt_no,OLD.target_snapshot_hash,OLD.started_at)) THEN RAISE EXCEPTION 'APPEND_ONLY:qa_manual_attempts'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_manual_attempt_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON qa_manual_attempts FOR EACH ROW EXECUTE FUNCTION qa_guard_manual_attempt_mutation();

      CREATE OR REPLACE FUNCTION qa_guard_observation_insert() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE item_state text; reviewed boolean; reaches_self boolean;
      BEGIN
        SELECT p.state,(s.state='COMPLETED') INTO item_state,reviewed FROM qa_plan_items p JOIN qa_test_sessions s ON s.session_id=p.session_id WHERE p.plan_item_id=NEW.plan_item_id FOR UPDATE OF p,s;
        IF reviewed THEN RAISE EXCEPTION 'QA_SESSION_REVIEWED_EXECUTION_FROZEN'; END IF;
        IF NEW.corrects_observation_id IS NULL AND item_state IN('TERMINAL','WAIVED') THEN RAISE EXCEPTION 'QA_PLAN_ITEM_EXECUTION_CLOSED'; END IF;
        IF NEW.corrects_observation_id IS NOT NULL THEN
          WITH RECURSIVE lineage(id,predecessor) AS (SELECT observation_id,corrects_observation_id FROM qa_observations WHERE observation_id=NEW.corrects_observation_id UNION ALL SELECT o.observation_id,o.corrects_observation_id FROM qa_observations o JOIN lineage l ON o.observation_id=l.predecessor) SELECT EXISTS(SELECT 1 FROM lineage WHERE id=NEW.observation_id) INTO reaches_self;
          IF reaches_self THEN RAISE EXCEPTION 'QA_OBSERVATION_CORRECTION_CYCLE'; END IF;
        END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_observation_insert_guard BEFORE INSERT ON qa_observations FOR EACH ROW EXECUTE FUNCTION qa_guard_observation_insert();

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
        IF EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result='ASSERTION_FAILED') AND EXISTS(SELECT 1 FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result='PASS') AND (NOT(result_row.review_flags ? 'FLAKY_SUSPECTED') OR result_row.result<>'INCONCLUSIVE') THEN RAISE EXCEPTION 'QA_FLAKY_US3_INCONCLUSIVE_REQUIRED'; END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_result_complete_guard AFTER INSERT ON qa_plan_item_result_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_plan_item_result_complete();
      CREATE CONSTRAINT TRIGGER qa_result_attempt_membership_guard AFTER INSERT ON qa_plan_item_result_attempt_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_plan_item_result_complete();
      CREATE CONSTRAINT TRIGGER qa_result_observation_membership_guard AFTER INSERT ON qa_plan_item_result_observation_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_plan_item_result_complete();
    `);
    await queryRunner.query(qaAppendOnlyGuardSql("qa_observations"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_plan_item_result_revisions"));
    await queryRunner.query(qaAppendOnlyGuardSql("qa_plan_item_result_attempt_memberships"));
    await queryRunner.query(
      shortAppendOnlyGuardSql(
        "qa_plan_item_result_observation_memberships",
        "result_observation_members",
      ),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE qa_plan_items DROP CONSTRAINT IF EXISTS qa_plan_item_latest_result_fk;
      DROP TABLE qa_plan_item_result_observation_memberships;
      DROP TABLE qa_plan_item_result_attempt_memberships;
      DROP TABLE qa_plan_item_result_revisions;
      DROP TABLE qa_observations;
      DROP TABLE qa_manual_attempts;
      ALTER TABLE qa_plan_items DROP CONSTRAINT IF EXISTS qa_plan_item_execution_state,DROP CONSTRAINT IF EXISTS qa_plan_item_waiver_state,DROP COLUMN latest_result_revision_id,DROP COLUMN waiver_id;
      ALTER TABLE qa_plan_items ADD CONSTRAINT qa_plan_items_state_check CHECK(state='PLANNED');
      DROP FUNCTION IF EXISTS qa_assert_plan_item_result_complete();DROP FUNCTION IF EXISTS qa_guard_observation_insert();DROP FUNCTION IF EXISTS qa_guard_manual_attempt_mutation();
    `);
  }
}

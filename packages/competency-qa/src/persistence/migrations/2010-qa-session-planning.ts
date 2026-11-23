import type { MigrationInterface, QueryRunner } from "typeorm";

export class QaSessionPlanning20101700000002010 implements MigrationInterface {
  readonly name = "QaSessionPlanning20101700000002010";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_test_sessions(
        session_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,
        ordinal integer NOT NULL CHECK(ordinal>=1),parent_session_id text NULL,plan_version_id text NOT NULL,requirement_id text NOT NULL,requirement_key text NOT NULL,
        mode text NOT NULL CHECK(mode='MANUAL'),state text NOT NULL CHECK(state IN('PLANNED','READY','RUNNING','REVIEW_REQUIRED','COMPLETED','BLOCKED','CANCELLED')),
        owner_id uuid NOT NULL REFERENCES identities(id),required_capabilities jsonb NOT NULL,target_snapshot jsonb NOT NULL,target_hash text NOT NULL,scope_snapshot jsonb NOT NULL,scope_hash text NOT NULL,
        structure_revision integer NOT NULL CHECK(structure_revision>=1),structure_hash text NOT NULL,ready_against_structure_hash text NULL,resource_version bigint NOT NULL CHECK(resource_version>=1),content jsonb NOT NULL,created_by jsonb NOT NULL,created_at timestamptz NOT NULL,
        ready_at timestamptz NULL,started_at timestamptz NULL,blocked_at timestamptz NULL,cancelled_at timestamptz NULL,blocked_from text NULL,cancelled_from text NULL,state_reason text NULL,
        PRIMARY KEY(session_id),UNIQUE(session_id,workspace_id,project_id),UNIQUE(workspace_id,project_id,work_item_id,ordinal),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        FOREIGN KEY(plan_version_id,workspace_id,project_id) REFERENCES qa_required_session_plan_versions(plan_version_id,workspace_id,project_id),
        FOREIGN KEY(requirement_id,workspace_id,project_id) REFERENCES qa_required_session_plan_requirements(requirement_id,workspace_id,project_id),
        FOREIGN KEY(parent_session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id) DEFERRABLE INITIALLY DEFERRED,
        CHECK(parent_session_id IS NULL OR parent_session_id<>session_id),
        CHECK((state='PLANNED' AND ready_against_structure_hash IS NULL) OR state<>'PLANNED'),
        CHECK((state IN('READY','RUNNING') AND ready_against_structure_hash=structure_hash) OR state NOT IN('READY','RUNNING')),
        CHECK((state='RUNNING' AND started_at IS NOT NULL) OR state<>'RUNNING')
      );
      CREATE TABLE qa_plan_items(
        plan_item_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,
        ordinal integer NOT NULL CHECK(ordinal>=1),state text NOT NULL CHECK(state='PLANNED'),mode text NOT NULL CHECK(mode='MANUAL'),title text NOT NULL,instructions text NULL,expected_outcome text NOT NULL,
        definition_ref jsonb NOT NULL,definition_hash text NOT NULL,content_hash text NOT NULL,content jsonb NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>=1),created_by jsonb NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
        PRIMARY KEY(plan_item_id),UNIQUE(plan_item_id,workspace_id,project_id),UNIQUE(session_id,ordinal),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );
      CREATE INDEX qa_test_session_scope_idx ON qa_test_sessions(workspace_id,project_id,work_item_id,ordinal);
      CREATE INDEX qa_plan_item_scope_idx ON qa_plan_items(workspace_id,project_id,session_id,ordinal);

      CREATE OR REPLACE FUNCTION qa_enforce_session_snapshot_lock() RETURNS trigger LANGUAGE plpgsql AS $qa$
      BEGIN
        IF ROW(NEW.target_snapshot,NEW.target_hash,NEW.scope_snapshot,NEW.scope_hash,NEW.owner_id,NEW.required_capabilities,NEW.structure_revision,NEW.structure_hash,NEW.plan_version_id,NEW.requirement_id)
          IS DISTINCT FROM ROW(OLD.target_snapshot,OLD.target_hash,OLD.scope_snapshot,OLD.scope_hash,OLD.owner_id,OLD.required_capabilities,OLD.structure_revision,OLD.structure_hash,OLD.plan_version_id,OLD.requirement_id)
          AND (current_setting('awp.qa_structure_mutation',true) IS DISTINCT FROM 'allowed' OR NEW.structure_revision<>OLD.structure_revision+1 OR NEW.structure_hash=OLD.structure_hash OR NEW.state<>'PLANNED' OR NEW.ready_against_structure_hash IS NOT NULL)
        THEN RAISE EXCEPTION 'QA_SESSION_STRUCTURE_UOW_REQUIRED'; END IF;
        IF OLD.started_at IS NOT NULL AND ROW(NEW.target_snapshot,NEW.target_hash,NEW.scope_snapshot,NEW.scope_hash,NEW.owner_id,NEW.required_capabilities,NEW.structure_revision,NEW.structure_hash,NEW.ready_against_structure_hash,NEW.plan_version_id,NEW.requirement_id)
          IS DISTINCT FROM ROW(OLD.target_snapshot,OLD.target_hash,OLD.scope_snapshot,OLD.scope_hash,OLD.owner_id,OLD.required_capabilities,OLD.structure_revision,OLD.structure_hash,OLD.ready_against_structure_hash,OLD.plan_version_id,OLD.requirement_id)
        THEN RAISE EXCEPTION 'SESSION_SNAPSHOT_LOCKED'; END IF;
        IF NEW.state='READY' AND NEW.ready_against_structure_hash IS DISTINCT FROM NEW.structure_hash THEN RAISE EXCEPTION 'QA_SESSION_READY_HASH_STALE'; END IF;
        IF NEW.state='PLANNED' AND NEW.ready_against_structure_hash IS NOT NULL THEN RAISE EXCEPTION 'QA_SESSION_PLANNED_READY_HASH_FORBIDDEN'; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_test_session_snapshot_lock BEFORE UPDATE ON qa_test_sessions FOR EACH ROW EXECUTE FUNCTION qa_enforce_session_snapshot_lock();

      CREATE OR REPLACE FUNCTION qa_enforce_plan_item_structure_uow() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE owning_session_id text; owning_started_at timestamptz;
      BEGIN
        owning_session_id := COALESCE(NEW.session_id,OLD.session_id);
        SELECT started_at INTO owning_started_at FROM qa_test_sessions WHERE session_id=owning_session_id;
        IF owning_started_at IS NOT NULL THEN RAISE EXCEPTION 'SESSION_SNAPSHOT_LOCKED'; END IF;
        IF current_setting('awp.qa_structure_mutation',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'QA_PLAN_ITEM_UOW_REQUIRED'; END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;$qa$;
      CREATE TRIGGER qa_plan_item_structure_uow BEFORE INSERT OR UPDATE OR DELETE ON qa_plan_items FOR EACH ROW EXECUTE FUNCTION qa_enforce_plan_item_structure_uow();

      CREATE OR REPLACE FUNCTION qa_enforce_session_parent_scope_and_acyclic() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE reaches_self boolean;
      BEGIN
        IF NEW.parent_session_id IS NULL THEN RETURN NEW; END IF;
        IF NOT EXISTS(SELECT 1 FROM qa_test_sessions p WHERE p.session_id=NEW.parent_session_id AND p.workspace_id=NEW.workspace_id AND p.project_id=NEW.project_id AND p.work_item_id=NEW.work_item_id) THEN RAISE EXCEPTION 'QA_SESSION_PARENT_SCOPE_MISMATCH'; END IF;
        WITH RECURSIVE lineage(id,parent_id) AS (SELECT p.session_id,p.parent_session_id FROM qa_test_sessions p WHERE p.session_id=NEW.parent_session_id UNION ALL SELECT p.session_id,p.parent_session_id FROM qa_test_sessions p JOIN lineage l ON p.session_id=l.parent_id) SELECT EXISTS(SELECT 1 FROM lineage WHERE id=NEW.session_id) INTO reaches_self;
        IF reaches_self THEN RAISE EXCEPTION 'QA_SESSION_PARENT_CYCLE'; END IF; RETURN NEW;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_test_session_parent_guard AFTER INSERT OR UPDATE OF parent_session_id ON qa_test_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_enforce_session_parent_scope_and_acyclic();
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE qa_plan_items; DROP TABLE qa_test_sessions; DROP FUNCTION IF EXISTS qa_enforce_plan_item_structure_uow(); DROP FUNCTION IF EXISTS qa_enforce_session_parent_scope_and_acyclic(); DROP FUNCTION IF EXISTS qa_enforce_session_snapshot_lock();",
    );
  }
}

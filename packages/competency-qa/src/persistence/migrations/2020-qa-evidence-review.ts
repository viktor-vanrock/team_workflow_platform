import type { MigrationInterface, QueryRunner } from "typeorm";

import { qaAppendOnlyGuardSql } from "./immutability-helpers.ts";

const shortAppendOnlyGuardSql = (tableName: string, key: string) => `
CREATE OR REPLACE FUNCTION "qa_ao_${key}"() RETURNS trigger LANGUAGE plpgsql AS $qa$
BEGIN RAISE EXCEPTION 'APPEND_ONLY:%', TG_TABLE_NAME; END;$qa$;
CREATE TRIGGER "qa_ao_${key}_trigger" BEFORE UPDATE OR DELETE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "qa_ao_${key}"();`;

export class QaEvidenceReview20201700000002020 implements MigrationInterface {
  readonly name = "QaEvidenceReview20201700000002020";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE qa_evidence_artifact_links(
        evidence_link_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,artifact_reference_id uuid NOT NULL,
        owner_kind text NOT NULL CHECK(owner_kind IN('SESSION','PLAN_ITEM','MANUAL_ATTEMPT','OBSERVATION')),owner_session_id text NULL,owner_plan_item_id text NULL,owner_attempt_id text NULL,owner_observation_id text NULL,
        role text NOT NULL CHECK(role IN('EXECUTION_EVIDENCE','CONTEXT')),checksum text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=1),media_type text NOT NULL,classification_key text NOT NULL REFERENCES classification_catalog(key),
        availability_at_signing text NOT NULL CHECK(availability_at_signing='AVAILABLE'),attached_by uuid NOT NULL REFERENCES identities(id),attached_at timestamptz NOT NULL,finalized_at timestamptz NOT NULL,content_hash text NOT NULL,
        PRIMARY KEY(evidence_link_id),UNIQUE(evidence_link_id,workspace_id,project_id,work_item_id,session_id),
        FOREIGN KEY(workspace_id,project_id,artifact_reference_id) REFERENCES artifact_references(workspace_id,project_id,id),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(owner_session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(owner_plan_item_id,workspace_id,project_id) REFERENCES qa_plan_items(plan_item_id,workspace_id,project_id),
        FOREIGN KEY(owner_attempt_id,workspace_id,project_id) REFERENCES qa_manual_attempts(attempt_id,workspace_id,project_id),
        FOREIGN KEY(owner_observation_id,workspace_id,project_id) REFERENCES qa_observations(observation_id,workspace_id,project_id),
        CHECK((owner_kind='SESSION' AND owner_session_id IS NOT NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL) OR
          (owner_kind='PLAN_ITEM' AND owner_session_id IS NULL AND owner_plan_item_id IS NOT NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NULL) OR
          (owner_kind='MANUAL_ATTEMPT' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NOT NULL AND owner_observation_id IS NULL) OR
          (owner_kind='OBSERVATION' AND owner_session_id IS NULL AND owner_plan_item_id IS NULL AND owner_attempt_id IS NULL AND owner_observation_id IS NOT NULL))
      );
      CREATE UNIQUE INDEX qa_evidence_owner_artifact_once ON qa_evidence_artifact_links(workspace_id,project_id,artifact_reference_id,owner_kind,COALESCE(owner_session_id,''),COALESCE(owner_plan_item_id,''),COALESCE(owner_attempt_id,''),COALESCE(owner_observation_id,''));

      CREATE TABLE qa_plan_item_result_evidence_memberships(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,plan_item_id text NOT NULL,result_revision_id text NOT NULL,evidence_link_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=1),evidence_link_content_hash text NOT NULL,
        PRIMARY KEY(membership_id),UNIQUE(result_revision_id,evidence_link_id),UNIQUE(result_revision_id,ordinal),
        FOREIGN KEY(result_revision_id,workspace_id,project_id,plan_item_id) REFERENCES qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,plan_item_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(evidence_link_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_artifact_links(evidence_link_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE qa_evidence_manifests(
        manifest_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,latest_revision_id text NULL,latest_adjudicative_revision_id text NULL,revision_count integer NOT NULL DEFAULT 0 CHECK(revision_count>=0),resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>=1),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
        PRIMARY KEY(manifest_id),UNIQUE(manifest_id,workspace_id,project_id,work_item_id,session_id),UNIQUE(workspace_id,project_id,session_id),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id)
      );
      CREATE TABLE qa_evidence_manifest_revisions(
        manifest_revision_id text NOT NULL,manifest_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,version integer NOT NULL CHECK(version>=1),kind text NOT NULL CHECK(kind IN('INITIAL','SUBSTANTIVE_CORRECTION','CLERICAL')),previous_revision_id text NULL,previous_version integer NULL,previous_content_hash text NULL,correction_reason text NULL,
        manifest jsonb NOT NULL,content_hash text NOT NULL,signature jsonb NOT NULL,evidence_policy_ref jsonb NOT NULL,published_at timestamptz NOT NULL,
        PRIMARY KEY(manifest_revision_id),UNIQUE(manifest_revision_id,workspace_id,project_id,work_item_id,session_id),UNIQUE(manifest_revision_id,manifest_id,version),UNIQUE(manifest_revision_id,manifest_id,version,content_hash),UNIQUE(manifest_id,version),
        FOREIGN KEY(manifest_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifests(manifest_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(previous_revision_id,manifest_id,previous_version,previous_content_hash) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,manifest_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK((version=1 AND kind='INITIAL' AND previous_revision_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL AND correction_reason IS NULL) OR (version>1 AND kind IN('SUBSTANTIVE_CORRECTION','CLERICAL') AND previous_revision_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 1 AND 2000))
      );
      ALTER TABLE qa_evidence_manifests ADD CONSTRAINT qa_manifest_latest_fk FOREIGN KEY(latest_revision_id,manifest_id,revision_count) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,manifest_id,version) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_evidence_manifests ADD CONSTRAINT qa_manifest_adjudicative_fk FOREIGN KEY(latest_adjudicative_revision_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE qa_evidence_manifest_artifact_memberships(
        membership_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,manifest_revision_id text NOT NULL,evidence_link_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=1),role text NOT NULL CHECK(role='MANIFEST_MEMBER'),checksum text NOT NULL,size_bytes bigint NOT NULL,media_type text NOT NULL,classification_key text NOT NULL,availability_at_signing text NOT NULL CHECK(availability_at_signing='AVAILABLE'),
        PRIMARY KEY(membership_id),UNIQUE(manifest_revision_id,evidence_link_id),UNIQUE(manifest_revision_id,ordinal),
        FOREIGN KEY(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(evidence_link_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_artifact_links(evidence_link_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE qa_session_reviews(
        session_review_id text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,work_item_id uuid NOT NULL,session_id text NOT NULL,version integer NOT NULL CHECK(version>=1),supersedes_review_id text NULL,supersedes_version integer NULL,supersedes_content_hash text NULL,supersession_reason text NULL,
        session_outcome text NOT NULL CHECK(session_outcome IN('PASSED','FAILED','BLOCKED','INCONCLUSIVE')),outcome_summary text NOT NULL,manifest_revision_id text NOT NULL,manifest_content_hash text NOT NULL,execution_set_hash text NOT NULL,result_set_hash text NOT NULL,frozen_finding_set_hash text NOT NULL,flaky_disposition_confirmations jsonb NOT NULL DEFAULT '[]'::jsonb,
        reviewer jsonb NOT NULL,authorization_basis_hash text NOT NULL,risk_review_policy_ref jsonb NOT NULL,reviewed_at timestamptz NOT NULL,content_hash text NOT NULL,content jsonb NOT NULL,
        PRIMARY KEY(session_review_id),UNIQUE(session_review_id,workspace_id,project_id,work_item_id,session_id),UNIQUE(session_review_id,session_id,version,content_hash),UNIQUE(session_id,version),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        FOREIGN KEY(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(supersedes_review_id,session_id,supersedes_version,supersedes_content_hash) REFERENCES qa_session_reviews(session_review_id,session_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK(length(btrim(outcome_summary)) BETWEEN 1 AND 10000),
        CHECK((version=1 AND supersedes_review_id IS NULL AND supersedes_version IS NULL AND supersedes_content_hash IS NULL AND supersession_reason IS NULL) OR (version>1 AND supersedes_review_id IS NOT NULL AND supersedes_version=version-1 AND supersedes_content_hash IS NOT NULL AND length(btrim(supersession_reason)) BETWEEN 1 AND 2000))
      );

      ALTER TABLE qa_test_sessions ADD COLUMN latest_session_review_id text NULL,ADD COLUMN session_outcome text NULL CHECK(session_outcome IS NULL OR session_outcome IN('PASSED','FAILED','BLOCKED','INCONCLUSIVE')),ADD COLUMN adjudicative_manifest_revision_id text NULL,ADD COLUMN completed_at timestamptz NULL;
      ALTER TABLE qa_test_sessions ADD CONSTRAINT qa_session_latest_review_fk FOREIGN KEY(latest_session_review_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_session_reviews(session_review_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_test_sessions ADD CONSTRAINT qa_session_adjudicative_manifest_fk FOREIGN KEY(adjudicative_manifest_revision_id,workspace_id,project_id,work_item_id,session_id) REFERENCES qa_evidence_manifest_revisions(manifest_revision_id,workspace_id,project_id,work_item_id,session_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE qa_test_sessions ADD CONSTRAINT qa_session_completion_review_shape CHECK((state='COMPLETED' AND latest_session_review_id IS NOT NULL AND session_outcome IS NOT NULL AND adjudicative_manifest_revision_id IS NOT NULL AND completed_at IS NOT NULL) OR state<>'COMPLETED');

      CREATE OR REPLACE FUNCTION qa_assert_negative_evidence_membership() RETURNS trigger LANGUAGE plpgsql AS $qa$
      DECLARE result_row qa_plan_item_result_revisions%ROWTYPE; result_evidence_count integer; uncovered_attempts integer;
      BEGIN
        SELECT * INTO result_row FROM qa_plan_item_result_revisions WHERE result_revision_id=COALESCE(NEW.result_revision_id,OLD.result_revision_id);
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO result_evidence_count FROM qa_plan_item_result_evidence_memberships WHERE result_revision_id=result_row.result_revision_id;
        IF result_row.result IN('FAIL','BLOCKED','INCONCLUSIVE') AND result_evidence_count=0 THEN RAISE EXCEPTION 'QA_RESULT_EVIDENCE_REQUIRED'; END IF;
        SELECT count(*) INTO uncovered_attempts FROM qa_plan_item_result_attempt_memberships am JOIN qa_manual_attempts a ON a.attempt_id=am.attempt_id WHERE am.result_revision_id=result_row.result_revision_id AND a.result IN('ASSERTION_FAILED','INFRA_FAILED','TIMEOUT','INCOMPLETE') AND NOT EXISTS(SELECT 1 FROM qa_evidence_artifact_links e WHERE e.workspace_id=a.workspace_id AND e.project_id=a.project_id AND e.session_id=a.session_id AND e.owner_kind='MANUAL_ATTEMPT' AND e.owner_attempt_id=a.attempt_id);
        IF uncovered_attempts>0 THEN RAISE EXCEPTION 'QA_ATTEMPT_EVIDENCE_REQUIRED'; END IF;
        RETURN NULL;
      END;$qa$;
      CREATE CONSTRAINT TRIGGER qa_negative_result_evidence_guard AFTER INSERT ON qa_plan_item_result_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_negative_evidence_membership();
      CREATE CONSTRAINT TRIGGER qa_result_evidence_membership_guard AFTER INSERT ON qa_plan_item_result_evidence_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_assert_negative_evidence_membership();
    `);
    for (const table of [
      "qa_evidence_artifact_links",
      "qa_evidence_manifest_revisions",
      "qa_session_reviews",
    ])
      await queryRunner.query(qaAppendOnlyGuardSql(table));
    await queryRunner.query(
      shortAppendOnlyGuardSql(
        "qa_plan_item_result_evidence_memberships",
        "result_evidence_members",
      ),
    );
    await queryRunner.query(
      shortAppendOnlyGuardSql(
        "qa_evidence_manifest_artifact_memberships",
        "manifest_artifact_members",
      ),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE qa_test_sessions DROP CONSTRAINT IF EXISTS qa_session_completion_review_shape,DROP CONSTRAINT IF EXISTS qa_session_adjudicative_manifest_fk,DROP CONSTRAINT IF EXISTS qa_session_latest_review_fk,DROP COLUMN completed_at,DROP COLUMN adjudicative_manifest_revision_id,DROP COLUMN session_outcome,DROP COLUMN latest_session_review_id;
      DROP TABLE qa_session_reviews;DROP TABLE qa_evidence_manifest_artifact_memberships;ALTER TABLE qa_evidence_manifests DROP CONSTRAINT IF EXISTS qa_manifest_latest_fk,DROP CONSTRAINT IF EXISTS qa_manifest_adjudicative_fk;DROP TABLE qa_evidence_manifest_revisions;DROP TABLE qa_evidence_manifests;DROP TABLE qa_plan_item_result_evidence_memberships;DROP TABLE qa_evidence_artifact_links;DROP FUNCTION IF EXISTS qa_assert_negative_evidence_membership();
    `);
  }
}

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QaSessionPlanProposalAggregate } from "../../../packages/competency-qa/src/domain/session-plan-proposal.ts";
import { QaTriageAssessmentAggregate } from "../../../packages/competency-qa/src/domain/triage-assessment.ts";
import { QaHermesPolicyInvalidation } from "../../../packages/competency-qa/src/persistence/hermes-policy-invalidation.ts";
import { TypeOrmQaSessionPlanProposalRepository } from "../../../packages/competency-qa/src/persistence/session-plan-proposal.repository.ts";
import { TypeOrmQaTriageAssessmentRepository } from "../../../packages/competency-qa/src/persistence/triage-assessment.repository.ts";
import { deterministicQaSessionPlan } from "../../../packages/competency-qa/src/skills/qa-session-plan.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { RuntimeConfigurationRepository } from "../../../packages/platform-persistence-typeorm/src/runtime-configuration.repository.ts";
import { HermesCorpusEvaluator } from "../../../packages/runtime-composition/src/hermes/evaluation.ts";
import {
  type HermesEvaluationApproval,
  HermesEvaluationPolicyService,
  type HermesPolicySelectionInput,
} from "../../../packages/runtime-composition/src/hermes/evaluation-policy.ts";
import { triageFixture } from "../../helpers/006/triage-fixture.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import {
  createHermesDevelopmentPort008,
  hermesCandidate008,
  readHermesCorpus008,
} from "../../support/008-hermes-evaluation.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 evaluated Hermes policy persistence",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "promotes and rolls back exact reviewed refs, fences stale proposals and survives restart on %s",
      async (image) => {
        const f = await startUs3DatabaseFixture({ postgresImage: image });
        try {
          const corpus = readHermesCorpus008(),
            candidate = hermesCandidate008(corpus);
          const evaluation = await new HermesCorpusEvaluator(
            createHermesDevelopmentPort008(corpus),
          ).evaluate(corpus, candidate);
          const scope = { workspaceId: f.workspaceId, projectId: f.projectId };
          const ref = (id: string) => ({ id, version: 1, contentHash: sha256(id) });
          let authorized = true,
            review = true;
          let proof: HermesEvaluationApproval = {
            scope,
            evaluationRef: {
              id: evaluation.runId,
              version: 1,
              contentHash: evaluation.contentHash as `sha256:${string}`,
            },
            reviewRef: ref("human-evaluation-review"),
            evaluation,
            reviewerKind: "HUMAN",
            reviewerId: us3Actor.principalId,
            outcome: "APPROVED",
            validUntil: new Date(Date.now() + 300_000).toISOString(),
            mode: "DEVELOPMENT_MOCKS",
            compatibilityRef: ref("qa-schema-runtime-v1"),
          };
          const service = new HermesEvaluationPolicyService(
            f.source,
            {
              authorize: async (selectedScope, actorId) =>
                authorized &&
                selectedScope.projectId === scope.projectId &&
                selectedScope.workspaceId === scope.workspaceId &&
                actorId === us3Actor.principalId,
              loadApproved: async () => {
                if (!review) throw new Error("REVIEW_REVOKED");
                return proof;
              },
            },
            new QaHermesPolicyInvalidation(),
            "DEVELOPMENT_MOCKS",
          );
          const input: HermesPolicySelectionInput = {
            ...scope,
            actorId: us3Actor.principalId,
            expectedRowVersion: 0,
            candidate,
            evaluationRef: proof.evaluationRef,
            reviewRef: proof.reviewRef,
            compatibilityRef: proof.compatibilityRef,
            validUntil: new Date(Date.now() + 120_000).toISOString(),
            requestKey: "promote-initial",
          };
          const insert = async (
            id: string,
            state = "CURRENT",
            projectId = f.projectId,
            modelPolicyRef?: { id: string; version: number; contentHash: string },
          ) => {
            const content = {
              ...triageFixture(),
              assessmentId: id,
              workspaceId: f.workspaceId,
              projectId,
              createdAt: new Date().toISOString(),
            };
            const snapshot = QaTriageAssessmentAggregate.create({
              id,
              workspaceId: f.workspaceId,
              projectId,
              subject: content.subject,
              revision: 1,
              content,
              expiresAt: new Date(Date.now() + 300_000),
            }).snapshot();
            await f.source.query(
              "INSERT INTO qa_triage_assessments(id,workspace_id,project_id,subject,revision,content,content_hash,source_fact_set_hash,state,expires_at,action_provenance_ref,created_at,model_policy_ref) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'fixture',clock_timestamp(),$10)",
              [
                `${id}:r1`,
                f.workspaceId,
                projectId,
                content.subject,
                content,
                snapshot.contentHash,
                snapshot.sourceFactSetHash,
                state,
                snapshot.expiresAt,
                modelPolicyRef ?? null,
              ],
            );
            return snapshot;
          };
          const pending = await insert("pending");
          await insert("superseded", "SUPERSEDED");
          await insert("foreign", "CURRENT", randomUUID());
          const plans = new TypeOrmQaSessionPlanProposalRepository(f.source);
          const plan = (id: string) => {
            const subject = {
              kind: "WORK_ITEM" as const,
              id: f.workItemId,
              version: 1,
              contentHash: sha256(f.workItemId),
            };
            const content = deterministicQaSessionPlan({
              ...scope,
              proposalId: id,
              workItemId: subject.id,
              workItemVersion: subject.version,
              workItemContentHash: subject.contentHash,
              revision: 1,
              facts: triageFixture().facts,
              environmentRef: "fixture-environment",
              agentRunId: randomUUID(),
              now: new Date(),
              expiresAt: new Date(Date.now() + 300_000),
            });
            return QaSessionPlanProposalAggregate.create({
              ...scope,
              id,
              subject,
              content,
              revision: 1,
              expiresAt: new Date(content.expiresAt),
            });
          };
          const acceptedPlan = plan("accepted-plan");
          await plans.save(
            acceptedPlan.accept(
              "HUMAN",
              "plan-reference",
              us3Actor.principalId,
              new Date(),
              acceptedPlan.snapshot().sourceFactSetHash,
            ),
            "fixture",
          );
          await plans.save(plan("pending-plan").snapshot(), "fixture");
          const first = await service.select(input);
          expect(first.document.invalidatedProposals).toEqual({ triage: 1, sessionPlans: 1 });
          expect(await service.select(input)).toEqual(first);
          expect(
            await f.source.query("SELECT id,state FROM qa_triage_assessments ORDER BY id"),
          ).toEqual([
            { id: "foreign:r1", state: "CURRENT" },
            { id: "pending:r1", state: "STALE" },
            { id: "superseded:r1", state: "SUPERSEDED" },
          ]);
          expect(
            (await new TypeOrmQaTriageAssessmentRepository(f.source).save(pending, "fixture"))
              .state,
          ).toBe("STALE");
          expect(
            await f.source.query("SELECT id,state FROM qa_session_plan_proposals ORDER BY id"),
          ).toEqual([
            { id: "accepted-plan:r1", state: "ACCEPTED" },
            { id: "pending-plan:r1", state: "STALE" },
          ]);
          await expect(plans.save(plan("late-plan").snapshot(), "fixture")).rejects.toThrow(
            "QA_HERMES_POLICY_CHANGED",
          );
          await plans.save(plan("new-plan").snapshot(), "fixture", new Date(), first.ref);
          await expect(insert("late-old-model-response")).rejects.toThrow(
            "QA_HERMES_POLICY_CHANGED",
          );
          await insert("new-pending", "CURRENT", f.projectId, first.ref);
          authorized = false;
          await expect(
            service.select({ ...input, expectedRowVersion: 1, requestKey: "denied" }),
          ).rejects.toThrow("HERMES_POLICY_ACCESS_DENIED");
          authorized = true;
          review = false;
          await expect(
            service.select({ ...input, expectedRowVersion: 1, requestKey: "review-revoked" }),
          ).rejects.toThrow("REVIEW_REVOKED");
          review = true;
          await expect(
            service.select({
              ...input,
              candidate: { ...candidate, promptRef: ref("unevaluated-prompt") },
              expectedRowVersion: 1,
              requestKey: "changed-prompt",
            }),
          ).rejects.toThrow("HERMES_APPROVED_EVALUATION_REQUIRED");
          await expect(
            service.select({
              ...input,
              expectedRowVersion: 1,
              requestKey: "foreign-rollback",
              rollbackTargetRef: { ...first.ref, id: "foreign-policy" },
            }),
          ).rejects.toThrow("HERMES_ROLLBACK_INCOMPATIBLE");
          expect(
            await f.source.query(
              "SELECT state FROM qa_triage_assessments WHERE id='new-pending:r1'",
            ),
          ).toEqual([{ state: "CURRENT" }]);
          const firstProof = proof,
            nextCandidate = { ...candidate, promptRef: ref("evaluated-prompt-v2") };
          const nextEvaluation = await new HermesCorpusEvaluator(
            createHermesDevelopmentPort008(corpus, nextCandidate),
          ).evaluate(corpus, nextCandidate);
          proof = {
            ...proof,
            evaluation: nextEvaluation,
            evaluationRef: {
              id: nextEvaluation.runId,
              version: 1,
              contentHash: nextEvaluation.contentHash as `sha256:${string}`,
            },
            reviewRef: ref("review-prompt-v2"),
          };
          const second = await service.select({
            ...input,
            candidate: nextCandidate,
            evaluationRef: proof.evaluationRef,
            reviewRef: proof.reviewRef,
            expectedRowVersion: 1,
            requestKey: "promote-next",
          });
          proof = firstProof;
          const rollback = await service.select({
            ...input,
            expectedRowVersion: 2,
            requestKey: "rollback-first",
            rollbackTargetRef: first.ref,
          });
          expect(rollback.ref.version).toBe(3);
          expect(rollback.document.rollbackTargetRef).toEqual(first.ref);
          await f.source.destroy();
          await f.source.initialize();
          const current = await f.source.transaction((manager) =>
            new RuntimeConfigurationRepository().current(
              manager,
              scope,
              rollback.ref,
              "MODEL_POLICY",
            ),
          );
          expect(current).toEqual(rollback);
          await expect(
            f.source.transaction((manager) =>
              new RuntimeConfigurationRepository().current(
                manager,
                scope,
                second.ref,
                "MODEL_POLICY",
              ),
            ),
          ).rejects.toThrow("RUNTIME_CONFIGURATION_UNAVAILABLE");
          expect(
            await f.source.query(
              "SELECT version FROM runtime_configuration_revisions WHERE configuration_id=$1 ORDER BY version",
              [first.ref.id],
            ),
          ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
          await expect(
            f.source.query(
              "DELETE FROM runtime_configuration_revisions WHERE configuration_id=$1",
              [first.ref.id],
            ),
          ).rejects.toThrow();
          await insert("race-pending", "CURRENT", f.projectId, rollback.ref);
          const raced = await Promise.allSettled([
            service.select({ ...input, expectedRowVersion: 3, requestKey: "race-one" }),
            service.select({ ...input, expectedRowVersion: 3, requestKey: "race-two" }),
          ]);
          expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
          expect(
            await f.source.query(
              "SELECT state FROM qa_triage_assessments WHERE id='race-pending:r1'",
            ),
          ).toEqual([{ state: "STALE" }]);
          const won = raced.find((result) => result.status === "fulfilled");
          if (won?.status !== "fulfilled") throw new Error("PROMOTION_WINNER_MISSING");
          await expect(
            insert("late-prior-selection", "CURRENT", f.projectId, rollback.ref),
          ).rejects.toThrow("QA_HERMES_POLICY_CHANGED");
          await insert("audit-pending", "CURRENT", f.projectId, won.value.ref);
          await f.source.query(
            "CREATE FUNCTION reject_hermes_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'HERMES_AUDIT_FAILED'; END $$; CREATE TRIGGER reject_hermes_event BEFORE INSERT ON runtime_configuration_events FOR EACH ROW EXECUTE FUNCTION reject_hermes_event()",
          );
          await expect(
            service.select({ ...input, expectedRowVersion: 4, requestKey: "audit-failure" }),
          ).rejects.toThrow("HERMES_AUDIT_FAILED");
          expect(
            await f.source.query(
              "SELECT state FROM qa_triage_assessments WHERE id='audit-pending:r1'",
            ),
          ).toEqual([{ state: "CURRENT" }]);
          expect(
            await f.source.query(
              "SELECT current_version FROM runtime_configuration_headers WHERE configuration_id=$1",
              [first.ref.id],
            ),
          ).toEqual([{ current_version: 4 }]);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      180_000,
    );
  },
);

import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";
import { createQaSessionReview } from "../domain/session-review.ts";
import { completeTestSessionReview } from "../domain/test-session.ts";
import { TypeOrmEvidenceReviewRepository } from "../persistence/evidence-review.repository.ts";
import { TypeOrmFindingRepository } from "../persistence/finding.repository.ts";
import { TypeOrmManualExecutionRepository } from "../persistence/manual-execution.repository.ts";
import { TypeOrmManualSessionRepository } from "../persistence/manual-session.repository.ts";
import { SessionReviewUnitOfWork } from "../persistence/session-review.uow.ts";
import type { QaAutomationReviewReadiness } from "./automation-review-readiness.ts";
import { buildCleanEvidenceManifest } from "./evidence-manifest-builder.ts";
import { evaluateSessionReviewPreconditions } from "./session-review-preconditions.ts";

export interface ReviewManualSessionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly expectedExecutionSetHash: QaContentHash;
  readonly actor: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly evidencePolicyRef: Readonly<{ key: string; version: string }>;
  readonly riskReviewPolicyRef: unknown;
  readonly outcomeSummary: string;
  readonly at: string;
}

export function assertQaAutomationSessionReviewReadiness(
  input: Readonly<{
    readiness: QaAutomationReviewReadiness;
    expectedAttemptSetHash: QaContentHash;
    actor: QaHumanActor;
  }>,
): Readonly<{
  attemptSetHash: QaContentHash;
  maximumAttemptNo: number;
  attemptCount: number;
  resultSetHash: QaContentHash;
  retryDecisionSetHash: QaContentHash;
}> {
  if (input.actor.kind !== "HUMAN" || !input.actor.issuer || !input.actor.subject)
    throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  const blocker = input.readiness.blockers[0];
  if (!input.readiness.reviewable || blocker)
    throw new QaDomainError(blocker?.code ?? "QA_AUTOMATION_REVIEW_BLOCKED");
  if (input.readiness.attemptSetHash !== input.expectedAttemptSetHash)
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_SET_STALE");
  return Object.freeze({
    attemptSetHash: input.readiness.attemptSetHash,
    maximumAttemptNo: input.readiness.maximumAttemptNo,
    attemptCount: input.readiness.attemptCount,
    resultSetHash: input.readiness.resultSetHash,
    retryDecisionSetHash: input.readiness.retryDecisionSetHash,
  });
}

export interface FreezeQaAutomationReviewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly expectedSessionVersion: number;
  readonly expectedAttemptSetHash: QaContentHash;
  readonly readiness: QaAutomationReviewReadiness;
  readonly planItemResultRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly adjudicativeManifestRevisionRef: Readonly<{ id: string; contentHash: QaContentHash }>;
  readonly artifactDescriptorSetHash: QaContentHash;
  readonly observationSetHash: QaContentHash;
  readonly findingSetHash: QaContentHash;
  readonly evidenceSetHash: QaContentHash;
  readonly riskPolicyRef: string;
  readonly riskPolicyHash: QaContentHash;
  readonly actor: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly correlationId: string;
  readonly causationId: string;
  readonly at: string;
}

export class TypeOrmAutomationReviewFreezeService {
  constructor(private readonly source: DataSource) {}

  async freeze(input: FreezeQaAutomationReviewInput) {
    const snapshot = assertQaAutomationSessionReviewReadiness({
      readiness: input.readiness,
      expectedAttemptSetHash: input.expectedAttemptSetHash,
      actor: input.actor,
    });
    if (
      input.readiness.quarantineWarnings.some(({ effectiveState }) => effectiveState === "ACTIVE")
    ) {
      // Active quarantine is preserved in the signed warning set; it does not erase the underlying result.
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const lockedRows = (await manager.query(
        `
SELECT session.state,session.mode,session.resource_version,item.state AS plan_item_state,
       item.latest_result_revision_id
FROM qa_test_sessions session
JOIN qa_plan_items item ON item.session_id=session.session_id
  AND item.workspace_id=session.workspace_id AND item.project_id=session.project_id
WHERE session.workspace_id=$1 AND session.project_id=$2 AND session.session_id=$3 AND item.plan_item_id=$4
FOR UPDATE OF session,item`,
        [input.workspaceId, input.projectId, input.sessionId, input.planItemId],
      )) as readonly unknown[];
      const locked = (Array.isArray(lockedRows[0]) ? lockedRows[0][0] : lockedRows[0]) as
        | Readonly<{
            state: string;
            mode: string;
            resource_version: string | number;
            plan_item_state: string;
            latest_result_revision_id: string | null;
          }>
        | undefined;
      if (!locked || locked.mode !== "AUTOMATED")
        throw new QaDomainError("QA_AUTOMATED_SESSION_NOT_FOUND");
      if (locked.state !== "REVIEW_REQUIRED" || locked.plan_item_state !== "TERMINAL")
        throw new QaDomainError("QA_AUTOMATION_REVIEW_STATE_INVALID");
      if (Number(locked.resource_version) !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      if (locked.latest_result_revision_id !== input.planItemResultRef.id)
        throw new QaDomainError("QA_AUTOMATION_ATTEMPT_SET_STALE");
      const existingRows = (await manager.query(
        `
SELECT * FROM qa_automation_review_freezes
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4`,
        [input.workspaceId, input.projectId, input.sessionId, input.planItemId],
      )) as readonly unknown[];
      const existing = (Array.isArray(existingRows[0]) ? existingRows[0][0] : existingRows[0]) as
        Readonly<Record<string, unknown>> | undefined;
      if (existing) {
        if (
          existing.attempt_set_hash !== snapshot.attemptSetHash ||
          existing.plan_item_result_revision_id !== input.planItemResultRef.id
        ) {
          throw new QaDomainError("QA_AUTOMATION_REVIEW_FREEZE_CONFLICT");
        }
        return Object.freeze({ replayed: true, freeze: Object.freeze({ ...existing }) });
      }
      const freezeId = randomUUID();
      const quarantineWarningSetHash = qaAggregateSnapshotHash(
        input.readiness.quarantineWarnings as never,
      );
      const body = Object.freeze({
        freezeId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        planItemId: input.planItemId,
        sourceKind: "PLAN_ITEM_RESULT" as const,
        planItemResultRef: input.planItemResultRef,
        attemptSetHash: snapshot.attemptSetHash,
        maximumAttemptNo: snapshot.maximumAttemptNo,
        attemptCount: snapshot.attemptCount,
        resultSetHash: snapshot.resultSetHash,
        retryDecisionSetHash: snapshot.retryDecisionSetHash,
        artifactDescriptorSetHash: input.artifactDescriptorSetHash,
        observationSetHash: input.observationSetHash,
        findingSetHash: input.findingSetHash,
        evidenceSetHash: input.evidenceSetHash,
        adjudicativeManifestRevisionRef: input.adjudicativeManifestRevisionRef,
        quarantineWarningSetHash,
        riskPolicyRef: input.riskPolicyRef,
        riskPolicyHash: input.riskPolicyHash,
        frozenByPrincipalId: input.actor.principalId,
        authorizationBasisHash: input.authorizationBasisHash,
        frozenAt: input.at,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
      const contentHash = qaAggregateSnapshotHash(body as never);
      const insertedRows = (await manager.query(
        `
INSERT INTO qa_automation_review_freezes(
  freeze_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,source_kind,
  plan_item_result_revision_id,plan_item_result_version,plan_item_result_content_hash,
  session_review_id,session_review_version,session_review_content_hash,attempt_set_hash,maximum_attempt_no,
  attempt_count,result_set_hash,retry_decision_set_hash,artifact_descriptor_set_hash,observation_set_hash,
  finding_set_hash,evidence_set_hash,adjudicative_manifest_revision_id,adjudicative_manifest_content_hash,
  quarantine_warning_set_hash,risk_policy_ref,risk_policy_content_hash,frozen_by_kind,frozen_by_principal_id,
  authorization_basis_hash,frozen_at,correlation_id,causation_id,content_hash
) VALUES(
  $1,$2,$3,$4,$5,$6,'PLAN_ITEM_RESULT',$7,$8,$9,NULL,NULL,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,
  $19,$20,$21,$22,$23,'HUMAN',$24,$25,$26,$27,$28,$29
) RETURNING *`,
        [
          freezeId,
          input.workspaceId,
          input.projectId,
          input.workItemId,
          input.sessionId,
          input.planItemId,
          input.planItemResultRef.id,
          input.planItemResultRef.version,
          input.planItemResultRef.contentHash,
          snapshot.attemptSetHash,
          snapshot.maximumAttemptNo,
          snapshot.attemptCount,
          snapshot.resultSetHash,
          snapshot.retryDecisionSetHash,
          input.artifactDescriptorSetHash,
          input.observationSetHash,
          input.findingSetHash,
          input.evidenceSetHash,
          input.adjudicativeManifestRevisionRef.id,
          input.adjudicativeManifestRevisionRef.contentHash,
          quarantineWarningSetHash,
          input.riskPolicyRef,
          input.riskPolicyHash,
          input.actor.principalId,
          input.authorizationBasisHash,
          input.at,
          input.correlationId,
          input.causationId,
          contentHash,
        ],
      )) as readonly unknown[];
      const inserted = (Array.isArray(insertedRows[0]) ? insertedRows[0][0] : insertedRows[0]) as
        Readonly<Record<string, unknown>> | undefined;
      if (!inserted) throw new QaDomainError("QA_AUTOMATION_REVIEW_FREEZE_INSERT_FAILED");
      return Object.freeze({ replayed: false, freeze: Object.freeze({ ...inserted }) });
    });
  }
}

export async function completeCleanManualSession(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    sessionId: string;
    expectedSessionVersion: number;
    actor: QaHumanActor;
    outcomeSummary: string;
    at: string;
  }>,
) {
  const manifestRevisionId = randomUUID();
  const manifestContentHash = qaAggregateSnapshotHash({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionId: input.sessionId,
    outcome: "PASSED",
    summary: input.outcomeSummary,
    reviewedAt: input.at,
  } as never);
  const review = createQaSessionReview({
    id: randomUUID(),
    version: 1,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionId: input.sessionId,
    sessionOutcome: "PASSED",
    outcomeSummary: input.outcomeSummary,
    adjudicativeManifestRevisionRef: {
      id: manifestRevisionId,
      version: 1,
      contentHash: manifestContentHash,
    },
    executionSetHash: qaAggregateSnapshotHash([] as never),
    resultSetHash: qaAggregateSnapshotHash([] as never),
    frozenFindingSetHash: qaAggregateSnapshotHash([] as never),
    flakyDispositionConfirmations: [],
    reviewer: input.actor,
    authorizationBasisHash: qaAggregateSnapshotHash({ actor: input.actor } as never),
    reviewedAt: input.at,
  });
  const manifestId = randomUUID();
  return Object.freeze({
    session: Object.freeze({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      state: "COMPLETED" as const,
      sessionOutcome: "PASSED" as const,
      resourceVersion: input.expectedSessionVersion + 1,
    }),
    sessionReview: review,
    manifest: Object.freeze({
      manifestId,
      manifestRevisionId,
      revision: 1,
      contentHash: manifestContentHash,
      resourceVersion: 1,
    }),
    nativeRetestLineage: Object.freeze({
      kind: "QA_SESSION" as const,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sessionReviewRef: { id: review.id, version: 1, contentHash: review.contentHash },
      manifestRevisionRef: { id: manifestRevisionId, version: 1, contentHash: manifestContentHash },
    }),
  });
}

export type CompletedManualSessionReview = Awaited<ReturnType<typeof completeCleanManualSession>>;
export const asQaContentHash = (value: string) => value as QaContentHash;

export class TypeOrmReviewManualSessionService {
  constructor(private readonly source: DataSource) {}
  async reviewCleanPass(input: ReviewManualSessionInput) {
    return await this.#review({ ...input, sessionOutcome: "PASSED", requireFindings: false });
  }
  async reviewWithFindings(
    input: ReviewManualSessionInput &
      Readonly<{ sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE" }>,
  ) {
    return await this.#review({ ...input, requireFindings: true });
  }
  async #review(
    input: ReviewManualSessionInput &
      Readonly<{
        sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
        requireFindings: boolean;
      }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const scope = { workspaceId: input.workspaceId, projectId: input.projectId };
      const session = await new TypeOrmManualSessionRepository(manager).get(scope, input.sessionId);
      if (!session || session.workItemId !== input.workItemId)
        throw new QaDomainError("QA_SESSION_NOT_FOUND");
      if (session.resourceVersion !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      if (session.state !== "REVIEW_REQUIRED")
        throw new QaDomainError("QA_SESSION_REVIEW_STATE_INVALID");
      const execution = new TypeOrmManualExecutionRepository(manager);
      const itemQuery = (await manager.query(
        "SELECT plan_item_id,latest_result_revision_id,waiver_id FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 ORDER BY ordinal",
        [input.workspaceId, input.projectId, input.sessionId],
      )) as readonly unknown[];
      const itemRows = (
        Array.isArray(itemQuery[0]) ? itemQuery[0] : itemQuery
      ) as readonly Readonly<{
        plan_item_id: string;
        latest_result_revision_id: string | null;
        waiver_id: string | null;
      }>[];
      if (
        !itemRows.length ||
        itemRows.some(({ latest_result_revision_id }) => !latest_result_revision_id)
      )
        throw new QaDomainError("QA_SESSION_PLAN_ITEMS_NOT_TERMINAL");
      const attempts = (
        await Promise.all(
          itemRows.map(({ plan_item_id }) => execution.attempts(scope, plan_item_id)),
        )
      ).flat();
      const observations = (
        await Promise.all(
          itemRows.map(({ plan_item_id }) => execution.observations(scope, plan_item_id)),
        )
      ).flat();
      const resultHistories = await Promise.all(
        itemRows.map(({ plan_item_id }) => execution.resultRevisions(scope, plan_item_id)),
      );
      const results = resultHistories.map((history) => history.at(-1)!);
      const waivers = new Map<
        string,
        Readonly<{
          waiver_id: string;
          content_hash: string;
          state: string;
          waiver_kind: string;
          expires_at: Date | string;
          work_item_id: string;
        }>
      >();
      for (const row of itemRows.filter(({ waiver_id }) => waiver_id !== null)) {
        const foundQuery = (await manager.query(
          "SELECT waiver_id,content_hash,state,waiver_kind,expires_at,work_item_id FROM qa_waivers WHERE waiver_id=$1 AND workspace_id=$2 AND project_id=$3",
          [row.waiver_id, input.workspaceId, input.projectId],
        )) as readonly unknown[];
        const found = (Array.isArray(foundQuery[0]) ? foundQuery[0][0] : foundQuery[0]) as
          | Readonly<{
              waiver_id: string;
              content_hash: string;
              state: string;
              waiver_kind: string;
              expires_at: Date | string;
              work_item_id: string;
            }>
          | undefined;
        if (
          !found ||
          found.state !== "APPROVED" ||
          found.waiver_kind !== "PLAN_ITEM" ||
          found.work_item_id !== input.workItemId ||
          Date.parse(String(found.expires_at)) <= Date.parse(input.at)
        )
          throw new QaDomainError("QA_PLAN_ITEM_WAIVER_NOT_LIVE");
        waivers.set(row.plan_item_id, found);
      }
      for (const [index, row] of itemRows.entries()) {
        const snapshot = await execution.snapshot(scope, row.plan_item_id);
        const result = results[index]!;
        if (
          result.consideredAttemptSetHash !== snapshot.attemptSetHash ||
          result.consideredObservationSetHash !== snapshot.observationSetHash ||
          result.maximumAttemptNo !== snapshot.maximumAttemptNo
        )
          throw new QaDomainError("STALE_OBSERVATION_SET");
      }
      const evidenceRepository = new TypeOrmEvidenceReviewRepository(manager);
      const evidence = await evidenceRepository.listEvidence(scope, input.sessionId);
      for (const result of results.filter(({ result }) => result === "NOT_RUN")) {
        const waiver = waivers.get(result.planItemId);
        if (
          !waiver ||
          result.waiverRef?.id !== waiver.waiver_id ||
          result.waiverRef.contentHash !== waiver.content_hash
        )
          throw new QaDomainError("QA_PLAN_ITEM_WAIVER_NOT_LIVE");
      }
      const frozenFindings = input.requireFindings
        ? await new TypeOrmFindingRepository(manager).freezeSession(
            scope,
            input.sessionId,
            input.at,
          )
        : Object.freeze([]);
      const precondition = evaluateSessionReviewPreconditions({
        attempts: attempts.map((attempt) => ({
          attemptId: attempt.id,
          planItemId: attempt.planItemId,
          attemptNo: attempt.attemptNo,
          result: attempt.result!,
        })),
        observations: observations.map((observation) => ({
          observationId: observation.id,
          attemptId: observation.attemptId,
          planItemId: observation.planItemId,
          kind: observation.kind,
        })),
        results: results.map((result) => ({
          resultRevisionId: result.id,
          planItemId: result.planItemId,
          result: result.result,
          attemptIds: result.consideredAttemptRefs.map(({ id }) => id),
          observationIds: result.consideredObservationRefs.map(({ id }) => id),
          evidenceLinkIds: result.evidenceLinkIds,
        })),
        evidence: evidence.map((link) => ({
          evidenceLinkId: link.evidenceArtifactLinkId,
          ownerType: link.owner.ownerType,
          ownerId: link.owner.ownerId,
          availability: link.availability,
        })),
        waivers: [...waivers.values()],
        ...(input.requireFindings
          ? {
              findingInventory: frozenFindings.map(({ observationIds }) => ({
                stage: "FROZEN" as const,
                observationIds,
              })),
            }
          : {}),
      });
      if (!precondition.reviewable) throw new QaDomainError(precondition.code);
      if (
        !input.requireFindings &&
        results.some(({ result }) => !["PASS", "NOT_RUN"].includes(result))
      )
        throw new QaDomainError("FINDING_REQUIRED");
      const executionSetHash = qaAggregateSnapshotHash(
        attempts.map(({ id, contentHash }) => ({ id, contentHash })) as never,
      );
      if (executionSetHash !== input.expectedExecutionSetHash)
        throw new QaDomainError("QA_SESSION_EXECUTION_SET_STALE");
      const manifest = buildCleanEvidenceManifest({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        targetSnapshotHash: session.targetSnapshot.contentHash,
        scopeSnapshotHash: session.scopeSnapshot.contentHash,
        resultRevisions: results.map((result) => ({
          resultRevisionId: result.id,
          planItemId: result.planItemId,
          result: result.result,
          attemptIds: result.consideredAttemptRefs.map(({ id }) => id),
          observationIds: result.consideredObservationRefs.map(({ id }) => id),
          evidenceLinkIds: result.evidenceLinkIds,
          ...(result.waiverRef ? { waiverRef: result.waiverRef } : {}),
        })),
        attempts: attempts.map((attempt) => ({
          attemptId: attempt.id,
          planItemId: attempt.planItemId,
          attemptNo: attempt.attemptNo,
          result: attempt.result!,
          ...(attempt.cancellationReason ? { cancellationReason: attempt.cancellationReason } : {}),
          actorId: attempt.actor.principalId,
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt!,
        })),
        observations: observations.map((observation) => ({
          observationId: observation.id,
          planItemId: observation.planItemId,
          attemptId: observation.attemptId,
          kind: observation.kind,
          expectedOutcome: observation.expectedOutcome,
          actualOutcome: observation.actualOutcome,
        })),
        artifactLinks: evidence.map((link) => ({
          evidenceArtifactLinkId: link.evidenceArtifactLinkId,
          checksum: link.checksum,
          mediaType: link.mediaType,
          sizeBytes: link.sizeBytes,
          dataClassificationKey: link.dataClassificationKey,
          availabilityAtSigning: "AVAILABLE" as const,
        })),
        sessionOutcome: input.sessionOutcome,
        outcomeSummary: input.outcomeSummary,
        profileRefs: session.targetSnapshot.profileRefs,
        policyRefs: [input.evidencePolicyRef],
        reviewerId: input.actor.principalId,
        reviewedAt: input.at,
        frozenFindingReviews: frozenFindings,
      });
      const review = createQaSessionReview({
        id: randomUUID(),
        version: 1,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        sessionOutcome: input.sessionOutcome,
        outcomeSummary: input.outcomeSummary,
        adjudicativeManifestRevisionRef: {
          id: manifest.manifestRevisionId,
          version: 1,
          contentHash: manifest.contentHash,
        },
        executionSetHash,
        resultSetHash: qaAggregateSnapshotHash(
          results.map(({ id, version, contentHash }) => ({ id, version, contentHash })) as never,
        ),
        frozenFindingSetHash: qaAggregateSnapshotHash(
          frozenFindings.map(({ id, version, contentHash }) => ({
            id,
            version,
            contentHash,
          })) as never,
        ),
        flakyDispositionConfirmations: [],
        reviewer: input.actor,
        authorizationBasisHash: input.authorizationBasisHash,
        reviewedAt: input.at,
      });
      const completedSession = completeTestSessionReview(session, {
        actor: input.actor,
        at: input.at,
        expectedResourceVersion: input.expectedSessionVersion,
        sessionReviewId: review.id,
        sessionOutcome: input.sessionOutcome,
        adjudicativeManifestRevisionId: manifest.manifestRevisionId,
      });
      const persisted = await new SessionReviewUnitOfWork(manager).persistInitial({
        previousSession: session,
        completedSession,
        manifest,
        review,
        evidencePolicyRef: input.evidencePolicyRef,
        riskReviewPolicyRef: input.riskReviewPolicyRef,
        frozenFindingReviewRefs: frozenFindings.map(({ id, version, contentHash }) => ({
          id,
          version,
          contentHash,
        })),
      });
      return Object.freeze({
        session: completedSession,
        sessionReview: review,
        manifestRevision: manifest,
        manifestHeaderResourceVersion: persisted.manifestResourceVersion,
      });
    });
  }
}

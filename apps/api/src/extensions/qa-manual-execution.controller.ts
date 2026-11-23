import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  type QaContentHash,
  type QaManualAttemptResult,
  type QaObservationKind,
  type QaObservationSeverity,
  type QaPlanItemHumanResult,
  TypeOrmManualAttemptService,
  TypeOrmManualExecutionRepository,
  TypeOrmRecordObservationService,
  TypeOrmRecordPlanItemResultService,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (version: number) => `W/"${version}"`;
const version = (value: string | undefined): number => {
  const found = /^W\/"([1-9][0-9]*)"$/.exec(value ?? "");
  if (!found) throw new Error("IF_MATCH_REQUIRED");
  return Number(found[1]);
};
const publicAttempt = (value: Awaited<ReturnType<TypeOrmManualExecutionRepository["attempt"]>>) =>
  value
    ? {
        schemaVersion: 1,
        attemptId: value.id,
        workspaceId: value.workspaceId,
        projectId: value.projectId,
        workItemId: value.workItemId,
        sessionId: value.sessionId,
        planItemId: value.planItemId,
        attemptNo: value.attemptNo,
        state: value.state,
        actor: value.actor,
        targetSnapshotHash: value.targetSnapshotHash,
        startedAt: value.startedAt,
        ...(value.endedAt ? { endedAt: value.endedAt } : {}),
        ...(value.result ? { result: value.result } : {}),
        ...(value.cancellationReason ? { cancellationReason: value.cancellationReason } : {}),
        ...(value.notes ? { notes: value.notes } : {}),
        contentHash: value.contentHash,
        resourceVersion: value.resourceVersion,
      }
    : undefined;
const publicObservation = (
  value: NonNullable<Awaited<ReturnType<TypeOrmManualExecutionRepository["observation"]>>>,
) => ({
  schemaVersion: 1,
  observationId: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  workItemId: value.workItemId,
  sessionId: value.sessionId,
  planItemId: value.planItemId,
  attemptId: value.attemptId,
  kind: value.kind,
  expectedOutcome: value.expectedOutcome,
  actualOutcome: value.actualOutcome,
  severity: value.severity,
  ...(value.notes ? { notes: value.notes } : {}),
  artifactRefs: value.artifactIds.map((id) => ({ artifactId: id })),
  ...(value.correctsObservationRef
    ? {
        correctsObservationRef: value.correctsObservationRef,
        correctionReason: value.correctionReason,
      }
    : {}),
  actor: value.actor,
  observedAt: value.observedAt,
  contentHash: value.contentHash,
  resourceVersion: value.resourceVersion,
});
const publicResult = (
  value: Awaited<ReturnType<TypeOrmManualExecutionRepository["resultRevisions"]>>[number],
) => ({
  schemaVersion: 1,
  resultRevisionId: value.id,
  version: value.version,
  ...(value.previousRevisionRef
    ? { previousRevisionRef: value.previousRevisionRef, correctionReason: value.correctionReason }
    : {}),
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  workItemId: value.workItemId,
  sessionId: value.sessionId,
  planItemId: value.planItemId,
  attemptMembershipMode: value.attemptMembershipMode,
  consideredAttemptRefs: value.consideredAttemptRefs,
  consideredAttemptSetHash: value.consideredAttemptSetHash,
  observationMembershipMode: value.observationMembershipMode,
  consideredObservationRefs: value.consideredObservationRefs,
  consideredObservationSetHash: value.consideredObservationSetHash,
  maximumAttemptNo: value.maximumAttemptNo,
  reviewFlags: value.reviewFlags,
  result: value.result,
  actualOutcome: value.actualOutcome,
  decisionReason: value.decisionReason,
  artifactRefs: value.evidenceLinkIds.map((artifactId) => ({ artifactId })),
  ...(value.waiverRef ? { waiverRef: value.waiverRef } : {}),
  contentHash: value.contentHash,
  recordedBy: value.recordedBy,
  recordedAt: value.recordedAt,
});

@Controller(
  "api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/sessions/:sessionId",
)
@UseGuards(QaSessionGuard)
export class QaManualExecutionController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get("plan-items/:planItemId/attempts")
  async listAttempts(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("planItemId") planItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const repository = new TypeOrmManualExecutionRepository(this.source);
    const item = await repository.planItem({ workspaceId, projectId }, sessionId, planItemId);
    if (!item) throw new Error("QA_PLAN_ITEM_NOT_FOUND");
    return (await repository.attempts({ workspaceId, projectId }, planItemId)).map((value) =>
      publicAttempt(value)!,
    );
  }

  @Post("plan-items/:planItemId/attempts")
  async startAttempt(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Param("planItemId") planItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ targetSnapshotHash: QaContentHash }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const auth = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.execute",
    );
    const repository = new TypeOrmManualExecutionRepository(this.source);
    const session = await repository.session({ workspaceId, projectId }, sessionId);
    if (!session || session.workItemId !== workItemId) throw new Error("QA_SESSION_NOT_FOUND");
    if (body.targetSnapshotHash !== session.targetSnapshotHash)
      throw new Error("QA_ATTEMPT_TARGET_HASH_STALE");
    const created = await new TypeOrmManualAttemptService(this.source).start({
      workspaceId,
      projectId,
      sessionId,
      planItemId,
      actor: auth.actor,
      expectedSessionVersion: version(ifMatch),
      at: new Date().toISOString(),
    });
    response.setHeader("ETag", etag(created.sessionResourceVersion));
    response.setHeader("Location", `${sessionId}/attempts/${created.attempt.id}`);
    return publicAttempt(created.attempt);
  }

  @Post("attempts/:attemptId/completion")
  async completeAttempt(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("attemptId") attemptId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{ result: QaManualAttemptResult; notes?: string; cancellationReason?: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const auth = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.execute",
    );
    const completed = await new TypeOrmManualAttemptService(this.source).complete({
      workspaceId,
      projectId,
      attemptId,
      actor: auth.actor,
      result: body.result,
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.cancellationReason ? { cancellationReason: body.cancellationReason } : {}),
      expectedSessionVersion: version(ifMatch),
      at: new Date().toISOString(),
    });
    response.setHeader("ETag", etag(completed.sessionResourceVersion));
    return publicAttempt(completed.attempt);
  }

  @Get("attempts/:attemptId/observations")
  async listObservations(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("attemptId") attemptId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const repository = new TypeOrmManualExecutionRepository(this.source);
    const attempt = await repository.attempt({ workspaceId, projectId }, attemptId);
    if (!attempt) throw new Error("QA_ATTEMPT_NOT_FOUND");
    return (await repository.observations({ workspaceId, projectId }, attempt.planItemId))
      .filter((value) => value.attemptId === attemptId)
      .map(publicObservation);
  }

  @Post("attempts/:attemptId/observations")
  async recordObservation(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      planItemId: string;
      kind: QaObservationKind;
      expectedOutcome: string;
      actualOutcome: string;
      severity: QaObservationSeverity;
      notes?: string;
      artifactIds?: readonly string[];
      correctsObservationRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
      correctionReason?: string;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const auth = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.execute",
    );
    const recorded = await new TypeOrmRecordObservationService(this.source).record({
      workspaceId,
      projectId,
      sessionId,
      planItemId: body.planItemId,
      attemptId,
      kind: body.kind,
      expectedOutcome: body.expectedOutcome,
      actualOutcome: body.actualOutcome,
      severity: body.severity,
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.artifactIds ? { artifactIds: body.artifactIds } : {}),
      ...(body.correctsObservationRef
        ? { correctsObservationRef: body.correctsObservationRef }
        : {}),
      ...(body.correctionReason ? { correctionReason: body.correctionReason } : {}),
      actor: auth.actor,
      expectedSessionVersion: version(ifMatch),
      at: new Date().toISOString(),
    });
    response.setHeader("ETag", etag(recorded.sessionResourceVersion));
    return publicObservation(recorded.observation);
  }

  @Get("plan-items/:planItemId/result-revisions")
  async listResults(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("planItemId") planItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    return (
      await new TypeOrmManualExecutionRepository(this.source).resultRevisions(
        { workspaceId, projectId },
        planItemId,
      )
    ).map(publicResult);
  }

  @Post("plan-items/:planItemId/result-revisions")
  async recordResult(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("planItemId") planItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      expectedPreviousResultRevisionRef: null | Readonly<{
        id: string;
        version: number;
        contentHash: QaContentHash;
      }>;
      correctionReason?: string;
      expectedAttemptSetHash: QaContentHash;
      expectedMaximumAttemptNo: number;
      expectedObservationSetHash: QaContentHash;
      expectedObservationCount: number;
      reviewFlags: readonly "FLAKY_SUSPECTED"[];
      result: QaPlanItemHumanResult;
      actualOutcome: string;
      decisionReason: string;
      artifactIds: readonly string[];
      waiverRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const auth = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.execute",
    );
    const snapshot = await new TypeOrmManualExecutionRepository(this.source).snapshot(
      { workspaceId, projectId },
      planItemId,
    );
    if (snapshot.observations.length !== body.expectedObservationCount)
      throw new Error("QA_RESULT_EXPECTED_SET_STALE");
    const recorded = await new TypeOrmRecordPlanItemResultService(this.source).record({
      workspaceId,
      projectId,
      sessionId,
      planItemId,
      result: body.result,
      actualOutcome: body.actualOutcome,
      decisionReason: body.decisionReason,
      reviewFlags: body.reviewFlags,
      evidenceLinkIds: body.artifactIds,
      ...(body.waiverRef ? { waiverRef: body.waiverRef } : {}),
      ...(body.expectedPreviousResultRevisionRef
        ? { previousRevisionRef: body.expectedPreviousResultRevisionRef }
        : {}),
      ...(body.correctionReason ? { correctionReason: body.correctionReason } : {}),
      actor: auth.actor,
      expectedSessionVersion: version(ifMatch),
      expectedMaximumAttemptNo: body.expectedMaximumAttemptNo,
      expectedAttemptSetHash: body.expectedAttemptSetHash,
      expectedObservationSetHash: body.expectedObservationSetHash,
      at: new Date().toISOString(),
    });
    response.setHeader("ETag", etag(recorded.sessionResourceVersion));
    return publicResult(recorded.result);
  }
}

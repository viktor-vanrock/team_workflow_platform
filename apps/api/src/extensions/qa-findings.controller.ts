import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  buildQaFindingDecisionEvent,
  qaAggregateSnapshotHash,
  QaDomainError,
  type QaFindingClassification,
  type QaFindingDispositionDecision,
  type QaFindingReviewRevision,
  type QaFindingSeverity,
  type QaHumanActor,
  TypeOrmFindingRepository,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type Row = Readonly<Record<string, unknown>>;
type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (version: number) => `W/"${version}"`;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const requireVersion = (value: string | undefined): number => {
  const match = /^W\/"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return Number(match[1]);
};
const conflict = (error: unknown): never => {
  if (error instanceof QaDomainError) throw new ConflictException(error.message);
  throw error;
};

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/findings")
@UseGuards(QaSessionGuard)
export class QaFindingsController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get()
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    return await this.source.transaction(
      async (manager) =>
        await new TypeOrmFindingRepository(manager).list({ workspaceId, projectId }, workItemId),
    );
  }

  @Post()
  async create(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      sessionId: string;
      observationIds: readonly string[];
      severity: QaFindingSeverity;
      summary: string;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.finding.classify",
    );
    if (
      !body.observationIds?.length ||
      new Set(body.observationIds).size !== body.observationIds.length ||
      !body.summary?.trim()
    )
      throw new ConflictException("QA_FINDING_INPUT_INVALID");
    try {
      const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
        const session = rows(
          await manager.query(
            "SELECT resource_version FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND session_id=$4 FOR UPDATE",
            [workspaceId, projectId, workItemId, body.sessionId],
          ),
        )[0];
        if (!session) throw new QaDomainError("QA_SESSION_NOT_FOUND");
        if (Number(session.resource_version) !== requireVersion(ifMatch))
          throw new QaDomainError("QA_SESSION_CAS_CONFLICT");
        const repository = new TypeOrmFindingRepository(manager);
        const created = await repository.create({
          scope: { workspaceId, projectId },
          workItemId,
          sessionId: body.sessionId,
          observationId: body.observationIds[0]!,
          actor: authorization.actor,
          at: new Date().toISOString(),
        });
        for (const observationId of body.observationIds.slice(1))
          await repository.assign({
            scope: { workspaceId, projectId },
            findingId: created.findingId,
            observationId,
            actor: authorization.actor,
            at: new Date().toISOString(),
          });
        await manager.query(
          "UPDATE qa_findings SET content=content||jsonb_build_object('initialSeverity',$1::text,'summary',$2::text) WHERE finding_id=$3",
          [body.severity, body.summary, created.findingId],
        );
        return await this.#finding(manager, workspaceId, projectId, workItemId, created.findingId);
      });
      response.setHeader("ETag", etag(Number(result.resource_version)));
      response.setHeader("Location", `findings/${result.finding_id}`);
      return this.#publicFinding(result);
    } catch (error) {
      return conflict(error);
    }
  }

  @Get(":findingId/memberships")
  async memberships(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("findingId") findingId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    try {
      const result = await this.source.transaction(async (manager) => {
        const finding = await this.#finding(manager, workspaceId, projectId, undefined, findingId);
        response.setHeader("ETag", etag(Number(finding.resource_version)));
        return await new TypeOrmFindingRepository(manager).memberships(
          { workspaceId, projectId },
          findingId,
        );
      });
      return result;
    } catch (error) {
      return conflict(error);
    }
  }

  @Post(":findingId/memberships")
  async assign(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ observationId: string; expectedMembershipSetHash: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.finding.classify",
    );
    try {
      const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
        await this.#assertFindingCas(
          manager,
          workspaceId,
          projectId,
          workItemId,
          findingId,
          requireVersion(ifMatch),
        );
        const repository = new TypeOrmFindingRepository(manager);
        const before = await repository.memberships({ workspaceId, projectId }, findingId);
        if (before.activeMembershipSetHash !== body.expectedMembershipSetHash)
          throw new QaDomainError("QA_FINDING_MEMBERSHIP_CAS_CONFLICT");
        const memberships = await repository.assign({
          scope: { workspaceId, projectId },
          findingId,
          observationId: body.observationId,
          actor: authorization.actor,
          reason: "MEMBERSHIP_ASSIGNED",
          at: new Date().toISOString(),
        });
        const finding = await this.#finding(manager, workspaceId, projectId, workItemId, findingId);
        return { memberships, version: Number(finding.resource_version) };
      });
      response.setHeader("ETag", etag(result.version));
      response.setHeader(
        "Location",
        `memberships/${result.memberships.memberships.at(-1)?.membershipId}`,
      );
      return result.memberships;
    } catch (error) {
      return conflict(error);
    }
  }

  @Post(":findingId/memberships/:membershipId/release")
  @HttpCode(200)
  async release(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Param("membershipId") membershipId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ expectedMembershipSetHash: string; reason: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.finding.classify",
    );
    try {
      const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
        await this.#assertFindingCas(
          manager,
          workspaceId,
          projectId,
          workItemId,
          findingId,
          requireVersion(ifMatch),
        );
        const repository = new TypeOrmFindingRepository(manager);
        const before = await repository.memberships({ workspaceId, projectId }, findingId);
        if (before.activeMembershipSetHash !== body.expectedMembershipSetHash)
          throw new QaDomainError("QA_FINDING_MEMBERSHIP_CAS_CONFLICT");
        const memberships = await repository.release({
          scope: { workspaceId, projectId },
          findingId,
          membershipId,
          actor: authorization.actor,
          reason: body.reason,
          at: new Date().toISOString(),
        });
        const finding = await this.#finding(manager, workspaceId, projectId, workItemId, findingId);
        return { memberships, version: Number(finding.resource_version) };
      });
      response.setHeader("ETag", etag(result.version));
      return result.memberships;
    } catch (error) {
      return conflict(error);
    }
  }

  @Put(":findingId/classification")
  async classify(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      classification: QaFindingClassification;
      reason: string;
      expectedCurrentReviewRef: null | Readonly<{
        id: string;
        version: number;
        contentHash: string;
      }>;
      expectedMembershipSetHash: string;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.finding.classify",
    );
    try {
      const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
        const finding = await this.#assertFindingCas(
          manager,
          workspaceId,
          projectId,
          workItemId,
          findingId,
          requireVersion(ifMatch),
        );
        const current = finding.current_review_revision_id
          ? rows(
              await manager.query(
                "SELECT finding_review_revision_id,version,content_hash FROM qa_finding_review_revisions WHERE finding_review_revision_id=$1",
                [finding.current_review_revision_id],
              ),
            )[0]
          : undefined;
        const expected = body.expectedCurrentReviewRef;
        if (
          (current === undefined) !== (expected === null) ||
          (current &&
            expected &&
            (current.finding_review_revision_id !== expected.id ||
              Number(current.version) !== expected.version ||
              current.content_hash !== expected.contentHash))
        )
          throw new QaDomainError("QA_FINDING_REVIEW_CAS_CONFLICT");
        const repository = new TypeOrmFindingRepository(manager);
        const membership = await repository.memberships({ workspaceId, projectId }, findingId);
        if (membership.activeMembershipSetHash !== body.expectedMembershipSetHash)
          throw new QaDomainError("QA_FINDING_MEMBERSHIP_CAS_CONFLICT");
        const content = json<Record<string, unknown>>(finding.content);
        const reviewRevision = await repository.classify({
          scope: { workspaceId, projectId },
          findingId,
          classification: body.classification,
          severity: String(content.initialSeverity ?? "MEDIUM") as QaFindingSeverity,
          summary: String(content.summary ?? "Manual QA finding"),
          reason: body.reason,
          policyRef: { key: "qa.finding-classification", version: "1.0.0" },
          actor: authorization.actor,
          at: new Date().toISOString(),
        });
        await this.#emit(manager, reviewRevision as unknown as QaFindingReviewRevision);
        const updated = await this.#finding(manager, workspaceId, projectId, workItemId, findingId);
        return {
          finding: this.#publicFinding(updated),
          reviewRevision,
          version: Number(updated.resource_version),
        };
      });
      response.setHeader("ETag", etag(result.version));
      return { finding: result.finding, reviewRevision: result.reviewRevision };
    } catch (error) {
      return conflict(error);
    }
  }

  @Put(":findingId/disposition")
  async dispose(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      dispositionDecision: QaFindingDispositionDecision;
      dispositionReason: string;
      expectedReviewContentHash: string;
      expectedMembershipSetHash: string;
      duplicateDefectRef?: unknown;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const permission =
      body.dispositionDecision === "ACCEPTED_RISK"
        ? "qa.finding.accept-risk"
        : body.dispositionDecision === "WAIVED"
          ? "qa.waiver.approve"
          : "qa.finding.classify";
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      permission,
    );
    try {
      const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
        const finding = await this.#assertFindingCas(
          manager,
          workspaceId,
          projectId,
          workItemId,
          findingId,
          requireVersion(ifMatch),
        );
        const current = rows(
          await manager.query(
            "SELECT * FROM qa_finding_review_revisions WHERE finding_review_revision_id=$1 FOR UPDATE",
            [finding.current_review_revision_id],
          ),
        )[0];
        if (
          !current ||
          current.content_hash !== body.expectedReviewContentHash ||
          current.active_membership_set_hash !== body.expectedMembershipSetHash
        )
          throw new QaDomainError("QA_FINDING_REVIEW_CAS_CONFLICT");
        if (body.dispositionDecision === "ACCEPTED_RISK" || body.dispositionDecision === "WAIVED") {
          const action = await this.#createAction(manager, {
            workspaceId,
            projectId,
            findingId,
            decision: body.dispositionDecision,
            reason: body.dispositionReason,
            actor: authorization.actor,
            review: current,
          });
          return { body: action, version: Number(finding.resource_version) };
        }
        const review = await new TypeOrmFindingRepository(manager).dispose({
          scope: { workspaceId, projectId },
          findingId,
          decision: body.dispositionDecision,
          reason: body.dispositionReason,
          actor: authorization.actor,
          at: new Date().toISOString(),
          ...(body.duplicateDefectRef ? { duplicateDefectRef: body.duplicateDefectRef } : {}),
        });
        await this.#emit(manager, review as unknown as QaFindingReviewRevision);
        const updated = await this.#finding(manager, workspaceId, projectId, workItemId, findingId);
        return { body: this.#publicFinding(updated), version: Number(updated.resource_version) };
      });
      response.setHeader("ETag", etag(result.version));
      return result.body;
    } catch (error) {
      return conflict(error);
    }
  }

  async #createAction(
    manager: EntityManager,
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      findingId: string;
      decision: "ACCEPTED_RISK" | "WAIVED";
      reason: string;
      actor: QaHumanActor;
      review: Row;
    }>,
  ) {
    if (!input.reason.trim()) throw new QaDomainError("QA_FINDING_ACTION_REASON_REQUIRED");
    const id = randomUUID();
    const candidate = {
      scope: { workspaceId: input.workspaceId, projectId: input.projectId },
      findingId: input.findingId,
      findingReviewRef: {
        id: String(input.review.finding_review_revision_id),
        version: Number(input.review.version),
        contentHash: String(input.review.content_hash),
      },
      decision: input.decision,
      initiatorId: input.actor.principalId,
      reason: input.reason,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    const candidateHash = qaAggregateSnapshotHash(candidate as never);
    await manager.query(
      "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,row_version,created_at) VALUES($1,$2,$3,'QA_FINDING_ACTION',$4,$5,'PENDING_APPROVAL',1,clock_timestamp())",
      [
        id,
        input.workspaceId,
        input.projectId,
        JSON.stringify({ candidate, initiatorId: input.actor.principalId }),
        candidateHash,
      ],
    );
    return Object.freeze({
      actionId: id,
      actionKind: "QA_FINDING_ACTION",
      state: "PENDING_APPROVAL",
      candidateHash,
      findingReviewRef: candidate.findingReviewRef,
      decision: input.decision,
    });
  }

  async #emit(
    manager: EntityManager,
    revision: Parameters<typeof buildQaFindingDecisionEvent>[0],
  ): Promise<void> {
    const event = buildQaFindingDecisionEvent(revision);
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
      [
        randomUUID(),
        revision.workspaceId,
        revision.projectId,
        event.eventType,
        JSON.stringify(event),
        event.payloadHash,
      ],
    );
  }

  async #assertFindingCas(
    manager: EntityManager,
    workspaceId: string,
    projectId: string,
    workItemId: string,
    findingId: string,
    version: number,
  ): Promise<Row> {
    const finding = await this.#finding(
      manager,
      workspaceId,
      projectId,
      workItemId,
      findingId,
      true,
    );
    if (Number(finding.resource_version) !== version)
      throw new QaDomainError("QA_FINDING_CAS_CONFLICT");
    return finding;
  }

  async #finding(
    manager: EntityManager,
    workspaceId: string,
    projectId: string,
    workItemId: string | undefined,
    findingId: string,
    lock = false,
  ): Promise<Row> {
    const found = rows(
      await manager.query(
        `SELECT * FROM qa_findings WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3${workItemId ? " AND work_item_id=$4" : ""}${lock ? " FOR UPDATE" : ""}`,
        workItemId
          ? [workspaceId, projectId, findingId, workItemId]
          : [workspaceId, projectId, findingId],
      ),
    )[0];
    if (!found) throw new NotFoundException("QA_FINDING_NOT_FOUND");
    return found;
  }

  #publicFinding(row: Row): Row {
    return Object.freeze({
      ...json<Record<string, unknown>>(row.content),
      findingId: String(row.finding_id),
      workItemId: String(row.work_item_id),
      sessionId: String(row.session_id),
      state: String(row.state),
      resourceVersion: Number(row.resource_version),
    });
  }
}

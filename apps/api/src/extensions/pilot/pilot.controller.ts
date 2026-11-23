import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  gateRequirements,
} from "@awp/platform-core";
import type {
  DurablePilotEvidenceImport,
  PilotDeadLetterService,
  PilotReadinessQuery,
  ReplayDecisionInput,
} from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";

export const PILOT_EVIDENCE_IMPORT = Symbol("PILOT_EVIDENCE_IMPORT");
export const PILOT_READINESS_QUERY = Symbol("PILOT_READINESS_QUERY");
export const PILOT_DEAD_LETTERS = Symbol("PILOT_DEAD_LETTERS");
export const PILOT_RUN_SERVICE = Symbol("PILOT_RUN_SERVICE");
export interface PilotRunApiService {
  run(input: Readonly<{ workspaceId: string; projectId: string; runId: string }>): Promise<unknown>;
  metrics(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      runId: string;
      protocolHash: string;
      limit: number;
      after?: string;
    }>,
  ): Promise<unknown>;
  measurementProtocol(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      runId: string;
      actorId: string;
      body: unknown;
    }>,
  ): Promise<unknown>;
  baselineImport(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      runId: string;
      actorId: string;
      body: unknown;
    }>,
  ): Promise<unknown>;
  review(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      runId: string;
      actorId: string;
      body: unknown;
    }>,
  ): Promise<unknown>;
}
const recoveryStages = new Set([
  "PLANNED",
  "FENCED",
  "RESTORED",
  "VERIFIED",
  "RECONCILED",
  "READY_FOR_RESUME",
  "RESUMED",
  "BLOCKED",
]);
export function projectRecoveryEvidence008(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("RECOVERY_EVIDENCE_INVALID");
  const row = value as Record<string, unknown>;
  const unresolved = row.unresolvedEffects;
  if (
    typeof row.recoveryId !== "string" ||
    !recoveryStages.has(String(row.stage)) ||
    typeof row.status !== "string" ||
    !Array.isArray(unresolved) ||
    unresolved.some((item) => typeof item !== "string") ||
    unresolved.length > 100
  )
    throw new Error("RECOVERY_EVIDENCE_INVALID");
  const time = (item: unknown) =>
      typeof item === "string" && Number.isFinite(Date.parse(item)) ? item : null,
    number = (item: unknown) =>
      typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : null;
  return Object.freeze({
    recoveryId: row.recoveryId,
    stage: row.stage,
    status: row.status,
    faultDeclaredAt: time(row.faultDeclaredAt),
    serviceRestoredAt: time(row.serviceRestoredAt),
    rpoObservedSeconds: number(row.rpoObservedSeconds),
    rtoObservedSeconds: number(row.rtoObservedSeconds),
    unresolvedEffects: Object.freeze(unresolved.map((item) => item as string)),
  });
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/pilot")
@UseGuards(QaSessionGuard)
export class PilotController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(PILOT_EVIDENCE_IMPORT) private readonly imports: DurablePilotEvidenceImport,
    @Inject(PILOT_READINESS_QUERY) private readonly queries: PilotReadinessQuery,
    @Optional() @Inject(PILOT_RUN_SERVICE) private readonly pilotRuns?: PilotRunApiService,
  ) {}

  @Get("health")
  @Header("Cache-Control", "private, no-store")
  health(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.read(() =>
      this.queries.health({
        workspaceId,
        projectId,
        authorize: async (permission) =>
          authorizeQaApi(this.source, request, workspaceId, projectId, permission),
      }),
    );
  }

  @Get("deployments/:deploymentId/readiness")
  @Header("Cache-Control", "private, no-store")
  readiness(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("deploymentId") deploymentId: string,
  ) {
    return this.read(() =>
      this.queries.readiness(
        {
          workspaceId,
          projectId,
          authorize: async (permission) =>
            authorizeQaApi(this.source, request, workspaceId, projectId, permission),
        },
        deploymentId,
      ),
    );
  }

  @Post("evidence-imports")
  @Header("Cache-Control", "private, no-store")
  async evidenceImport(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: Readonly<{ executionKey: string; reportRef: ExactRevisionRef }>,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "pilot.evidence.import");
    try {
      if (
        !body ||
        !Object.values(gateRequirements).some((keys) => keys.includes(body.executionKey)) ||
        Object.keys(body).some((key) => !["executionKey", "reportRef"].includes(key))
      )
        throw new ConflictException("PILOT_EVIDENCE_IMPORT_INPUT_INVALID");
      assertExactRevisionRef(body.reportRef);
      return await this.imports.import(
        {
          workspaceId,
          projectId,
          authorize: async (permission) =>
            authorizeQaApi(this.source, request, workspaceId, projectId, permission),
        },
        body,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : "";
      if (code === "PILOT_EVIDENCE_IMPORT_DENIED") throw new ForbiddenException(code);
      if (
        ["PILOT_REPORT_UNVERIFIED", "PILOT_IMMUTABLE_CONFLICT", "PILOT_VERSION_CONFLICT"].includes(
          code,
        )
      )
        throw new ConflictException(code);
      throw new ConflictException("PILOT_EVIDENCE_IMPORT_UNAVAILABLE");
    }
  }

  @Get("runs/:runId")
  @Header("Cache-Control", "private, no-store")
  async run(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "pilot.report.read");
    return this.pilotOperation(
      async (service) => await service.run({ workspaceId, projectId, runId }),
    );
  }

  @Get("runs/:runId/metrics")
  @Header("Cache-Control", "private, no-store")
  async metrics(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Query() query: Record<string, unknown>,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "pilot.report.read");
    if (
      Object.keys(query).some((key) => !["after", "limit", "protocolHash"].includes(key)) ||
      typeof query.protocolHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(query.protocolHash) ||
      (query.after !== undefined && typeof query.after !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/u.test(query.limit)))
    )
      throw new BadRequestException("PILOT_METRICS_QUERY_INVALID");
    const limit = query.limit === undefined ? 50 : Math.min(Number(query.limit), 100);
    return this.pilotOperation(
      async (service) =>
        await service.metrics({
          workspaceId,
          projectId,
          runId,
          protocolHash: query.protocolHash as string,
          limit,
          ...(query.after === undefined ? {} : { after: query.after as string }),
        }),
    );
  }

  @Post("runs/:runId/measurement-protocols")
  @Header("Cache-Control", "private, no-store")
  async measurementProtocol(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    const authority = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "pilot.measurement.manage",
    );
    this.assertPilotBody(body, ["requestKey", "expectedVersion", "protocol"]);
    return this.pilotOperation(
      async (service) =>
        await service.measurementProtocol({
          workspaceId,
          projectId,
          runId,
          actorId: authority.actor.principalId,
          body,
        }),
    );
  }

  @Post("runs/:runId/baseline-imports")
  @Header("Cache-Control", "private, no-store")
  async baselineImport(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    const authority = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "pilot.measurement.manage",
    );
    this.assertPilotBody(body, [
      "requestKey",
      "expectedVersion",
      "protocolHash",
      "observations",
      "spotCheckRefs",
    ]);
    if (!/^sha256:[a-f0-9]{64}$/u.test((body as Record<string, unknown>).protocolHash as string))
      throw new BadRequestException("PILOT_OPERATION_INPUT_INVALID");
    return this.pilotOperation(
      async (service) =>
        await service.baselineImport({
          workspaceId,
          projectId,
          runId,
          actorId: authority.actor.principalId,
          body,
        }),
    );
  }

  @Post("runs/:runId/reviews")
  @Header("Cache-Control", "private, no-store")
  async review(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    const authority = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "pilot.review.record",
    );
    this.assertPilotBody(body, [
      "requestKey",
      "expectedVersion",
      "reportHash",
      "decision",
      "reason",
    ]);
    const value = body as Record<string, unknown>;
    if (
      !/^sha256:[a-f0-9]{64}$/u.test(value.reportHash as string) ||
      !["CONTINUE", "ADJUST", "STOP", "INSUFFICIENT_DATA"].includes(String(value.decision))
    )
      throw new BadRequestException("PILOT_OPERATION_INPUT_INVALID");
    return this.pilotOperation(
      async (service) =>
        await service.review({
          workspaceId,
          projectId,
          runId,
          actorId: authority.actor.principalId,
          body,
        }),
    );
  }

  private assertPilotBody(body: unknown, keys: readonly string[]): void {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== keys.length ||
      Object.keys(body).some((key) => !keys.includes(key))
    )
      throw new BadRequestException("PILOT_OPERATION_INPUT_INVALID");
    const value = body as Record<string, unknown>;
    if (
      typeof value.requestKey !== "string" ||
      value.requestKey.length < 8 ||
      value.requestKey.length > 128 ||
      !Number.isSafeInteger(value.expectedVersion) ||
      Number(value.expectedVersion) < 1
    )
      throw new BadRequestException("PILOT_OPERATION_INPUT_INVALID");
  }

  private async pilotOperation<T>(
    operation: (service: PilotRunApiService) => Promise<T>,
  ): Promise<T> {
    if (!this.pilotRuns) throw new ServiceUnavailableException("PILOT_OPERATION_UNAVAILABLE");
    try {
      return await operation(this.pilotRuns);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : "";
      if (code === "PILOT_RESOURCE_UNAVAILABLE") throw new NotFoundException(code);
      if (code.endsWith("_INVALID")) throw new BadRequestException(code);
      if (code.endsWith("_CONFLICT") || code.endsWith("_IMMUTABLE"))
        throw new ConflictException(code);
      throw new ServiceUnavailableException("PILOT_OPERATION_UNAVAILABLE");
    }
  }
  private async read<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && error.message === "PILOT_READ_DENIED")
        throw new ForbiddenException(error.message);
      if (error instanceof Error && error.message === "PILOT_RESOURCE_UNAVAILABLE")
        throw new NotFoundException(error.message);
      throw new ServiceUnavailableException("PILOT_READINESS_UNAVAILABLE");
    }
  }
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/pilot")
@UseGuards(QaSessionGuard)
export class PilotDeadLetterController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(PILOT_DEAD_LETTERS) private readonly service: PilotDeadLetterService,
  ) {}
  private context(request: QaSessionRequest, workspaceId: string, projectId: string) {
    return {
      workspaceId,
      projectId,
      authorize: async (permission: "pilot.replay.read" | "pilot.replay.decide") =>
        authorizeQaApi(this.source, request, workspaceId, projectId, permission),
    };
  }
  @Get("dead-letters")
  @Header("Cache-Control", "private, no-store")
  async deadLetters(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.execute(async () => {
      if (
        Object.keys(query).some((key) => !["after", "limit"].includes(key)) ||
        (query.after !== undefined && typeof query.after !== "string") ||
        (query.limit !== undefined &&
          (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/u.test(query.limit)))
      )
        throw new BadRequestException("DEAD_LETTER_QUERY_INVALID");
      return this.service.list(this.context(request, workspaceId, projectId), {
        ...(query.after === undefined ? {} : { after: query.after as string }),
        ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
      });
    });
  }
  @Get("recovery")
  @Header("Cache-Control", "private, no-store")
  async recovery(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.execute(async () => {
      if (
        Object.keys(query).some((key) => !["after", "limit"].includes(key)) ||
        (query.after !== undefined &&
          (typeof query.after !== "string" || !Number.isFinite(Date.parse(query.after)))) ||
        (query.limit !== undefined &&
          (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/u.test(query.limit)))
      )
        throw new BadRequestException("RECOVERY_EVIDENCE_QUERY_INVALID");
      const limit = query.limit === undefined ? 20 : Math.min(Number(query.limit), 100),
        context = this.context(request, workspaceId, projectId),
        uncertain = await this.service.list(context, { limit: 100 });
      const rows = (await this.source.query(
        `SELECT r.semantic_body,r.created_at FROM pilot_record_headers h JOIN pilot_record_revisions r ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.kind='RECOVERY' AND ($3::timestamptz IS NULL OR r.created_at<$3) ORDER BY r.created_at DESC,r.record_id LIMIT $4`,
        [workspaceId, projectId, query.after ?? null, limit + 1],
      )) as { semantic_body: unknown; created_at: Date }[];
      const page = rows.slice(0, limit),
        drills = page.map((row) => projectRecoveryEvidence008(row.semantic_body));
      return {
        workspaceId,
        projectId,
        evaluatedAt: new Date().toISOString(),
        drills,
        uncertainEffects: uncertain.items,
        nextCursor: rows.length > limit ? page.at(-1)!.created_at.toISOString() : undefined,
      };
    });
  }
  @Post("dead-letters/:commandId/diagnostics")
  @Header("Cache-Control", "private, no-store")
  async captureDiagnostics(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("commandId") commandId: string,
    @Body() body: unknown,
  ) {
    return this.execute(async () => {
      if (
        body !== undefined &&
        (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
      )
        throw new BadRequestException("DEAD_LETTER_DECISION_INVALID");
      return {
        recordRef: await this.service.capture(
          this.context(request, workspaceId, projectId),
          commandId,
        ),
      };
    });
  }
  @Post("replay-decisions")
  @Header("Cache-Control", "private, no-store")
  async replayDecision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: ReplayDecisionInput,
  ) {
    return this.execute(() =>
      this.service.replay(this.context(request, workspaceId, projectId), body),
    );
  }
  private async execute<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : "";
      if (code === "DEAD_LETTER_ACCESS_DENIED") throw new ForbiddenException(code);
      if (code === "DEAD_LETTER_RESOURCE_UNAVAILABLE") throw new NotFoundException(code);
      if (
        [
          "DEAD_LETTER_QUERY_INVALID",
          "DEAD_LETTER_DECISION_INVALID",
          "RECOVERY_EVIDENCE_QUERY_INVALID",
        ].includes(code)
      )
        throw new BadRequestException(code);
      // Provider/database/authority exceptions may contain credentials or payloads.
      throw new ConflictException("DEAD_LETTER_ACTION_UNAVAILABLE");
    }
  }
}

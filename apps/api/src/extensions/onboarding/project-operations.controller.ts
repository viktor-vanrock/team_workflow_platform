import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import {
  etag,
  exact,
  exacts,
  idempotencyKey,
  object,
  onboardingRequest,
  reject,
  safeResult,
  text,
} from "./durable-http.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "./project-operations.application.ts";

@UseGuards(QaSessionGuard)
@Controller("v1/workspaces/:workspaceId/projects/:projectId/operations")
export class ProjectOperationsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(PROJECT_OPERATIONS_HTTP_APPLICATION)
    private readonly application: DurableProjectOperationsApplication,
  ) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  read(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
  ) {
    return safeResult(() => this.application.read(onboardingRequest(this.source, request, w, p)));
  }
  @Post("suspend")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  suspend(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return safeResult(() => {
      const b = object(body, ["incidentRef", "reason"]);
      return this.application.suspend(
        onboardingRequest(this.source, request, w, p),
        {
          expectedVersion: etag(match),
          incidentRef: text(b.incidentRef, 2048),
          reason: text(b.reason),
        },
        idempotencyKey(key),
      );
    });
  }
  @Post("incident-dispositions")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  disposition(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return safeResult(() => {
      const b = object(body, ["incidentRef", "outcome", "reason"]);
      if (b.outcome !== "ACCEPTED" && b.outcome !== "REJECTED")
        return reject("INCIDENT_OUTCOME_INVALID", 400);
      return this.application.disposition(
        onboardingRequest(this.source, request, w, p),
        {
          expectedVersion: etag(match),
          incidentRef: text(b.incidentRef, 2048),
          outcome: b.outcome,
          reason: text(b.reason),
        },
        idempotencyKey(key),
      );
    });
  }
  @Post("resume-candidates")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  prepare(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return safeResult(() => {
      const b = object(body, ["incidentDispositionRef", "reason"]);
      return this.application.prepareResume(
        onboardingRequest(this.source, request, w, p),
        {
          expectedVersion: etag(match),
          incidentDispositionRef: exact(b.incidentDispositionRef),
          reason: text(b.reason),
        },
        idempotencyKey(key),
      );
    });
  }
  @Post("approvals")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  approve(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return safeResult(() => {
      const b = object(body, ["candidateRef"]);
      return this.application.approve(
        onboardingRequest(this.source, request, w, p),
        { expectedVersion: etag(match), candidateRef: exact(b.candidateRef) },
        idempotencyKey(key),
      );
    });
  }
  @Post("resume")
  @HttpCode(202)
  @Header("Cache-Control", "private, no-store")
  resume(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") w: string,
    @Param("projectId") p: string,
    @Headers("if-match") match: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return safeResult(() => {
      const b = object(body, [
        "incidentRef",
        "incidentDispositionRef",
        "freshProbeRefs",
        "actionCandidateRef",
        "approvalRef",
        "reason",
      ]);
      return this.application.resume(
        onboardingRequest(this.source, request, w, p),
        {
          expectedVersion: etag(match),
          incidentRef: text(b.incidentRef, 2048),
          incidentDispositionRef: exact(b.incidentDispositionRef),
          freshProbeRefs: exacts(b.freshProbeRefs),
          actionCandidateRef: exact(b.actionCandidateRef),
          approvalRef: exact(b.approvalRef),
          reason: text(b.reason),
        },
        idempotencyKey(key),
      );
    });
  }
}

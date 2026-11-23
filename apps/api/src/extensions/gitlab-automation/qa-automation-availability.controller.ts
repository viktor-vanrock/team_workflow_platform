import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { QaAutomationAvailabilityAuthority } from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";

export const QA_AUTOMATION_AVAILABILITY_API = Symbol("QA_AUTOMATION_AVAILABILITY_API");
export interface QaAutomationAvailabilityApiPort {
  current(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    authority?: QaAutomationAvailabilityAuthority,
  ): Promise<unknown>;
  operational?(scope: Readonly<{ workspaceId: string; projectId: string }>): Promise<
    Readonly<{
      connectionHealth: string;
      freshness: string;
      reasonCodes: readonly string[];
      lastAuthoritativeReadAt?: string;
      nextEligibleAt?: string;
    }>
  >;
}

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automation/availability")
@UseGuards(QaSessionGuard)
export class QaAutomationAvailabilityController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_AUTOMATION_AVAILABILITY_API)
    private readonly availability: QaAutomationAvailabilityApiPort,
  ) {}

  @Get()
  async current(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Res({ passthrough: true }) response?: HeaderResponse,
  ) {
    response?.setHeader("Cache-Control", "no-store");
    const authorize = () =>
      authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const initial = await authorize();
    const scope = Object.freeze({ workspaceId, projectId });
    const [projection, operational] = await Promise.all([
      this.availability.current(scope, { authorize }).catch((error: unknown) => {
        if (error instanceof Error && error.message === "QA_AUTOMATION_ACCESS_DENIED")
          throw new ForbiddenException("QA_AUTOMATION_ACCESS_DENIED");
        throw error;
      }),
      this.availability.operational?.(scope),
    ]);
    const current = await authorize();
    if (
      current.actor.principalId !== initial.actor.principalId ||
      current.actor.issuer !== initial.actor.issuer ||
      current.actor.subject !== initial.actor.subject ||
      current.classificationCeiling !== initial.classificationCeiling
    )
      throw new ForbiddenException("QA_AUTOMATION_ACCESS_DENIED");
    if (response && operational) {
      response.setHeader("X-AWP-GitLab-Connection-Health", operational.connectionHealth);
      response.setHeader("X-AWP-GitLab-Freshness", operational.freshness);
      response.setHeader("X-AWP-GitLab-Reason-Codes", operational.reasonCodes.join(","));
      if (operational.lastAuthoritativeReadAt)
        response.setHeader(
          "X-AWP-GitLab-Last-Authoritative-Read",
          operational.lastAuthoritativeReadAt,
        );
      if (operational.nextEligibleAt)
        response.setHeader("X-AWP-GitLab-Next-Eligible-At", operational.nextEligibleAt);
    }
    return projection;
  }
}

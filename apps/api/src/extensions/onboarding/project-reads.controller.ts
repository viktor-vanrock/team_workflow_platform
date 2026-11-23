import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { DurableProjectReadsApplication } from "./project-reads.application.ts";
import { PublishedOnboardingProblemFilter } from "./published-http.ts";

@Controller("api/v1/workspaces/:workspaceId")
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class ProjectReadsController {
  private readonly application: DurableProjectReadsApplication;
  constructor(@Inject(QA_DATA_SOURCE) source: DataSource) {
    this.application = new DurableProjectReadsApplication(source);
  }
  @Get("project-search")
  @Header("Cache-Control", "private, no-store")
  search(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.application.search(request, workspaceId, { q, limit, cursor });
  }
  @Get("project-events")
  @Header("Cache-Control", "private, no-store")
  events(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.application.events(request, workspaceId, { limit, cursor });
  }
  @Get("projects/:projectId/work-items/:workItemId")
  @Header("Cache-Control", "private, no-store")
  item(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    return this.application.workItem(request, workspaceId, projectId, workItemId);
  }
}

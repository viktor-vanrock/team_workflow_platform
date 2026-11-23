import {
  Body,
  Controller,
  type DynamicModule,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { ResourceScope } from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import type { CorporateSessionService } from "@awp/platform-runtime-nest";
import {
  createHermesDialogueClient,
  HERMES_PROJECT_DIALOGUE,
  type HermesDialoguePort,
  workspaceInstallationReadiness,
} from "@awp/runtime-composition";

import { CorporateAccessModule } from "../access/access.module.ts";
import { CorporateQaHttpIdentity } from "../extensions/corporate-qa-http-identity.ts";
import { HermesMattermostController } from "../extensions/hermes/mattermost.controller.ts";
import {
  etag,
  idempotencyKey,
  onboardingRequest,
  reject,
  safeResult,
} from "../extensions/onboarding/durable-http.ts";
import { ProjectDialogueController } from "../extensions/onboarding/project-dialogue.controller.ts";
import { ProjectMetadataApplication } from "../extensions/onboarding/project-metadata.application.ts";
import { PublishedOnboardingProblemFilter } from "../extensions/onboarding/published-http.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "../extensions/onboarding/registry.application.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  QaSessionGuard,
  type QaSessionRequest,
} from "../extensions/qa-api-authorization.ts";

const WORKSPACE_SESSIONS = "WORKSPACE_SESSIONS";
async function authority(
  sessions: CorporateSessionService,
  request: QaSessionRequest,
  scope: ResourceScope,
  permission: string,
  operationClass: "READ" | "MUTATE",
) {
  try {
    const result = await sessions.authorize(request, {
      scope,
      permission,
      operationClass,
      requireStepUp: operationClass === "MUTATE",
    });
    if (!result.authorizationBasis) throw new Error("CORPORATE_REGISTRATION_DENIED");
    return result.authorizationBasis;
  } catch (error) {
    return reject(
      error instanceof Error && error.message === "CORPORATE_STEP_UP_REQUIRED"
        ? "STEP_UP_REQUIRED"
        : "CORPORATE_REGISTRATION_DENIED",
      403,
    );
  }
}

/** Project admission only: no provider effects or local personas are registered. */
@Controller(["api/v1/workspaces/:workspaceId/projects", "v1/workspaces/:workspaceId/projects"])
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class WorkspaceProjectsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(WORKSPACE_SESSIONS) private readonly sessions: CorporateSessionService,
    @Inject(REGISTRY_HTTP_APPLICATION) private readonly registry: DurableRegistryHttpApplication,
  ) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  catalog(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return safeResult(() =>
      this.registry.catalog(request, workspaceId, {
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      }),
    );
  }
  @Get("registration-options")
  @Header("Cache-Control", "private, no-store")
  options(@Req() request: QaSessionRequest, @Param("workspaceId") workspaceId: string) {
    return safeResult(() => this.registry.registrationOptions(request, workspaceId));
  }
  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  register(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return safeResult(() =>
      this.registry.register(request, workspaceId, body, idempotencyKey(key)),
    );
  }
  @Get(":projectId/metadata")
  @Header("Cache-Control", "private, no-store")
  metadata(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    return safeResult(async () => {
      const result = await new ProjectMetadataApplication(this.source).read(
        onboardingRequest(this.source, request, workspaceId, projectId),
      );
      response.setHeader("ETag", `"${result.project.version}"`);
      return result;
    });
  }
  @Put(":projectId/metadata")
  @Header("Cache-Control", "private, no-store")
  update(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ) {
    return safeResult(async () => {
      await authority(
        this.sessions,
        request,
        { kind: "PROJECT", workspaceId, projectId },
        "project.metadata.update",
        "MUTATE",
      );
      const result = await new ProjectMetadataApplication(this.source).update(
        onboardingRequest(this.source, request, workspaceId, projectId),
        body,
        idempotencyKey(key),
        etag(match),
      );
      response.setHeader("ETag", `"${result.version}"`);
      return result;
    });
  }
}
@Controller("health")
export class WorkspaceHealthController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(HERMES_PROJECT_DIALOGUE) private readonly hermes: HermesDialoguePort,
  ) {}
  @Get("live") live() {
    return { status: "UP", service: "workspace" };
  }
  @Get("ready") async ready(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const result = await workspaceInstallationReadiness(this.source);
    const hermesReady = await this.hermes.ready();
    response.status(result.ready && hermesReady ? 200 : 503);
    return {
      ...result,
      ready: result.ready && hermesReady,
      ...(!hermesReady ? { reasonCode: "HERMES_SERVICE_UNAVAILABLE" } : {}),
      hermes: { ready: hermesReady },
    };
  }
}
@Module({})
export class WorkspaceInstallationModule {
  static register(
    source: DataSource,
    sessions: CorporateSessionService,
    ownsSource = false,
    hermes: HermesDialoguePort = createHermesDialogueClient(),
  ): DynamicModule {
    const identity = new CorporateQaHttpIdentity(
      sessions,
      new TypeOrmScopedAccessRepository(source),
      [],
    );
    const registry = new DurableRegistryHttpApplication(
      source,
      async (request, workspaceId, operation = "MUTATE", permission = "project.register") => {
        return authority(
          sessions,
          request,
          { kind: "WORKSPACE", workspaceId },
          permission,
          operation,
        );
      },
    );
    return {
      module: WorkspaceInstallationModule,
      imports: [CorporateAccessModule.register(source, sessions)],
      controllers: [
        WorkspaceProjectsController,
        ProjectDialogueController,
        HermesMattermostController,
        WorkspaceHealthController,
      ],
      providers: [
        { provide: HERMES_PROJECT_DIALOGUE, useValue: hermes },
        { provide: QA_DATA_SOURCE, useValue: source },
        { provide: QA_HTTP_IDENTITY, useValue: identity },
        { provide: WORKSPACE_SESSIONS, useValue: sessions },
        {
          provide: "WORKSPACE_SHUTDOWN",
          useValue: {
            async onApplicationShutdown() {
              if (ownsSource && source.isInitialized) await source.destroy();
            },
          },
        },
        { provide: REGISTRY_HTTP_APPLICATION, useValue: registry },
        QaSessionGuard,
      ],
    };
  }
}

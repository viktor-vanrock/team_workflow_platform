import "../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ForbiddenException,
  Module,
  UnauthorizedException,
} from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { BINDING_HTTP_APPLICATION } from "../../apps/api/src/extensions/onboarding/bindings.application.ts";
import { currentAuthority, digest } from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  DurableEvidenceHttpApplication,
  EVIDENCE_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/evidence.application.ts";
import { EvidenceIntegrityController } from "../../apps/api/src/extensions/onboarding/evidence.controller.ts";
import { OnboardingController } from "../../apps/api/src/extensions/onboarding/onboarding.controller.ts";
import { ProjectReadsController } from "../../apps/api/src/extensions/onboarding/project-reads.controller.ts";
import { PublishedOnboardingController } from "../../apps/api/src/extensions/onboarding/published.controllers.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/registry.application.ts";
import { RESOURCES_HTTP_APPLICATION } from "../../apps/api/src/extensions/onboarding/resources.application.ts";
import { VALIDATION_HTTP_APPLICATION } from "../../apps/api/src/extensions/onboarding/validation.application.ts";
import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  qaInteractionSession,
  QaSessionGuard,
  type QaSessionRequest,
} from "../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  createQaArtifactHttpApi,
  explicitArtifactScope,
} from "../../apps/api/src/extensions/qa-artifact-http-api.ts";
import {
  QA_ARTIFACT_HTTP_API,
  QaArtifactsController,
} from "../../apps/api/src/extensions/qa-artifacts.controller.ts";
import {
  PortfolioQueueController,
  QueueController,
} from "../../apps/api/src/extensions/queue/queue.controller.ts";
import { QUEUE_HTTP_AUTHORITY } from "../../apps/api/src/extensions/queue/queue-http-authority.ts";
import { createLocalEvidenceCrypto } from "../../apps/api/src/local/local-evidence-integrity.ts";
import {
  ArtifactAuthorizationContributionRegistry,
  defaultClassificationCatalog,
} from "../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  TypeOrmArtifactRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  ProblemDetailsFilter,
  ProjectOnboardingApplication,
  WorkspaceContextStore,
} from "../../packages/platform-runtime-nest/src/index.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import { PostgresAuthorizedQueueProjects } from "../../packages/runtime-composition/src/queue/portfolio-query.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";

const source = createPlatformDataSource({
  url: process.env.AWP_JOURNEY_DATABASE_URL!,
  entities: qaLocalEntities,
  migrations: qaLocalMigrations,
});
await source.initialize();
const directory = process.env.AWP_SCOPE_DIRECTORY!;
const principal = (context: Parameters<QaHttpIdentity["authenticate"]>[0]) => {
  const token = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>()
    .headers.authorization;
  const ids = {
    "Bearer owner": localPersonaIds["owner.local"],
    "Bearer lead": localPersonaIds["lead.alpha"],
    "Bearer limited": localPersonaIds["lead.alpha"],
    "Bearer executor": localPersonaIds["executor.alpha"],
  };
  if (!token || !(token in ids)) throw new UnauthorizedException();
  return ids[token as keyof typeof ids];
};
const authentication = () => ({
  contextRef: "controlled-verified-scope-session",
  verifiedAt: new Date().toISOString(),
  stepUpAt: new Date().toISOString(),
});
const identity: QaHttpIdentity = {
  authenticate: async (context) => {
    const principalId = principal(context),
      limited =
        context.switchToHttp().getRequest<{ headers: { authorization?: string } }>().headers
          .authorization === "Bearer limited";
    return async ({ scope, permission }) => {
      const authority = await source.transaction((manager) =>
        currentAuthority(manager, scope, principalId, permission),
      );
      if (
        limited &&
        defaultClassificationCatalog.reference(authority.classification).rank >
          defaultClassificationCatalog.reference("INTERNAL").rank
      )
        throw new ForbiddenException("QA_SCOPE_DENIED");
      return {
        actor: authority.actor,
        basis: authority.basis,
        scope,
        classificationCeiling: limited ? "INTERNAL" : authority.classificationCeiling,
        authentication: authentication(),
      };
    };
  },
  interaction: async (context) => ({
    principalId: principal(context),
    binding: digest({ principalId: principal(context) }),
    authentication: authentication(),
  }),
};
@Module({})
class ScopeModule {}
const app = await NestFactory.create(
  {
    module: ScopeModule,
    controllers: [
      QueueController,
      PortfolioQueueController,
      PublishedOnboardingController,
      ProjectReadsController,
      OnboardingController,
      EvidenceIntegrityController,
      QaArtifactsController,
    ],
    providers: [
      QaSessionGuard,
      { provide: QA_DATA_SOURCE, useValue: source },
      { provide: QA_HTTP_IDENTITY, useValue: identity },
      { provide: ProjectOnboardingApplication, useValue: {} },
      { provide: WorkspaceContextStore, useValue: {} },
      {
        provide: QUEUE_HTTP_AUTHORITY,
        useValue: {
          project: async (
            request: QaSessionRequest,
            workspaceId: string,
            projectId: string,
            permission: string,
          ) => authorizeQaApi(source, request, workspaceId, projectId, permission),
          portfolio: async (
            request: QaSessionRequest,
            workspaceId: string,
            permissions: readonly string[],
          ) => {
            const resolved = await new PostgresAuthorizedQueueProjects(source).resolveIdentity({
                workspaceId,
                principalId: (await qaInteractionSession(request)).principalId,
                permissions,
              }),
              projectIds: string[] = [];
            for (const projectId of resolved.projectIds) {
              try {
                for (const permission of new Set(["queue.project.read", ...permissions])) {
                  const authorized = await authorizeQaApi(
                    source,
                    request,
                    workspaceId,
                    projectId,
                    permission,
                  );
                  if (authorized.actor.principalId !== resolved.principalId)
                    throw new ForbiddenException("QA_SCOPE_DENIED");
                }
                projectIds.push(projectId);
              } catch (error) {
                if (!(error instanceof ForbiddenException)) throw error;
              }
            }
            return { principalId: resolved.principalId, projectIds };
          },
        },
      },
      { provide: REGISTRY_HTTP_APPLICATION, useValue: new DurableRegistryHttpApplication(source) },
      { provide: RESOURCES_HTTP_APPLICATION, useValue: {} },
      { provide: VALIDATION_HTTP_APPLICATION, useValue: {} },
      { provide: BINDING_HTTP_APPLICATION, useValue: {} },
      {
        provide: EVIDENCE_HTTP_APPLICATION,
        useValue: new DurableEvidenceHttpApplication(source, createLocalEvidenceCrypto(directory)),
      },
      {
        provide: QA_ARTIFACT_HTTP_API,
        useValue: createQaArtifactHttpApi({
          source,
          repository: new TypeOrmArtifactRepository(source),
          scope: explicitArtifactScope,
          contributions: new ArtifactAuthorizationContributionRegistry(),
          storage: {
            stream: async (reference: { opaqueLocator: string }) => {
              if (!/^[a-f0-9-]{36}$/u.test(reference.opaqueLocator))
                throw new Error("STORAGE_NOT_FOUND");
              return {
                body: (async function* () {
                  yield await readFile(join(directory, reference.opaqueLocator));
                })(),
              };
            },
          },
        }),
      },
    ],
  },
  { logger: ["error"], abortOnError: false },
);
app.useGlobalFilters(new ProblemDetailsFilter());
await app.listen(0, "127.0.0.1");
let commands = Promise.resolve();
process.on("message", (message: { id: number; operation: string }) => {
  commands = commands.then(async () => {
    try {
      if (message.operation !== "close") throw new Error("UNKNOWN_OPERATION");
      await app.close();
      await source.destroy();
      process.send?.({ id: message.id, result: { closed: true } });
      process.disconnect?.();
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : "PROCESS_ERROR",
      });
    }
  });
});
process.send?.({ ready: true, pid: process.pid, origin: await app.getUrl() });

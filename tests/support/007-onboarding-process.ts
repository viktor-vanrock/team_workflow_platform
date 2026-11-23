import "../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { Module, UnauthorizedException } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  QA_AUTOMATED_SESSIONS_API,
  QaAutomatedSessionsController,
} from "../../apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts";
import { TypeOrmQaAutomatedSessionsApi } from "../../apps/api/src/extensions/gitlab-automation/qa-automation-local.adapters.ts";
import {
  BINDING_HTTP_APPLICATION,
  DurableBindingHttpApplication,
} from "../../apps/api/src/extensions/onboarding/bindings.application.ts";
import { digest } from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import { OnboardingController } from "../../apps/api/src/extensions/onboarding/onboarding.controller.ts";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/project-operations.application.ts";
import { ProjectOperationsController } from "../../apps/api/src/extensions/onboarding/project-operations.controller.ts";
import { PublishedOnboardingController } from "../../apps/api/src/extensions/onboarding/published.controllers.ts";
import {
  DurableRegistryHttpApplication,
  REGISTRY_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/registry.application.ts";
import {
  DurableResourcesHttpApplication,
  RESOURCES_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/resources.application.ts";
import {
  DurableValidationHttpApplication,
  VALIDATION_HTTP_APPLICATION,
} from "../../apps/api/src/extensions/onboarding/validation.application.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../../apps/api/src/extensions/qa-api-authorization.ts";
import {
  QA_SESSION_RUNTIME,
  QaSessionsController,
} from "../../apps/api/src/extensions/qa-sessions.controller.ts";
import { authorizeLocalQaApi } from "../../apps/api/src/local/local-qa-authorization.ts";
import { createLocalQaSessionRuntime } from "../../apps/api/src/local/local-qa-session-runtime.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  ProblemDetailsFilter,
  ProjectOnboardingApplication,
  WorkspaceContextStore,
} from "../../packages/platform-runtime-nest/src/index.ts";
import { createRequestedCapabilityProbeWorker } from "../../packages/runtime-composition/src/onboarding/requested-probe-worker.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";

// No repository instances or business results are passed through IPC.
const source = createPlatformDataSource({
  url: process.env.AWP_JOURNEY_DATABASE_URL!,
  entities: qaLocalEntities,
  migrations: qaLocalMigrations,
});
await source.initialize();
let app: NestExpressApplication | undefined;
const worker = createRequestedCapabilityProbeWorker(source, {
  deadlineMs: 1000,
  validForMs: 120_000,
  authorize: async (target) => target.environmentScope === "LOCAL",
  observe: async (target, signal) => {
    const url = new URL(process.env.AWP_JOURNEY_PROVIDER_URL!);
    url.searchParams.set("operation", target.operation);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("PROVIDER_FAILED");
    return (await response.json()) as { status: "AVAILABLE"; safeIssueCodes: [] };
  },
});
if (process.env.AWP_JOURNEY_ROLE === "api") {
  const persona = (context: Parameters<QaHttpIdentity["authenticate"]>[0]) => {
    const token = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>()
      .headers.authorization;
    const key = token?.slice("Bearer ".length);
    const map = {
      owner: "owner.local",
      admin: "integration-admin.alpha",
      lead: "lead.alpha",
      executor: "executor.alpha",
    } as const;
    if (!token?.startsWith("Bearer ") || !key || !(key in map)) throw new UnauthorizedException();
    return map[key as keyof typeof map];
  };
  const authentication = (key: string) => ({
    contextRef: digest({ key }),
    verifiedAt: new Date().toISOString(),
    stepUpAt: new Date().toISOString(),
  });
  const identity: QaHttpIdentity = {
    authenticate: async (context) => {
      const key = persona(context);
      return async ({ scope, permission }) => ({
        ...(await authorizeLocalQaApi(
          source,
          { headers: {}, localPersonaKey: key },
          scope.workspaceId,
          scope.projectId,
          permission,
        )),
        authentication: authentication(key),
      });
    },
    interaction: async (context) => {
      const key = persona(context);
      return {
        principalId: localPersonaIds[key],
        binding: digest({ key }),
        authentication: authentication(key),
      };
    },
  };
  @Module({})
  class JourneyModule {}
  app = await NestFactory.create<NestExpressApplication>(
    {
      module: JourneyModule,
      controllers: [
        OnboardingController,
        PublishedOnboardingController,
        ProjectOperationsController,
        QaSessionsController,
        QaAutomatedSessionsController,
      ],
      providers: [
        QaSessionGuard,
        { provide: QA_DATA_SOURCE, useValue: source },
        { provide: QA_HTTP_IDENTITY, useValue: identity },
        { provide: ProjectOnboardingApplication, useValue: {} },
        { provide: WorkspaceContextStore, useValue: {} },
        {
          provide: REGISTRY_HTTP_APPLICATION,
          useValue: new DurableRegistryHttpApplication(source),
        },
        {
          provide: RESOURCES_HTTP_APPLICATION,
          useValue: new DurableResourcesHttpApplication(source, {
            slots: async () => {
              throw new Error("ACCOUNT_INVENTORY_NOT_USED");
            },
          }),
        },
        {
          provide: VALIDATION_HTTP_APPLICATION,
          useValue: new DurableValidationHttpApplication(source),
        },
        { provide: BINDING_HTTP_APPLICATION, useValue: new DurableBindingHttpApplication(source) },
        {
          provide: PROJECT_OPERATIONS_HTTP_APPLICATION,
          useValue: new DurableProjectOperationsApplication(source),
        },
        { provide: QA_SESSION_RUNTIME, useValue: createLocalQaSessionRuntime() },
        { provide: QA_AUTOMATED_SESSIONS_API, useValue: new TypeOrmQaAutomatedSessionsApi(source) },
      ],
    },
    { logger: false, abortOnError: false },
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0, "127.0.0.1");
}
let chain = Promise.resolve();
process.on("message", (message: { id: number; operation: string }) => {
  chain = chain.then(async () => {
    try {
      if (message.operation === "close") {
        await app?.close();
        await source.destroy();
        process.send?.({ id: message.id, result: { closed: true } });
        process.disconnect?.();
        return;
      }
      if (message.operation !== "run" || app) throw new Error("JOURNEY_OPERATION_UNKNOWN");
      process.send?.({ id: message.id, result: await worker.run() });
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : "JOURNEY_FAILED",
      });
    }
  });
});
process.send?.({ ready: true, pid: process.pid, origin: await app?.getUrl() });

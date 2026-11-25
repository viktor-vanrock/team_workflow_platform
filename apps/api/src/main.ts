import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { DataSource } from "typeorm";

import {
  InstrumentedRuntimeModule,
  ProblemDetailsFilter,
  runSafeRuntimeEntrypoint,
  SafeHttpTelemetryInterceptor,
  SafeNestLogger,
  selectRuntimeTelemetry,
  type TelemetryRuntime,
} from "@awp/platform-runtime-nest";
import {
  createPilotDevelopmentComposition,
  createPilotNonLocalComposition,
  loadEnvironment,
  type PilotNonLocalCompositionOptions,
  selectRuntimeComposition,
} from "@awp/runtime-composition";

import type { PilotNonLocalApiBindings } from "./app.module.ts";

export interface PilotNonLocalApiEntrypoint {
  readonly source: DataSource;
  readonly composition: Omit<PilotNonLocalCompositionOptions, "component">;
  readonly api: Omit<PilotNonLocalApiBindings, "source">;
}

export async function bootstrapApi(
  approvedTelemetry?: TelemetryRuntime,
  nonLocal?: PilotNonLocalApiEntrypoint,
): Promise<NestExpressApplication> {
  const environment = loadEnvironment();
  const composition = selectRuntimeComposition(process.env, environment);
  if ((environment.profile === "non-local") !== Boolean(nonLocal))
    throw new Error(
      environment.profile === "non-local"
        ? "CORPORATE_COMPOSITION_REQUIRED"
        : "PILOT_NON_LOCAL_PROFILE_CONFLICT",
    );
  if (composition === "qa-jira-gitlab-mattermost-local")
    createPilotDevelopmentComposition(environment);
  const telemetry = await selectRuntimeTelemetry("api", process.env, approvedTelemetry);
  const corporate = nonLocal
    ? createPilotNonLocalComposition(environment, nonLocal.source, {
        ...nonLocal.composition,
        component: "api",
      })
    : undefined;
  const deployment = corporate
    ? {
        readiness: () => corporate.deployment.readiness(),
        keepAlive: () => corporate.deployment.keepAlive(),
        stop: async () => {
          try {
            await corporate.deployment.stop();
          } finally {
            if (nonLocal!.source.isInitialized) await nonLocal!.source.destroy();
          }
        },
      }
    : undefined;
  let app: NestExpressApplication | undefined;
  try {
    const {
      LocalApiModule,
      PilotNonLocalApiModule,
      QaJiraGitLabLocalApiModule,
      QaJiraGitLabMattermostLocalApiModule,
      QaJiraLocalApiModule,
      QaJiraMattermostLocalApiModule,
      QaLocalApiModule,
    } = await import("./app.module.ts");
    if (corporate) await corporate.deployment.start();
    const module = corporate
      ? PilotNonLocalApiModule.register({ ...nonLocal!.api, source: nonLocal!.source })
      : environment.profile === "local"
        ? composition === "qa-jira-gitlab-mattermost-local"
          ? QaJiraGitLabMattermostLocalApiModule
          : composition === "qa-jira-gitlab-local"
            ? QaJiraGitLabLocalApiModule
            : composition === "qa-jira-mattermost-local"
              ? QaJiraMattermostLocalApiModule
              : composition === "qa-jira-local"
                ? QaJiraLocalApiModule
                : composition === "qa-local"
                  ? QaLocalApiModule
                  : LocalApiModule
        : (() => {
            throw new Error("CORPORATE_COMPOSITION_REQUIRED");
          })();
    app = await NestFactory.create<NestExpressApplication>(
      InstrumentedRuntimeModule.compose(module, telemetry, deployment),
      { logger: new SafeNestLogger("api"), abortOnError: false, rawBody: true },
    );
    // Local documentation supports 100,000 Unicode characters plus JSON escaping.
    // Corporate request limits retain their existing policy.
    if (environment.profile === "local") {
      app.useBodyParser("json", { limit: "1mb" });
    }
    app.useBodyParser("raw", { type: "application/octet-stream", limit: "10mb" });
    app.useGlobalFilters(new ProblemDetailsFilter());
    app.useGlobalInterceptors(new SafeHttpTelemetryInterceptor());
    app.enableCors({
      origin: process.env.AWP_WEB_ORIGIN ?? "http://localhost:5173",
      credentials: environment.profile === "local",
    });
    app.enableShutdownHooks();
    await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
    return app;
  } catch (error) {
    try {
      await app?.close();
      await deployment?.stop();
    } finally {
      await telemetry?.shutdown();
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (
    !(await runSafeRuntimeEntrypoint("api", async () => {
      await bootstrapApi();
    }))
  )
    process.exitCode = 1;
}

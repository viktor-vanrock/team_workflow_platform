import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { DataSource } from "typeorm";

import {
  InstrumentedRuntimeModule,
  runSafeRuntimeEntrypoint,
  SafeNestLogger,
  selectRuntimeTelemetry,
  type TelemetryRuntime,
} from "@awp/platform-runtime-nest";
import {
  type CorporateConnectorFactories,
  createPilotDevelopmentComposition,
  createPilotNonLocalComposition,
  type DeploymentStartup,
  loadEnvironment,
  type PilotNonLocalCompositionOptions,
  selectRuntimeComposition,
} from "@awp/runtime-composition";

import type { NamedWorkerLoopContribution } from "./app.module.ts";

export interface PilotNonLocalWorkerEntrypoint {
  readonly source: DataSource;
  readonly composition: Omit<PilotNonLocalCompositionOptions, "component">;
  readonly contributions:
    | readonly NamedWorkerLoopContribution[]
    | ((
        context: Readonly<{
          connectors: CorporateConnectorFactories;
          deployment: DeploymentStartup;
        }>,
      ) => readonly NamedWorkerLoopContribution[]);
}

export async function bootstrapWorker(
  approvedTelemetry?: TelemetryRuntime,
  nonLocal?: PilotNonLocalWorkerEntrypoint,
): Promise<Awaited<ReturnType<typeof NestFactory.create>>> {
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
  const telemetry = await selectRuntimeTelemetry("worker", process.env, approvedTelemetry);
  const corporate = nonLocal
    ? createPilotNonLocalComposition(environment, nonLocal.source, {
        ...nonLocal.composition,
        component: "worker",
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
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    const {
      LocalWorkerAppModule,
      PilotNonLocalWorkerAppModule,
      QaJiraGitLabLocalWorkerAppModule,
      QaJiraGitLabMattermostLocalWorkerAppModule,
      QaJiraLocalWorkerAppModule,
      QaJiraMattermostLocalWorkerAppModule,
      QaLocalWorkerAppModule,
    } = await import("./app.module.ts");
    if (corporate) await corporate.deployment.start();
    const module = corporate
      ? PilotNonLocalWorkerAppModule.register(
          nonLocal!.source,
          typeof nonLocal!.contributions === "function"
            ? nonLocal!.contributions({
                connectors: corporate.connectors,
                deployment: corporate.deployment,
              })
            : nonLocal!.contributions,
          corporate.workerKeys,
        )
      : environment.profile === "local"
        ? composition === "qa-jira-gitlab-mattermost-local"
          ? QaJiraGitLabMattermostLocalWorkerAppModule
          : composition === "qa-jira-gitlab-local"
            ? QaJiraGitLabLocalWorkerAppModule
            : composition === "qa-jira-mattermost-local"
              ? QaJiraMattermostLocalWorkerAppModule
              : composition === "qa-jira-local"
                ? QaJiraLocalWorkerAppModule
                : composition === "qa-local"
                  ? QaLocalWorkerAppModule
                  : LocalWorkerAppModule
        : (() => {
            throw new Error("CORPORATE_COMPOSITION_REQUIRED");
          })();
    app = await NestFactory.create(
      InstrumentedRuntimeModule.compose(module, telemetry, deployment),
      { logger: new SafeNestLogger("worker"), abortOnError: false },
    );
    app.enableShutdownHooks();
    await app.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3010), "0.0.0.0");
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
    !(await runSafeRuntimeEntrypoint("worker", async () => {
      await bootstrapWorker();
    }))
  )
    process.exitCode = 1;
}

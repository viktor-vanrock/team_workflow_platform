import type { NestExpressApplication } from "@nestjs/platform-express";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { TelemetryRuntime } from "@awp/platform-runtime-nest";
import {
  loadEnvironment,
  PublishedDeploymentReferences,
  type CorporateConnectorFactories,
  type DeploymentStartup,
} from "@awp/runtime-composition";

import {
  createCorporateQaBindings,
  type CorporateQaCompositionOptions,
} from "./extensions/corporate-qa-composition.ts";
import {
  assertCorporateQaDeploymentPins,
  loadCorporateQaHostConfig,
} from "./extensions/corporate-qa-config.ts";
import { createUnresolvedCorporateQaResponseChannels } from "./extensions/corporate-qa-response-channels.ts";
import { bootstrapApi, type PilotNonLocalApiEntrypoint } from "./main.ts";

/** The deployment host must construct the approved non-local dependencies explicitly. */
export async function bootstrapCorporateQaApi(
  telemetry: TelemetryRuntime,
  bindings: PilotNonLocalApiEntrypoint,
): Promise<NestExpressApplication> {
  if (!bindings.qa || !bindings.api.onboarding) throw new Error("CORPORATE_QA_BINDINGS_REQUIRED");
  return await bootstrapApi(telemetry, bindings);
}

/** Compose the concrete QA runtimes only after the scoped connector factories are ready. */
export async function bootstrapCorporateQaApplication(
  telemetry: TelemetryRuntime,
  bindings: Omit<PilotNonLocalApiEntrypoint, "qa">,
  qaOptions: (
    connectors: CorporateConnectorFactories,
    deployment: DeploymentStartup,
  ) => Omit<
    CorporateQaCompositionOptions,
    | "readinessPins"
    | "dodPins"
    | "defectPins"
    | "completionPins"
    | "stepUpPermissions"
    | "responseChannels"
  > &
    Partial<Pick<CorporateQaCompositionOptions, "responseChannels">>,
): Promise<NestExpressApplication> {
  if (typeof qaOptions !== "function") throw new Error("CORPORATE_QA_BINDINGS_REQUIRED");
  const environment = loadEnvironment();
  const config = loadCorporateQaHostConfig(environment);
  if (!environment.deployment || !bindings.source.isInitialized)
    throw new Error("CORPORATE_QA_BINDINGS_REQUIRED");
  const publications = await new PublishedDeploymentReferences(
    bindings.source,
    environment.deployment,
    bindings.composition.startup.validationDeadlineMs,
  ).load(
    environment.deployment,
    AbortSignal.timeout(bindings.composition.startup.validationDeadlineMs),
  );
  assertCorporateQaDeploymentPins(config, publications.publications);
  return await bootstrapCorporateQaApi(telemetry, {
    ...bindings,
    qa: (connectors, deployment) => {
      const ports = qaOptions(connectors, deployment);
      return createCorporateQaBindings(bindings.source, environment, {
        ...ports,
        responseChannels: ports.responseChannels ?? createUnresolvedCorporateQaResponseChannels(),
        readinessPins: config.readinessPins,
        dodPins: config.dodPins,
        defectPins: config.defectPins,
        completionPins: config.completionPins,
        stepUpPermissions: config.stepUpPermissions,
      });
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  import("./corporate-host.ts")
    .then(async ({ startCorporateQaHost }) => {
      await startCorporateQaHost();
    })
    .catch(() => {
      // Configuration and network errors can contain credentials or locators.
      console.error("CORPORATE_QA_STARTUP_FAILED");
      process.exitCode = 1;
    });
}

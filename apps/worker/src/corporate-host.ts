import { readFileSync } from "node:fs";
import {
  startTelemetry,
  type TelemetryPolicy,
  type TelemetryRuntime,
} from "@awp/platform-runtime-nest";
import {
  CorporateWorkerCommandContext,
  createCorporateStartupComposition,
  createCorporateTelemetryTransport,
  createCorporateVaultConnectorFactories,
  createStoredPilotCommandEffectGuard,
  createWorkspaceInstallationDataSource,
  loadCorporateVaultConfig,
  loadEnvironment,
  PinnedNetworkTransport,
  PilotCommandEffectGuard,
  PilotEffectGuard,
  PublishedDeploymentReferences,
  PublishedPilotFence,
  TypeOrmProjectEffectGuard,
  pilotContentHash,
  samePilotRef,
  type OutboundNetworkPolicy,
} from "@awp/runtime-composition";

import {
  createCorporateWorkerContributions,
  type CorporateWorkerPorts,
} from "./corporate-contributions.ts";
import { bootstrapWorker } from "./main.ts";

/** Real provider ports must be supplied by the trusted host; absent ports never start a worker. */
export async function startCorporateWorkerHost(ports: CorporateWorkerPorts = {}) {
  const environment = loadEnvironment();
  const deploymentPolicy = environment.deployment;
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deploymentPolicy ||
    !deploymentPolicy.workspaceId ||
    !deploymentPolicy.projectIds?.length ||
    (ports.gitlabEventPublisher !== undefined &&
      typeof ports.gitlabEventPublisher.publish !== "function")
  )
    throw new Error("CORPORATE_WORKER_HOST_CONFIGURATION_REQUIRED");
  const source = createWorkspaceInstallationDataSource();
  let telemetry: TelemetryRuntime | undefined;
  try {
    await source.initialize();
    const approved = await new PublishedDeploymentReferences(source, deploymentPolicy, 5000).load(
      deploymentPolicy,
      AbortSignal.timeout(5000),
    );
    const publication = approved.publications.find((item) => item.kind === "NETWORK_POLICY");
    if (!publication) throw new Error("CORPORATE_WORKER_NETWORK_POLICY_REQUIRED");
    const policy = {
      ...publication.document,
      ref: publication.ref,
    } as unknown as OutboundNetworkPolicy;
    const ca = process.env.AWP_CORPORATE_CA_PATH
      ? readFileSync(process.env.AWP_CORPORATE_CA_PATH, "utf8")
      : undefined;
    const network = new PinnedNetworkTransport(policy, ca ? { tls: { ca } } : {});
    const vaultConfig = loadCorporateVaultConfig(environment, approved.publications);
    let liveGuard: PilotCommandEffectGuard | undefined;
    class DeferredGuard extends PilotCommandEffectGuard {
      constructor() {
        super(
          {
            assertEffectsAllowed: async () => {
              throw new Error("CORPORATE_WORKER_GUARD_UNINITIALIZED");
            },
          } as unknown as PilotEffectGuard,
          async () => undefined,
        );
      }
      override async assertCommandAllowed(
        command: Parameters<PilotCommandEffectGuard["assertCommandAllowed"]>[0],
      ): Promise<void> {
        if (!liveGuard) throw new Error("CORPORATE_WORKER_GUARD_UNINITIALIZED");
        await liveGuard.assertCommandAllowed(command);
      }
    }
    const deferredGuard = new DeferredGuard();
    const commands = new CorporateWorkerCommandContext(source, deferredGuard);
    const connectors = createCorporateVaultConnectorFactories(
      source,
      network,
      vaultConfig,
      commands,
    );
    const composition = createCorporateStartupComposition({
      environment,
      network,
      connectors,
      imageDigest: process.env.AWP_RUNTIME_IMAGE_DIGEST ?? "",
    });
    const telemetryPublication = approved.publications.find(
      (item) => item.kind === "TELEMETRY_POLICY",
    );
    const endpoint = deploymentPolicy.endpoints.find((item) => item.purpose === "telemetry");
    if (
      !telemetryPublication ||
      !endpoint ||
      !samePilotRef(telemetryPublication.ref, deploymentPolicy.telemetryPolicyRef) ||
      pilotContentHash(telemetryPublication.document) !== telemetryPublication.ref.contentHash
    )
      throw new Error("CORPORATE_TELEMETRY_POLICY_REQUIRED");
    const telemetryPolicy = {
      ...telemetryPublication.document,
      component: "worker",
    } as unknown as TelemetryPolicy;
    if (
      telemetryPolicy.mode !== "CORPORATE" ||
      telemetryPolicy.collectorOrigin !== endpoint.allowedOrigin
    )
      throw new Error("CORPORATE_TELEMETRY_POLICY_INVALID");
    const transport = createCorporateTelemetryTransport(network);
    const underlying = await startTelemetry(telemetryPolicy, {
      ...transport,
      agentOptions: {
        ...network.agentOptionsForOrigin(telemetryPolicy.collectorOrigin),
        ...transport.agentOptions,
      },
      authorizeExport: async (url, signal) =>
        (await network.authorizeEndpoint(url, "POST", signal)) &&
        (await transport.authorizeExport(url, signal)),
    });
    let shutdown: Promise<void> | undefined;
    telemetry = {
      health: () => underlying.health(),
      flush: async () => await underlying.flush(),
      shutdown: async () => await (shutdown ??= underlying.shutdown()),
    };
    return await bootstrapWorker(telemetry, {
      source,
      composition,
      contributions: ({ connectors: factories, deployment }) => {
        const fences = new PublishedPilotFence(
          source,
          deploymentPolicy.workspaceId,
          deploymentPolicy.projectIds,
        );
        const effectGuard = new PilotEffectGuard(
          new TypeOrmProjectEffectGuard(source),
          fences,
          deployment.instanceId,
          Date.now,
          deployment,
        );
        liveGuard = createStoredPilotCommandEffectGuard(source, effectGuard);
        return createCorporateWorkerContributions({
          source,
          environment,
          grants: vaultConfig.connectors.map(({ grant }) => grant),
          factories,
          commands,
          connectorAuthority: connectors.authority,
          fences,
          effectGuard,
          allowValidatedIncomplete: process.env.AWP_GITLAB_VALIDATED_INCOMPLETE === "true",
          ports,
        });
      },
    });
  } catch (error) {
    try {
      await telemetry?.shutdown();
    } catch {
      console.error("CORPORATE_WORKER_TELEMETRY_SHUTDOWN_FAILED");
    }
    try {
      if (source.isInitialized) await source.destroy();
    } catch {
      console.error("CORPORATE_WORKER_DATABASE_SHUTDOWN_FAILED");
    }
    throw error;
  }
}

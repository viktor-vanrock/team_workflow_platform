import { readFileSync } from "node:fs";

import type { NestExpressApplication } from "@nestjs/platform-express";

import { pilotContentHash, samePilotRef } from "@awp/platform-core";
import {
  startTelemetry,
  type TelemetryPolicy,
  type TelemetryRuntime,
} from "@awp/platform-runtime-nest";
import {
  createCorporateSigningAuthority,
  createCorporateSigningVaultClient,
  createCorporateVaultConnectorFactories,
  createWorkspaceInstallationDataSource,
  DurablePilotEvidenceImport,
  GitLabPilotReportStore,
  loadEnvironment,
  loadWorkspaceInstallationConfig,
  type OutboundNetworkPolicy,
  PilotReadinessQuery,
  PinnedNetworkTransport,
  PublishedDeploymentReferences,
  PublishedPilotFence,
  PublishedPilotReportPolicy,
  SignedPilotReportVerifier,
  VerifiedPilotGateEvidence,
  workspaceInstallationSessions,
} from "@awp/runtime-composition";

import { bootstrapCorporateQaApplication } from "./corporate-main.ts";
import { loadCorporateAgentConfig } from "./extensions/corporate-agent-config.ts";
import { createCorporateAgentGrantAuthority } from "./extensions/corporate-agent-grant-authority.ts";
import { createCorporateCommandAdmissionAuthority } from "./extensions/corporate-command-admission.ts";
import { createCorporateReportLocators } from "./extensions/corporate-report-locators.ts";
import { createCorporateStartupComposition } from "./extensions/corporate-startup-composition.ts";
import { createCorporateTelemetryTransport } from "./extensions/corporate-telemetry-transport.ts";
import { loadCorporateVaultConfig } from "./extensions/corporate-vault-config.ts";
import { createCorporateEvidenceCrypto } from "./extensions/onboarding/corporate-evidence-crypto.ts";
import { loadCorporateSigningHostConfig } from "./extensions/onboarding/corporate-signing-config.ts";
import { FileAccountInventory } from "./extensions/onboarding/resources.application.ts";

/** Own the source and corporate session lifecycle; fail closed on incomplete configuration. */
export async function startCorporateQaHost(): Promise<NestExpressApplication> {
  const environment = loadEnvironment();
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !environment.deployment
  )
    throw new Error("CORPORATE_QA_HOST_PROFILE_DENIED");
  const config = loadWorkspaceInstallationConfig();
  if (
    config.tokens.issuer !== environment.identityIssuer ||
    config.tokens.audience !== environment.identityAudience ||
    !samePilotRef(config.session.policyRef, environment.deployment.identityPolicyRef) ||
    config.session.browserOrigin !==
      environment.deployment.endpoints.find((item) => item.purpose === "browser")?.url ||
    config.session.callbackUrl !==
      environment.deployment.endpoints.find((item) => item.purpose === "callback")?.url
  )
    throw new Error("CORPORATE_QA_IDENTITY_CONFIGURATION_MISMATCH");
  const source = createWorkspaceInstallationDataSource();
  let telemetry: TelemetryRuntime | undefined;
  try {
    await source.initialize();
    const { sessions } = workspaceInstallationSessions(source, config);
    const timeoutMs = 5000;
    const approved = await new PublishedDeploymentReferences(
      source,
      environment.deployment,
      timeoutMs,
    ).load(environment.deployment, AbortSignal.timeout(timeoutMs));
    const networkPublication = approved.publications.find(
      (value) => value.kind === "NETWORK_POLICY",
    );
    if (!networkPublication) throw new Error("CORPORATE_QA_NETWORK_POLICY_REQUIRED");
    const networkPolicy = {
      ...networkPublication.document,
      ref: networkPublication.ref,
    } as unknown as OutboundNetworkPolicy;
    const ca = process.env.AWP_CORPORATE_CA_PATH
      ? readFileSync(process.env.AWP_CORPORATE_CA_PATH, "utf8")
      : undefined;
    const network = new PinnedNetworkTransport(networkPolicy, ca ? { tls: { ca } } : {});
    const vaultConfig = loadCorporateVaultConfig(environment, approved.publications);
    const connectorFactories = createCorporateVaultConnectorFactories(source, network, vaultConfig);
    const signingConfig = loadCorporateSigningHostConfig(environment, approved.publications);
    const signingGrants = signingConfig.projects.map((entry) => entry.grant);
    const signingClient = createCorporateSigningVaultClient({
      source,
      network,
      vaultOrigin: vaultConfig.vault.vaultOrigin,
      namespace: vaultConfig.vault.namespace,
      deadlineMs: vaultConfig.vault.deadlineMs,
      maximumResponseBytes: vaultConfig.vault.maximumResponseBytes,
      credentials: connectorFactories.workloadCredentials,
      policyRef: environment.deployment.signingPolicyRef,
      configurations: signingGrants.map((grant) => grant.configuration),
    });
    const evidenceCrypto = createCorporateEvidenceCrypto({
      source: signingClient,
      publicKeyHistoryDirectory: signingConfig.publicKeyHistoryDirectory,
      signingPolicyRef: environment.deployment.signingPolicyRef,
      projects: signingConfig.projects.map((entry) => ({
        signing: entry.grant.configuration,
        redactionPolicyRef: entry.redactionPolicyRef,
        exportPolicyRef: entry.exportPolicyRef,
        trustedPublicKeys: entry.trustedPublicKeys,
      })),
      authorize: createCorporateSigningAuthority(
        source,
        environment.deployment.signingPolicyRef,
        signingGrants,
      ),
    });
    const composition = createCorporateStartupComposition({
      environment,
      network,
      connectors: connectorFactories,
      imageDigest: process.env.AWP_RUNTIME_IMAGE_DIGEST ?? "",
    });
    const reportLocatorPath = process.env.AWP_CORPORATE_REPORT_LOCATORS_PATH;
    if (!reportLocatorPath) throw new Error("CORPORATE_REPORT_LOCATORS_INVALID");
    const reportLocators = createCorporateReportLocators({
      source,
      environment,
      connectors: vaultConfig,
      factories: connectorFactories.factories,
      path: reportLocatorPath,
    });
    const reportPolicyPath = process.env.AWP_CORPORATE_REPORT_POLICY_PATH;
    if (!reportPolicyPath) throw new Error("PILOT_REPORT_POLICY_CONFIGURATION_INVALID");
    const reportPolicies = new PublishedPilotReportPolicy(
      source,
      environment.deployment.inputPackageRef,
      reportPolicyPath,
    );
    const agentAuthority = createCorporateAgentGrantAuthority(
      source,
      loadCorporateAgentConfig(environment),
    );
    const verifier = new SignedPilotReportVerifier(
      new GitLabPilotReportStore(reportLocators),
      reportPolicies,
    );
    const references = new PublishedDeploymentReferences(source, environment.deployment, timeoutMs);
    const api = {
      evidenceImport: new DurablePilotEvidenceImport(source, verifier),
      readinessQuery: new PilotReadinessQuery(
        source,
        references,
        new VerifiedPilotGateEvidence(verifier),
      ),
      onboarding: {
        sessions,
        accountInventory: new FileAccountInventory(process.env.AWP_QA_ACCOUNT_INVENTORY_FILE),
        evidenceCrypto,
      },
    };
    const telemetryPublication = approved.publications.find(
      (value) => value.kind === "TELEMETRY_POLICY",
    );
    const telemetryEndpoint = environment.deployment.endpoints.find(
      (value) => value.purpose === "telemetry",
    );
    if (
      !telemetryPublication ||
      !telemetryEndpoint ||
      !samePilotRef(telemetryPublication.ref, environment.deployment.telemetryPolicyRef) ||
      pilotContentHash(telemetryPublication.document) !== telemetryPublication.ref.contentHash
    )
      throw new Error("CORPORATE_TELEMETRY_POLICY_REQUIRED");
    const telemetryPolicy = {
      ...telemetryPublication.document,
      component: "api",
    } as unknown as TelemetryPolicy;
    if (
      telemetryPolicy.mode !== "CORPORATE" ||
      telemetryPolicy.collectorOrigin !== telemetryEndpoint.allowedOrigin
    )
      throw new Error("CORPORATE_TELEMETRY_POLICY_INVALID");
    const telemetryTransport = createCorporateTelemetryTransport(network);
    const underlyingTelemetry = await startTelemetry(telemetryPolicy, {
      ...telemetryTransport,
      agentOptions: {
        ...telemetryTransport.agentOptions,
        ...network.agentOptionsForOrigin(telemetryPolicy.collectorOrigin),
        ...(telemetryTransport.agentOptions?.cert
          ? { cert: telemetryTransport.agentOptions.cert }
          : {}),
        ...(telemetryTransport.agentOptions?.key
          ? { key: telemetryTransport.agentOptions.key }
          : {}),
        ...(telemetryTransport.agentOptions?.passphrase
          ? { passphrase: telemetryTransport.agentOptions.passphrase }
          : {}),
      },
      authorizeExport: async (url, signal) =>
        (await network.authorizeEndpoint(url, "POST", signal)) &&
        (await telemetryTransport.authorizeExport(url, signal)),
    });
    let shutdown: Promise<void> | undefined;
    telemetry = {
      health: () => underlyingTelemetry.health(),
      flush: async () => await underlyingTelemetry.flush(),
      shutdown: async () => await (shutdown ??= underlyingTelemetry.shutdown()),
    };
    return await bootstrapCorporateQaApplication(
      telemetry,
      { source, composition, api },
      (_connectors, deployment) => {
        const fences = new PublishedPilotFence(
          source,
          environment.deployment!.workspaceId,
          environment.deployment!.projectIds,
        );
        const sessionFences = new PublishedPilotFence(
          source,
          environment.deployment!.workspaceId,
          environment.deployment!.projectIds,
          "queue.work-admit",
        );
        return {
          agentAuthority,
          commandAdmission: createCorporateCommandAdmissionAuthority(source, fences, deployment),
          sessionAdmission: createCorporateCommandAdmissionAuthority(
            source,
            sessionFences,
            deployment,
          ),
        };
      },
    );
  } catch (error) {
    await telemetry?.shutdown();
    if (source.isInitialized) await source.destroy();
    throw error;
  }
}

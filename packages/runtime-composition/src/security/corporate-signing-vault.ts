import type { DataSource } from "typeorm";

import { evidenceContentHash } from "@awp/competency-qa";
import { type ExactRevisionRef, freezePilotValue, samePilotRef } from "@awp/platform-core";
import { RuntimeConfigurationRepository } from "@awp/platform-persistence-typeorm";

import type { PinnedNetworkTransport } from "../pilot/network-policy.ts";
import type { CorporateSigningConfiguration } from "./corporate-evidence-signing.ts";
import { VaultHttpClient, type VaultWorkloadCredentials } from "./vault-http-client.ts";

/** Vault Transit accepts only exact published signing policy and the configured scoped signing request. */
export function createCorporateSigningVaultClient(
  input: Readonly<{
    source: DataSource;
    network: PinnedNetworkTransport;
    vaultOrigin: string;
    namespace: string;
    deadlineMs: number;
    maximumResponseBytes: number;
    credentials: VaultWorkloadCredentials;
    policyRef: ExactRevisionRef;
    configurations: readonly CorporateSigningConfiguration[];
  }>,
): VaultHttpClient {
  if (
    !input.source.isInitialized ||
    input.network.policy.mode !== "CORPORATE" ||
    !input.configurations.length
  )
    throw new Error("CORPORATE_SIGNING_VAULT_CONFIG_INVALID");
  const configurations = freezePilotValue(structuredClone(input.configurations));
  if (
    configurations.some((config) => !samePilotRef(config.signingPolicyRef, input.policyRef)) ||
    new Set(configurations.map((config) => `${config.workspaceId}:${config.projectId}`)).size !==
      configurations.length
  )
    throw new Error("CORPORATE_SIGNING_VAULT_CONFIG_INVALID");
  const repository = new RuntimeConfigurationRepository();
  return new VaultHttpClient({
    baseUrl: input.vaultOrigin,
    namespace: input.namespace,
    mode: "CORPORATE",
    deadlineMs: input.deadlineMs,
    maximumResponseBytes: input.maximumResponseBytes,
    network: input.network,
    credentials: input.credentials,
    authorizeEndpoint: async ({ url, method, use }, signal) => {
      try {
        const configuration = configurations.find(
          (config) =>
            config.workspaceId === use.workspaceId &&
            config.projectId === use.projectId &&
            config.servicePrincipalId === use.servicePrincipalId &&
            evidenceContentHash(config) === use.allowedUseHash,
        );
        if (
          !configuration ||
          signal.aborted ||
          use.purpose !== "EVIDENCE_SIGNING" ||
          method !== "POST" ||
          url !== `${input.vaultOrigin}/v1/${configuration.mount}/sign/${configuration.keyName}`
        )
          return false;
        await input.source.transaction("REPEATABLE READ", async (manager) =>
          repository.current(manager, configuration, input.policyRef, "SIGNING_POLICY"),
        );
        return !signal.aborted;
      } catch {
        return false;
      }
    },
  });
}

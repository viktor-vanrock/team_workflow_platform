import type { DataSource } from "typeorm";

import { freezePilotValue, pilotContentHash, type ExactRevisionRef } from "@awp/platform-core";

import {
  TypeOrmCorporateConnectorAuthority,
  type CorporateConnectorCommandAdmission,
  type CorporateConnectorGrant,
} from "../pilot/connector-authority.ts";
import {
  CorporateConnectorFactories,
  type CorporateConnectorCredential,
} from "../pilot/connector-factories.ts";
import type { PinnedNetworkTransport } from "../pilot/network-policy.ts";
import { PublishedVaultSecretAuthorization } from "./published-vault-authorization.ts";
import { VaultHttpClient } from "./vault-http-client.ts";
import {
  VaultKubernetesCredentials,
  type VaultKubernetesCredentialsOptions,
} from "./vault-kubernetes-credentials.ts";
import type { VaultSecretUse } from "./vault-secret-resolver.ts";

export interface CorporateVaultConnectorConfiguration {
  readonly policyRef: ExactRevisionRef;
  readonly vault: Omit<VaultKubernetesCredentialsOptions, "network">;
  readonly connectors: readonly Readonly<{
    grant: CorporateConnectorGrant;
    credentials: readonly Readonly<{
      credential: CorporateConnectorCredential;
      approvedMappingHash: string;
    }>[];
  }>[];
}

/** The configuration carries only Vault references; provider and workload tokens come from Vault. */
export function createCorporateVaultConnectorFactories(
  source: DataSource,
  network: PinnedNetworkTransport,
  input: CorporateVaultConnectorConfiguration,
  commands?: CorporateConnectorCommandAdmission,
) {
  if (!source.isInitialized || network.policy.mode !== "CORPORATE" || !input.connectors.length)
    throw new Error("CORPORATE_VAULT_CONFIGURATION_INVALID");
  input = freezePilotValue(structuredClone(input));
  const grants = input.connectors.map(({ grant }) => grant);
  const authority = new TypeOrmCorporateConnectorAuthority(source, grants, commands);
  const mappingEntries = input.connectors.flatMap(({ grant, credentials }) =>
    credentials.map(({ credential, approvedMappingHash }) => ({
      binding: grant.binding,
      credential,
      approvedMappingHash,
    })),
  );
  const byUse = new Map<string, (typeof mappingEntries)[number]>();
  for (const entry of mappingEntries) {
    const use = entry.credential.mapping.use;
    const binding = entry.binding;
    const key = pilotContentHash(use);
    if (
      byUse.has(key) ||
      use.workspaceId !== binding.workspaceId ||
      use.projectId !== binding.projectId ||
      use.servicePrincipalId !== binding.servicePrincipalId ||
      pilotContentHash(use.policyRef) !== pilotContentHash(input.policyRef) ||
      pilotContentHash(use.policyRef) !== pilotContentHash(binding.policyRef) ||
      pilotContentHash(use.profileRef) !== pilotContentHash(binding.profileRef) ||
      pilotContentHash(use.connectionRef) !== pilotContentHash(binding.connectionRef)
    )
      throw new Error("CORPORATE_VAULT_CONFIGURATION_INVALID");
    byUse.set(key, entry);
  }
  const secretAuthorization = new PublishedVaultSecretAuthorization(
    source,
    input.policyRef,
    mappingEntries.map(({ credential, approvedMappingHash }) => ({
      mapping: credential.mapping,
      approvedMappingHash,
    })),
    async (use: VaultSecretUse, signal) => {
      const entry = byUse.get(pilotContentHash(use));
      if (
        !entry ||
        !["CONNECTOR_READ", "CONNECTOR_WRITE", "CONNECTOR_WEBHOOK"].includes(use.purpose)
      )
        return false;
      return await authority.authorize(
        entry.binding,
        use.purpose as "CONNECTOR_READ" | "CONNECTOR_WRITE" | "CONNECTOR_WEBHOOK",
        signal,
      );
    },
  );
  const credentials = new VaultKubernetesCredentials({ ...input.vault, network });
  const vault = new VaultHttpClient({
    baseUrl: input.vault.vaultOrigin,
    namespace: input.vault.namespace,
    mode: "CORPORATE",
    deadlineMs: input.vault.deadlineMs,
    maximumResponseBytes: input.vault.maximumResponseBytes,
    network,
    credentials,
    authorizeEndpoint: async (request, signal) => {
      const entry = mappingEntries.find(
        ({ approvedMappingHash }) => approvedMappingHash === request.use.allowedUseHash,
      );
      if (!entry || signal.aborted) return false;
      const mapping = entry.credential.mapping;
      return (
        request.method === "GET" &&
        request.use.workspaceId === mapping.use.workspaceId &&
        request.use.projectId === mapping.use.projectId &&
        request.use.servicePrincipalId === mapping.use.servicePrincipalId &&
        request.use.purpose === mapping.use.purpose &&
        request.url ===
          `${input.vault.vaultOrigin}/v1/${mapping.mount}/data/${mapping.path}?version=${mapping.secretVersion}` &&
        (await secretAuthorization.authorize(mapping.use, mapping, signal))
      );
    },
  });
  const bindings = input.connectors.map(({ grant, credentials: values }) => ({
    binding: grant.binding,
    credentials: values.map(({ credential }) => credential),
  }));
  return {
    network,
    vault,
    authority,
    secretAuthorization,
    bindings,
    workloadCredentials: credentials,
    factories: new CorporateConnectorFactories({
      network,
      vault,
      authority,
      secretAuthorization,
      bindings,
    }),
  };
}

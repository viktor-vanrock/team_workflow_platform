import { readFileSync } from "node:fs";

import { type ExactRevisionRef, freezePilotValue, pilotContentHash } from "@awp/platform-core";
import type { RuntimeConfigurationPublication } from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateVaultConnectorConfiguration } from "./corporate-vault-connectors.ts";

/** The file holds opaque references, public policy and Vault paths, never secret values. */
export function parseCorporateVaultConfig(
  value: unknown,
  environment: RuntimeEnvironment,
  publications: readonly RuntimeConfigurationPublication[],
): CorporateVaultConnectorConfiguration {
  const deny = (): never => {
    throw new Error("CORPORATE_VAULT_CONFIG_INVALID");
  };
  const object = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return deny();
    return input as Record<string, unknown>;
  };
  const input = object(value);
  const deployment = environment.deployment;
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    input.schemaVersion !== 1 ||
    input.deploymentPolicyHash !== pilotContentHash(deployment) ||
    Object.keys(input).some(
      (key) => !["schemaVersion", "deploymentPolicyHash", "vault", "connectors"].includes(key),
    ) ||
    !Array.isArray(input.connectors) ||
    input.connectors.length !== deployment.projectIds.length * 3
  )
    return deny();
  const vault = object(input.vault);
  if (
    Object.keys(vault).some(
      (key) =>
        ![
          "vaultOrigin",
          "namespace",
          "authMount",
          "role",
          "serviceAccountTokenFile",
          "deadlineMs",
          "maximumResponseBytes",
        ].includes(key),
    )
  )
    return deny();
  if (
    typeof vault.vaultOrigin !== "string" ||
    typeof vault.namespace !== "string" ||
    typeof vault.authMount !== "string" ||
    typeof vault.role !== "string" ||
    typeof vault.serviceAccountTokenFile !== "string" ||
    typeof vault.deadlineMs !== "number" ||
    typeof vault.maximumResponseBytes !== "number"
  )
    return deny();
  const vaultEndpoint = deployment.endpoints.find((value) => value.purpose === "vault");
  if (!vaultEndpoint || vault.vaultOrigin !== vaultEndpoint.allowedOrigin) return deny();
  const secretPolicy = publications.find((row) => row.kind === "SECRET_RESOLVER_POLICY");
  if (
    !secretPolicy ||
    pilotContentHash(secretPolicy.ref) !== pilotContentHash(deployment.secretResolverPolicyRef)
  )
    return deny();
  const same = (a: unknown, b: ExactRevisionRef): boolean =>
    pilotContentHash(a) === pilotContentHash(b);
  const seen = new Set<string>();
  for (const raw of input.connectors) {
    const item = object(raw);
    if (
      Object.keys(item).some((key) => !["grant", "credentials"].includes(key)) ||
      !Array.isArray(item.credentials)
    )
      return deny();
    const grant = object(item.grant),
      binding = object(grant.binding);
    const identity = object(grant.serviceIdentity),
      permissions = object(grant.permissions);
    if (
      Object.keys(grant).some(
        (key) =>
          !["binding", "integrationBindingRef", "serviceIdentity", "permissions"].includes(key),
      ) ||
      Object.keys(identity).some((key) => !["issuer", "subject", "serviceKey"].includes(key)) ||
      Object.keys(permissions).some(
        (key) => !["CONNECTOR_READ", "CONNECTOR_WRITE", "CONNECTOR_WEBHOOK"].includes(key),
      ) ||
      Object.keys(binding).some(
        (key) =>
          ![
            "workspaceId",
            "projectId",
            "servicePrincipalId",
            "provider",
            "ref",
            "profileRef",
            "connectionRef",
            "policyRef",
            "mode",
            "endpoint",
            "expiresAt",
            "gitlab",
            "routes",
          ].includes(key),
      ) ||
      binding.workspaceId !== deployment.workspaceId ||
      typeof binding.projectId !== "string" ||
      !deployment.projectIds.includes(binding.projectId) ||
      !["JIRA", "GITLAB", "MATTERMOST"].includes(String(binding.provider)) ||
      binding.mode !== "CORPORATE" ||
      !same(binding.policyRef, deployment.secretResolverPolicyRef) ||
      !same(binding.ref, grant.integrationBindingRef as ExactRevisionRef)
    )
      return deny();
    if (
      !Array.isArray(binding.routes) ||
      binding.routes.some((value) =>
        Object.keys(object(value)).some(
          (key) => !["method", "path", "match", "purpose"].includes(key),
        ),
      )
    )
      return deny();
    if (binding.gitlab !== undefined) {
      const gitlab = object(binding.gitlab);
      if (Object.keys(gitlab).some((key) => !["numericProjectId", "trigger"].includes(key)))
        return deny();
      if (
        gitlab.trigger !== undefined &&
        Object.keys(object(gitlab.trigger)).some(
          (key) => !["dialect", "ref", "pipelineNameInput"].includes(key),
        )
      )
        return deny();
    }
    const key = `${binding.projectId}:${String(binding.provider)}`;
    if (seen.has(key)) return deny();
    seen.add(key);
    const publication = publications.find(
      (row) =>
        row.kind === "CONNECTOR_BINDING" &&
        row.document.provider === String(binding.provider).toLowerCase(),
    );
    const projects = publication?.document.projects;
    if (!Array.isArray(projects)) return deny();
    const project = projects.map(object).find((row) => row.projectId === binding.projectId);
    if (
      !project ||
      !same(project.integrationBindingRef, grant.integrationBindingRef as ExactRevisionRef) ||
      !same(project.profileRef, binding.profileRef as ExactRevisionRef) ||
      !same(project.connectionRef, binding.connectionRef as ExactRevisionRef) ||
      binding.endpoint !== project.endpoint
    )
      return deny();
    for (const rawCredential of item.credentials) {
      const entry = object(rawCredential),
        credential = object(entry.credential),
        mapping = object(credential.mapping),
        use = object(mapping.use);
      if (
        Object.keys(entry).some((key) => !["credential", "approvedMappingHash"].includes(key)) ||
        Object.keys(credential).some((key) => !["authentication", "mapping"].includes(key)) ||
        Object.keys(mapping).some(
          (key) =>
            ![
              "ref",
              "secretRef",
              "use",
              "mount",
              "path",
              "field",
              "secretVersion",
              "maximumLeaseMs",
            ].includes(key),
        ) ||
        Object.keys(use).some(
          (key) =>
            ![
              "workspaceId",
              "projectId",
              "servicePrincipalId",
              "purpose",
              "profileRef",
              "connectionRef",
              "policyRef",
            ].includes(key),
        ) ||
        typeof credential.authentication !== "string" ||
        typeof mapping.secretRef !== "string" ||
        typeof mapping.mount !== "string" ||
        typeof mapping.path !== "string" ||
        typeof mapping.field !== "string" ||
        typeof mapping.secretVersion !== "number" ||
        typeof mapping.maximumLeaseMs !== "number" ||
        typeof entry.approvedMappingHash !== "string" ||
        entry.approvedMappingHash !== pilotContentHash(mapping)
      )
        return deny();
    }
  }
  return freezePilotValue(
    structuredClone({
      policyRef: deployment.secretResolverPolicyRef,
      vault,
      connectors: input.connectors,
    }),
  ) as unknown as CorporateVaultConnectorConfiguration;
}

export function loadCorporateVaultConfig(
  environment: RuntimeEnvironment,
  publications: readonly RuntimeConfigurationPublication[],
  env: NodeJS.ProcessEnv = process.env,
): CorporateVaultConnectorConfiguration {
  const path = env.AWP_CORPORATE_VAULT_CONFIG_PATH;
  if (!path) throw new Error("CORPORATE_VAULT_CONFIG_REQUIRED");
  try {
    const bytes = readFileSync(path);
    if (!bytes.length || bytes.length > 1_000_000) throw new Error();
    return parseCorporateVaultConfig(JSON.parse(bytes.toString("utf8")), environment, publications);
  } catch {
    throw new Error("CORPORATE_VAULT_CONFIG_INVALID");
  }
}

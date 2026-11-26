import { describe, expect, it } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { createCorporateVaultConnectorFactories } from "../../../packages/runtime-composition/src/security/corporate-vault-connectors.ts";

const ref = { id: "ref", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const scope = { workspaceId: "workspace", projectId: "project", servicePrincipalId: "service" };
const binding = {
  ...scope,
  ref,
  profileRef: ref,
  connectionRef: ref,
  policyRef: ref,
  provider: "JIRA" as const,
  mode: "CORPORATE" as const,
  endpoint: "https://jira.example",
  expiresAt: "2099-01-01T00:00:00.000Z",
  routes: [
    {
      method: "GET" as const,
      path: "/rest/",
      match: "PREFIX" as const,
      purpose: "CONNECTOR_READ" as const,
    },
  ],
};
const mapping = {
  ref,
  secretRef: "secretref://jira/read",
  use: {
    ...scope,
    purpose: "CONNECTOR_READ" as const,
    profileRef: ref,
    connectionRef: ref,
    policyRef: ref,
  },
  mount: "secret",
  path: "jira/read",
  field: "credential",
  secretVersion: 1,
  maximumLeaseMs: 500,
};
const network = {
  policy: { mode: "CORPORATE", deadlineMs: 1000 },
  fetch: async () => new Response(),
  authorizeEndpoint: async () => false,
};
const source = { isInitialized: true };
const configuration = {
  policyRef: ref,
  vault: {
    vaultOrigin: "https://vault.example",
    namespace: "team/",
    authMount: "kubernetes",
    role: "api",
    serviceAccountTokenFile: "/var/run/secrets/token",
    deadlineMs: 1000,
    maximumResponseBytes: 4096,
  },
  connectors: [
    {
      grant: {
        binding,
        integrationBindingRef: ref,
        serviceIdentity: { issuer: "https://id.example", subject: "service", serviceKey: "api" },
        permissions: { CONNECTOR_READ: "integration.use" },
      },
      credentials: [
        {
          credential: { mapping, authentication: "BEARER" as const },
          approvedMappingHash: pilotContentHash(mapping),
        },
      ],
    },
  ],
};

describe("corporate Vault connector assembly", () => {
  it("assembles purpose-scoped factories without reading token values", () => {
    const result = createCorporateVaultConnectorFactories(
      source as never,
      network as never,
      configuration,
    );
    expect(result.factories).toBeDefined();
    expect(result.vault.usesNetwork(network as never)).toBe(true);
  });
  it("rejects mapping hash changes and cross-project use", () => {
    const badHash = structuredClone(configuration);
    badHash.connectors[0]!.credentials[0]!.approvedMappingHash = `sha256:${"b".repeat(64)}`;
    expect(() =>
      createCorporateVaultConnectorFactories(source as never, network as never, badHash),
    ).toThrow("VAULT_AUTHORIZATION_CONFIGURATION_INVALID");
    const wrongProject = structuredClone(configuration);
    wrongProject.connectors[0]!.credentials[0]!.credential.mapping.use.projectId = "other";
    expect(() =>
      createCorporateVaultConnectorFactories(source as never, network as never, wrongProject),
    ).toThrow("CORPORATE_VAULT_CONFIGURATION_INVALID");
  });
});

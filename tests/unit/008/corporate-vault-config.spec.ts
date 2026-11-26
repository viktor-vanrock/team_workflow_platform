import { describe, expect, it } from "vitest";

import { parseCorporateVaultConfig } from "../../../apps/api/src/extensions/corporate-vault-config.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";

const scope = { workspaceId: "workspace", projectId: "project", servicePrincipalId: "service" };
const ref = { id: "approved", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
const policy = {
  workspaceId: scope.workspaceId,
  projectIds: [scope.projectId],
  secretResolverPolicyRef: ref,
  endpoints: [{ purpose: "vault", allowedOrigin: "https://vault.example" }],
};
const environment = {
  profile: "non-local",
  environmentScope: "NON_PROD",
  deployment: policy,
} as never;
function fixture() {
  const connectors = ["JIRA", "GITLAB", "MATTERMOST"].map((provider) => {
    const binding = {
      ...scope,
      provider,
      mode: "CORPORATE",
      endpoint: `https://${provider.toLowerCase()}.example`,
      ref,
      profileRef: ref,
      connectionRef: ref,
      policyRef: ref,
      expiresAt: "2099-01-01T00:00:00.000Z",
      routes: [{ method: "GET", path: "/", match: "EXACT", purpose: "CONNECTOR_READ" }],
    };
    const mapping = {
      ref,
      secretRef: `secretref://${provider.toLowerCase()}/read`,
      use: {
        ...scope,
        purpose: "CONNECTOR_READ",
        profileRef: ref,
        connectionRef: ref,
        policyRef: ref,
      },
      mount: "secret",
      path: `${provider.toLowerCase()}/read`,
      field: "credential",
      secretVersion: 1,
      maximumLeaseMs: 1000,
    };
    return {
      grant: {
        binding,
        integrationBindingRef: ref,
        serviceIdentity: {
          issuer: "https://identity.example",
          subject: "service",
          serviceKey: "worker",
        },
        permissions: { CONNECTOR_READ: "integration.use" },
      },
      credentials: [
        {
          credential: { authentication: "BEARER", mapping },
          approvedMappingHash: pilotContentHash(mapping),
        },
      ],
    };
  });
  const publications = [
    { kind: "SECRET_RESOLVER_POLICY", ref, document: {} },
    ...connectors.map(({ grant }) => ({
      kind: "CONNECTOR_BINDING",
      document: {
        provider: grant.binding.provider.toLowerCase(),
        projects: [
          {
            projectId: scope.projectId,
            integrationBindingRef: ref,
            profileRef: ref,
            connectionRef: ref,
            endpoint: grant.binding.endpoint,
          },
        ],
      },
    })),
  ];
  return {
    config: {
      schemaVersion: 1,
      deploymentPolicyHash: pilotContentHash(policy),
      vault: {
        vaultOrigin: "https://vault.example",
        namespace: "team/",
        authMount: "kubernetes",
        role: "service",
        serviceAccountTokenFile: "/var/run/token",
        deadlineMs: 1000,
        maximumResponseBytes: 4096,
      },
      connectors,
    },
    publications,
  };
}

describe("corporate Vault configuration", () => {
  it("allows only mappings approved by the published scoped policies", () => {
    const { config, publications } = fixture();
    expect(
      parseCorporateVaultConfig(config, environment, publications as never).connectors,
    ).toHaveLength(3);
    const altered = structuredClone(config);
    altered.connectors[0]!.credentials[0]!.credential.mapping.field = "other";
    expect(() => parseCorporateVaultConfig(altered, environment, publications as never)).toThrow(
      "CORPORATE_VAULT_CONFIG_INVALID",
    );
    const revoked = [
      { kind: "SECRET_RESOLVER_POLICY", ref: { ...ref, version: 2 }, document: {} },
      ...publications.slice(1),
    ];
    expect(() => parseCorporateVaultConfig(config, environment, revoked as never)).toThrow(
      "CORPORATE_VAULT_CONFIG_INVALID",
    );
  });
  it("rejects a provider token in configuration", () => {
    const { config, publications } = fixture();
    expect(() =>
      parseCorporateVaultConfig(
        { ...config, token: "not-real" },
        environment,
        publications as never,
      ),
    ).toThrow("CORPORATE_VAULT_CONFIG_INVALID");
  });
});

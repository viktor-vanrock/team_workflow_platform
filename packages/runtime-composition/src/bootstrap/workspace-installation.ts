import { readFileSync } from "node:fs";

import { DataSource } from "typeorm";

import type { CorporateSessionPolicy, PinnedOidcPolicy } from "@awp/platform-runtime-nest";

import { runtimePersistence } from "../pilot/composition.ts";
import { type OutboundNetworkPolicy, PinnedNetworkTransport } from "../pilot/network-policy.ts";
import { createCorporateSessionBindings } from "../security/corporate-session-bindings.ts";

export interface WorkspaceInstallationConfig {
  readonly tokens: PinnedOidcPolicy;
  readonly session: CorporateSessionPolicy;
  readonly network: OutboundNetworkPolicy;
  readonly encryptionKeyId: string;
}
const read = (path: string | undefined): string => {
  if (!path) throw new Error("WORKSPACE_CONFIGURATION_REQUIRED");
  const value = readFileSync(path, "utf8").trim();
  if (!value || value.length > 100_000) throw new Error("WORKSPACE_CONFIGURATION_INVALID");
  return value;
};
export function loadWorkspaceInstallationConfig(env = process.env): WorkspaceInstallationConfig {
  const value = JSON.parse(read(env.AWP_WORKSPACE_CONFIG_PATH)) as WorkspaceInstallationConfig;
  if (
    value?.tokens?.mode !== "CORPORATE" ||
    value?.network?.mode !== "CORPORATE" ||
    value.session?.callbackUrl !== `${value.session?.browserOrigin}/api/v1/auth/callback` ||
    !["/access", "/admin/users", "/projects", "/projects/new"].every((p) =>
      value.session?.returnPaths?.includes(p),
    )
  )
    throw new Error("WORKSPACE_CORPORATE_CONFIGURATION_REQUIRED");
  return value;
}
export function createWorkspaceInstallationDataSource(env = process.env): DataSource {
  if (env.AWP_WORKSPACE_DATABASE_URL && env.AWP_WORKSPACE_DATABASE_URL_FILE)
    throw new Error("WORKSPACE_DATABASE_CONFIGURATION_CONFLICT");
  const url = env.AWP_WORKSPACE_DATABASE_URL ?? read(env.AWP_WORKSPACE_DATABASE_URL_FILE);
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash)
    throw new Error("WORKSPACE_DATABASE_URL_INVALID");
  if (!["verify-full", "disable"].includes(env.AWP_WORKSPACE_DATABASE_TLS ?? "verify-full"))
    throw new Error("WORKSPACE_DATABASE_TLS_INVALID");
  const registry = runtimePersistence("qa-jira-gitlab-mattermost-test");
  return new DataSource({
    type: "postgres",
    url,
    entities: [...registry.entities],
    migrations: [...registry.migrations],
    migrationsTableName: "typeorm_migrations",
    migrationsTransactionMode: "all",
    migrationsRun: false,
    synchronize: false,
    logging: false,
    ssl:
      env.AWP_WORKSPACE_DATABASE_TLS === "disable"
        ? false
        : {
            rejectUnauthorized: true,
            ...(env.AWP_WORKSPACE_DATABASE_CA_PATH
              ? { ca: read(env.AWP_WORKSPACE_DATABASE_CA_PATH) }
              : {}),
          },
  });
}
export function workspaceInstallationSessions(
  source: DataSource,
  config: WorkspaceInstallationConfig,
  env = process.env,
) {
  // Read only approved key IDs; old keys can remain during the bounded session rotation window.
  const keys = JSON.parse(read(env.AWP_SESSION_KEYS_PATH)) as Record<string, string>;
  const material = Object.entries(keys);
  if (
    !material.length ||
    material.length > 8 ||
    !keys[config.encryptionKeyId] ||
    material.some(
      ([id, value]) =>
        !/^[a-zA-Z0-9_-]{1,64}$/u.test(id) ||
        typeof value !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/u.test(value) ||
        Buffer.from(value, "base64").length !== 32,
    )
  )
    throw new Error("WORKSPACE_SESSION_KEYS_INVALID");
  const network = new PinnedNetworkTransport(config.network, {
    ...(env.AWP_OIDC_CA_PATH ? { tls: { ca: read(env.AWP_OIDC_CA_PATH) } } : {}),
  });
  return createCorporateSessionBindings({
    source,
    ...config,
    network,
    groups: { issuer: config.tokens.issuer, ref: config.session.policyRef, mappings: [] },
    accessProvisioning: true,
    encryptionKeys: {
      async withKey(id, use) {
        const encoded = keys[id];
        if (!encoded) throw new Error("WORKSPACE_SESSION_KEY_UNAVAILABLE");
        const key = Buffer.from(encoded, "base64");
        try {
          return await use(key);
        } finally {
          key.fill(0);
        }
      },
    },
    clientAuthentication: {
      async authorizeTokenRequest() {
        return {
          headers: {},
          form: env.AWP_OIDC_CLIENT_SECRET_PATH
            ? { client_secret: read(env.AWP_OIDC_CLIENT_SECRET_PATH) }
            : {},
        };
      },
    },
  });
}

export async function workspaceInstallationReadiness(source: DataSource) {
  try {
    const expected = runtimePersistence("qa-jira-gitlab-mattermost-test").expectedVersions;
    const rows = (await source.query("SELECT namespace,version FROM platform_schema_versions")) as {
      namespace: string;
      version: number;
    }[];
    if (
      Object.entries(expected).some(
        ([namespace, version]) =>
          !rows.some((r) => r.namespace === namespace && r.version === version),
      )
    )
      return { ready: false, reasonCode: "WORKSPACE_SCHEMA_MISMATCH" };
    const rows2 =
      (await source.query(`SELECT b.workspace_id FROM qa_workspace_bootstrap b JOIN workspaces w ON w.id=b.workspace_id AND w.state='ACTIVE'
      JOIN workspace_work_types t ON t.workspace_id=w.id AND t.work_type_key='qa.validation' AND t.intake_state='ENABLED'`)) as unknown[];
    return {
      ready: rows2.length === 1,
      reasonCode: rows2.length === 1 ? "WORKSPACE_ACCEPTS_PROJECTS" : "QA_WORKSPACE_UNAVAILABLE",
    };
  } catch {
    return { ready: false, reasonCode: "WORKSPACE_DATABASE_UNAVAILABLE" };
  }
}

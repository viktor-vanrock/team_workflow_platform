import type { DataSource } from "typeorm";
import { validateGitLabConnectionConfiguration } from "@awp/connector-gitlab";
import type { RuntimeEnvironment } from "../config/environment.ts";
import type { RequestedProbeTarget } from "../onboarding/requested-probe-worker.ts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "./connector-authority.ts";
import type { CorporateConnectorFactories } from "./connector-factories.ts";

const obj = (value: unknown): Record<string, unknown> => {
  const result = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("CORPORATE_PROBE_CONFIGURATION_INVALID");
  return result as Record<string, unknown>;
};
const unwrap = (value: Record<string, unknown>, key: string) => {
  if (!value[key]) return value;
  const envelope = obj(value[key]);
  return obj(envelope.value ?? envelope);
};
const same = (
  a: { id: string; version: number; contentHash: string },
  b: { id: string; version: number; contentHash: string },
) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;

/** Read-only connectivity evidence; it never claims a write capability was exercised. */
export function createCorporateProbeObserver(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment
  )
    throw new Error("CORPORATE_PROBE_OBSERVER_REQUIRED");
  return async (
    target: RequestedProbeTarget,
    signal: AbortSignal,
  ): Promise<
    Readonly<{
      status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
      safeIssueCodes: readonly string[];
    }>
  > => {
    if (
      signal.aborted ||
      target.environmentScope !== "NON_PROD" ||
      target.workspaceId !== deployment.workspaceId ||
      !deployment.projectIds.includes(target.projectId)
    )
      throw new Error("CORPORATE_PROBE_SCOPE_DENIED");
    const grants = input.grants.filter(
      ({ binding, integrationBindingRef }) =>
        binding.workspaceId === target.workspaceId &&
        binding.projectId === target.projectId &&
        same(integrationBindingRef, target.bindingRef) &&
        same(binding.profileRef, target.profileRef) &&
        same(binding.connectionRef, target.connectionRef),
    );
    if (grants.length !== 1) throw new Error("CORPORATE_PROBE_BINDING_REQUIRED");
    const grant = grants[0]!;
    const load = async (
      kind: "connector_profile" | "connection",
      ref: typeof target.profileRef,
    ) => {
      const rows = (await input.source.query(
        `SELECT r.content,r.content_hash FROM ${kind}_headers h JOIN ${kind}_revisions r
        ON (r.workspace_id,r.header_id,r.version)=(h.workspace_id,h.id,h.current_published_version)
        WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
        [target.workspaceId, ref.id, ref.version],
      )) as readonly { content: Record<string, unknown>; content_hash: string }[];
      if (
        rows.length !== 1 ||
        rows[0]!.content_hash !== ref.contentHash ||
        integrationConfigurationHash(kind, rows[0]!.content) !== ref.contentHash
      )
        throw new Error("CORPORATE_PROBE_CONFIGURATION_STALE");
      return rows[0]!.content;
    };
    const [profileContent, connectionContent] = await Promise.all([
      load("connector_profile", target.profileRef),
      load("connection", target.connectionRef),
    ]);
    const profile = unwrap(profileContent, "profileConfiguration");
    if (grant.binding.provider === "JIRA") {
      const project = obj(profile.project);
      if (typeof project.id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(project.id))
        throw new Error("CORPORATE_PROBE_CONFIGURATION_INVALID");
      const result = await input.factories.jira(grant.binding.ref.id).request({
        method: "GET",
        path: `/rest/api/3/project/${encodeURIComponent(project.id)}`,
        signal,
      });
      if (String(obj(await result.json()).id) !== project.id)
        throw new Error("CORPORATE_PROBE_PROJECT_MISMATCH");
    } else if (grant.binding.provider === "MATTERMOST") {
      const bot = obj(profile.bot);
      const result = obj(
        await input.factories
          .mattermost(grant.binding.ref.id, "CONNECTOR_READ")
          .get("/api/v4/users/me"),
      );
      if (typeof bot.userId !== "string" || result.id !== bot.userId)
        throw new Error("CORPORATE_PROBE_IDENTITY_MISMATCH");
    } else {
      const numericProjectId = grant.binding.gitlab?.numericProjectId;
      if (!numericProjectId) throw new Error("CORPORATE_PROBE_CONFIGURATION_INVALID");
      const connection = validateGitLabConnectionConfiguration(
        unwrap(connectionContent, "connectorConfiguration"),
      );
      const { client } = input.factories.gitlab(grant.binding.ref.id, connection, numericProjectId);
      const result = obj(
        await client.requestJson({
          operation: "profile.discovery",
          authOperation: "buildRead",
          method: "GET",
          path: `/api/v4/projects/${numericProjectId}`,
          signal,
        }),
      );
      if (Number(result.id) !== numericProjectId)
        throw new Error("CORPORATE_PROBE_PROJECT_MISMATCH");
    }
    if (signal.aborted) throw new Error("CORPORATE_PROBE_DEADLINE");
    return { status: "DEGRADED", safeIssueCodes: ["PROVIDER_CAPABILITY_UNSUPPORTED"] };
  };
}

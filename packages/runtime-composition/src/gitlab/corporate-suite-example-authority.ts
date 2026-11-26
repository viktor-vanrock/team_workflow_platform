import type { DataSource } from "typeorm";
import {
  preflightGitLabProfile,
  readGitLabSuitePipelineEvidence,
  readGitLabSuiteResultExample,
  selectGitLabSuitePipeline,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import { pilotContentHash } from "@awp/platform-core";
import type { RuntimeEnvironment } from "../config/environment.ts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type {
  CorporateConnectorFactories,
  CorporateConnectorRequestAuthority,
} from "../pilot/connector-factories.ts";
import { PublishedDeploymentReferences } from "../pilot/published-deployment-references.ts";
import { resolveCorporateGitLabC1 } from "./corporate-c1-metadata.ts";
import { assertCorporateGitLabDiscoveryServer } from "./corporate-discovery-server.ts";

const parse = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_INVALID");
  return parsed as Record<string, unknown>;
};
const exact = (
  a: { id: string; version: number; contentHash: string },
  b: { id: string; version: number; contentHash: string },
) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;

/** Staged authority for a server-selected Suite; not registered in any worker composition. */
export function createCorporateSuiteExampleAuthority(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    authority: CorporateConnectorRequestAuthority;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment?.workspaceId ||
    !deployment.projectIds.length
  )
    throw new Error("CORPORATE_GITLAB_EXAMPLE_AUTHORITY_REQUIRED");
  const prepare = async (
    scope: Readonly<{ workspaceId: string; projectId: string; suiteKey: string }>,
    signal: AbortSignal,
  ) => {
    if (
      signal.aborted ||
      scope.workspaceId !== deployment.workspaceId ||
      !deployment.projectIds.includes(scope.projectId) ||
      !/^[a-z][a-z0-9._-]{0,127}$/u.test(scope.suiteKey)
    )
      throw new Error("CORPORATE_GITLAB_EXAMPLE_SCOPE_DENIED");
    const load = async () => {
      const approved = await new PublishedDeploymentReferences(input.source, deployment, 5000).load(
        deployment,
        signal,
      );
      const c1 = resolveCorporateGitLabC1(
        input.environment,
        approved.publications,
        scope.projectId,
      );
      const pins = c1.configurationPins.filter((pin) => pin.logicalRole === "TEST_EXECUTION");
      if (pins.length !== 1) throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_INVALID");
      const pin = pins[0]!;
      const profileRef = { ...pin.profileRef, contentHash: pin.profileHash };
      const connectionRef = { ...pin.connectionRef, contentHash: pin.connectionHash };
      const bindingRef = {
        ...pin.projectIntegrationBindingRef,
        contentHash: pin.projectIntegrationBindingHash,
      };
      const matches = input.grants.filter(
        ({ binding, integrationBindingRef }) =>
          binding.provider === "GITLAB" &&
          binding.workspaceId === scope.workspaceId &&
          binding.projectId === scope.projectId &&
          exact(integrationBindingRef, bindingRef) &&
          exact(binding.profileRef, profileRef) &&
          exact(binding.connectionRef, connectionRef) &&
          binding.gitlab?.numericProjectId === c1.numericGitLabProjectId,
      );
      if (
        matches.length !== 1 ||
        !(await input.authority.authorize(matches[0]!.binding, "CONNECTOR_READ", signal))
      )
        throw new Error("CORPORATE_GITLAB_EXAMPLE_ACCESS_DENIED");
      const rows = (await input.source.query(
        `SELECT p.content AS profile_content,p.content_hash AS profile_hash,c.content AS connection_content,c.content_hash AS connection_hash,
             d.discovery_snapshot_id,d.content_hash AS discovery_hash,d.edition,d.exact_version,d.exact_build,d.ref_commit_sha,d.exact_ref
           FROM connector_profile_headers ph JOIN connector_profile_revisions p ON p.workspace_id=ph.workspace_id AND p.header_id=ph.id AND p.version=ph.current_published_version
           JOIN connection_headers ch ON ch.workspace_id=ph.workspace_id AND ch.id=$3
           JOIN connection_revisions c ON c.workspace_id=ch.workspace_id AND c.header_id=ch.id AND c.version=ch.current_published_version
           JOIN gitlab_discovery_snapshots d ON d.workspace_id=ph.workspace_id AND d.connection_ref=$5::jsonb
             AND d.numeric_project_id=$7 AND d.connector_version='1.1.0' AND d.validation_status='VALID' AND d.production_denied=true AND d.expires_at>clock_timestamp()
           WHERE ph.workspace_id=$1 AND ph.id=$2 AND p.version=$4 AND p.status='PUBLISHED' AND c.version=$6 AND c.status='PUBLISHED'
           ORDER BY d.collected_at DESC LIMIT 1`,
        [
          scope.workspaceId,
          profileRef.id,
          connectionRef.id,
          profileRef.version,
          JSON.stringify(connectionRef),
          connectionRef.version,
          c1.numericGitLabProjectId,
        ],
      )) as readonly Record<string, unknown>[];
      if (rows.length !== 1) throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_STALE");
      const row = rows[0]!;
      assertCorporateGitLabDiscoveryServer(row, c1.server);
      const profileContent = parse(row.profile_content),
        connectionContent = parse(row.connection_content);
      if (
        row.profile_hash !== profileRef.contentHash ||
        row.connection_hash !== connectionRef.contentHash ||
        integrationConfigurationHash("connector_profile", profileContent) !==
          profileRef.contentHash ||
        integrationConfigurationHash("connection", connectionContent) !== connectionRef.contentHash
      )
        throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_STALE");
      const envelope = connectionContent.connectorConfiguration;
      const connection = validateGitLabConnectionConfiguration(
        envelope && typeof envelope === "object" && "value" in envelope
          ? envelope.value
          : connectionContent,
      );
      const preflight = preflightGitLabProfile(profileContent, connection);
      const profile = preflight.profile;
      if (
        preflight.status !== "SAFE_TO_DISCOVER" ||
        !profile ||
        profile.numericGitLabProjectId !== c1.numericGitLabProjectId ||
        row.exact_ref !== profile.trigger.ref ||
        typeof row.ref_commit_sha !== "string" ||
        !/^[a-f0-9]{40}$/u.test(row.ref_commit_sha) ||
        profile.suiteMappings.filter((suite) => suite.suiteKey === scope.suiteKey).length !== 1 ||
        pilotContentHash(profile.resultContract.schemaRef) !==
          pilotContentHash(c1.resultContract.schemaRef)
      )
        throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_INVALID");
      return {
        c1,
        profile,
        connection,
        grant: matches[0]!,
        commitSha: row.ref_commit_sha,
        witness: pilotContentHash({
          metadataHash: c1.contentHash,
          discoveryId: row.discovery_snapshot_id,
          discoveryHash: row.discovery_hash,
          commitSha: row.ref_commit_sha,
          profileRef,
          connectionRef,
          bindingRef,
        }),
      };
    };
    const original = await load();
    const revalidate = async () => {
      if (signal.aborted || (await load()).witness !== original.witness)
        throw new Error("CORPORATE_GITLAB_EXAMPLE_CONFIGURATION_STALE");
    };
    const { client } = input.factories.gitlab(
      original.grant.binding.ref.id,
      original.connection,
      original.c1.numericGitLabProjectId,
      "1.1.0",
    );
    return { original, revalidate, client };
  };
  return {
    async read(
      scope: Readonly<{ workspaceId: string; projectId: string; suiteKey: string }>,
      signal: AbortSignal,
    ) {
      const { original, revalidate, client } = await prepare(scope, signal);
      const result = await readGitLabSuiteResultExample({
        client,
        numericProjectId: original.c1.numericGitLabProjectId,
        commitSha: original.commitSha,
        schemaRef: original.profile.resultContract.schemaRef,
        maximumBytes: original.profile.resultContract.maxBytes,
        signal,
        revalidate,
      });
      return Object.freeze({ ...result, discoveryWitnessHash: original.witness });
    },
    async verifyPipelineArtifact(
      scope: Readonly<{ workspaceId: string; projectId: string; suiteKey: string }>,
      signal: AbortSignal,
    ) {
      const { original, revalidate, client } = await prepare(scope, signal);
      const execution = original.c1.configurationPins.filter(
        (item) => item.logicalRole === "TEST_EXECUTION",
      );
      const artifacts = original.c1.configurationPins.filter(
        (item) => item.logicalRole === "ARTIFACT_SOURCE",
      );
      if (
        execution.length !== 1 ||
        artifacts.length !== 1 ||
        !exact(
          {
            ...execution[0]!.projectIntegrationBindingRef,
            contentHash: execution[0]!.projectIntegrationBindingHash,
          },
          {
            ...artifacts[0]!.projectIntegrationBindingRef,
            contentHash: artifacts[0]!.projectIntegrationBindingHash,
          },
        ) ||
        !exact(
          { ...execution[0]!.profileRef, contentHash: execution[0]!.profileHash },
          { ...artifacts[0]!.profileRef, contentHash: artifacts[0]!.profileHash },
        ) ||
        !exact(
          { ...execution[0]!.connectionRef, contentHash: execution[0]!.connectionHash },
          { ...artifacts[0]!.connectionRef, contentHash: artifacts[0]!.connectionHash },
        )
      )
        throw new Error("CORPORATE_GITLAB_SUITE_ARTIFACT_AUTHORITY_REQUIRED");
      const mapping = original.profile.suiteMappings.find(
        (item) => item.suiteKey === scope.suiteKey,
      )!;
      const selected = await selectGitLabSuitePipeline({
        client,
        numericProjectId: original.c1.numericGitLabProjectId,
        exactRef: original.profile.trigger.ref,
        commitSha: original.commitSha,
        jobName: mapping.resultJobName,
        signal,
        revalidate,
      });
      const result = await readGitLabSuitePipelineEvidence({
        client,
        numericProjectId: original.c1.numericGitLabProjectId,
        ...selected,
        commitSha: original.commitSha,
        jobName: mapping.resultJobName,
        artifactPath: mapping.resultArtifactPath,
        suiteKey: scope.suiteKey,
        allowedEnvironmentRefs: mapping.allowedEnvironmentRefs,
        schemaRef: original.profile.resultContract.schemaRef,
        maximumBytes: original.profile.resultContract.maxBytes,
        signal,
        revalidate,
      });
      return Object.freeze({ ...result, discoveryWitnessHash: original.witness });
    },
  };
}

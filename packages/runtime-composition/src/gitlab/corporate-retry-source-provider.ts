import type { DataSource } from "typeorm";
import {
  createGitLabDialect,
  GitLabSourceContextHandler,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import type { QaAutomatedTargetSnapshot, QaAutomationAttemptRecord } from "@awp/competency-qa/node";
import type { TrustedConnectorOperationContext } from "@awp/connector-sdk";
import { defaultClassificationCatalog } from "@awp/platform-core";
import { sha256, type JsonValue } from "@awp/platform-contracts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import {
  assertCorporateGitLabDiscoveryCurrent,
  assertCorporateGitLabDiscoveryServer,
} from "./corporate-discovery-server.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type {
  CorporateConnectorFactories,
  CorporateConnectorRequestAuthority,
} from "../pilot/connector-factories.ts";

const parse = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;
const same = (
  a: { id: string; version: number; contentHash: string },
  b: { id: string; version: number; contentHash: string },
) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;

/** Source read uses its own published pin and current service grant for retry target verification. */
export async function createCorporateGitLabRetrySourceProvider(
  input: Readonly<{
    source: DataSource;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    authority: CorporateConnectorRequestAuthority;
    attempt: QaAutomationAttemptRecord;
    snapshot: QaAutomatedTargetSnapshot;
    numericProjectId: number;
    server: Readonly<{ edition: string; exactVersion: string; exactBuild: string }>;
    signal: AbortSignal;
    revalidateAttempt(): Promise<void>;
  }>,
) {
  const { attempt, snapshot, signal } = input;
  const { snapshotHash, ...body } = snapshot;
  const pins = snapshot.configurationPins.filter((pin) => pin.logicalRole === "SOURCE_CONTEXT");
  const pin = pins[0];
  if (
    signal.aborted ||
    !["RUNNING", "TERMINAL"].includes(attempt.currentStatus) ||
    pins.length !== 1 ||
    !pin ||
    pin.capabilityKey !== "source-context.read" ||
    pin.exactContractVersion !== "1.0.0" ||
    snapshot.workspaceId !== attempt.workspaceId ||
    snapshot.projectId !== attempt.projectId ||
    snapshot.testSessionId !== attempt.testSessionId ||
    snapshotHash !== attempt.targetSnapshotHash ||
    sha256(body as unknown as JsonValue) !== snapshotHash ||
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    typeof input.revalidateAttempt !== "function"
  )
    throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_PIN_INVALID");
  const grants = input.grants.filter(
    (grant) =>
      grant.binding.provider === "GITLAB" &&
      grant.binding.workspaceId === attempt.workspaceId &&
      grant.binding.projectId === attempt.projectId &&
      grant.binding.servicePrincipalId === attempt.executingServiceId &&
      same(grant.integrationBindingRef, pin.projectIntegrationBindingRef) &&
      same(grant.binding.profileRef, pin.profileRef) &&
      same(grant.binding.connectionRef, pin.connectionRef),
  );
  if (grants.length !== 1) throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_ACCESS_DENIED");
  const grant = grants[0]!;
  const rows = (await input.source.query(
    `SELECT p.content AS profile_content,p.content_hash AS profile_hash,c.content AS connection_content,c.content_hash AS connection_hash,
       d.adapter_family,d.api_family,d.edition,d.exact_version,d.exact_build,d.numeric_project_id
     FROM connector_profile_headers ph JOIN connector_profile_revisions p ON p.workspace_id=ph.workspace_id AND p.header_id=ph.id AND p.version=ph.current_published_version
     JOIN connection_headers ch ON ch.workspace_id=ph.workspace_id AND ch.id=$3
     JOIN connection_revisions c ON c.workspace_id=ch.workspace_id AND c.header_id=ch.id AND c.version=ch.current_published_version
     JOIN gitlab_discovery_snapshots d ON d.workspace_id=ph.workspace_id AND d.connection_ref=$5::jsonb
       AND d.validation_status='VALID' AND d.production_denied=true AND d.expires_at>clock_timestamp() AND d.numeric_project_id=$7
     WHERE ph.workspace_id=$1 AND ph.id=$2 AND p.version=$4 AND p.status='PUBLISHED' AND c.version=$6 AND c.status='PUBLISHED'
     ORDER BY d.collected_at DESC LIMIT 1`,
    [
      attempt.workspaceId,
      pin.profileRef.id,
      pin.connectionRef.id,
      pin.profileRef.version,
      JSON.stringify(pin.connectionRef),
      pin.connectionRef.version,
      input.numericProjectId,
    ],
  )) as readonly Record<string, unknown>[];
  if (rows.length !== 1) throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_CONFIGURATION_STALE");
  const row = rows[0]!;
  assertCorporateGitLabDiscoveryServer(row, input.server);
  const profileContent = parse<Record<string, unknown>>(row.profile_content);
  const connectionContent = parse<Record<string, unknown>>(row.connection_content);
  if (
    row.profile_hash !== pin.profileRef.contentHash ||
    row.connection_hash !== pin.connectionRef.contentHash ||
    integrationConfigurationHash("connector_profile", profileContent) !==
      pin.profileRef.contentHash ||
    integrationConfigurationHash("connection", connectionContent) !== pin.connectionRef.contentHash
  )
    throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_CONFIGURATION_STALE");
  const envelope = connectionContent.connectorConfiguration;
  const value =
    envelope && typeof envelope === "object" && "value" in envelope
      ? envelope.value
      : connectionContent;
  const connection = validateGitLabConnectionConfiguration(value);
  const preflight = preflightGitLabProfile(profileContent, connection);
  if (
    preflight.status !== "SAFE_TO_DISCOVER" ||
    !preflight.profile ||
    preflight.profile.numericGitLabProjectId !== input.numericProjectId
  )
    throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_CONFIGURATION_STALE");
  const profile = preflight.profile;
  const dialect = createGitLabDialect({
    adapterFamily: String(row.adapter_family) as "gitlab-rest-v4",
    apiFamily: String(row.api_family) as "v4",
    edition: String(row.edition) as "CE" | "EE",
    exactVersion: String(row.exact_version),
    exactBuild: String(row.exact_build),
    triggerDialect: profile.trigger.dialect,
    webhookDialect: profile.webhook.verificationMode,
  });
  const { client } = input.factories.gitlab(
    grant.binding.ref.id,
    connection,
    profile.numericGitLabProjectId,
  );
  const context: TrustedConnectorOperationContext = {
    scope: { kind: "PROJECT", workspaceId: attempt.workspaceId, projectId: attempt.projectId },
    actor: {
      kind: "SERVICE",
      principalId: attempt.executingServiceId,
      serviceKey: grant.serviceIdentity.serviceKey,
    },
    authorizationBasisHash: attempt.authorizationBasisHash,
    correlationId: attempt.correlationId,
    causationId: attempt.causationId,
    effectIdempotencyKey: `gitlab:retry-source-read:${attempt.automationAttemptId}`,
    profileRef: pin.profileRef,
    classification: defaultClassificationCatalog.reference("INTERNAL"),
    signal,
    configurationPins: snapshot.configurationPins.map((p) => ({
      logicalRole: p.logicalRole,
      capabilityKey: p.capabilityKey,
      exactContractVersion: p.exactContractVersion,
      bindingRef: p.projectIntegrationBindingRef,
      profileRef: p.profileRef,
      connectionRef: p.connectionRef,
      validationReportRef: p.validationReportRef,
      operationSetHash: p.operationSetHash,
    })),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    telemetry: {
      correlationId: attempt.correlationId,
      causationId: attempt.causationId,
      operation: "source-context.read",
    },
  };
  const revalidate = async () => {
    await input.revalidateAttempt();
    await assertCorporateGitLabDiscoveryCurrent(
      input.source,
      attempt.workspaceId,
      pin.connectionRef,
      input.numericProjectId,
      input.server,
    );
    if (
      signal.aborted ||
      !(await input.authority.authorize(grant.binding, "CONNECTOR_READ", signal))
    )
      throw new Error("CORPORATE_GITLAB_RETRY_SOURCE_ACCESS_DENIED");
  };
  await revalidate();
  return Object.freeze({
    context,
    profile,
    revalidate,
    source: new GitLabSourceContextHandler({
      client,
      dialect,
      numericProjectId: profile.numericGitLabProjectId,
      clock: { now: () => new Date() },
    }),
  });
}

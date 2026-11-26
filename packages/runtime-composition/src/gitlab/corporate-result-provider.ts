import type { DataSource } from "typeorm";

import type { QaAutomatedTargetSnapshot, QaAutomationAttemptRecord } from "@awp/competency-qa/node";
import {
  createGitLabDialect,
  createGitLabRestPipelineReadTransport,
  GitLabPipelineReader,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import type { TrustedConnectorOperationContext } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { defaultClassificationCatalog } from "@awp/platform-core";

import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type {
  CorporateConnectorFactories,
  CorporateConnectorRequestAuthority,
} from "../pilot/connector-factories.ts";
import {
  assertCorporateGitLabDiscoveryCurrent,
  assertCorporateGitLabDiscoveryServer,
} from "./corporate-discovery-server.ts";
import {
  assertCorporateGitLabObservationMatches,
  type createCorporateGitLabTerminalObservation,
} from "./corporate-terminal-observation.ts";

const parse = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;
const same = (
  a: { id: string; version: number; contentHash: string },
  b: { id: string; version: number; contentHash: string },
) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;
type Terminal = Awaited<
  ReturnType<ReturnType<typeof createCorporateGitLabTerminalObservation>["load"]>
>;

export function corporateGitLabResultJobExpiry(
  jobs: unknown,
  jobId: string,
  expectedName: string,
): string {
  if (!Array.isArray(jobs) || jobs.length > 64)
    throw new Error("CORPORATE_GITLAB_RESULT_JOB_INVALID");
  const matches = jobs.filter(
    (job: unknown) =>
      job !== null &&
      typeof job === "object" &&
      !Array.isArray(job) &&
      String((job as Record<string, unknown>).id) === jobId,
  );
  const job = matches[0] as Record<string, unknown> | undefined;
  if (
    matches.length !== 1 ||
    !job ||
    job.name !== expectedName ||
    typeof job.artifacts_expire_at !== "string" ||
    !Number.isFinite(Date.parse(job.artifacts_expire_at))
  )
    throw new Error("CORPORATE_GITLAB_RESULT_EXPIRY_UNVERIFIED");
  return new Date(job.artifacts_expire_at).toISOString();
}

/** Open a read-only GitLab client from the current publication, discovery, attempt and service grant. */
export async function createCorporateGitLabResultProvider(
  input: Readonly<{
    source: DataSource;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    authority: CorporateConnectorRequestAuthority;
    terminal: Terminal;
    attempt: QaAutomationAttemptRecord;
    snapshot: QaAutomatedTargetSnapshot;
    numericProjectId: number;
    server: Readonly<{ edition: string; exactVersion: string; exactBuild: string }>;
    revalidateConfiguration(): Promise<void>;
    signal: AbortSignal;
  }>,
) {
  const { attempt, snapshot, terminal, signal } = input;
  const { snapshotHash, ...snapshotBody } = snapshot;
  const pins = snapshot.configurationPins.filter((pin) => pin.logicalRole === "TEST_EXECUTION");
  const pin = pins[0];
  if (
    signal.aborted ||
    pins.length !== 1 ||
    !pin ||
    attempt.automationAttemptId !== terminal.candidate.attemptId ||
    attempt.connectorCommandId !== terminal.candidate.commandId ||
    attempt.workspaceId !== terminal.candidate.workspaceId ||
    attempt.projectId !== terminal.candidate.projectId ||
    attempt.currentStatus !== "RUNNING" ||
    attempt.targetSnapshotHash !== snapshot.snapshotHash ||
    snapshot.workspaceId !== attempt.workspaceId ||
    snapshot.projectId !== attempt.projectId ||
    snapshot.testSessionId !== attempt.testSessionId ||
    sha256(snapshotBody as unknown as JsonValue) !== snapshotHash ||
    !same(pin.profileRef, terminal.binding.profileRef) ||
    !same(pin.connectionRef, terminal.binding.connectionRef)
  )
    throw new Error("CORPORATE_GITLAB_RESULT_PIN_INVALID");
  const grants = input.grants.filter(
    (grant) =>
      grant.binding.ref.id === terminal.binding.ref.id &&
      grant.binding.servicePrincipalId === attempt.executingServiceId &&
      same(grant.integrationBindingRef, pin.projectIntegrationBindingRef),
  );
  if (grants.length !== 1) throw new Error("CORPORATE_GITLAB_RESULT_ACCESS_DENIED");
  if (Number(terminal.observation.numeric_project_id) !== input.numericProjectId)
    throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
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
      Number(terminal.observation.numeric_project_id),
    ],
  )) as readonly Record<string, unknown>[];
  if (rows.length !== 1) throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
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
    throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
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
    preflight.profile.numericGitLabProjectId !== Number(row.numeric_project_id)
  )
    throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
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
  const clock = { now: () => new Date() };
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
    effectIdempotencyKey: `gitlab:result-read:${attempt.automationAttemptId}`,
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
      operation: "pipeline.read",
    },
  };
  const revalidate = async () => {
    await input.revalidateConfiguration();
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
      throw new Error("CORPORATE_GITLAB_RESULT_ACCESS_DENIED");
  };
  const reader = new GitLabPipelineReader({
    profile,
    clock,
    transport: createGitLabRestPipelineReadTransport(client, dialect),
    authority: () => ({
      sourceCommitSha: snapshot.target.commitSha,
      suiteKey: snapshot.suite.suiteKey,
      environmentRef: snapshot.environment.environmentRef,
      targetSnapshotHash: snapshot.snapshotHash,
      configurationPinSetHash: attempt.configurationPinSetHash,
    }),
  });
  await revalidate();
  const readRequest = {
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.read",
    automationAttemptId: attempt.automationAttemptId,
    externalPipelineId: String(terminal.observation.external_pipeline_id),
    targetSnapshotHash: snapshot.snapshotHash,
    configurationPinSetHash: attempt.configurationPinSetHash,
  } as const;
  const observation = await reader.read(context, readRequest);
  await revalidate();
  assertCorporateGitLabObservationMatches(terminal.observation, observation);
  return Object.freeze({
    context,
    profile,
    observation,
    revalidate,
    async revalidateObservation() {
      await revalidate();
      const fresh = await reader.read(context, readRequest);
      await revalidate();
      assertCorporateGitLabObservationMatches(terminal.observation, fresh);
    },
    async resultJobExpiry(jobId: string): Promise<string> {
      const suites = profile.suiteMappings.filter(
        (suite) => suite.suiteKey === snapshot.suite.suiteKey,
      );
      if (
        suites.length !== 1 ||
        !observation.externalJobIds.includes(jobId) ||
        observation.resultDescriptorRef !==
          `gitlab-result:${profile.numericGitLabProjectId}:${observation.externalPipelineId}:${jobId}:${sha256(suites[0]!.resultArtifactPath)}`
      )
        throw new Error("CORPORATE_GITLAB_RESULT_JOB_INVALID");
      await revalidate();
      const jobs = await client.requestJson<unknown>({
        operation: "pipeline.jobs-read",
        authOperation: "pipelineRead",
        method: "GET",
        path: dialect.pipelineJobsPath(
          profile.numericGitLabProjectId,
          observation.externalPipelineId,
        ),
        signal,
      });
      await revalidate();
      const expiry = corporateGitLabResultJobExpiry(jobs, jobId, suites[0]!.resultJobName);
      const fresh = await reader.read(context, readRequest);
      await revalidate();
      assertCorporateGitLabObservationMatches(terminal.observation, fresh);
      return expiry;
    },
  });
}

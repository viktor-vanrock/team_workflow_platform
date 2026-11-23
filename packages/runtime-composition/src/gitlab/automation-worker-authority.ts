import type { DataSource } from "typeorm";

import {
  type GitLabPipelineLookupTransport,
  type GitLabPipelineProviderCandidate,
  GitLabPipelineTransportFailure,
  GitLabPipelineTriggerHandler,
  type GitLabPipelineTriggerInvocation,
  type GitLabProfileConfiguration,
  GitLabTriggerReconciliationHandler,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import type {
  PipelineTriggerRequest,
  TrustedConnectorConfigurationPin,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import type { ConnectorCommand } from "@awp/platform-core";

import { isGitLabLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import {
  type GitLabAutomationWorkerAuthority,
  type GitLabAutomationWorkerMaterialization,
} from "./automation-worker.ts";

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Readonly<Record<string, unknown>> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function positivePolicyNumber(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    throw new Error("GITLAB_AUTOMATION_PROFILE_POLICY_INVALID");
  return number;
}

function providerError(value: unknown, status: number): Error {
  const code = String(
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as Readonly<Record<string, unknown>>).code ?? `GITLAB_HTTP_${status}`)
      : `GITLAB_HTTP_${status}`,
  );
  return new GitLabPipelineTransportFailure(
    code.includes("TIMEOUT_BEFORE_INVOCATION") ? "PRE_INVOCATION" : "POSSIBLE_EFFECT",
    code,
  );
}

async function responseJson(response: Response): Promise<unknown> {
  const value = (await response
    .json()
    .catch(() => Object.freeze({ code: `GITLAB_HTTP_${response.status}` }))) as unknown;
  if (!response.ok) throw providerError(value, response.status);
  return value;
}

function trustedPins(
  value: readonly Readonly<Record<string, unknown>>[],
): readonly TrustedConnectorConfigurationPin[] {
  return Object.freeze(
    value.map((raw) => {
      const pin = raw as Readonly<{
        logicalRole: string;
        capabilityKey: string;
        exactContractVersion: string;
        projectIntegrationBindingRef: TrustedConnectorConfigurationPin["bindingRef"];
        profileRef: TrustedConnectorConfigurationPin["profileRef"];
        connectionRef: TrustedConnectorConfigurationPin["connectionRef"];
        validationReportRef: TrustedConnectorConfigurationPin["validationReportRef"];
        operationSetHash: TrustedConnectorConfigurationPin["operationSetHash"];
      }>;
      return Object.freeze({
        logicalRole: pin.logicalRole,
        capabilityKey: pin.capabilityKey,
        exactContractVersion: pin.exactContractVersion,
        bindingRef: pin.projectIntegrationBindingRef,
        profileRef: pin.profileRef,
        connectionRef: pin.connectionRef,
        validationReportRef: pin.validationReportRef,
        operationSetHash: pin.operationSetHash,
      });
    }),
  );
}

export function createLocalGitLabAutomationWorkerAuthority(
  source: DataSource,
  environment: RuntimeEnvironment,
  transport: typeof fetch = fetch,
): GitLabAutomationWorkerAuthority {
  if (
    !isGitLabLocalComposition(environment.composition) ||
    environment.environmentScope !== "LOCAL" ||
    !environment.mockHubUrl
  ) {
    throw new Error("GITLAB_AUTOMATION_LOCAL_AUTHORITY_REQUIRED");
  }
  const endpoint = new URL(environment.mockHubUrl);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "mock-hub"].includes(endpoint.hostname)
  ) {
    throw new Error("GITLAB_AUTOMATION_LOCAL_ENDPOINT_FORBIDDEN");
  }

  return Object.freeze({
    async materialize(command: ConnectorCommand): Promise<GitLabAutomationWorkerMaterialization> {
      const request = command.payload as Partial<PipelineTriggerRequest>;
      if (!request.automationAttemptId) throw new Error("GITLAB_AUTOMATION_ATTEMPT_ID_REQUIRED");
      const attempts = records(
        await source.query(
          `
SELECT attempt.connector_command_id,session.target_snapshot
FROM qa_automation_attempts attempt
JOIN qa_test_sessions session ON session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id AND session.session_id=attempt.session_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.attempt_id=$3`,
          [command.workspaceId, command.projectId, request.automationAttemptId],
        ),
      );
      const attempt = attempts[0];
      if (!attempt || String(attempt.connector_command_id) !== command.id)
        throw new Error("GITLAB_AUTOMATION_ATTEMPT_COMMAND_MISMATCH");
      const target = json<
        Readonly<{
          target: Readonly<{ commitSha: string }>;
          environment: Readonly<{ environmentRef: string }>;
          suite: Readonly<{ suiteKey: string }>;
          configurationPins: readonly Readonly<Record<string, unknown>>[];
        }>
      >(attempt.target_snapshot);
      const pins = trustedPins(target.configurationPins);
      const executionPins = pins.filter(({ logicalRole }) => logicalRole === "TEST_EXECUTION");
      const pin = executionPins[0];
      if (
        executionPins.length !== 1 ||
        !pin ||
        pin.profileRef.id !== command.profileRef.id ||
        pin.profileRef.version !== command.profileRef.version
      ) {
        throw new Error("GITLAB_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
      }
      const profiles = records(
        await source.query(
          `
SELECT content,content_hash FROM connector_profile_revisions
WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'`,
          [command.workspaceId, pin.profileRef.id, pin.profileRef.version],
        ),
      );
      const profileRow = profiles[0];
      if (!profileRow || String(profileRow.content_hash) !== pin.profileRef.contentHash)
        throw new Error("GITLAB_AUTOMATION_PROFILE_PIN_REVOKED");
      const connections = records(
        await source.query(
          `
SELECT content,content_hash FROM connection_revisions
WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'`,
          [command.workspaceId, pin.connectionRef.id, pin.connectionRef.version],
        ),
      );
      const connectionRow = connections[0];
      if (!connectionRow || String(connectionRow.content_hash) !== pin.connectionRef.contentHash)
        throw new Error("GITLAB_AUTOMATION_CONNECTION_PIN_REVOKED");
      const connection = validateGitLabConnectionConfiguration(json(connectionRow.content));
      const preflight = preflightGitLabProfile(json(profileRow.content), connection);
      if (preflight.status !== "SAFE_TO_DISCOVER" || !preflight.profile)
        throw new Error("GITLAB_AUTOMATION_PROFILE_REVOKED");
      const profile: GitLabProfileConfiguration = preflight.profile;
      const clock = Object.freeze({ now: () => new Date() });
      const fetchJson = async (url: URL, init: RequestInit) =>
        await responseJson(await transport(url, Object.freeze({ ...init, redirect: "manual" })));
      const trigger = new GitLabPipelineTriggerHandler({
        profile,
        authority: () =>
          Object.freeze({
            suiteKey: target.suite.suiteKey,
            environmentRef: target.environment.environmentRef,
            sourceCommitSha: target.target.commitSha,
          }),
        clock,
        transport: Object.freeze({
          async trigger(invocation: GitLabPipelineTriggerInvocation) {
            const url = new URL(invocation.path, endpoint);
            if (url.origin !== endpoint.origin)
              throw new Error("GITLAB_AUTOMATION_EGRESS_FORBIDDEN");
            return await fetchJson(url, {
              method: "POST",
              headers: Object.freeze({ "content-type": "application/json" }),
              body: JSON.stringify({ ...invocation.body, token: "mock-gitlab-trigger" }),
              ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
            });
          },
        }),
      });
      const lookup = new GitLabTriggerReconciliationHandler({
        profile,
        authority: () =>
          Object.freeze({
            suiteKey: target.suite.suiteKey,
            environmentRef: target.environment.environmentRef,
            sourceCommitSha: target.target.commitSha,
          }),
        clock,
        transport: Object.freeze({
          async list(
            input: Parameters<GitLabPipelineLookupTransport["list"]>[0],
          ): Promise<readonly GitLabPipelineProviderCandidate[]> {
            const url = new URL(input.path, endpoint);
            if (url.origin !== endpoint.origin)
              throw new Error("GITLAB_AUTOMATION_EGRESS_FORBIDDEN");
            url.searchParams.set("ref", input.ref);
            url.searchParams.set("created_after", input.windowStart);
            url.searchParams.set("created_before", input.windowEnd);
            const values = records(
              await fetchJson(url, {
                method: "GET",
                headers: Object.freeze({ "private-token": "mock-gitlab-read" }),
                signal: input.signal,
              }),
            );
            return Object.freeze(
              values.map((value) =>
                Object.freeze({
                  id: String(value.id),
                  name: String(value.name),
                  ref: String(value.ref),
                  sha: String(value.sha),
                  status: String(value.status),
                  createdAt: new Date(String(value.created_at)).toISOString(),
                  ...(value.web_url === undefined ? {} : { displayRef: String(value.web_url) }),
                }),
              ),
            );
          },
          async readInputs(
            input: Parameters<GitLabPipelineLookupTransport["readInputs"]>[0],
          ): Promise<Readonly<Record<string, string | number | boolean>>> {
            const url = new URL(input.path, endpoint);
            if (url.origin !== endpoint.origin)
              throw new Error("GITLAB_AUTOMATION_EGRESS_FORBIDDEN");
            const values = records(
              await fetchJson(url, {
                method: "GET",
                headers: Object.freeze({ "private-token": "mock-gitlab-read" }),
                signal: input.signal,
              }),
            );
            return Object.freeze(
              Object.fromEntries(
                values.map((value) => [
                  String(value.key),
                  value.value as string | number | boolean,
                ]),
              ),
            );
          },
        }),
      });
      const now = new Date();
      const context: TrustedConnectorOperationContext = Object.freeze({
        scope: Object.freeze({
          kind: "PROJECT",
          workspaceId: command.workspaceId,
          projectId: command.projectId,
        }),
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: "f5100000-0000-4000-8000-000000000001",
          serviceKey: "worker.gitlab-automation",
        }),
        authorizationBasisHash:
          command.initialAuthorizationBasisHash as TrustedConnectorOperationContext["authorizationBasisHash"],
        correlationId: command.correlationId,
        causationId: command.causationId,
        effectIdempotencyKey: command.effectIdempotencyKey,
        profileRef: command.profileRef,
        classification: Object.freeze({ key: command.dataClassificationKey, rank: 10 }),
        signal: new AbortController().signal,
        configurationPins: pins,
        deadlineAt: new Date(
          now.getTime() +
            positivePolicyNumber(profile.ratePolicy.requestTimeoutMs, 10_000, 60_000) +
            5_000,
        ).toISOString(),
        telemetry: Object.freeze({
          correlationId: command.correlationId,
          causationId: command.causationId,
          operation: command.capability.operation,
        }),
      });
      return Object.freeze({
        port: Object.freeze({
          trigger: trigger.trigger.bind(trigger),
          lookup: lookup.lookup.bind(lookup),
        }),
        context,
        connectionHeaderId: pin.connectionRef.id,
        connectionRef: pin.connectionRef,
        profileRef: pin.profileRef,
        numericProjectId: profile.numericGitLabProjectId,
        exactRef: profile.trigger.ref,
        expectedCommitSha: target.target.commitSha,
        lookupConsistencyWindowMs:
          positivePolicyNumber(profile.reconciliation.lookupConsistencyWindowSeconds, 120, 900) *
          1_000,
        lookupIntervalMs:
          positivePolicyNumber(profile.reconciliation.pollIntervalSeconds, 30, 900) * 1_000,
      });
    },
  });
}

import type { DataSource } from "typeorm";

import {
  GitLabPipelineTriggerHandler,
  GitLabTriggerReconciliationHandler,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import type {
  PipelineTriggerRequest,
  TrustedConnectorConfigurationPin,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { type ConnectorCommand, defaultClassificationCatalog } from "@awp/platform-core";

import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorFactories } from "../pilot/connector-factories.ts";
import type { CorporateWorkerCommandContext } from "../pilot/worker-command-context.ts";
import type { GitLabAutomationWorkerAuthority } from "./automation-worker.ts";
import {
  assertCorporateGitLabBuildMapping,
  assertCorporateGitLabBuildRef,
} from "./corporate-build-target.ts";
import { assertCorporatePublishedSuiteParameters } from "./corporate-parameter-schema.ts";

const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const valueOf = (content: Record<string, unknown>, key: string): unknown => {
  const envelope = content[key];
  return envelope && typeof envelope === "object" && !Array.isArray(envelope) && "value" in envelope
    ? envelope.value
    : content;
};
const positive = (value: unknown, fallback: number, maximum: number) => {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    throw new Error("CORPORATE_GITLAB_POLICY_INVALID");
  return number;
};

/** Materializes GitLab automation only from exact published revisions and scoped corporate factories. */
export function createCorporateGitLabAutomationWorkerAuthority(
  input: Readonly<{
    source: DataSource;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    commands: CorporateWorkerCommandContext;
  }>,
): GitLabAutomationWorkerAuthority {
  if (!input.source.isInitialized) throw new Error("CORPORATE_GITLAB_AUTHORITY_REQUIRED");
  return {
    async materialize(command: ConnectorCommand) {
      const request = command.payload as Partial<PipelineTriggerRequest>;
      if (!request.automationAttemptId) throw new Error("GITLAB_AUTOMATION_ATTEMPT_ID_REQUIRED");
      const rows = (await input.source.query(
        `SELECT a.connector_command_id,a.target_snapshot_hash,a.work_item_id,a.session_id,a.initiating_human_principal_id,
        a.executing_service_principal_id,a.effect_idempotency_key,a.lineage_kind,s.target_hash,s.target_snapshot FROM qa_automation_attempts a
        JOIN qa_test_sessions s ON (s.workspace_id,s.project_id,s.session_id)=(a.workspace_id,a.project_id,a.session_id)
        WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.attempt_id=$3`,
        [command.workspaceId, command.projectId, request.automationAttemptId],
      )) as readonly {
        connector_command_id: string;
        target_snapshot_hash: string;
        work_item_id: string;
        session_id: string;
        initiating_human_principal_id: string;
        executing_service_principal_id: string;
        effect_idempotency_key: string;
        lineage_kind: string;
        target_hash: string;
        target_snapshot: unknown;
      }[];
      if (rows.length !== 1 || rows[0]!.connector_command_id !== command.id)
        throw new Error("GITLAB_AUTOMATION_ATTEMPT_COMMAND_MISMATCH");
      const target = json<{
        snapshotHash: string;
        workspaceId: string;
        projectId: string;
        workItemId: string;
        testSessionId: string;
        target: { commitSha: string; buildRef?: string };
        environment: { environmentRef: string };
        suite: Parameters<typeof assertCorporatePublishedSuiteParameters>[2] & { suiteKey: string };
        configurationPins: readonly {
          logicalRole: string;
          capabilityKey: string;
          exactContractVersion: string;
          projectIntegrationBindingRef: TrustedConnectorConfigurationPin["bindingRef"];
          profileRef: TrustedConnectorConfigurationPin["profileRef"];
          connectionRef: TrustedConnectorConfigurationPin["connectionRef"];
          validationReportRef: TrustedConnectorConfigurationPin["validationReportRef"];
          operationSetHash: TrustedConnectorConfigurationPin["operationSetHash"];
        }[];
      }>(rows[0]!.target_snapshot);
      if (!target || !Array.isArray(target.configurationPins))
        throw new Error("GITLAB_AUTOMATION_CONFIGURATION_INVALID");
      const { snapshotHash, ...snapshotBody } = target;
      if (
        snapshotHash !== rows[0]!.target_snapshot_hash ||
        snapshotHash !== rows[0]!.target_hash ||
        target.workspaceId !== command.workspaceId ||
        target.projectId !== command.projectId ||
        target.workItemId !== rows[0]!.work_item_id ||
        target.testSessionId !== rows[0]!.session_id ||
        sha256(snapshotBody as unknown as JsonValue) !== snapshotHash
      )
        throw new Error("GITLAB_AUTOMATION_TARGET_SNAPSHOT_STALE");
      assertCorporateGitLabBuildRef(target.target);
      const pins: TrustedConnectorConfigurationPin[] = (
        target.configurationPins as readonly {
          logicalRole: string;
          capabilityKey: string;
          exactContractVersion: string;
          projectIntegrationBindingRef: TrustedConnectorConfigurationPin["bindingRef"];
          profileRef: TrustedConnectorConfigurationPin["profileRef"];
          connectionRef: TrustedConnectorConfigurationPin["connectionRef"];
          validationReportRef: TrustedConnectorConfigurationPin["validationReportRef"];
          operationSetHash: TrustedConnectorConfigurationPin["operationSetHash"];
        }[]
      ).map((pin) => ({
        logicalRole: pin.logicalRole,
        capabilityKey: pin.capabilityKey,
        exactContractVersion: pin.exactContractVersion,
        bindingRef: pin.projectIntegrationBindingRef,
        profileRef: pin.profileRef,
        connectionRef: pin.connectionRef,
        validationReportRef: pin.validationReportRef,
        operationSetHash: pin.operationSetHash,
      }));
      const selected = pins.filter((pin) => pin.logicalRole === "TEST_EXECUTION");
      if (selected.length !== 1) throw new Error("GITLAB_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
      const pin = selected[0]!;
      if (
        pin.profileRef.id !== command.profileRef.id ||
        pin.profileRef.version !== command.profileRef.version
      )
        throw new Error("GITLAB_AUTOMATION_TEST_EXECUTION_PIN_INVALID");
      const grants = input.grants.filter(
        ({ binding, integrationBindingRef }) =>
          binding.provider === "GITLAB" &&
          binding.workspaceId === command.workspaceId &&
          binding.projectId === command.projectId &&
          binding.profileRef.id === pin.profileRef.id &&
          binding.profileRef.version === pin.profileRef.version &&
          binding.profileRef.contentHash === pin.profileRef.contentHash &&
          binding.connectionRef.id === pin.connectionRef.id &&
          binding.connectionRef.version === pin.connectionRef.version &&
          binding.connectionRef.contentHash === pin.connectionRef.contentHash &&
          integrationBindingRef.id === pin.bindingRef.id &&
          integrationBindingRef.version === pin.bindingRef.version &&
          integrationBindingRef.contentHash === pin.bindingRef.contentHash,
      );
      if (grants.length !== 1) throw new Error("CORPORATE_GITLAB_BINDING_REQUIRED");
      const grant = grants[0]!;
      if (
        (rows[0]!.lineage_kind === "AUTO_INFRA_RETRY"
          ? command.actor.kind !== "SERVICE" ||
            command.actor.principalId !== rows[0]!.executing_service_principal_id
          : command.actor.kind !== "HUMAN" ||
            command.actor.principalId !== rows[0]!.initiating_human_principal_id) ||
        rows[0]!.executing_service_principal_id !== grant.binding.servicePrincipalId ||
        rows[0]!.effect_idempotency_key !== command.effectIdempotencyKey
      )
        throw new Error("GITLAB_AUTOMATION_ATTEMPT_AUTHORITY_MISMATCH");
      // Existing in-flight effects remain eligible for reconciliation; no new
      // pipeline may start while Suite safety evidence is unavailable.
      if (command.status === "QUEUED")
        throw new Error("GITLAB_SUITE_UNAVAILABLE_RUNNER_NETWORK_NO_DEPLOY_EVIDENCE_MISSING");
      const load = async (kind: "connector_profile" | "connection", ref: typeof pin.profileRef) => {
        const rows = (await input.source.query(
          `SELECT r.content,r.content_hash FROM ${kind}_headers h JOIN ${kind}_revisions r
          ON (r.workspace_id,r.header_id,r.version)=(h.workspace_id,h.id,h.current_published_version)
          WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
          [command.workspaceId, ref.id, ref.version],
        )) as readonly { content: Record<string, unknown>; content_hash: string }[];
        if (
          rows.length !== 1 ||
          rows[0]!.content_hash !== ref.contentHash ||
          integrationConfigurationHash(kind, rows[0]!.content) !== ref.contentHash
        )
          throw new Error("GITLAB_AUTOMATION_CONFIGURATION_STALE");
        return rows[0]!.content;
      };
      const [profileContent, connectionContent] = await Promise.all([
        load("connector_profile", pin.profileRef),
        load("connection", pin.connectionRef),
      ]);
      const connection = validateGitLabConnectionConfiguration(
        valueOf(connectionContent, "connectorConfiguration"),
      );
      const preflight = preflightGitLabProfile(profileContent, connection);
      if (preflight.status !== "SAFE_TO_DISCOVER" || !preflight.profile)
        throw new Error("GITLAB_AUTOMATION_PROFILE_REVOKED");
      const profile = preflight.profile;
      assertCorporateGitLabBuildMapping({
        target: target.target,
        acceptedParameters: target.suite.acceptedParameters,
        mappings: profile.trigger.inputMappings,
      });
      await assertCorporatePublishedSuiteParameters(input.source, command, target.suite);
      const { client, triggerTransport } = input.factories.gitlab(
        grant.binding.ref.id,
        connection,
        profile.numericGitLabProjectId,
      );
      const authority = () => ({
        suiteKey: target.suite.suiteKey,
        environmentRef: target.environment.environmentRef,
        sourceCommitSha: target.target.commitSha,
      });
      const trigger = new GitLabPipelineTriggerHandler({
        profile,
        authority,
        clock: { now: () => new Date() },
        transport: {
          trigger: async (invocation) =>
            await input.commands.run(command, async () => {
              await assertCorporatePublishedSuiteParameters(input.source, command, target.suite);
              return await triggerTransport.trigger(invocation);
            }),
        },
      });
      const read = async (path: string, signal: AbortSignal) =>
        await client.requestJson<unknown>({
          operation: "pipeline.lookup",
          authOperation: "pipelineLookup",
          method: "GET",
          path,
          signal,
        });
      const lookup = new GitLabTriggerReconciliationHandler({
        profile,
        authority,
        clock: { now: () => new Date() },
        transport: {
          list: async (request) => {
            const params = new URLSearchParams({
              ref: request.ref,
              created_after: request.windowStart,
              created_before: request.windowEnd,
            });
            const values = await read(`${request.path}?${params.toString()}`, request.signal);
            if (!Array.isArray(values)) throw new Error("GITLAB_LOOKUP_INVALID");
            return values.map((raw) => {
              const value = raw as Record<string, unknown>;
              return {
                id: String(value.id),
                name: String(value.name),
                ref: String(value.ref),
                sha: String(value.sha),
                status: String(value.status),
                createdAt: new Date(String(value.created_at)).toISOString(),
                ...(value.web_url === undefined ? {} : { displayRef: String(value.web_url) }),
              };
            });
          },
          readInputs: async (request) => {
            const values = await read(request.path, request.signal);
            if (!Array.isArray(values)) throw new Error("GITLAB_LOOKUP_INVALID");
            return Object.fromEntries(
              values.map((raw) => {
                const item = raw as Record<string, unknown>;
                return [String(item.key), item.value as string | number | boolean];
              }),
            );
          },
        },
      });
      const now = new Date();
      const context: TrustedConnectorOperationContext = {
        scope: { kind: "PROJECT", workspaceId: command.workspaceId, projectId: command.projectId },
        actor: {
          kind: "SERVICE",
          principalId: grant.binding.servicePrincipalId,
          serviceKey: grant.serviceIdentity.serviceKey,
        },
        authorizationBasisHash: command.initialAuthorizationBasisHash as `sha256:${string}`,
        correlationId: command.correlationId,
        causationId: command.causationId,
        effectIdempotencyKey: command.effectIdempotencyKey,
        profileRef: command.profileRef,
        classification: defaultClassificationCatalog.reference(command.dataClassificationKey),
        signal: new AbortController().signal,
        configurationPins: pins,
        deadlineAt: new Date(
          now.getTime() + positive(profile.ratePolicy.requestTimeoutMs, 10_000, 60_000) + 5000,
        ).toISOString(),
        telemetry: {
          correlationId: command.correlationId,
          causationId: command.causationId,
          operation: command.capability.operation,
        },
      };
      return {
        port: { trigger: trigger.trigger.bind(trigger), lookup: lookup.lookup.bind(lookup) },
        context,
        connectionHeaderId: pin.connectionRef.id,
        connectionRef: pin.connectionRef,
        profileRef: pin.profileRef,
        numericProjectId: profile.numericGitLabProjectId,
        exactRef: profile.trigger.ref,
        expectedCommitSha: target.target.commitSha,
        lookupConsistencyWindowMs:
          positive(profile.reconciliation.lookupConsistencyWindowSeconds, 120, 900) * 1000,
        lookupIntervalMs: positive(profile.reconciliation.pollIntervalSeconds, 30, 900) * 1000,
      };
    },
  };
}

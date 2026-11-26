import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { defaultClassificationCatalog } from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type {
  CorporateConnectorFactories,
  CorporateConnectorRequestAuthority,
} from "../pilot/connector-factories.ts";
import type { PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { createCorporateGitLabResultArtifactProvider } from "./corporate-result-artifact-provider.ts";
import { collectCorporateGitLabResultArtifacts } from "./corporate-result-collection.ts";
import {
  corporateGitLabMissingResultForQa,
  corporateGitLabResultForQa,
  normalizeCorporateGitLabResult,
} from "./corporate-result-normalization.ts";
import { createCorporateGitLabResultProvider } from "./corporate-result-provider.ts";
import { createCorporateGitLabResultState } from "./corporate-result-state.ts";
import type { CorporateGitLabResultAuthority } from "./corporate-result-worker.ts";
import { createCorporateGitLabRetryAuthority } from "./corporate-retry-authority.ts";
import { createCorporateGitLabRetryPolicyAuthority } from "./corporate-retry-policy-authority.ts";
import { createCorporateGitLabTerminalObservation } from "./corporate-terminal-observation.ts";
import type { GitLabAutomationRetrySnapshot } from "./result-sync.ts";

function assertRetryDecisionCurrent(
  prepared: GitLabAutomationRetrySnapshot,
  current: GitLabAutomationRetrySnapshot,
) {
  const stable = (value: typeof prepared) => {
    const { authorizationRecheckHash: _evidence, ...authority } = value.authority;
    void _evidence;
    return {
      policy: value.policy,
      authority,
      executingService: value.executingService,
      causalAuthorizationBasis: value.causalAuthorizationBasis,
    };
  };
  if (
    sha256(stable(prepared) as unknown as JsonValue) !==
    sha256(stable(current) as unknown as JsonValue)
  )
    throw new Error("CORPORATE_GITLAB_RETRY_AUTHORITY_CHANGED");
}

/** Server-owned result authority checks provider observations, artifacts and retry policy. */
export function createCorporateGitLabResultAuthority(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    connectorAuthority: CorporateConnectorRequestAuthority;
    guard: PilotCommandEffectGuard;
    allowValidatedIncomplete?: boolean;
  }>,
): CorporateGitLabResultAuthority {
  const state = createCorporateGitLabResultState(input.source, input.environment);
  const terminal = createCorporateGitLabTerminalObservation({
    ...input,
    authority: input.connectorAuthority,
  });
  const retry = createCorporateGitLabRetryAuthority(input);
  const policy = createCorporateGitLabRetryPolicyAuthority(input);
  const access = new TypeOrmScopedAccessRepository(input.source);
  const context = (
    attempt: Awaited<ReturnType<typeof state.load>>["attempt"],
    service: Awaited<ReturnType<typeof retry.resolve>>["executingService"],
  ) => ({
    scope: {
      kind: "PROJECT" as const,
      workspaceId: attempt.workspaceId,
      projectId: attempt.projectId,
    },
    actor: service,
    correlationId: attempt.correlationId,
    causationId: attempt.causationId,
  });
  return {
    async prepare(candidate, signal) {
      const current = await state.load(candidate, "RUNNING");
      if (current.attempt.connectorCommandId !== candidate.commandId)
        throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
      const saved = await terminal.load(candidate, signal);
      const configuration = await policy.resolve(current.attempt, signal);
      const revalidateConfiguration = async () => {
        const latest = await policy.resolve(current.attempt, signal);
        if (latest.metadataHash !== configuration.metadataHash)
          throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
      };
      const provider = await createCorporateGitLabResultProvider({
        ...input,
        authority: input.connectorAuthority,
        terminal: saved,
        attempt: current.attempt,
        snapshot: current.targetSnapshot,
        numericProjectId: configuration.numericProjectId,
        server: configuration.server,
        revalidateConfiguration,
        signal,
      });
      let normalization;
      let normalized;
      let artifacts;
      if (provider.observation.resultDescriptorRef) {
        const buildRef = current.targetSnapshot.target.buildRef;
        if (!buildRef) throw new Error("CORPORATE_GITLAB_BUILD_REF_REQUIRED");
        artifacts = await createCorporateGitLabResultArtifactProvider({
          ...input,
          authority: input.connectorAuthority,
          attempt: current.attempt,
          snapshot: current.targetSnapshot,
          numericProjectId: provider.profile.numericGitLabProjectId,
          server: configuration.server,
          signal,
          revalidateAttempt: async () => {
            await terminal.load(candidate, signal);
            await revalidateConfiguration();
          },
        });
        normalized = await normalizeCorporateGitLabResult({
          context: artifacts.context,
          profile: artifacts.profile,
          snapshot: current.targetSnapshot,
          observation: provider.observation,
          storedObservation: saved.observation,
          expectedStoredObservationHash: candidate.observationHash,
          attemptId: current.attempt.automationAttemptId,
          requestMarkerHash: String(saved.observation.marker_hash) as `sha256:${string}`,
          buildRef,
          revalidate: artifacts.revalidate,
          normalizer: artifacts.normalizer,
        });
        normalization = corporateGitLabResultForQa({
          snapshot: current.targetSnapshot,
          observation: provider.observation,
          normalized,
        });
        if (
          normalization.normalizationKind === "SCHEMA_VALIDATED" &&
          normalization.outcome === "INCOMPLETE" &&
          input.allowValidatedIncomplete !== true
        )
          throw new Error("CORPORATE_GITLAB_VALID_INCOMPLETE_NOT_ENABLED");
      } else {
        normalization = corporateGitLabMissingResultForQa({
          snapshot: current.targetSnapshot,
          observation: provider.observation,
          storedObservation: saved.observation,
          expectedStoredObservationHash: candidate.observationHash,
          resultSchemaRef: current.attempt.resultSchemaRef,
        });
      }
      const decision = await retry.resolve(
        current.attempt,
        current.targetSnapshot,
        normalization.outcome === "INFRA_FAILED" ? normalization.infrastructureCode : undefined,
        signal,
      );
      let collected = { descriptors: [], manifest: [] } as Awaited<
        ReturnType<typeof collectCorporateGitLabResultArtifacts>
      >;
      if (normalized?.normalizationKind === "SCHEMA_VALIDATED" && artifacts) {
        const project = await access.getProject({
          kind: "PROJECT",
          workspaceId: candidate.workspaceId,
          projectId: candidate.projectId,
        });
        if (!project || project.state !== "ACTIVE")
          throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
        collected = await collectCorporateGitLabResultArtifacts({
          snapshot: current.targetSnapshot,
          attemptId: current.attempt.automationAttemptId,
          pipeline: provider,
          artifacts,
          normalized,
          registeredAt: decision.decidedAt,
          minimumClassificationRank: project.classification.rank,
          artifactPolicy: decision.artifactPolicy,
        });
      }
      const stored = saved.observation;
      const at = (value: unknown) => new Date(String(value)).toISOString();
      const recordedAt = new Date().toISOString();
      const sourceKind =
        stored.source_kind === "POLL" ? ("POLL_READ" as const) : ("RECONCILIATION_READ" as const);
      return {
        facts: {
          context: context(current.attempt, decision.executingService),
          attempt: current.attempt,
          previousStatus: current.previousStatus,
          targetSnapshot: current.targetSnapshot,
          observation: {
            externalPipelineId: provider.observation.externalPipelineId,
            externalJobIds: provider.observation.externalJobIds,
            providerStatus: provider.observation.providerState,
            providerRevisionToken: provider.observation.providerRevisionToken,
            providerUpdatedAt: provider.observation.providerUpdatedAt,
            terminal: true as const,
            observedAt: at(stored.observed_at),
            observationHash: candidate.observationHash as `sha256:${string}`,
            source: sourceKind,
            sourceReceiptRef: `gitlab-observation:${candidate.observationId}`,
          },
          normalization,
          artifactDescriptors: collected.descriptors,
          machineArtifactManifest: collected.manifest,
          previousLineageResults: current.previousLineageResults,
          session: current.session,
          recordedAt,
        },
        lineage: current.lineage,
        retry: { ...decision, decidedAt: recordedAt },
      };
    },
    async prepareRecovery(candidate, signal) {
      const current = await state.load(candidate, "TERMINAL");
      if (
        !current.terminalResult ||
        current.terminalResult.automationAttemptResultId !== candidate.resultId
      )
        throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
      const decision = await retry.resolve(
        current.attempt,
        current.targetSnapshot,
        current.terminalResult.infrastructureCode,
        signal,
      );
      return {
        context: context(current.attempt, decision.executingService),
        attempt: current.attempt,
        result: current.terminalResult,
        lineage: current.lineage,
        targetSnapshot: current.targetSnapshot,
        retry: decision,
      };
    },
    async revalidate(candidate, signal, request) {
      if ("observationId" in candidate) {
        if (!("facts" in request)) throw new Error("CORPORATE_GITLAB_RESULT_CANDIDATE_MISMATCH");
        const current = await state.load(candidate, "RUNNING");
        const saved = await terminal.load(candidate, signal);
        const configuration = await policy.resolve(current.attempt, signal);
        const revalidateConfiguration = async () => {
          const latest = await policy.resolve(current.attempt, signal);
          if (latest.metadataHash !== configuration.metadataHash)
            throw new Error("CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE");
        };
        const provider = await createCorporateGitLabResultProvider({
          ...input,
          authority: input.connectorAuthority,
          terminal: saved,
          attempt: current.attempt,
          snapshot: current.targetSnapshot,
          numericProjectId: configuration.numericProjectId,
          server: configuration.server,
          revalidateConfiguration,
          signal,
        });
        let artifactForRecheck:
          Awaited<ReturnType<typeof createCorporateGitLabResultArtifactProvider>> | undefined;
        let normalizedForRecheck:
          Awaited<ReturnType<typeof normalizeCorporateGitLabResult>> | undefined;
        if (request.facts.normalization.sourceResultArtifactRef) {
          const artifact = await createCorporateGitLabResultArtifactProvider({
            ...input,
            authority: input.connectorAuthority,
            attempt: current.attempt,
            snapshot: current.targetSnapshot,
            numericProjectId: Number(saved.observation.numeric_project_id),
            server: configuration.server,
            signal,
            revalidateAttempt: async () => {
              await terminal.load(candidate, signal);
              await revalidateConfiguration();
            },
          });
          await artifact.revalidate();
          const buildRef = current.targetSnapshot.target.buildRef;
          if (!buildRef) throw new Error("CORPORATE_GITLAB_BUILD_REF_REQUIRED");
          const normalized = await normalizeCorporateGitLabResult({
            context: artifact.context,
            profile: artifact.profile,
            snapshot: current.targetSnapshot,
            observation: provider.observation,
            storedObservation: saved.observation,
            expectedStoredObservationHash: candidate.observationHash,
            attemptId: current.attempt.automationAttemptId,
            requestMarkerHash: String(saved.observation.marker_hash) as `sha256:${string}`,
            buildRef,
            revalidate: artifact.revalidate,
            normalizer: artifact.normalizer,
          });
          const fresh = corporateGitLabResultForQa({
            snapshot: current.targetSnapshot,
            observation: provider.observation,
            normalized,
          });
          if (
            sha256(fresh as unknown as JsonValue) !==
            sha256(request.facts.normalization as unknown as JsonValue)
          )
            throw new Error("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
          artifactForRecheck = artifact;
          normalizedForRecheck = normalized;
        } else if (provider.observation.resultDescriptorRef) {
          throw new Error("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
        }
        const project = await access.getProject({
          kind: "PROJECT",
          workspaceId: candidate.workspaceId,
          projectId: candidate.projectId,
        });
        if (
          !project ||
          project.state !== "ACTIVE" ||
          request.facts.artifactDescriptors.some(
            (descriptor) =>
              defaultClassificationCatalog.reference(descriptor.classificationKey).rank <
                project.classification.rank ||
              (descriptor.availability === "AVAILABLE" &&
                Date.parse(descriptor.expiresAt) <= Date.now()),
          )
        )
          throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
        if (normalizedForRecheck?.normalizationKind === "SCHEMA_VALIDATED" && artifactForRecheck) {
          const registeredAt = request.facts.artifactDescriptors[0]?.registeredAt;
          if (!registeredAt) throw new Error("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
          const collected = await collectCorporateGitLabResultArtifacts({
            snapshot: current.targetSnapshot,
            attemptId: current.attempt.automationAttemptId,
            pipeline: provider,
            artifacts: artifactForRecheck,
            normalized: normalizedForRecheck,
            registeredAt,
            minimumClassificationRank: project.classification.rank,
            artifactPolicy: configuration.artifactPolicy,
          });
          if (
            sha256(collected.descriptors as unknown as JsonValue) !==
              sha256(request.facts.artifactDescriptors as unknown as JsonValue) ||
            sha256(collected.manifest as unknown as JsonValue) !==
              sha256(request.facts.machineArtifactManifest as unknown as JsonValue)
          )
            throw new Error("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
        }
        const outcome = request.facts.normalization;
        const currentRetry = await retry.resolve(
          current.attempt,
          current.targetSnapshot,
          outcome.outcome === "INFRA_FAILED" ? outcome.infrastructureCode : undefined,
          signal,
        );
        assertRetryDecisionCurrent(request.retry, currentRetry);
      } else {
        const current = await state.load(candidate, "TERMINAL");
        if (
          !current.terminalResult ||
          current.terminalResult.automationAttemptResultId !== candidate.resultId
        )
          throw new Error("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
        const currentRetry = await retry.resolve(
          current.attempt,
          current.targetSnapshot,
          current.terminalResult.infrastructureCode,
          signal,
        );
        if (!("retry" in request)) throw new Error("CORPORATE_GITLAB_RESULT_CANDIDATE_MISMATCH");
        assertRetryDecisionCurrent(request.retry, currentRetry);
      }
    },
  };
}

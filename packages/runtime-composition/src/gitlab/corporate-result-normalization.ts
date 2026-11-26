import type {
  QaAutomatedTargetSnapshot,
  QaAutomationNormalizedResultInput,
} from "@awp/competency-qa/node";
import type {
  GitLabProfileConfiguration,
  GitLabResultNormalization,
  GitLabResultNormalizationRequest,
} from "@awp/connector-gitlab";
import type { PipelineObservation, TrustedConnectorOperationContext } from "@awp/connector-sdk";
import { sha256, type JsonValue } from "@awp/platform-contracts";
import { assertCorporateGitLabObservationMatches } from "./corporate-terminal-observation.ts";

/** Normalize only the result artifact selected by a verified terminal pipeline read. */
export async function normalizeCorporateGitLabResult(
  input: Readonly<{
    context: TrustedConnectorOperationContext;
    profile: GitLabProfileConfiguration;
    snapshot: QaAutomatedTargetSnapshot;
    observation: PipelineObservation;
    storedObservation: Readonly<Record<string, unknown>>;
    attemptId: string;
    expectedStoredObservationHash: string;
    requestMarkerHash: `sha256:${string}`;
    buildRef: string;
    revalidate: () => Promise<void>;
    normalizer: Readonly<{
      downloadAndNormalize(
        context: TrustedConnectorOperationContext,
        request: GitLabResultNormalizationRequest,
      ): Promise<GitLabResultNormalization>;
    }>;
  }>,
): Promise<GitLabResultNormalization> {
  const { context, profile, snapshot, observation } = input;
  assertCorporateGitLabObservationMatches(input.storedObservation, observation);
  const { snapshotHash, ...snapshotBody } = snapshot;
  const { observationHash, ...observationBody } = observation;
  const suites = profile.suiteMappings.filter(
    (suite) => suite.suiteKey === snapshot.suite.suiteKey,
  );
  const match =
    /^gitlab-result:([1-9][0-9]*):([1-9][0-9]*):([1-9][0-9]*):(sha256:[a-f0-9]{64})$/u.exec(
      observation.resultDescriptorRef ?? "",
    );
  if (
    context.signal.aborted ||
    context.scope.kind !== "PROJECT" ||
    context.actor.kind !== "SERVICE" ||
    context.scope.workspaceId !== snapshot.workspaceId ||
    context.scope.projectId !== snapshot.projectId ||
    sha256(snapshotBody as unknown as JsonValue) !== snapshotHash ||
    input.storedObservation.observation_hash !== input.expectedStoredObservationHash ||
    sha256(observationBody as unknown as JsonValue) !== observationHash ||
    !observation.terminal ||
    observation.sourceCommitSha !== snapshot.target.commitSha ||
    suites.length !== 1 ||
    !suites[0]!.allowedEnvironmentRefs.includes(snapshot.environment.environmentRef) ||
    !input.attemptId ||
    !input.buildRef ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.requestMarkerHash) ||
    !match ||
    Number(match[1]) !== profile.numericGitLabProjectId ||
    match[2] !== observation.externalPipelineId ||
    !observation.externalJobIds.includes(match[3]!) ||
    match[4] !== sha256(suites[0]!.resultArtifactPath)
  )
    throw new Error("CORPORATE_GITLAB_RESULT_SELECTION_INVALID");
  if (typeof input.revalidate !== "function")
    throw new Error("CORPORATE_GITLAB_RESULT_AUTHORITY_REQUIRED");
  await input.revalidate();
  const normalized = await input.normalizer.downloadAndNormalize(context, {
    automationAttemptId: input.attemptId,
    externalPipelineId: observation.externalPipelineId,
    externalJobId: match[3]!,
    sourceResultArtifactRef: observation.resultDescriptorRef!,
    authority: {
      requestMarkerHash: input.requestMarkerHash,
      sourceCommitSha: snapshot.target.commitSha,
      buildRef: input.buildRef,
      suiteKey: snapshot.suite.suiteKey,
      environmentRef: snapshot.environment.environmentRef,
    },
  });
  await input.revalidate();
  if (context.signal.aborted) throw new Error("CORPORATE_GITLAB_RESULT_AUTHORITY_REQUIRED");
  return normalized;
}

/** Convert a provider normalization into QA's existing result vocabulary without inventing outcomes. */
export function corporateGitLabResultForQa(
  input: Readonly<{
    snapshot: QaAutomatedTargetSnapshot;
    observation: PipelineObservation;
    normalized: GitLabResultNormalization;
  }>,
): QaAutomationNormalizedResultInput {
  const { snapshot, observation, normalized } = input;
  if (
    !observation.terminal ||
    observation.sourceCommitSha !== snapshot.target.commitSha ||
    !normalized.sourceResultArtifactRef ||
    normalized.sourceResultArtifactRef !== observation.resultDescriptorRef
  )
    throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_INVALID");
  const common = {
    resultSchemaRef: normalized.expectedSchemaRef,
    sourceResultArtifactRef: normalized.sourceResultArtifactRef,
    ...(normalized.resultContentHash ? { resultContentHash: normalized.resultContentHash } : {}),
    ...(normalized.observedSchemaRef
      ? { observedResultSchemaRef: normalized.observedSchemaRef }
      : {}),
    externalPipelineId: observation.externalPipelineId,
    externalJobIds: observation.externalJobIds,
    suiteKey: snapshot.suite.suiteKey,
    environmentRef: snapshot.environment.environmentRef,
  };
  if (normalized.normalizationKind === "SCHEMA_VALIDATED") {
    const result = normalized.result;
    if (
      String(result.pipelineId) !== observation.externalPipelineId ||
      !observation.externalJobIds.includes(String(result.jobId)) ||
      result.commitSha !== snapshot.target.commitSha ||
      result.suiteKey !== common.suiteKey ||
      result.environmentRef !== common.environmentRef
    )
      throw new Error("CORPORATE_GITLAB_RESULT_SCOPE_INVALID");
    return Object.freeze({
      ...common,
      normalizationKind: "SCHEMA_VALIDATED",
      normalizationStatus: "VALID",
      issueCodes: [],
      outcome: result.outcome,
      target: snapshot.target,
      durationMs: result.durationMs,
      ...(result.infrastructureCode ? { infrastructureCode: result.infrastructureCode } : {}),
      ...(result.cancellationReasonCode
        ? { cancellationReasonCode: result.cancellationReasonCode }
        : {}),
      terminalAt: result.finishedAt,
    });
  }
  return Object.freeze({
    ...common,
    normalizationKind: "SYNTHETIC_INCOMPLETE",
    normalizationStatus: normalized.normalizationStatus,
    issueCodes: normalized.issueCodes,
    syntheticReasonCode: normalized.syntheticReasonCode,
    outcome: "INCOMPLETE",
    terminalAt: observation.finishedAt ?? observation.providerUpdatedAt,
  });
}

/** A terminal pipeline with no matching result job cannot be treated as a successful QA result. */
export function corporateGitLabMissingResultForQa(
  input: Readonly<{
    snapshot: QaAutomatedTargetSnapshot;
    observation: PipelineObservation;
    storedObservation: Readonly<Record<string, unknown>>;
    expectedStoredObservationHash: string;
    resultSchemaRef: QaAutomationNormalizedResultInput["resultSchemaRef"];
  }>,
): QaAutomationNormalizedResultInput {
  const { snapshot, observation } = input;
  assertCorporateGitLabObservationMatches(input.storedObservation, observation);
  const { snapshotHash, ...snapshotBody } = snapshot;
  const { observationHash, ...observationBody } = observation;
  if (
    !observation.terminal ||
    observation.resultDescriptorRef ||
    observation.sourceCommitSha !== snapshot.target.commitSha ||
    input.storedObservation.observation_hash !== input.expectedStoredObservationHash ||
    sha256(observationBody as unknown as JsonValue) !== observationHash ||
    sha256(snapshotBody as unknown as JsonValue) !== snapshotHash ||
    input.resultSchemaRef.id !== snapshot.executionPolicies.resultSchemaRef.id ||
    input.resultSchemaRef.version !== snapshot.executionPolicies.resultSchemaRef.version ||
    input.resultSchemaRef.digest !== snapshot.executionPolicies.resultSchemaRef.contentHash
  )
    throw new Error("CORPORATE_GITLAB_RESULT_SELECTION_INVALID");
  return Object.freeze({
    normalizationKind: "SYNTHETIC_INCOMPLETE",
    normalizationStatus: "MISSING",
    issueCodes: ["RESULT_MISSING"] as const,
    syntheticReasonCode: "RESULT_MISSING",
    outcome: "INCOMPLETE",
    resultSchemaRef: input.resultSchemaRef,
    externalPipelineId: observation.externalPipelineId,
    externalJobIds: observation.externalJobIds,
    suiteKey: snapshot.suite.suiteKey,
    environmentRef: snapshot.environment.environmentRef,
    terminalAt: observation.finishedAt ?? observation.providerUpdatedAt,
  });
}

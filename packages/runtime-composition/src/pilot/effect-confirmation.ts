import type {
  PipelineLookupRequest,
  PipelineLookupResult,
  PipelineTriggerReceipt,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface GitLabEffectConfirmationIdentity {
  readonly triggerRequestHash: string;
  readonly markerHash: string;
  readonly expectedCommitSha: string;
  readonly creationWindowStart: string;
  readonly creationWindowEnd: string;
}

/** Validate observations against the original durable effect, never adapter claims alone. */
export function assertGitLabEffectReceipt(
  effect: GitLabEffectConfirmationIdentity,
  receipt: PipelineTriggerReceipt,
  now: Date,
): void {
  const { observationHash, ...body } = receipt;
  const created = Date.parse(receipt.providerCreatedAt),
    observed = Date.parse(receipt.observedAt);
  if (
    receipt.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    receipt.messageType !== "RESULT" ||
    receipt.operation !== "pipeline.trigger" ||
    typeof receipt.externalPipelineId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(receipt.externalPipelineId) ||
    receipt.sourceCommitSha !== effect.expectedCommitSha ||
    receipt.triggerRequestHash !== effect.triggerRequestHash ||
    receipt.effectMarkerHash !== effect.markerHash ||
    !["QUEUED", "RUNNING", "TERMINAL"].includes(receipt.observedState) ||
    !Number.isFinite(created) ||
    !Number.isFinite(observed) ||
    !Number.isFinite(now.getTime()) ||
    created < Date.parse(effect.creationWindowStart) ||
    created > Date.parse(effect.creationWindowEnd) ||
    observed < created ||
    observed > now.getTime() ||
    observationHash !== sha256(body as unknown as JsonValue)
  )
    throw new Error("GITLAB_EFFECT_CONFIRMATION_INVALID");
}

export function assertGitLabEffectLookup(
  request: PipelineLookupRequest,
  result: PipelineLookupResult,
): void {
  if (
    result.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    result.messageType !== "RESULT" ||
    result.operation !== "pipeline.lookup" ||
    !["ZERO", "EXACT_ONE", "MULTIPLE"].includes(result.outcome) ||
    result.observedWindow?.start !== request.windowStart ||
    result.observedWindow?.end !== request.windowEnd ||
    !/^sha256:[a-f0-9]{64}$/u.test(result.consistencyEvidenceHash) ||
    (result.outcome === "MULTIPLE" &&
      (!Array.isArray(result.matchCommitmentHashes) ||
        result.matchCommitmentHashes.length < 2 ||
        result.matchCommitmentHashes.some(
          (hash: unknown) => typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash),
        )))
  )
    throw new Error("GITLAB_EFFECT_LOOKUP_INVALID");
}

/** Search visibility after dispatch cannot authorize a new Jira write. */
export function jiraEffectQuarantineReason(state: string): string | undefined {
  return state === "AMBIGUOUS"
    ? "JIRA_EFFECT_UNRESOLVED"
    : state === "FAILED_FINAL"
      ? "JIRA_EFFECT_FAILED_FINAL"
      : undefined;
}

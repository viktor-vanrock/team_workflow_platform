import type {
  PipelineLookupRequest,
  PipelineLookupResult,
  PipelineTriggerReceipt,
  TestExecutorPort,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import {
  assertGitLabTestExecutorContext,
  gitLabPipelineTargetCommitment,
  type GitLabPipelineTriggerAuthority,
  GitLabPipelineTriggerError,
  isGitLabSha256,
  renderGitLabPipelineName,
} from "../pipeline/gitlab-pipeline-trigger.ts";
import type { GitLabProfileConfiguration } from "../profile/gitlab-profile-validator.ts";

export interface GitLabPipelineProviderCandidate {
  readonly id: string;
  readonly name: string;
  readonly ref: string;
  readonly sha: string;
  readonly status: string;
  readonly createdAt: string;
  readonly displayRef?: string;
}

export interface GitLabPipelineLookupTransport {
  list(
    input: Readonly<{
      numericProjectId: number;
      path: string;
      ref: string;
      windowStart: string;
      windowEnd: string;
      signal: AbortSignal;
    }>,
  ): Promise<readonly GitLabPipelineProviderCandidate[]>;
  readInputs(
    input: Readonly<{
      numericProjectId: number;
      path: string;
      externalPipelineId: string;
      signal: AbortSignal;
    }>,
  ): Promise<Readonly<Record<string, string | number | boolean>>>;
}

function deepFreeze<T>(value: T): T {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertLookupRequest(request: PipelineLookupRequest): Readonly<{ start: Date; end: Date }> {
  const start = new Date(request.windowStart);
  const end = new Date(request.windowEnd);
  if (
    request.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "pipeline.lookup" ||
    !request.automationAttemptId ||
    ![request.effectMarkerHash, request.expectedTargetCommitment, request.triggerRequestHash].every(
      isGitLabSha256,
    ) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() >= end.getTime() ||
    end.getTime() - start.getTime() > 15 * 60_000
  )
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_LOOKUP_REQUEST_INVALID", "FINAL");
  return Object.freeze({ start, end });
}

function providerState(value: string): PipelineTriggerReceipt["observedState"] {
  if (["created", "pending", "waiting_for_resource", "preparing", "scheduled"].includes(value))
    return "QUEUED";
  if (value === "running") return "RUNNING";
  if (["success", "failed", "canceled", "cancelled", "skipped", "manual"].includes(value))
    return "TERMINAL";
  throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_LOOKUP_STATUS_INVALID", "LOOKUP_ONLY");
}

function candidateHash(
  profile: GitLabProfileConfiguration,
  candidate: GitLabPipelineProviderCandidate,
): Sha256Digest {
  return sha256({
    numericProjectId: profile.numericGitLabProjectId,
    ...candidate,
  } as unknown as JsonValue);
}

function receipt(
  candidate: GitLabPipelineProviderCandidate,
  request: PipelineLookupRequest,
  observedAt: Date,
): PipelineTriggerReceipt {
  const body = deepFreeze({
    schemaVersion: "test-executor.trigger-status@1.0.0" as const,
    messageType: "RESULT" as const,
    operation: "pipeline.trigger" as const,
    externalPipelineId: candidate.id,
    ...(candidate.displayRef === undefined
      ? {}
      : { externalPipelineDisplayRef: candidate.displayRef }),
    sourceCommitSha: candidate.sha,
    observedState: providerState(candidate.status),
    providerCreatedAt: new Date(candidate.createdAt).toISOString(),
    observedAt: observedAt.toISOString(),
    triggerRequestHash: request.triggerRequestHash,
    effectMarkerHash: request.effectMarkerHash,
  });
  return deepFreeze({ ...body, observationHash: sha256(body as unknown as JsonValue) });
}

export class GitLabTriggerReconciliationHandler implements Pick<TestExecutorPort, "lookup"> {
  constructor(
    private readonly options: Readonly<{
      profile: GitLabProfileConfiguration;
      authority(request: PipelineLookupRequest): GitLabPipelineTriggerAuthority;
      clock: GitLabClock;
      transport: GitLabPipelineLookupTransport;
    }>,
  ) {}

  async lookup(
    context: TrustedConnectorOperationContext,
    request: PipelineLookupRequest,
  ): Promise<PipelineLookupResult> {
    const observedAt = this.options.clock.now();
    assertGitLabTestExecutorContext(context, observedAt);
    const window = assertLookupRequest(request);
    const authority = this.options.authority(request);
    if (
      gitLabPipelineTargetCommitment(
        this.options.profile.trigger.ref,
        authority.sourceCommitSha,
      ) !== request.expectedTargetCommitment
    ) {
      throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_LOOKUP_TARGET_MISMATCH", "FINAL");
    }
    const expectedName = renderGitLabPipelineName(this.options.profile, {
      automationAttemptId: request.automationAttemptId,
      triggerRequestHash: request.triggerRequestHash,
    });
    const candidates = await this.options.transport.list(
      deepFreeze({
        numericProjectId: this.options.profile.numericGitLabProjectId,
        path: `/api/v4/projects/${this.options.profile.numericGitLabProjectId}/pipelines`,
        ref: this.options.profile.trigger.ref,
        windowStart: request.windowStart,
        windowEnd: request.windowEnd,
        signal: context.signal,
      }),
    );
    const matches: GitLabPipelineProviderCandidate[] = [];
    for (const candidate of candidates) {
      const createdAt = new Date(candidate.createdAt);
      if (
        !candidate.id ||
        candidate.id.length > 128 ||
        candidate.ref !== this.options.profile.trigger.ref ||
        candidate.sha !== authority.sourceCommitSha ||
        candidate.name !== expectedName ||
        Number.isNaN(createdAt.getTime()) ||
        createdAt < window.start ||
        createdAt > window.end ||
        gitLabPipelineTargetCommitment(candidate.ref, candidate.sha) !==
          request.expectedTargetCommitment
      )
        continue;
      const inputs = await this.options.transport.readInputs(
        deepFreeze({
          numericProjectId: this.options.profile.numericGitLabProjectId,
          path: `/api/v4/projects/${this.options.profile.numericGitLabProjectId}/pipelines/${encodeURIComponent(candidate.id)}/variables`,
          externalPipelineId: candidate.id,
          signal: context.signal,
        }),
      );
      if (inputs[this.options.profile.trigger.markerInputName] === request.effectMarkerHash)
        matches.push(deepFreeze(structuredClone(candidate)));
    }
    matches.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    const matchCommitmentHashes = deepFreeze(
      matches.map((candidate) => candidateHash(this.options.profile, candidate)),
    );
    const base = deepFreeze({
      schemaVersion: "test-executor.trigger-status@1.0.0" as const,
      messageType: "RESULT" as const,
      operation: "pipeline.lookup" as const,
      observedWindow: { start: request.windowStart, end: request.windowEnd },
    });
    const evidence = (outcome: "EXACT_ONE" | "ZERO" | "MULTIPLE") =>
      sha256({
        numericProjectId: this.options.profile.numericGitLabProjectId,
        outcome,
        observedWindow: base.observedWindow,
        matchCommitmentHashes,
        effectMarkerHash: request.effectMarkerHash,
        triggerRequestHash: request.triggerRequestHash,
      } as unknown as JsonValue);
    if (matches.length === 0)
      return deepFreeze({
        ...base,
        outcome: "ZERO" as const,
        consistencyEvidenceHash: evidence("ZERO"),
      });
    if (matches.length === 1)
      return deepFreeze({
        ...base,
        outcome: "EXACT_ONE" as const,
        receipt: receipt(matches[0]!, request, observedAt),
        consistencyEvidenceHash: evidence("EXACT_ONE"),
      });
    return deepFreeze({
      ...base,
      outcome: "MULTIPLE" as const,
      matchCommitmentHashes,
      consistencyEvidenceHash: evidence("MULTIPLE"),
    });
  }
}

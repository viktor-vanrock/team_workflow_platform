import type {
  PipelineTriggerReceipt,
  PipelineTriggerRequest,
  TestExecutorPort,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import type { GitLabProfileConfiguration } from "../profile/gitlab-profile-validator.ts";

export interface GitLabPipelineTriggerAuthority {
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly sourceCommitSha: string;
}

export interface GitLabPipelineTriggerInvocation {
  readonly numericProjectId: number;
  readonly path: string;
  readonly dialect: "TYPED_INPUTS" | "BOUNDED_VARIABLES";
  readonly pipelineName: string;
  readonly body: Readonly<{
    ref: string;
    name: string;
    inputs?: Readonly<Record<string, string | number | boolean>>;
    variables?: readonly Readonly<{ key: string; value: string | number | boolean }>[];
  }>;
  readonly signal?: AbortSignal;
}

export interface GitLabPipelineTriggerTransport {
  trigger(input: GitLabPipelineTriggerInvocation): Promise<unknown>;
}

export class GitLabPipelineTransportFailure extends Error {
  constructor(
    readonly stage: "PRE_INVOCATION" | "POSSIBLE_EFFECT",
    readonly transportCode: string,
  ) {
    super(transportCode);
    this.name = "GitLabPipelineTransportFailure";
  }
}

export class GitLabPipelineTriggerError extends Error {
  constructor(
    readonly code: string,
    readonly recovery: "BOUNDED_RETRY_ALLOWED" | "LOOKUP_ONLY" | "FINAL",
  ) {
    super(code);
    this.name = "GitLabPipelineTriggerError";
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function isGitLabSha256(value: string): value is Sha256Digest {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function safeText(value: unknown, code: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new GitLabPipelineTriggerError(code, "FINAL");
  }
  return value;
}

function safeCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value))
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_COMMIT_SHA_INVALID", "FINAL");
  return value;
}

export function assertGitLabTestExecutorContext(
  context: TrustedConnectorOperationContext,
  now: Date,
): void {
  const pins = context.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
  );
  const pin = pins[0];
  if (
    context.scope.kind !== "PROJECT" ||
    context.actor.kind !== "SERVICE" ||
    !context.scope.workspaceId ||
    !context.scope.projectId ||
    !isGitLabSha256(context.authorizationBasisHash) ||
    !context.correlationId ||
    !context.causationId ||
    !context.effectIdempotencyKey ||
    Number.isNaN(Date.parse(context.deadlineAt)) ||
    Date.parse(context.deadlineAt) <= now.getTime() ||
    context.signal.aborted ||
    pins.length !== 1 ||
    !pin ||
    pin.capabilityKey !== "test-executor.trigger-status" ||
    pin.exactContractVersion !== "1.0.0" ||
    pin.profileRef.id !== context.profileRef.id ||
    pin.profileRef.version !== context.profileRef.version ||
    ![
      pin.profileRef.contentHash,
      pin.connectionRef.contentHash,
      pin.bindingRef.contentHash,
      pin.validationReportRef.contentHash,
      pin.operationSetHash,
    ].every(isGitLabSha256)
  )
    throw new GitLabPipelineTriggerError("GITLAB_TEST_EXECUTOR_CONTEXT_INVALID", "FINAL");
}

export function renderGitLabPipelineName(
  profile: GitLabProfileConfiguration,
  request: Pick<PipelineTriggerRequest, "automationAttemptId" | "triggerRequestHash">,
): string {
  const name = profile.trigger.pipelineNameTemplate
    .replace(
      "{attemptId}",
      safeText(request.automationAttemptId, "GITLAB_TRIGGER_ATTEMPT_ID_INVALID", 128),
    )
    .replace("{requestHash}", request.triggerRequestHash);
  return safeText(name, "GITLAB_TRIGGER_PIPELINE_NAME_INVALID", 255);
}

export function gitLabPipelineTargetCommitment(ref: string, sourceCommitSha: string): Sha256Digest {
  return sha256({
    ref: safeText(ref, "GITLAB_TRIGGER_REF_INVALID", 255),
    sourceCommitSha: safeCommit(sourceCommitSha),
  });
}

function assertTriggerRequest(request: PipelineTriggerRequest): void {
  if (
    request.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "pipeline.trigger" ||
    [
      request.testSessionId,
      request.automationAttemptId,
      request.targetSnapshotRef,
      request.suiteBindingRef.id,
    ].some((value) => !value) ||
    !Number.isSafeInteger(request.suiteBindingRef.version) ||
    request.suiteBindingRef.version < 1 ||
    ![
      request.launchRequestCommitment,
      request.targetSnapshotHash,
      request.suiteBindingRef.contentHash,
      request.suiteBindingHash,
      request.parameterSetHash,
      request.effectMarkerHash,
      request.triggerRequestHash,
    ].every(isGitLabSha256)
  )
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_REQUEST_INVALID", "FINAL");
}

function mappedValue(
  logicalField: string,
  source: "SERVER_CONTEXT" | "SUITE_PARAMETER",
  request: PipelineTriggerRequest,
  authority: GitLabPipelineTriggerAuthority,
): JsonValue | undefined {
  if (source === "SUITE_PARAMETER") return request.acceptedParameters[logicalField];
  const values: Readonly<Record<string, JsonValue>> = Object.freeze({
    REQUEST_MARKER: request.effectMarkerHash,
    SUITE_KEY: authority.suiteKey,
    ENVIRONMENT_REF: authority.environmentRef,
    COMMIT_SHA: authority.sourceCommitSha,
    ATTEMPT_ID: request.automationAttemptId,
    TARGET_SNAPSHOT_REF: request.targetSnapshotRef,
  });
  return values[logicalField];
}

function typedValue(
  value: JsonValue | undefined,
  type: "STRING" | "INTEGER" | "BOOLEAN",
): string | number | boolean {
  const valid =
    (type === "STRING" && typeof value === "string") ||
    (type === "INTEGER" && typeof value === "number" && Number.isSafeInteger(value)) ||
    (type === "BOOLEAN" && typeof value === "boolean");
  if (!valid || (typeof value === "string" && /[\r\n;&|`$<>]/u.test(value))) {
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_INPUT_VALUE_INVALID", "FINAL");
  }
  return value as string | number | boolean;
}

export function buildGitLabPipelineTrigger(
  profile: GitLabProfileConfiguration,
  request: PipelineTriggerRequest,
  authority: GitLabPipelineTriggerAuthority,
): GitLabPipelineTriggerInvocation {
  assertTriggerRequest(request);
  if (
    !profile.productionDenied ||
    !Number.isSafeInteger(profile.numericGitLabProjectId) ||
    profile.numericGitLabProjectId < 1 ||
    !profile.allowedRefs.includes(profile.trigger.ref) ||
    !authority.suiteKey ||
    !authority.environmentRef
  )
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_PROFILE_AUTHORITY_INVALID", "FINAL");
  safeCommit(authority.sourceCommitSha);
  const suiteMappings = profile.suiteMappings.filter(
    ({ suiteKey }) => suiteKey === authority.suiteKey,
  );
  const suite = suiteMappings[0];
  if (
    suiteMappings.length !== 1 ||
    !suite ||
    suite.logicalPipelineKey !== profile.trigger.logicalPipelineKey ||
    suite.sourceRefPolicyRef !== profile.trigger.sourceRefPolicyRef ||
    !suite.allowedEnvironmentRefs.includes(authority.environmentRef)
  )
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_SUITE_AUTHORITY_INVALID", "FINAL");

  const inputs: Record<string, string | number | boolean> = {};
  for (const mapping of profile.trigger.inputMappings) {
    if (
      !profile.trigger.allowedInputNames.includes(mapping.providerInputName) ||
      Object.hasOwn(inputs, mapping.providerInputName)
    ) {
      throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_INPUT_MAPPING_INVALID", "FINAL");
    }
    const value = typedValue(
      mappedValue(mapping.logicalField, mapping.source, request, authority),
      mapping.inputType,
    );
    if (mapping.allowedValues !== undefined && !mapping.allowedValues.includes(value)) {
      throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_INPUT_NOT_ALLOWED", "FINAL");
    }
    inputs[mapping.providerInputName] = value;
  }
  if (inputs[profile.trigger.markerInputName] !== request.effectMarkerHash) {
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_MARKER_MAPPING_INVALID", "FINAL");
  }
  const pipelineName = renderGitLabPipelineName(profile, request);
  const body =
    profile.trigger.dialect === "TYPED_INPUTS"
      ? { ref: profile.trigger.ref, name: pipelineName, inputs: deepFreeze(inputs) }
      : {
          ref: profile.trigger.ref,
          name: pipelineName,
          variables: deepFreeze(Object.entries(inputs).map(([key, value]) => ({ key, value }))),
        };
  return deepFreeze({
    numericProjectId: profile.numericGitLabProjectId,
    path: `/api/v4/projects/${profile.numericGitLabProjectId}/trigger/pipeline`,
    dialect: profile.trigger.dialect,
    pipelineName,
    body,
  });
}

function providerRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_RESPONSE_INVALID", "LOOKUP_ONLY");
  }
  return value as Readonly<Record<string, unknown>>;
}

function providerState(value: unknown): PipelineTriggerReceipt["observedState"] {
  if (
    ["created", "pending", "waiting_for_resource", "preparing", "scheduled"].includes(String(value))
  )
    return "QUEUED";
  if (value === "running") return "RUNNING";
  if (["success", "failed", "canceled", "cancelled", "skipped", "manual"].includes(String(value)))
    return "TERMINAL";
  throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_PROVIDER_STATUS_INVALID", "LOOKUP_ONLY");
}

function providerTimestamp(value: unknown): string {
  const raw = safeText(value, "GITLAB_TRIGGER_PROVIDER_TIME_INVALID", 64);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()))
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_PROVIDER_TIME_INVALID", "LOOKUP_ONLY");
  return parsed.toISOString();
}

export function createGitLabPipelineTriggerReceipt(
  response: unknown,
  request: PipelineTriggerRequest,
  authority: GitLabPipelineTriggerAuthority,
  observedAt: Date,
): PipelineTriggerReceipt {
  const provider = providerRecord(response);
  const externalPipelineId = safeText(
    String(provider.id ?? ""),
    "GITLAB_TRIGGER_PIPELINE_ID_INVALID",
    128,
  );
  const sourceCommitSha = safeCommit(
    safeText(provider.sha, "GITLAB_TRIGGER_COMMIT_SHA_INVALID", 40),
  );
  if (sourceCommitSha !== authority.sourceCommitSha)
    throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_TARGET_MISMATCH", "LOOKUP_ONLY");
  const body = deepFreeze({
    schemaVersion: "test-executor.trigger-status@1.0.0" as const,
    messageType: "RESULT" as const,
    operation: "pipeline.trigger" as const,
    externalPipelineId,
    ...(provider.web_url === undefined
      ? {}
      : {
          externalPipelineDisplayRef: safeText(
            provider.web_url,
            "GITLAB_TRIGGER_DISPLAY_REF_INVALID",
          ),
        }),
    sourceCommitSha,
    observedState: providerState(provider.status),
    providerCreatedAt: providerTimestamp(provider.created_at),
    observedAt: observedAt.toISOString(),
    triggerRequestHash: request.triggerRequestHash,
    effectMarkerHash: request.effectMarkerHash,
  });
  return deepFreeze({ ...body, observationHash: sha256(body as unknown as JsonValue) });
}

export class GitLabPipelineTriggerHandler implements Pick<TestExecutorPort, "trigger"> {
  constructor(
    private readonly options: Readonly<{
      profile: GitLabProfileConfiguration;
      authority(request: PipelineTriggerRequest): GitLabPipelineTriggerAuthority;
      clock: GitLabClock;
      transport: GitLabPipelineTriggerTransport;
    }>,
  ) {}

  async trigger(
    context: TrustedConnectorOperationContext,
    request: PipelineTriggerRequest,
  ): Promise<PipelineTriggerReceipt> {
    const observedAt = this.options.clock.now();
    assertGitLabTestExecutorContext(context, observedAt);
    const authority = this.options.authority(request);
    const invocation = {
      ...buildGitLabPipelineTrigger(this.options.profile, request, authority),
      signal: context.signal,
    };
    try {
      const response = await this.options.transport.trigger(deepFreeze(invocation));
      return createGitLabPipelineTriggerReceipt(response, request, authority, observedAt);
    } catch (error) {
      if (error instanceof GitLabPipelineTriggerError) throw error;
      if (error instanceof GitLabPipelineTransportFailure && error.stage === "PRE_INVOCATION") {
        throw new GitLabPipelineTriggerError(
          "GITLAB_TRIGGER_PRE_INVOCATION_TRANSPORT_FAILURE",
          "BOUNDED_RETRY_ALLOWED",
        );
      }
      throw new GitLabPipelineTriggerError("GITLAB_TRIGGER_EFFECT_AMBIGUOUS", "LOOKUP_ONLY");
    }
  }
}

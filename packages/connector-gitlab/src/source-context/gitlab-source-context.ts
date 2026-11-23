import {
  type BuildObservation,
  type CommitObservation,
  type MergeRequestObservation,
  type SourceContextObservation,
  type SourceContextReadPort,
  type SourceContextReadRequest,
  type SourceContextReadResult,
  type TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import type { GitLabRestClient } from "../http/gitlab-rest-client.ts";
import type { GitLabDialect } from "../profile/gitlab-dialect.ts";

export interface GitLabSourceContextHandlerOptions {
  readonly client: GitLabRestClient;
  readonly dialect: GitLabDialect;
  readonly numericProjectId: number;
  readonly clock: GitLabClock;
}

export class GitLabSourceContextError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabSourceContextError";
  }
}

function record(
  value: unknown,
  code = "GITLAB_SOURCE_RESPONSE_INVALID",
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new GitLabSourceContextError(code);
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, code: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new GitLabSourceContextError(code);
  }
  return value;
}

function timestamp(value: unknown, code: string): string {
  const candidate = string(value, code, 64);
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) throw new GitLabSourceContextError(code);
  return date.toISOString();
}

function commitSha(value: unknown): string {
  const candidate = string(value, "GITLAB_SOURCE_COMMIT_SHA_INVALID", 40);
  if (!/^[a-f0-9]{40}$/u.test(candidate))
    throw new GitLabSourceContextError("GITLAB_SOURCE_COMMIT_SHA_INVALID");
  return candidate;
}

function numericReference(value: string): string {
  if (!/^[1-9][0-9]{0,17}$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new GitLabSourceContextError("GITLAB_SOURCE_REFERENCE_INVALID");
  }
  return value;
}

function exactHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function assertTrustedContext(context: TrustedConnectorOperationContext, now: Date): void {
  if (
    context.scope.kind !== "PROJECT" ||
    !context.scope.workspaceId ||
    !context.scope.projectId ||
    !context.authorizationBasisHash ||
    !exactHash(context.authorizationBasisHash) ||
    !context.correlationId ||
    !context.causationId ||
    Number.isNaN(Date.parse(context.deadlineAt)) ||
    Date.parse(context.deadlineAt) <= now.getTime() ||
    context.signal.aborted
  )
    throw new GitLabSourceContextError("GITLAB_SOURCE_CONTEXT_INVALID");
  const pins = context.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "SOURCE_CONTEXT",
  );
  const pin = pins[0];
  if (
    pins.length !== 1 ||
    !pin ||
    pin.capabilityKey !== "source-context.read" ||
    pin.exactContractVersion !== "1.0.0" ||
    pin.profileRef.id !== context.profileRef.id ||
    pin.profileRef.version !== context.profileRef.version ||
    !exactHash(pin.profileRef.contentHash) ||
    !exactHash(pin.connectionRef.contentHash) ||
    !exactHash(pin.bindingRef.contentHash) ||
    !exactHash(pin.validationReportRef.contentHash) ||
    !exactHash(pin.operationSetHash)
  )
    throw new GitLabSourceContextError("GITLAB_SOURCE_CONFIGURATION_PIN_INVALID");
}

function assertRequest(request: SourceContextReadRequest): void {
  if (request.schemaVersion !== "source-context.read@1.0.0" || request.messageType !== "REQUEST") {
    throw new GitLabSourceContextError("GITLAB_SOURCE_REQUEST_VERSION_INVALID");
  }
  const expectedKind =
    request.operation === "merge-request.read"
      ? "MERGE_REQUEST"
      : request.operation === "commit.read"
        ? "COMMIT"
        : "BUILD";
  if (request.selector.sourceKind !== expectedKind)
    throw new GitLabSourceContextError("GITLAB_SOURCE_OPERATION_SELECTOR_MISMATCH");
}

function withHash<T extends Omit<SourceContextObservation, "observationHash">>(
  value: T,
): T & Readonly<{ observationHash: `sha256:${string}` }> {
  return Object.freeze({ ...value, observationHash: sha256(value as unknown as JsonValue) });
}

function assertExpectedRevision(request: SourceContextReadRequest, revision: string): void {
  if (
    request.selector.expectedRevision !== undefined &&
    request.selector.expectedRevision !== revision
  ) {
    throw new GitLabSourceContextError("GITLAB_SOURCE_REVISION_MISMATCH");
  }
}

function mergeRequestState(value: unknown): MergeRequestObservation["state"] {
  if (value === "opened" || value === "open") return "OPEN";
  if (value === "merged") return "MERGED";
  if (value === "closed") return "CLOSED";
  throw new GitLabSourceContextError("GITLAB_MERGE_REQUEST_STATE_INVALID");
}

function buildState(value: unknown): BuildObservation["state"] {
  if (["success", "running", "pending", "created", "manual"].includes(String(value)))
    return "AVAILABLE";
  if (["failed", "canceled", "cancelled", "skipped"].includes(String(value))) return "UNAVAILABLE";
  if (value === "expired") return "EXPIRED";
  throw new GitLabSourceContextError("GITLAB_BUILD_STATE_INVALID");
}

export class GitLabSourceContextHandler implements SourceContextReadPort {
  constructor(private readonly options: GitLabSourceContextHandlerOptions) {
    if (!Number.isSafeInteger(options.numericProjectId) || options.numericProjectId < 1) {
      throw new GitLabSourceContextError("GITLAB_PROJECT_ID_INVALID");
    }
  }

  async read(
    context: TrustedConnectorOperationContext,
    request: SourceContextReadRequest,
  ): Promise<SourceContextReadResult> {
    const observedAt = this.options.clock.now();
    assertTrustedContext(context, observedAt);
    assertRequest(request);
    let observation: SourceContextObservation;
    if (request.operation === "merge-request.read")
      observation = await this.#mergeRequest(context, request, observedAt);
    else if (request.operation === "commit.read")
      observation = await this.#commit(context, request, observedAt);
    else observation = await this.#build(context, request, observedAt);
    return Object.freeze({
      schemaVersion: "source-context.read@1.0.0",
      messageType: "RESULT",
      operation: request.operation,
      observation,
    });
  }

  async #mergeRequest(
    context: TrustedConnectorOperationContext,
    request: SourceContextReadRequest,
    observedAt: Date,
  ): Promise<MergeRequestObservation> {
    const sourceRef = numericReference(request.selector.sourceRef);
    const response = record(
      await this.options.client.requestJson({
        operation: "merge-request.read",
        authOperation: "mergeRequestRead",
        method: "GET",
        path: this.options.dialect.mergeRequestPath(this.options.numericProjectId, sourceRef),
        signal: context.signal,
      }),
    );
    const headCommitSha = commitSha(response.sha ?? response.diff_head_sha);
    assertExpectedRevision(request, headCommitSha);
    const body: Omit<MergeRequestObservation, "observationHash"> = Object.freeze({
      sourceKind: "MERGE_REQUEST",
      sourceRef,
      providerRevisionToken: timestamp(
        response.updated_at,
        "GITLAB_MERGE_REQUEST_REVISION_TOKEN_INVALID",
      ),
      observedAt: observedAt.toISOString(),
      state: mergeRequestState(response.state),
      sourceRevision: string(
        response.source_branch,
        "GITLAB_MERGE_REQUEST_SOURCE_REVISION_INVALID",
        255,
      ),
      targetRevision: string(
        response.target_branch,
        "GITLAB_MERGE_REQUEST_TARGET_REVISION_INVALID",
        255,
      ),
      headCommitSha,
      buildRefs: Object.freeze([]),
    });
    return withHash(body);
  }

  async #commit(
    context: TrustedConnectorOperationContext,
    request: SourceContextReadRequest,
    observedAt: Date,
  ): Promise<CommitObservation> {
    const sourceRef = commitSha(request.selector.sourceRef);
    const response = record(
      await this.options.client.requestJson({
        operation: "commit.read",
        authOperation: "commitRead",
        method: "GET",
        path: this.options.dialect.commitPath(this.options.numericProjectId, sourceRef),
        signal: context.signal,
      }),
    );
    const revision = commitSha(response.id ?? response.sha);
    assertExpectedRevision(request, revision);
    if (!Array.isArray(response.parent_ids) || response.parent_ids.length > 64)
      throw new GitLabSourceContextError("GITLAB_COMMIT_PARENTS_INVALID");
    const body: Omit<CommitObservation, "observationHash"> = Object.freeze({
      sourceKind: "COMMIT",
      sourceRef,
      providerRevisionToken: timestamp(
        response.committed_date,
        "GITLAB_COMMIT_REVISION_TOKEN_INVALID",
      ),
      observedAt: observedAt.toISOString(),
      commitSha: revision,
      parentCommitShas: Object.freeze(response.parent_ids.map(commitSha)),
    });
    return withHash(body);
  }

  async #build(
    context: TrustedConnectorOperationContext,
    request: SourceContextReadRequest,
    observedAt: Date,
  ): Promise<BuildObservation> {
    const sourceRef = numericReference(request.selector.sourceRef);
    const response = record(
      await this.options.client.requestJson({
        operation: "build.read",
        authOperation: "buildRead",
        method: "GET",
        path: this.options.dialect.pipelinePath(this.options.numericProjectId, sourceRef),
        signal: context.signal,
      }),
    );
    const sourceCommitSha = commitSha(response.sha ?? response.commit_sha);
    assertExpectedRevision(request, sourceCommitSha);
    const normalized = Object.freeze({
      id: Number(response.id ?? response.pipeline_id),
      ref: string(response.ref, "GITLAB_BUILD_REF_INVALID", 255),
      sourceCommitSha,
      state: buildState(response.status),
      updatedAt: timestamp(response.updated_at, "GITLAB_BUILD_REVISION_TOKEN_INVALID"),
    });
    if (!Number.isSafeInteger(normalized.id) || normalized.id !== Number(sourceRef))
      throw new GitLabSourceContextError("GITLAB_BUILD_ID_MISMATCH");
    const body: Omit<BuildObservation, "observationHash"> = Object.freeze({
      sourceKind: "BUILD",
      sourceRef,
      providerRevisionToken: normalized.updatedAt,
      observedAt: observedAt.toISOString(),
      buildDigest: sha256(normalized as unknown as JsonValue),
      sourceCommitSha,
      state: normalized.state,
    });
    return withHash(body);
  }
}

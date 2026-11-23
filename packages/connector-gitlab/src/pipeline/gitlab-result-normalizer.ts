import type { TrustedConnectorOperationContext } from "@awp/connector-sdk";
import {
  designContractRegistry,
  type JsonValue,
  type SchemaReference,
  SchemaValidationError,
  sha256,
  type Sha256Digest,
} from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import { GitLabRestClient, GitLabTransportError } from "../http/gitlab-rest-client.ts";
import type { GitLabDialect } from "../profile/gitlab-dialect.ts";
import type {
  GitLabProfileConfiguration,
  GitLabProfileSuiteMapping,
} from "../profile/gitlab-profile-validator.ts";
import { isGitLabSha256 } from "./gitlab-pipeline-trigger.ts";

export type GitLabMachineResultOutcome =
  "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
export type GitLabResultNormalizationIssue =
  | "RESULT_MISSING"
  | "RESULT_TOO_LARGE"
  | "RESULT_SCHEMA_UNKNOWN"
  | "RESULT_SCHEMA_DRIFT"
  | "RESULT_SCOPE_MISMATCH"
  | "RESULT_TARGET_MISMATCH"
  | "ARTIFACT_CHECKSUM_MISMATCH"
  | "ARTIFACT_EXPIRED";

export interface GitLabMachineResultArtifact {
  readonly path: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: Sha256Digest;
  readonly classification: string;
  readonly expiresAt: string;
}

export interface GitLabMachineResult {
  readonly schemaVersion: "gitlab-pipeline-result@1.0.0";
  readonly requestMarkerHash: Sha256Digest;
  readonly pipelineId: number;
  readonly jobId: number;
  readonly commitSha: string;
  readonly buildRef: string;
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly outcome: GitLabMachineResultOutcome;
  readonly infrastructureCode?: string;
  readonly cancellationReasonCode?: string;
  readonly summary?: Readonly<{ total: number; passed: number; failed: number; skipped: number }>;
  readonly artifacts: readonly GitLabMachineResultArtifact[];
}

export interface GitLabResultNormalizationAuthority {
  readonly requestMarkerHash: Sha256Digest;
  readonly sourceCommitSha: string;
  readonly buildRef: string;
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly expectedResultChecksum?: Sha256Digest;
}

export interface GitLabResultNormalizationRequest {
  readonly automationAttemptId: string;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly sourceResultArtifactRef: string;
  readonly authority: GitLabResultNormalizationAuthority;
}

interface NormalizationBase {
  readonly expectedSchemaRef: SchemaReference;
  readonly sourceResultArtifactRef: string;
  readonly resultContentHash?: Sha256Digest;
  readonly observedSchemaRef?: SchemaReference;
}

export type GitLabResultNormalization =
  | (NormalizationBase &
      Readonly<{
        normalizationKind: "SCHEMA_VALIDATED";
        normalizationStatus: "VALID";
        issueCodes: readonly [];
        outcome: GitLabMachineResultOutcome;
        result: GitLabMachineResult;
      }>)
  | (NormalizationBase &
      Readonly<{
        normalizationKind: "SYNTHETIC_INCOMPLETE";
        normalizationStatus: "INVALID" | "MISSING";
        issueCodes: readonly GitLabResultNormalizationIssue[];
        syntheticReasonCode: GitLabResultNormalizationIssue;
        outcome: "INCOMPLETE";
      }>);

export interface GitLabResultNormalizerOptions {
  readonly client: GitLabRestClient;
  readonly dialect: GitLabDialect;
  readonly profile: GitLabProfileConfiguration;
  readonly clock: GitLabClock;
}

export class GitLabResultNormalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabResultNormalizationError";
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

function numericId(value: string, code: string): number {
  if (!/^[1-9][0-9]{0,17}$/u.test(value) || !Number.isSafeInteger(Number(value)))
    throw new GitLabResultNormalizationError(code);
  return Number(value);
}

function exactSuite(
  profile: GitLabProfileConfiguration,
  suiteKey: string,
  environmentRef: string,
): GitLabProfileSuiteMapping {
  const matches = profile.suiteMappings.filter((candidate) => candidate.suiteKey === suiteKey);
  const suite = matches[0];
  if (
    matches.length !== 1 ||
    !suite ||
    !profile.productionDenied ||
    !suite.allowedEnvironmentRefs.includes(environmentRef)
  ) {
    throw new GitLabResultNormalizationError("GITLAB_RESULT_AUTHORITY_INVALID");
  }
  return suite;
}

function assertArtifactContext(context: TrustedConnectorOperationContext, now: Date): void {
  const pins = context.configurationPins.filter(
    ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
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
    Number.isNaN(Date.parse(context.deadlineAt)) ||
    Date.parse(context.deadlineAt) <= now.getTime() ||
    context.signal.aborted ||
    pins.length !== 1 ||
    !pin ||
    pin.capabilityKey !== "artifact.ci-read" ||
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
    throw new GitLabResultNormalizationError("GITLAB_RESULT_CONTEXT_INVALID");
}

function observedSchemaRef(schemaVersion: unknown, contentHash: Sha256Digest): SchemaReference {
  const version =
    typeof schemaVersion === "string"
      ? /^gitlab-pipeline-result@(\d+)\./u.exec(schemaVersion)
      : null;
  return deepFreeze({
    id: version
      ? "urn:awp:schemas:005:gitlab-pipeline-result:v1"
      : "urn:awp:schemas:005:gitlab-pipeline-result:unknown",
    version: version ? Number(version[1]) : 1,
    digest: contentHash,
  });
}

function incomplete(
  expectedSchemaRef: SchemaReference,
  sourceResultArtifactRef: string,
  issue: GitLabResultNormalizationIssue,
  status: "INVALID" | "MISSING",
  details: Readonly<{ resultContentHash?: Sha256Digest; observedSchemaRef?: SchemaReference }> = {},
): GitLabResultNormalization {
  return deepFreeze({
    normalizationKind: "SYNTHETIC_INCOMPLETE" as const,
    normalizationStatus: status,
    issueCodes: Object.freeze([issue]),
    syntheticReasonCode: issue,
    outcome: "INCOMPLETE" as const,
    expectedSchemaRef,
    sourceResultArtifactRef,
    ...details,
  });
}

function decode(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      text.charCodeAt(0) === 0xfeff ||
      new TextEncoder().encode(text).byteLength !== bytes.byteLength
    )
      return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedResult(value: unknown): GitLabMachineResult {
  const source = value as GitLabMachineResult;
  return deepFreeze({
    ...structuredClone(source),
    ...(source.summary === undefined ? {} : { summary: deepFreeze({ ...source.summary }) }),
    artifacts: Object.freeze(source.artifacts.map((artifact) => deepFreeze({ ...artifact }))),
  });
}

export function normalizeGitLabMachineResult(
  input: Readonly<{
    profile: GitLabProfileConfiguration;
    request: GitLabResultNormalizationRequest;
    bytes: Uint8Array;
    observedAt: Date;
  }>,
): GitLabResultNormalization {
  const { profile, request, bytes, observedAt } = input;
  const expectedSchemaRef = profile.resultContract.schemaRef;
  if (!request.automationAttemptId || !request.sourceResultArtifactRef)
    throw new GitLabResultNormalizationError("GITLAB_RESULT_REQUEST_INVALID");
  const pipelineId = numericId(request.externalPipelineId, "GITLAB_RESULT_PIPELINE_ID_INVALID");
  const jobId = numericId(request.externalJobId, "GITLAB_RESULT_JOB_ID_INVALID");
  exactSuite(profile, request.authority.suiteKey, request.authority.environmentRef);
  if (
    !isGitLabSha256(request.authority.requestMarkerHash) ||
    (request.authority.expectedResultChecksum !== undefined &&
      !isGitLabSha256(request.authority.expectedResultChecksum)) ||
    !/^[a-f0-9]{40}$/u.test(request.authority.sourceCommitSha) ||
    !request.authority.buildRef
  )
    throw new GitLabResultNormalizationError("GITLAB_RESULT_AUTHORITY_INVALID");
  if (bytes.byteLength > profile.resultContract.maxBytes)
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_TOO_LARGE",
      "INVALID",
    );
  const raw = decode(bytes);
  if (raw === undefined)
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_SCHEMA_UNKNOWN",
      "INVALID",
    );
  const resultContentHash = sha256(raw);
  if (
    request.authority.expectedResultChecksum !== undefined &&
    resultContentHash !== request.authority.expectedResultChecksum
  ) {
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "ARTIFACT_CHECKSUM_MISMATCH",
      "INVALID",
      { resultContentHash },
    );
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_SCHEMA_UNKNOWN",
      "INVALID",
      { resultContentHash },
    );
  }
  const version = isRecord(candidate) ? candidate.schemaVersion : undefined;
  const observed = observedSchemaRef(version, resultContentHash);
  if (version !== "gitlab-pipeline-result@1.0.0") {
    const issue =
      typeof version === "string" && version.startsWith("gitlab-pipeline-result@")
        ? "RESULT_SCHEMA_DRIFT"
        : "RESULT_SCHEMA_UNKNOWN";
    return incomplete(expectedSchemaRef, request.sourceResultArtifactRef, issue, "INVALID", {
      resultContentHash,
      observedSchemaRef: observed,
    });
  }
  try {
    if (
      expectedSchemaRef.id !== "urn:awp:schemas:005:gitlab-pipeline-result:v1" ||
      expectedSchemaRef.version !== 1 ||
      expectedSchemaRef.digest !== designContractRegistry.digest(expectedSchemaRef.id)
    )
      return incomplete(
        expectedSchemaRef,
        request.sourceResultArtifactRef,
        "RESULT_SCHEMA_DRIFT",
        "INVALID",
        { resultContentHash, observedSchemaRef: observed },
      );
    designContractRegistry.validate({
      schemaRef: expectedSchemaRef,
      value: candidate as JsonValue,
    });
  } catch (error) {
    if (error instanceof SchemaValidationError || error instanceof Error) {
      return incomplete(
        expectedSchemaRef,
        request.sourceResultArtifactRef,
        "RESULT_SCHEMA_DRIFT",
        "INVALID",
        { resultContentHash, observedSchemaRef: observed },
      );
    }
    throw error;
  }
  const result = normalizedResult(candidate);
  if (
    result.requestMarkerHash !== request.authority.requestMarkerHash ||
    result.pipelineId !== pipelineId ||
    result.jobId !== jobId ||
    result.suiteKey !== request.authority.suiteKey ||
    result.environmentRef !== request.authority.environmentRef
  )
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_SCOPE_MISMATCH",
      "INVALID",
      { resultContentHash },
    );
  if (
    result.commitSha !== request.authority.sourceCommitSha ||
    result.buildRef !== request.authority.buildRef
  ) {
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_TARGET_MISMATCH",
      "INVALID",
      { resultContentHash },
    );
  }
  if (
    result.artifacts.some(
      ({ byteSize, classification }) =>
        byteSize > profile.artifactPolicy.maxArtifactBytes ||
        !profile.artifactPolicy.allowedClassifications.includes(classification),
    )
  ) {
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "RESULT_SCOPE_MISMATCH",
      "INVALID",
      { resultContentHash },
    );
  }
  if (result.artifacts.some(({ expiresAt }) => Date.parse(expiresAt) <= observedAt.getTime())) {
    return incomplete(
      expectedSchemaRef,
      request.sourceResultArtifactRef,
      "ARTIFACT_EXPIRED",
      "INVALID",
      { resultContentHash },
    );
  }
  return deepFreeze({
    normalizationKind: "SCHEMA_VALIDATED" as const,
    normalizationStatus: "VALID" as const,
    issueCodes: Object.freeze([]) as readonly [],
    outcome: result.outcome,
    expectedSchemaRef,
    sourceResultArtifactRef: request.sourceResultArtifactRef,
    resultContentHash,
    result,
  });
}

export class GitLabResultNormalizer {
  constructor(private readonly options: GitLabResultNormalizerOptions) {}

  async downloadAndNormalize(
    context: TrustedConnectorOperationContext,
    request: GitLabResultNormalizationRequest,
  ): Promise<GitLabResultNormalization> {
    const observedAt = this.options.clock.now();
    assertArtifactContext(context, observedAt);
    numericId(request.externalPipelineId, "GITLAB_RESULT_PIPELINE_ID_INVALID");
    const jobId = numericId(request.externalJobId, "GITLAB_RESULT_JOB_ID_INVALID");
    const suite = exactSuite(
      this.options.profile,
      request.authority.suiteKey,
      request.authority.environmentRef,
    );
    const path = `${this.options.dialect.jobArtifactsPath(this.options.profile.numericGitLabProjectId, String(jobId))}?artifact_path=${encodeURIComponent(suite.resultArtifactPath)}`;
    let response: Response;
    try {
      response = await this.options.client.request({
        operation: "artifact.result-read",
        authOperation: "artifactStream",
        method: "GET",
        path,
        signal: context.signal,
      });
    } catch (error) {
      if (error instanceof GitLabTransportError && error.status === 404) {
        return incomplete(
          this.options.profile.resultContract.schemaRef,
          request.sourceResultArtifactRef,
          "RESULT_MISSING",
          "MISSING",
        );
      }
      if (error instanceof GitLabTransportError && error.code === "GITLAB_RESPONSE_TOO_LARGE") {
        return incomplete(
          this.options.profile.resultContract.schemaRef,
          request.sourceResultArtifactRef,
          "RESULT_TOO_LARGE",
          "INVALID",
        );
      }
      throw error;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(contentType)) {
      return incomplete(
        this.options.profile.resultContract.schemaRef,
        request.sourceResultArtifactRef,
        "RESULT_SCHEMA_UNKNOWN",
        "INVALID",
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.options.profile.resultContract.maxBytes
    ) {
      return incomplete(
        this.options.profile.resultContract.schemaRef,
        request.sourceResultArtifactRef,
        "RESULT_TOO_LARGE",
        "INVALID",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.options.profile.resultContract.maxBytes) {
      return incomplete(
        this.options.profile.resultContract.schemaRef,
        request.sourceResultArtifactRef,
        "RESULT_TOO_LARGE",
        "INVALID",
      );
    }
    const headerChecksum = response.headers.get("x-awp-checksum") ?? undefined;
    const expectedResultChecksum =
      request.authority.expectedResultChecksum ??
      (headerChecksum && isGitLabSha256(headerChecksum) ? headerChecksum : undefined);
    return normalizeGitLabMachineResult({
      profile: this.options.profile,
      request: deepFreeze({
        ...request,
        authority: deepFreeze({
          ...request.authority,
          ...(expectedResultChecksum === undefined ? {} : { expectedResultChecksum }),
        }),
      }),
      bytes,
      observedAt,
    });
  }
}

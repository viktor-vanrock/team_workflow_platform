import { createHash } from "node:crypto";

import type {
  CiArtifactAvailability,
  CiArtifactDescriptor,
  CiArtifactKind,
  CiArtifactMetadataRequest,
  CiArtifactPort,
  CiArtifactStream,
  CiArtifactStreamRequest,
  TrustedConnectorExactReference,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import { GitLabRestClient, GitLabTransportError } from "../http/gitlab-rest-client.ts";
import { isGitLabSha256 } from "../pipeline/gitlab-pipeline-trigger.ts";
import type { GitLabDialect } from "../profile/gitlab-dialect.ts";
import type { GitLabProfileConfiguration } from "../profile/gitlab-profile-validator.ts";

export interface GitLabArtifactAuthority {
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly automationAttemptId: string;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly logicalArtifactKey: string;
  readonly resultHash: Sha256Digest;
  readonly artifactPath: string;
  readonly artifactKind: CiArtifactKind;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: Sha256Digest;
  readonly classification: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface GitLabArtifactStreamAuthority extends GitLabArtifactAuthority {
  readonly artifactReferenceId: string;
  readonly descriptorId: string;
  readonly descriptorHash: Sha256Digest;
}

export interface GitLabCiArtifactHandlerOptions {
  readonly client: GitLabRestClient;
  readonly dialect: GitLabDialect;
  readonly profile: GitLabProfileConfiguration;
  readonly clock: GitLabClock;
  readonly metadataAuthority: (request: CiArtifactMetadataRequest) => GitLabArtifactAuthority;
  readonly streamAuthority: (request: CiArtifactStreamRequest) => GitLabArtifactStreamAuthority;
}

export class GitLabCiArtifactError extends Error {
  constructor(
    readonly code: string,
    readonly availability?: Exclude<CiArtifactAvailability, "AVAILABLE">,
  ) {
    super(code);
    this.name = "GitLabCiArtifactError";
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return value;
  if (value instanceof ReadableStream) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function bytesHash(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function uuidFromHash(hash: Sha256Digest): string {
  const hex = hash.slice("sha256:".length);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function numericId(value: string, code: string): string {
  if (!/^[1-9][0-9]{0,17}$/u.test(value) || !Number.isSafeInteger(Number(value)))
    throw new GitLabCiArtifactError(code);
  return value;
}

function timestamp(value: string, code: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new GitLabCiArtifactError(code);
  return parsed.toISOString();
}

function assertPath(value: string): void {
  if (!/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,512}$/u.test(value))
    throw new GitLabCiArtifactError("GITLAB_ARTIFACT_PATH_INVALID");
}

function artifactProfilePin(
  context: TrustedConnectorOperationContext,
  now: Date,
): TrustedConnectorExactReference {
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
    throw new GitLabCiArtifactError("GITLAB_ARTIFACT_CONTEXT_INVALID");
  return pin.profileRef;
}

function assertAuthority(
  profile: GitLabProfileConfiguration,
  authority: GitLabArtifactAuthority,
): void {
  numericId(authority.externalPipelineId, "GITLAB_ARTIFACT_PIPELINE_ID_INVALID");
  numericId(authority.externalJobId, "GITLAB_ARTIFACT_JOB_ID_INVALID");
  assertPath(authority.artifactPath);
  if (
    [
      authority.workItemId,
      authority.testSessionId,
      authority.automationAttemptId,
      authority.logicalArtifactKey,
      authority.fileName,
      authority.mediaType,
    ].some((value) => !value) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(authority.logicalArtifactKey) ||
    !/^[A-Za-z0-9._-]{1,255}$/u.test(authority.fileName) ||
    authority.mediaType.length > 128 ||
    !Number.isSafeInteger(authority.byteSize) ||
    authority.byteSize < 0 ||
    authority.byteSize > profile.artifactPolicy.maxArtifactBytes ||
    !isGitLabSha256(authority.resultHash) ||
    !isGitLabSha256(authority.checksum) ||
    !profile.artifactPolicy.allowedClassifications.includes(authority.classification) ||
    timestamp(authority.createdAt, "GITLAB_ARTIFACT_CREATED_AT_INVALID") >
      timestamp(authority.expiresAt, "GITLAB_ARTIFACT_EXPIRES_AT_INVALID")
  )
    throw new GitLabCiArtifactError("GITLAB_ARTIFACT_AUTHORITY_INVALID");
}

function assertMetadataRequest(
  request: CiArtifactMetadataRequest,
  authority: GitLabArtifactAuthority,
): void {
  if (
    request.schemaVersion !== "artifact.ci-read@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "artifact.metadata" ||
    request.automationAttemptId !== authority.automationAttemptId ||
    request.externalPipelineId !== authority.externalPipelineId ||
    request.externalJobId !== authority.externalJobId ||
    request.logicalArtifactKey !== authority.logicalArtifactKey ||
    request.resultHash !== authority.resultHash
  )
    throw new GitLabCiArtifactError("GITLAB_ARTIFACT_METADATA_REQUEST_INVALID");
}

function assertStreamRequest(
  request: CiArtifactStreamRequest,
  authority: GitLabArtifactStreamAuthority,
): void {
  if (
    request.schemaVersion !== "artifact.ci-read@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "artifact.stream" ||
    request.artifactReferenceId !== authority.artifactReferenceId ||
    request.descriptorId !== authority.descriptorId ||
    request.descriptorHash !== authority.descriptorHash ||
    request.expectedByteSize !== authority.byteSize ||
    request.expectedChecksum !== authority.checksum ||
    request.expectedClassification !== authority.classification
  )
    throw new GitLabCiArtifactError("GITLAB_ARTIFACT_STREAM_REQUEST_INVALID");
}

function artifactPath(
  options: GitLabCiArtifactHandlerOptions,
  authority: GitLabArtifactAuthority,
): string {
  return `${options.dialect.jobArtifactsPath(options.profile.numericGitLabProjectId, authority.externalJobId)}?artifact_path=${encodeURIComponent(authority.artifactPath)}`;
}

function locatorHash(
  options: GitLabCiArtifactHandlerOptions,
  authority: GitLabArtifactAuthority,
): Sha256Digest {
  return sha256({
    adapter: options.dialect.adapterFamily,
    exactVersion: options.dialect.exactVersion,
    numericProjectId: options.profile.numericGitLabProjectId,
    externalPipelineId: authority.externalPipelineId,
    externalJobId: authority.externalJobId,
    artifactPath: authority.artifactPath,
  } as unknown as JsonValue);
}

function checksumSource(
  kind: CiArtifactKind,
): "MACHINE_RESULT_MANIFEST" | "CONNECTOR_CONTENT_SHA256" {
  return kind === "RESULT" ? "CONNECTOR_CONTENT_SHA256" : "MACHINE_RESULT_MANIFEST";
}

async function providerResponse(
  options: GitLabCiArtifactHandlerOptions,
  context: TrustedConnectorOperationContext,
  authority: GitLabArtifactAuthority,
): Promise<Response | undefined> {
  try {
    return await options.client.request({
      operation: "artifact.read",
      authOperation: "artifactStream",
      method: "GET",
      path: artifactPath(options, authority),
      signal: context.signal,
      maxResponseBytes: options.profile.artifactPolicy.maxArtifactBytes,
    });
  } catch (error) {
    if (error instanceof GitLabTransportError && error.status === 404) return undefined;
    throw error;
  }
}

export class GitLabCiArtifactHandler implements CiArtifactPort {
  constructor(private readonly options: GitLabCiArtifactHandlerOptions) {
    if (
      !Number.isSafeInteger(options.profile.numericGitLabProjectId) ||
      options.profile.numericGitLabProjectId < 1 ||
      !options.profile.productionDenied
    ) {
      throw new GitLabCiArtifactError("GITLAB_ARTIFACT_PROFILE_INVALID");
    }
  }

  async metadata(
    context: TrustedConnectorOperationContext,
    request: CiArtifactMetadataRequest,
  ): Promise<CiArtifactDescriptor> {
    const observedAt = this.options.clock.now();
    const sourceProfileRef = artifactProfilePin(context, observedAt);
    const authority = deepFreeze(structuredClone(this.options.metadataAuthority(request)));
    assertAuthority(this.options.profile, authority);
    assertMetadataRequest(request, authority);
    let availability: CiArtifactAvailability;
    if (Date.parse(authority.expiresAt) <= observedAt.getTime()) availability = "EXPIRED";
    else {
      const response = await providerResponse(this.options, context, authority);
      if (!response) availability = "MISSING";
      else {
        const declaredLength = response.headers.get("content-length");
        availability =
          declaredLength !== null && Number(declaredLength) !== authority.byteSize
            ? "CHECKSUM_MISMATCH"
            : "AVAILABLE";
        await response.body?.cancel();
      }
    }
    const opaqueLocatorHash = locatorHash(this.options, authority);
    const provenanceHash = sha256({
      workspaceId: context.scope.workspaceId,
      projectId: context.scope.projectId,
      numericProjectId: this.options.profile.numericGitLabProjectId,
      automationAttemptId: authority.automationAttemptId,
      resultHash: authority.resultHash,
      opaqueLocatorHash,
      sourceProfileRef,
      sourceProfileHash: sourceProfileRef.contentHash,
    } as unknown as JsonValue);
    const descriptorId = uuidFromHash(
      sha256({ provenanceHash, logicalArtifactKey: authority.logicalArtifactKey }),
    );
    const body = deepFreeze({
      schemaVersion: "artifact.ci-read@1.0.0" as const,
      messageType: "RESULT" as const,
      operation: "artifact.metadata" as const,
      descriptorId,
      workItemId: authority.workItemId,
      testSessionId: authority.testSessionId,
      automationAttemptId: authority.automationAttemptId,
      externalPipelineId: authority.externalPipelineId,
      externalJobId: authority.externalJobId,
      artifactKind: authority.artifactKind,
      opaqueLocatorHash,
      fileName: authority.fileName,
      mediaType: authority.mediaType,
      byteSize: authority.byteSize,
      checksum: authority.checksum,
      checksumSource: checksumSource(authority.artifactKind),
      classification: authority.classification,
      availability,
      sourceProfileRef: { id: sourceProfileRef.id, version: sourceProfileRef.version },
      sourceProfileHash: sourceProfileRef.contentHash,
      createdAt: timestamp(authority.createdAt, "GITLAB_ARTIFACT_CREATED_AT_INVALID"),
      expiresAt: timestamp(authority.expiresAt, "GITLAB_ARTIFACT_EXPIRES_AT_INVALID"),
      provenanceHash,
    });
    return deepFreeze({ ...body, descriptorHash: sha256(body as unknown as JsonValue) });
  }

  async stream(
    context: TrustedConnectorOperationContext,
    request: CiArtifactStreamRequest,
  ): Promise<CiArtifactStream> {
    const verifiedAt = this.options.clock.now();
    artifactProfilePin(context, verifiedAt);
    const authority = deepFreeze(structuredClone(this.options.streamAuthority(request)));
    assertAuthority(this.options.profile, authority);
    assertStreamRequest(request, authority);
    if (Date.parse(authority.expiresAt) <= verifiedAt.getTime())
      throw new GitLabCiArtifactError("GITLAB_ARTIFACT_EXPIRED", "EXPIRED");
    const response = await providerResponse(this.options, context, authority);
    if (!response) throw new GitLabCiArtifactError("GITLAB_ARTIFACT_MISSING", "MISSING");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const checksum = bytesHash(bytes);
    if (bytes.byteLength !== authority.byteSize || checksum !== authority.checksum) {
      throw new GitLabCiArtifactError("GITLAB_ARTIFACT_CHECKSUM_MISMATCH", "CHECKSUM_MISMATCH");
    }
    const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (responseType && responseType !== authority.mediaType)
      throw new GitLabCiArtifactError("GITLAB_ARTIFACT_MEDIA_TYPE_MISMATCH", "CHECKSUM_MISMATCH");
    const metadataBody = deepFreeze({
      schemaVersion: "artifact.ci-read@1.0.0" as const,
      messageType: "RESULT" as const,
      operation: "artifact.stream" as const,
      artifactReferenceId: request.artifactReferenceId,
      mediaType: authority.mediaType,
      byteSize: bytes.byteLength,
      checksum,
      checksumSource: checksumSource(authority.artifactKind),
      classification: authority.classification,
      availability: "AVAILABLE" as const,
      verifiedAt: verifiedAt.toISOString(),
    });
    const metadata = deepFreeze({
      ...metadataBody,
      streamReceiptHash: sha256({
        ...metadataBody,
        descriptorId: authority.descriptorId,
        descriptorHash: authority.descriptorHash,
        opaqueLocatorHash: locatorHash(this.options, authority),
        authorizationBasisHash: context.authorizationBasisHash,
      } as unknown as JsonValue),
    });
    const streamBytes = bytes.slice();
    return Object.freeze({
      metadata,
      bytes: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(streamBytes);
          controller.close();
        },
      }),
    });
  }
}

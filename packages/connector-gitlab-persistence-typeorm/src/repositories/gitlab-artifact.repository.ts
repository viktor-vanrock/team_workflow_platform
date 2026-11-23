import { createHash } from "node:crypto";

import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import {
  frozenRows,
  type GitLabQueryExecutor,
  gitLabRows,
  type GitLabWorkspaceProjectScope,
} from "./repository-helpers.ts";

export type GitLabArtifactLocatorAvailability =
  "AVAILABLE" | "EXPIRED" | "MISSING" | "CHECKSUM_MISMATCH";
export type GitLabArtifactStreamOutcome =
  "STREAMED" | "EXPIRED" | "MISSING" | "CHECKSUM_MISMATCH" | "DENIED" | "PROVIDER_ERROR";

export interface GitLabArtifactLocatorRevisionInput {
  readonly artifactLocatorRevisionId: string;
  readonly scope: GitLabWorkspaceProjectScope;
  readonly coreArtifactReferenceId: string;
  readonly connectionHeaderId: string;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly artifactPathHash: Sha256Digest;
  readonly sealedLocator: Uint8Array;
  readonly checksum: Sha256Digest;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly artifactKind: "RESULT" | "REPORT" | "LOG" | "SCREENSHOT" | "TRACE" | "OTHER";
  readonly classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly providerExpiresAt: string;
  readonly descriptorHash: Sha256Digest;
  readonly availability: GitLabArtifactLocatorAvailability;
  readonly observedAt: string;
  readonly previousRevisionId?: string;
}

export interface GitLabArtifactStreamReceiptInput {
  readonly artifactStreamReceiptId: string;
  readonly scope: GitLabWorkspaceProjectScope;
  readonly authorizedRequestRef: Readonly<{
    id: string;
    version: number;
    contentHash: Sha256Digest;
  }>;
  readonly artifactLocatorRevisionId: string;
  readonly streamedChecksum?: Sha256Digest;
  readonly streamedBytes?: number;
  readonly outcome: GitLabArtifactStreamOutcome;
  readonly errorCode?: string;
  readonly correlationId: string;
  readonly streamedAt: string;
}

export class GitLabArtifactPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabArtifactPersistenceError";
  }
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return gitLabRows<Record<string, unknown>>(value);
}

function jsonValue(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function hash(value: string): value is Sha256Digest {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function sealedHash(value: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function timestamp(value: string, code: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new GitLabArtifactPersistenceError(code);
  return parsed.toISOString();
}

function publicLocator(row: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...row,
    connection_ref: jsonValue(row.connection_ref),
    profile_ref: jsonValue(row.profile_ref),
    sealed_locator: "[SEALED]",
  });
}

function assertScope(scope: GitLabWorkspaceProjectScope): void {
  if (
    !scope.workspaceId ||
    !Number.isSafeInteger(scope.numericProjectId) ||
    scope.numericProjectId < 1
  )
    throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_SCOPE_INVALID");
}

function sameImmutableDescriptor(
  previous: Record<string, unknown>,
  input: GitLabArtifactLocatorRevisionInput,
): boolean {
  const connection = jsonValue(previous.connection_ref);
  const profile = jsonValue(previous.profile_ref);
  return (
    String(previous.core_artifact_reference_id) === input.coreArtifactReferenceId &&
    String(previous.connection_header_id) === input.connectionHeaderId &&
    JSON.stringify(connection) === JSON.stringify(input.connectionRef) &&
    JSON.stringify(profile) === JSON.stringify(input.profileRef) &&
    Number(previous.numeric_project_id) === input.scope.numericProjectId &&
    String(previous.external_pipeline_id) === input.externalPipelineId &&
    String(previous.external_job_id) === input.externalJobId &&
    String(previous.artifact_path_hash) === input.artifactPathHash &&
    String(previous.checksum) === input.checksum &&
    Number(previous.byte_size) === input.byteSize &&
    String(previous.media_type) === input.mediaType &&
    String(previous.artifact_kind) === input.artifactKind &&
    String(previous.classification) === input.classification &&
    new Date(String(previous.provider_expires_at)).toISOString() ===
      timestamp(input.providerExpiresAt, "GITLAB_ARTIFACT_EXPIRY_INVALID") &&
    String(previous.descriptor_hash) === input.descriptorHash
  );
}

export class TypeOrmGitLabArtifactRepository {
  constructor(private readonly source: GitLabQueryExecutor) {}

  async latestLocator(
    scope: GitLabWorkspaceProjectScope,
    artifactReferenceId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    assertScope(scope);
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_artifact_locator_revisions
WHERE workspace_id=$1 AND numeric_project_id=$2 AND core_artifact_reference_id=$3
ORDER BY observed_at DESC,artifact_locator_revision_id DESC LIMIT 1`,
        [scope.workspaceId, scope.numericProjectId, artifactReferenceId],
      ),
    );
    return rows[0] === undefined ? undefined : publicLocator(rows[0]);
  }

  async locatorHistory(
    scope: GitLabWorkspaceProjectScope,
    artifactReferenceId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    assertScope(scope);
    const rows = await this.source.query(
      `
SELECT artifact_locator_revision_id,workspace_id,core_artifact_reference_id,connection_header_id,profile_ref,
       numeric_project_id,external_pipeline_id,external_job_id,artifact_path_hash,checksum,byte_size,media_type,
       artifact_kind,classification,provider_expires_at,descriptor_hash,content_hash,availability,observed_at,previous_revision_id
FROM gitlab_artifact_locator_revisions
WHERE workspace_id=$1 AND numeric_project_id=$2 AND core_artifact_reference_id=$3
ORDER BY observed_at,artifact_locator_revision_id`,
      [scope.workspaceId, scope.numericProjectId, artifactReferenceId],
    );
    return frozenRows(rows);
  }

  async streamReceipts(
    scope: GitLabWorkspaceProjectScope,
    artifactLocatorRevisionId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    assertScope(scope);
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_artifact_stream_receipts
WHERE workspace_id=$1 AND artifact_locator_revision_id=$2
ORDER BY streamed_at,artifact_stream_receipt_id`,
        [scope.workspaceId, artifactLocatorRevisionId],
      ),
    );
  }

  async appendLocatorRevision(
    input: GitLabArtifactLocatorRevisionInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertScope(input.scope);
    const providerExpiresAt = timestamp(input.providerExpiresAt, "GITLAB_ARTIFACT_EXPIRY_INVALID");
    const observedAt = timestamp(input.observedAt, "GITLAB_ARTIFACT_OBSERVED_AT_INVALID");
    if (
      !input.artifactLocatorRevisionId ||
      !input.coreArtifactReferenceId ||
      !input.connectionHeaderId ||
      !input.connectionRef.id ||
      input.connectionRef.version < 1 ||
      !hash(input.connectionRef.contentHash) ||
      !input.profileRef.id ||
      input.profileRef.version < 1 ||
      !hash(input.profileRef.contentHash) ||
      !input.externalPipelineId ||
      !input.externalJobId ||
      !hash(input.artifactPathHash) ||
      !hash(input.checksum) ||
      !hash(input.descriptorHash) ||
      !(input.sealedLocator instanceof Uint8Array) ||
      input.sealedLocator.byteLength < 16 ||
      input.sealedLocator.byteLength > 4096 ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      input.byteSize > 104_857_600 ||
      !input.mediaType ||
      input.mediaType.length > 128
    )
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_INVALID");
    const content = Object.freeze({
      workspaceId: input.scope.workspaceId,
      numericProjectId: input.scope.numericProjectId,
      coreArtifactReferenceId: input.coreArtifactReferenceId,
      connectionHeaderId: input.connectionHeaderId,
      connectionRef: input.connectionRef,
      profileRef: input.profileRef,
      externalPipelineId: input.externalPipelineId,
      externalJobId: input.externalJobId,
      artifactPathHash: input.artifactPathHash,
      sealedLocatorHash: sealedHash(input.sealedLocator),
      checksum: input.checksum,
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      artifactKind: input.artifactKind,
      classification: input.classification,
      providerExpiresAt,
      descriptorHash: input.descriptorHash,
      availability: input.availability,
      observedAt,
      ...(input.previousRevisionId === undefined
        ? {}
        : { previousRevisionId: input.previousRevisionId }),
    });
    const contentHash = sha256(content as unknown as JsonValue);
    const existingById = rows(
      await this.source.query(
        "SELECT * FROM gitlab_artifact_locator_revisions WHERE workspace_id=$1 AND artifact_locator_revision_id=$2",
        [input.scope.workspaceId, input.artifactLocatorRevisionId],
      ),
    );
    if (existingById[0]) {
      if (String(existingById[0].content_hash) !== contentHash)
        throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_ID_CONFLICT");
      return publicLocator(existingById[0]);
    }
    const latest = rows(
      await this.source.query(
        `
SELECT * FROM gitlab_artifact_locator_revisions
WHERE workspace_id=$1 AND numeric_project_id=$2 AND core_artifact_reference_id=$3
ORDER BY observed_at DESC,artifact_locator_revision_id DESC LIMIT 1`,
        [input.scope.workspaceId, input.scope.numericProjectId, input.coreArtifactReferenceId],
      ),
    )[0];
    if ((latest === undefined) !== (input.previousRevisionId === undefined))
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_PREDECESSOR_REQUIRED");
    if (latest !== undefined) {
      if (input.previousRevisionId !== String(latest.artifact_locator_revision_id))
        throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_PREDECESSOR_STALE");
      if (!sameImmutableDescriptor(latest, input))
        throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_DESCRIPTOR_IMMUTABLE");
      if (Date.parse(observedAt) < Date.parse(String(latest.observed_at)))
        throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_OBSERVATION_REGRESSION");
    }
    const duplicate = rows(
      await this.source.query(
        "SELECT * FROM gitlab_artifact_locator_revisions WHERE workspace_id=$1 AND core_artifact_reference_id=$2 AND content_hash=$3",
        [input.scope.workspaceId, input.coreArtifactReferenceId, contentHash],
      ),
    )[0];
    if (duplicate) return publicLocator(duplicate);
    const inserted = rows(
      await this.source.query(
        `
INSERT INTO gitlab_artifact_locator_revisions(
  artifact_locator_revision_id,workspace_id,core_artifact_reference_id,connection_header_id,connection_ref,profile_ref,
  numeric_project_id,external_pipeline_id,external_job_id,artifact_path_hash,sealed_locator,checksum,byte_size,media_type,
  artifact_kind,classification,provider_expires_at,descriptor_hash,content_hash,availability,observed_at,previous_revision_id
) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
RETURNING *`,
        [
          input.artifactLocatorRevisionId,
          input.scope.workspaceId,
          input.coreArtifactReferenceId,
          input.connectionHeaderId,
          JSON.stringify(input.connectionRef),
          JSON.stringify(input.profileRef),
          input.scope.numericProjectId,
          input.externalPipelineId,
          input.externalJobId,
          input.artifactPathHash,
          Buffer.from(input.sealedLocator),
          input.checksum,
          input.byteSize,
          input.mediaType,
          input.artifactKind,
          input.classification,
          providerExpiresAt,
          input.descriptorHash,
          contentHash,
          input.availability,
          observedAt,
          input.previousRevisionId ?? null,
        ],
      ),
    )[0];
    if (!inserted)
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_INSERT_FAILED");
    return publicLocator(inserted);
  }

  async appendStreamReceipt(
    input: GitLabArtifactStreamReceiptInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    assertScope(input.scope);
    const streamedAt = timestamp(input.streamedAt, "GITLAB_ARTIFACT_STREAM_TIME_INVALID");
    const streamed = input.outcome === "STREAMED";
    if (
      !input.artifactStreamReceiptId ||
      !input.authorizedRequestRef.id ||
      input.authorizedRequestRef.version < 1 ||
      !hash(input.authorizedRequestRef.contentHash) ||
      !input.artifactLocatorRevisionId ||
      !input.correlationId ||
      streamed !==
        (input.streamedChecksum !== undefined &&
          input.streamedBytes !== undefined &&
          input.errorCode === undefined) ||
      (!streamed && !input.errorCode) ||
      (input.streamedChecksum !== undefined && !hash(input.streamedChecksum)) ||
      (input.streamedBytes !== undefined &&
        (!Number.isSafeInteger(input.streamedBytes) ||
          input.streamedBytes < 0 ||
          input.streamedBytes > 104_857_600))
    )
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_STREAM_RECEIPT_INVALID");
    const locator = rows(
      await this.source.query(
        "SELECT * FROM gitlab_artifact_locator_revisions WHERE workspace_id=$1 AND numeric_project_id=$2 AND artifact_locator_revision_id=$3",
        [input.scope.workspaceId, input.scope.numericProjectId, input.artifactLocatorRevisionId],
      ),
    )[0];
    if (!locator) throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_LOCATOR_NOT_FOUND");
    if (
      streamed &&
      (input.streamedChecksum !== String(locator.checksum) ||
        input.streamedBytes !== Number(locator.byte_size))
    ) {
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_STREAM_DESCRIPTOR_MISMATCH");
    }
    const content = Object.freeze({
      workspaceId: input.scope.workspaceId,
      authorizedRequestRef: input.authorizedRequestRef,
      artifactLocatorRevisionId: input.artifactLocatorRevisionId,
      ...(input.streamedChecksum === undefined ? {} : { streamedChecksum: input.streamedChecksum }),
      ...(input.streamedBytes === undefined ? {} : { streamedBytes: input.streamedBytes }),
      outcome: input.outcome,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      correlationId: input.correlationId,
      streamedAt,
    });
    const contentHash = sha256(content as unknown as JsonValue);
    const existing = rows(
      await this.source.query(
        "SELECT * FROM gitlab_artifact_stream_receipts WHERE workspace_id=$1 AND artifact_stream_receipt_id=$2",
        [input.scope.workspaceId, input.artifactStreamReceiptId],
      ),
    )[0];
    if (existing) {
      if (String(existing.content_hash) !== contentHash)
        throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_STREAM_RECEIPT_ID_CONFLICT");
      return Object.freeze({
        ...existing,
        authorized_request_ref: jsonValue(existing.authorized_request_ref),
      });
    }
    const inserted = rows(
      await this.source.query(
        `
INSERT INTO gitlab_artifact_stream_receipts(
  artifact_stream_receipt_id,workspace_id,authorized_request_ref,artifact_locator_revision_id,streamed_checksum,
  streamed_bytes,outcome,error_code,correlation_id,content_hash,streamed_at
) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          input.artifactStreamReceiptId,
          input.scope.workspaceId,
          JSON.stringify(input.authorizedRequestRef),
          input.artifactLocatorRevisionId,
          input.streamedChecksum ?? null,
          input.streamedBytes ?? null,
          input.outcome,
          input.errorCode ?? null,
          input.correlationId,
          contentHash,
          streamedAt,
        ],
      ),
    )[0];
    if (!inserted)
      throw new GitLabArtifactPersistenceError("GITLAB_ARTIFACT_STREAM_RECEIPT_INSERT_FAILED");
    return Object.freeze({
      ...inserted,
      authorized_request_ref: jsonValue(inserted.authorized_request_ref),
    });
  }
}

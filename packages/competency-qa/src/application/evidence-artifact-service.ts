import { createHash, randomUUID } from "node:crypto";

import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import { assertEvidenceUploadAllowed } from "../rules/evidence-policy.v1.ts";

export type QaEvidenceOwner = Readonly<{
  ownerType: "SESSION" | "PLAN_ITEM" | "ATTEMPT" | "OBSERVATION" | "FINDING";
  ownerId: string;
}>;
export type QaEvidenceAvailability = "AVAILABLE" | "EXPIRED";

export interface QaEvidenceArtifactLink {
  readonly evidenceArtifactLinkId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly owner: QaEvidenceOwner;
  readonly artifactReferenceId: string;
  readonly checksum: `sha256:${string}`;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly dataClassificationKey: string;
  readonly availability: QaEvidenceAvailability;
  readonly availabilityAtSigning: "AVAILABLE";
  readonly attachedBy: string;
  readonly finalizedAt: string;
}

interface AttachmentSession {
  readonly id: string;
  readonly contentUploadRef: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly owner: QaEvidenceOwner;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly dataClassificationKey: string;
  readonly actorId: string;
  readonly state: "AUTHORIZED" | "UPLOADED" | "FINALIZED";
  readonly resourceVersion: number;
  readonly bytes?: Uint8Array;
  readonly checksum?: `sha256:${string}`;
}

const etag = (version: number) => `W/"${version}"`;
const expected = (value: string): number => {
  const match = /^W\/"([1-9][0-9]*)"$/.exec(value);
  if (!match) throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_ETAG_REQUIRED");
  return Number(match[1]);
};
const checksum = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class InMemoryQaEvidenceArtifactService {
  readonly #attachments = new Map<string, AttachmentSession>();
  readonly #links = new Map<string, QaEvidenceArtifactLink>();

  async initiate(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      owner: QaEvidenceOwner;
      mediaType: string;
      sizeBytes: number;
      dataClassificationKey: string;
      actorId: string;
    }>,
  ) {
    assertEvidenceUploadAllowed(input.mediaType, input.sizeBytes);
    const attachment: AttachmentSession = Object.freeze({
      id: randomUUID(),
      contentUploadRef: randomUUID(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      owner: input.owner,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      dataClassificationKey: input.dataClassificationKey,
      actorId: input.actorId,
      state: "AUTHORIZED",
      resourceVersion: 1,
    });
    this.#attachments.set(attachment.contentUploadRef, attachment);
    return Object.freeze({ attachment: this.#publicAttachment(attachment), etag: etag(1) });
  }

  async upload(contentUploadRef: string, bytes: Uint8Array, ifMatch: string) {
    const attachment = this.#attachment(contentUploadRef);
    if (attachment.resourceVersion !== expected(ifMatch))
      throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_STALE_VERSION");
    if (attachment.state !== "AUTHORIZED")
      throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_STATE_INVALID");
    if (bytes.byteLength !== attachment.sizeBytes)
      throw new QaDomainError("QA_EVIDENCE_SIZE_MISMATCH");
    const updated: AttachmentSession = Object.freeze({
      ...attachment,
      bytes: Uint8Array.from(bytes),
      checksum: checksum(bytes),
      state: "UPLOADED",
      resourceVersion: 2,
    });
    this.#attachments.set(contentUploadRef, updated);
    return Object.freeze({
      attachment: this.#publicAttachment(updated),
      checksum: updated.checksum!,
      etag: etag(2),
    });
  }

  async finalize(
    contentUploadRef: string,
    input: Readonly<{
      checksum: string;
      mediaType: string;
      sizeBytes: number;
      dataClassificationKey: string;
    }>,
    ifMatch: string,
  ) {
    const attachment = this.#attachment(contentUploadRef);
    if (attachment.resourceVersion !== expected(ifMatch))
      throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_STALE_VERSION");
    if (attachment.state !== "UPLOADED" || !attachment.bytes || !attachment.checksum)
      throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_STATE_INVALID");
    if (input.checksum !== attachment.checksum)
      throw new QaDomainError("QA_EVIDENCE_CHECKSUM_MISMATCH");
    if (input.mediaType !== attachment.mediaType)
      throw new QaDomainError("QA_EVIDENCE_MEDIA_TYPE_MISMATCH");
    if (input.sizeBytes !== attachment.sizeBytes)
      throw new QaDomainError("QA_EVIDENCE_SIZE_MISMATCH");
    if (input.dataClassificationKey !== attachment.dataClassificationKey)
      throw new QaDomainError("QA_EVIDENCE_CLASSIFICATION_MISMATCH");
    const finalizedAt = new Date().toISOString();
    const evidence: QaEvidenceArtifactLink = Object.freeze({
      evidenceArtifactLinkId: randomUUID(),
      workspaceId: attachment.workspaceId,
      projectId: attachment.projectId,
      workItemId: attachment.workItemId,
      sessionId: attachment.sessionId,
      owner: attachment.owner,
      artifactReferenceId: randomUUID(),
      checksum: attachment.checksum,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      dataClassificationKey: attachment.dataClassificationKey,
      availability: "AVAILABLE",
      availabilityAtSigning: "AVAILABLE",
      attachedBy: attachment.actorId,
      finalizedAt,
    });
    this.#links.set(evidence.evidenceArtifactLinkId, evidence);
    const updated: AttachmentSession = Object.freeze({
      ...attachment,
      state: "FINALIZED",
      resourceVersion: 3,
    });
    this.#attachments.set(contentUploadRef, updated);
    return Object.freeze({ attachment: this.#publicAttachment(updated), evidence, etag: etag(3) });
  }

  async attachFinalizedFixture(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      ownerType: QaEvidenceOwner["ownerType"];
      ownerId: string;
      bytes: Uint8Array;
      mediaType: string;
      classification: string;
      actorId: string;
    }>,
  ): Promise<QaEvidenceArtifactLink> {
    const initiated = await this.initiate({
      ...input,
      owner: { ownerType: input.ownerType, ownerId: input.ownerId },
      sizeBytes: input.bytes.byteLength,
      dataClassificationKey: input.classification,
    });
    const uploaded = await this.upload(
      initiated.attachment.contentUploadRef,
      input.bytes,
      initiated.etag,
    );
    return (
      await this.finalize(
        initiated.attachment.contentUploadRef,
        {
          checksum: uploaded.checksum,
          mediaType: input.mediaType,
          sizeBytes: input.bytes.byteLength,
          dataClassificationKey: input.classification,
        },
        uploaded.etag,
      )
    ).evidence;
  }

  get(scope: QaScope, linkId: string): QaEvidenceArtifactLink {
    const link = this.#links.get(linkId);
    if (!link || link.workspaceId !== scope.workspaceId || link.projectId !== scope.projectId)
      throw new QaDomainError("QA_EVIDENCE_NOT_FOUND");
    return structuredClone(link);
  }
  list(scope: QaScope, sessionId: string): readonly QaEvidenceArtifactLink[] {
    return Object.freeze(
      [...this.#links.values()]
        .filter(
          (link) =>
            link.workspaceId === scope.workspaceId &&
            link.projectId === scope.projectId &&
            link.sessionId === sessionId,
        )
        .map((link) => structuredClone(link)),
    );
  }
  expire(linkId: string): void {
    const link = this.#links.get(linkId);
    if (!link) throw new QaDomainError("QA_EVIDENCE_NOT_FOUND");
    this.#links.set(linkId, Object.freeze({ ...link, availability: "EXPIRED" }));
  }
  uploadedContent(contentUploadRef: string): Uint8Array {
    const attachment = this.#attachment(contentUploadRef);
    if (!attachment.bytes || !attachment.checksum)
      throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_STATE_INVALID");
    return Uint8Array.from(attachment.bytes);
  }
  contentUploadRefForAttachment(attachmentSessionId: string): string {
    const match = [...this.#attachments.values()].find(({ id }) => id === attachmentSessionId);
    if (!match) throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_NOT_FOUND");
    return match.contentUploadRef;
  }
  #attachment(ref: string): AttachmentSession {
    const value = this.#attachments.get(ref);
    if (!value) throw new QaDomainError("QA_EVIDENCE_ATTACHMENT_NOT_FOUND");
    return value;
  }
  #publicAttachment(value: AttachmentSession) {
    return Object.freeze({
      schemaVersion: 1 as const,
      attachmentSessionId: value.id,
      contentUploadRef: value.contentUploadRef,
      workspaceId: value.workspaceId,
      projectId: value.projectId,
      workItemId: value.workItemId,
      sessionId: value.sessionId,
      owner: value.owner,
      state: value.state,
      mediaType: value.mediaType,
      sizeBytes: value.sizeBytes,
      dataClassificationKey: value.dataClassificationKey,
      resourceVersion: value.resourceVersion,
    });
  }
}

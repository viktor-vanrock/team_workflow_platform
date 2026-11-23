import type { JsonValue } from "@awp/platform-contracts";

import {
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";
import { assertQaExactReference, qaCanonicalContentHash } from "./revisions.ts";

export interface QaPublicationHeader {
  readonly id: string;
  readonly scope: QaScope;
  readonly currentPublishedVersionRef?: QaExactReference;
  readonly resourceVersion: number;
  readonly frozenAt?: string;
}

export interface QaPublishedVersion<TContent extends JsonValue> extends QaExactReference {
  readonly headerId: string;
  readonly scope: QaScope;
  readonly previousVersionRef?: QaExactReference;
  readonly content: TContent;
  readonly publishedBy: QaHumanActor;
  readonly publishedAt: string;
}

export interface QaPublishVersionInput<TContent extends JsonValue> {
  readonly versionId: string;
  readonly expectedResourceVersion: number;
  readonly expectedCurrentVersionRef?: QaExactReference;
  readonly content: TContent;
  readonly publishedBy: QaHumanActor;
  readonly publishedAt: string;
}

export function createQaPublicationHeader(id: string, scope: QaScope): QaPublicationHeader {
  if (id.length === 0 || scope.workspaceId.length === 0 || scope.projectId.length === 0) {
    throw new QaDomainError("QA_PUBLICATION_HEADER_INVALID");
  }
  return Object.freeze({ id, scope: Object.freeze({ ...scope }), resourceVersion: 1 });
}

export function publishQaVersion<TContent extends JsonValue>(
  header: QaPublicationHeader,
  input: QaPublishVersionInput<TContent>,
): Readonly<{
  header: QaPublicationHeader;
  version: QaPublishedVersion<TContent>;
}> {
  if (header.frozenAt !== undefined) throw new QaDomainError("QA_PUBLICATION_FROZEN");
  if (header.resourceVersion !== input.expectedResourceVersion) {
    throw new QaDomainError("QA_RESOURCE_VERSION_CONFLICT");
  }
  const current = header.currentPublishedVersionRef;
  if (current === undefined && input.expectedCurrentVersionRef !== undefined) {
    throw new QaDomainError("QA_CURRENT_PUBLICATION_MISMATCH");
  }
  if (current !== undefined) {
    if (input.expectedCurrentVersionRef === undefined) {
      throw new QaDomainError("QA_CURRENT_PUBLICATION_MISMATCH");
    }
    try {
      assertQaExactReference(current, input.expectedCurrentVersionRef);
    } catch {
      throw new QaDomainError("QA_CURRENT_PUBLICATION_MISMATCH");
    }
  }
  if (input.versionId.length === 0 || Number.isNaN(Date.parse(input.publishedAt))) {
    throw new QaDomainError("QA_PUBLICATION_VERSION_INVALID");
  }
  const versionNumber = (current?.version ?? 0) + 1;
  const contentHash: QaContentHash = qaCanonicalContentHash(input.content);
  const version: QaPublishedVersion<TContent> = Object.freeze({
    id: input.versionId,
    version: versionNumber,
    contentHash,
    headerId: header.id,
    scope: header.scope,
    ...(current === undefined ? {} : { previousVersionRef: current }),
    content: structuredClone(input.content),
    publishedBy: input.publishedBy,
    publishedAt: input.publishedAt,
  });
  return Object.freeze({
    version,
    header: Object.freeze({
      ...header,
      currentPublishedVersionRef: Object.freeze({
        id: version.id,
        version: version.version,
        contentHash: version.contentHash,
      }),
      resourceVersion: header.resourceVersion + 1,
    }),
  });
}

export function freezeQaPublicationHeader(
  header: QaPublicationHeader,
  expectedResourceVersion: number,
  frozenAt: string,
): QaPublicationHeader {
  if (header.resourceVersion !== expectedResourceVersion) {
    throw new QaDomainError("QA_RESOURCE_VERSION_CONFLICT");
  }
  if (header.currentPublishedVersionRef === undefined) {
    throw new QaDomainError("QA_CURRENT_PUBLICATION_REQUIRED");
  }
  if (header.frozenAt !== undefined && header.frozenAt !== frozenAt) {
    throw new QaDomainError("QA_PUBLICATION_ALREADY_FROZEN");
  }
  if (Number.isNaN(Date.parse(frozenAt)))
    throw new QaDomainError("QA_PUBLICATION_FREEZE_TIME_INVALID");
  if (header.frozenAt === frozenAt) return header;
  return Object.freeze({
    ...header,
    frozenAt,
    resourceVersion: header.resourceVersion + 1,
  });
}

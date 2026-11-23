import { canonicalSort, type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaImmutableRevision,
} from "./primitives.ts";

export function assertQaExactReference(expected: QaExactReference, actual: QaExactReference): void {
  if (
    expected.id !== actual.id ||
    expected.version !== actual.version ||
    expected.contentHash !== actual.contentHash
  ) {
    throw new QaDomainError("QA_EXACT_REFERENCE_MISMATCH");
  }
}

export function assertQaRevisionSuccessor(
  previous: QaImmutableRevision,
  next: QaImmutableRevision,
): void {
  if (next.id !== previous.id || next.version !== previous.version + 1) {
    throw new QaDomainError("QA_REVISION_GAP");
  }
  if (next.previous === undefined) throw new QaDomainError("QA_REVISION_PREDECESSOR_REQUIRED");
  try {
    assertQaExactReference(previous, next.previous);
  } catch {
    throw new QaDomainError("QA_REVISION_FORK");
  }
}

export function qaCanonicalContentHash(value: JsonValue): QaContentHash {
  return sha256(value);
}

export function qaCanonicalReferenceSetHash(
  references: readonly QaExactReference[],
): QaContentHash {
  const ordered = canonicalSort(references, ({ id, version, contentHash }) => ({
    id,
    version,
    contentHash,
  }));
  const seen = new Set<string>();
  const canonical = ordered.map(({ id, version, contentHash }) => {
    const key = `${id}:${version}:${contentHash}`;
    if (seen.has(key)) throw new QaDomainError("QA_REFERENCE_SET_DUPLICATE");
    seen.add(key);
    return { id, version, contentHash };
  });
  return sha256(canonical);
}

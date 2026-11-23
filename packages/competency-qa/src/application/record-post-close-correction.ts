import type { QaPostCloseCorrectionMarker } from "../domain/post-close-correction.ts";
import {
  assertQaVerifiedHuman,
  qaAggregateSnapshotHash,
  QaDomainError,
  type QaExactReference,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";

interface ManifestProjection {
  readonly manifestId: string;
  latestRevisionRef: QaExactReference;
  readonly latestAdjudicativeRevisionRef: QaExactReference;
  resourceVersion: number;
  content: Readonly<Record<string, unknown> & { note: string; artifactRefs: readonly string[] }>;
}

export class QaPostCloseCorrectionStore {
  readonly #manifest: ManifestProjection;
  readonly #markers: QaPostCloseCorrectionMarker[] = [];
  constructor(input: ManifestProjection) {
    this.#manifest = structuredClone(input);
  }
  manifest(): ManifestProjection {
    return structuredClone(this.#manifest);
  }
  markers(): readonly QaPostCloseCorrectionMarker[] {
    return Object.freeze(structuredClone(this.#markers));
  }
  commit(
    input: Readonly<{
      content: ManifestProjection["content"];
      revisionRef: QaExactReference;
      marker: QaPostCloseCorrectionMarker;
    }>,
  ): ManifestProjection {
    this.#manifest.content = Object.freeze(structuredClone(input.content));
    this.#manifest.latestRevisionRef = Object.freeze(structuredClone(input.revisionRef));
    this.#manifest.resourceVersion += 1;
    this.#markers.push(Object.freeze(structuredClone(input.marker)));
    return this.manifest();
  }
}

export async function recordPostCloseCorrection(
  input: Readonly<{
    store: QaPostCloseCorrectionStore;
    context: QaWorkspaceContext;
    workItemId: string;
    manifestId: string;
    ifMatch: number;
    expectedPreviousRef: QaExactReference;
    patch: Readonly<{ note?: string; artifactRefs?: readonly string[] }>;
    annotations: readonly Readonly<{ field: string; reason: string }>[];
    markerId: string;
    revisionId: string;
    at: string;
  }>,
): Promise<Readonly<{ manifest: ManifestProjection; marker: QaPostCloseCorrectionMarker }>> {
  const current = input.store.manifest();
  if (current.manifestId !== input.manifestId) throw new QaDomainError("QA_MANIFEST_MISMATCH");
  if (current.resourceVersion !== input.ifMatch) throw new QaDomainError("QA_ETAG_MISMATCH");
  if (
    current.latestRevisionRef.id !== input.expectedPreviousRef.id ||
    current.latestRevisionRef.version !== input.expectedPreviousRef.version ||
    current.latestRevisionRef.contentHash !== input.expectedPreviousRef.contentHash
  ) {
    throw new QaDomainError("QA_MANIFEST_REVISION_STALE");
  }
  if (
    input.context.actor.kind !== "HUMAN" ||
    input.context.scope.kind !== "PROJECT" ||
    input.patch.artifactRefs !== undefined ||
    input.patch.note === undefined ||
    !input.patch.note.trim() ||
    input.annotations.length === 0 ||
    input.annotations.some(({ field, reason }) => field !== "note" || !reason.trim())
  )
    throw new QaDomainError("QA_POST_CLOSE_CHANGE_NOT_CLERICAL");
  const actor = assertQaVerifiedHuman(input.context);
  const content = Object.freeze({ ...current.content, note: input.patch.note });
  const revisionRef = Object.freeze({
    id: input.revisionId,
    version: current.latestRevisionRef.version + 1,
    contentHash: qaAggregateSnapshotHash({
      manifestId: input.manifestId,
      previous: current.latestRevisionRef,
      kind: "CLERICAL",
      content,
      annotations: input.annotations,
    } as never),
  });
  const authorizationBasisHash = qaAggregateSnapshotHash(input.context.authorizationBasis as never);
  const marker: QaPostCloseCorrectionMarker = Object.freeze({
    markerId: input.markerId,
    manifestId: input.manifestId,
    previousRevisionRef: current.latestRevisionRef,
    clericalRevisionRef: revisionRef,
    annotations: Object.freeze(structuredClone(input.annotations)),
    basis: "HUMAN",
    actor: structuredClone(actor),
    authorizationBasisHash,
    recordedAt: input.at,
  });
  return Object.freeze({ manifest: input.store.commit({ content, revisionRef, marker }), marker });
}

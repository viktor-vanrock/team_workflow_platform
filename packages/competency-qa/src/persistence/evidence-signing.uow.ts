import type {
  EvidenceSignatureEnvelope,
  QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export class EvidenceSigningUnitOfWork {
  constructor(private readonly source: QaQueryExecutor) {}

  async commit(
    manifest: QaEvidenceManifestRevisionV2,
    signature: EvidenceSignatureEnvelope,
    expectedSessionVersion: number,
  ): Promise<void> {
    if (
      signature.manifestRevisionRef.id !== manifest.manifestRevisionId ||
      signature.manifestRevisionRef.version !== manifest.version ||
      signature.manifestRevisionRef.contentHash !== manifest.contentHash
    )
      throw new Error("EVIDENCE_SIGNATURE_SUBJECT_MISMATCH");
    await this.source.query("SELECT commit_signed_evidence_manifest_v2($1,$2,$3,$4,$5)", [
      manifest.workspaceId,
      manifest.projectId,
      JSON.stringify(manifest),
      JSON.stringify(signature),
      expectedSessionVersion,
    ]);
  }
}

export class InMemoryEvidenceSigningUnitOfWork {
  readonly manifests: unknown[] = [];
  readonly signatures: unknown[] = [];
  readonly #idempotency = new Map<
    string,
    Readonly<{ hash: string; result: Readonly<{ replayed: boolean; sessionVersion: number }> }>
  >();
  sessionVersion: number;

  constructor(sessionVersion: number) {
    this.sessionVersion = sessionVersion;
  }

  async commitCandidate(
    manifest: unknown,
    signature: unknown,
    expectedSessionVersion: number,
    idempotencyKey: string,
  ): Promise<Readonly<{ replayed: boolean; sessionVersion: number }>> {
    const hash = JSON.stringify({ manifest, signature });
    const replay = this.#idempotency.get(idempotencyKey);
    if (replay) {
      if (replay.hash !== hash) throw new Error("EVIDENCE_SIGNING_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ ...replay.result, replayed: true });
    }
    if (expectedSessionVersion !== this.sessionVersion)
      throw new Error("EVIDENCE_SIGNING_SESSION_STALE");
    this.manifests.push(structuredClone(manifest));
    this.signatures.push(structuredClone(signature));
    this.sessionVersion += 1;
    const result = Object.freeze({ replayed: false, sessionVersion: this.sessionVersion });
    this.#idempotency.set(idempotencyKey, Object.freeze({ hash, result }));
    return result;
  }
}

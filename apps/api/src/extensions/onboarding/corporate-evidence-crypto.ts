import type { QaEvidenceManifestRevisionV2 } from "@awp/competency-qa";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";
import {
  CorporateEvidenceSigner,
  type CorporateSigningConfiguration,
  FilePublicKeyHistory,
  type VaultHttpClient,
} from "@awp/runtime-composition";

import type { EvidenceCrypto } from "./evidence.application.ts";

export interface CorporateEvidenceCryptoProject {
  readonly signing: CorporateSigningConfiguration;
  readonly redactionPolicyRef: ExactRevisionRef;
  readonly exportPolicyRef: ExactRevisionRef;
  /** Public-only, immutable refs allowed for offline verification, including previous versions. */
  readonly trustedPublicKeys: readonly ExactRevisionRef[];
}

/** Scope-specific remote signing and offline verification; no local private key fallback. */
export function createCorporateEvidenceCrypto(
  input: Readonly<{
    source: VaultHttpClient;
    publicKeyHistoryDirectory: string;
    signingPolicyRef: ExactRevisionRef;
    projects: readonly CorporateEvidenceCryptoProject[];
    authorize: (
      manifest: QaEvidenceManifestRevisionV2,
      configuration: CorporateSigningConfiguration,
      signal: AbortSignal,
    ) => Promise<boolean>;
  }>,
): (scope: ProjectScope) => EvidenceCrypto {
  if (
    !input.publicKeyHistoryDirectory.startsWith("/") ||
    !input.projects.length ||
    typeof input.authorize !== "function"
  )
    throw new Error("CORPORATE_EVIDENCE_CONFIG_INVALID");
  const projects = freezePilotValue(structuredClone(input.projects));
  const scopes = new Set<string>();
  const crypto = new Map<string, EvidenceCrypto>();
  for (const entry of projects) {
    [entry.redactionPolicyRef, entry.exportPolicyRef, ...entry.trustedPublicKeys].forEach(
      assertExactRevisionRef,
    );
    const config = entry.signing;
    const key = `${config.workspaceId}:${config.projectId}`;
    if (
      scopes.has(key) ||
      !samePilotRef(config.signingPolicyRef, input.signingPolicyRef) ||
      !entry.trustedPublicKeys.some((ref) => samePilotRef(ref, config.publicKeyRef))
    )
      throw new Error("CORPORATE_EVIDENCE_CONFIG_INVALID");
    scopes.add(key);
    const history = new FilePublicKeyHistory(
      input.publicKeyHistoryDirectory,
      { workspaceId: config.workspaceId, projectId: config.projectId },
      (ref) => entry.trustedPublicKeys.some((known) => samePilotRef(known, ref)),
    );
    const signer = new CorporateEvidenceSigner(input.source, history, config, input.authorize);
    crypto.set(
      key,
      Object.freeze({
        redactionPolicyRef: entry.redactionPolicyRef,
        exportPolicyRef: entry.exportPolicyRef,
        signManifest: (manifest: QaEvidenceManifestRevisionV2) => signer.signManifest(manifest),
        verify: (manifest, envelope) => history.verify(manifest, envelope),
      } satisfies EvidenceCrypto),
    );
  }
  return (scope) => {
    const found = crypto.get(`${scope.workspaceId}:${scope.projectId}`);
    if (!found) throw new Error("CORPORATE_EVIDENCE_SCOPE_DENIED");
    return found;
  };
}

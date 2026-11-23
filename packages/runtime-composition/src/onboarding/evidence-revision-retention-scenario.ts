import {
  assembleEvidencePackage,
  buildEvidenceManifestV2,
  correctEvidenceManifestV2,
  evidenceContentHash,
  evidenceIntegrityModeForSchema,
} from "@awp/competency-qa";

import {
  LocalEd25519EvidenceSigner,
  LocalEvidenceSigningKeyStore,
} from "../security/evidence-signing.ts";
import { InMemoryArtifactRetentionLedger } from "./artifact-retention-worker.ts";
import { exportVerifiedEvidence } from "./evidence-service.ts";

const ref = (id: string) => ({ id, version: 1, contentHash: evidenceContentHash({ id }) });
const key = {
  kid: "local-ed25519:1",
  version: 1,
  publicJwk: { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" },
  privateJwk: {
    kty: "OKP",
    crv: "Ed25519",
    x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
  },
};

export async function runEvidenceRevisionRetentionScenario() {
  const workspaceId = "00000000-0000-4000-8000-000000000701";
  const projectId = "00000000-0000-4000-8000-000000000711";
  const targetSnapshot = {
    schemaVersion: "qa-target-snapshot@2.0.0" as const,
    snapshotId: "snapshot",
    version: 1 as const,
    workspaceId,
    projectId,
    workItemId: "work",
    sessionId: "session",
    mode: "MANUAL" as const,
    sourceRefs: [ref("source")],
    buildRef: ref("build"),
    environmentRef: ref("environment"),
    testDataRefs: [ref("data")],
    accountLeaseRefs: [],
    definitionRefs: [ref("definition")],
    configurationPins: [
      {
        ordinal: 1,
        logicalRole: "QA_REQUEST_AUTHORITY",
        capabilityKey: "qa.request",
        exactContractVersion: "1.0.0",
        bindingRef: ref("binding"),
        profileRef: ref("profile"),
        connectionRef: ref("connection"),
        validationReportRef: ref("validation"),
        operationSetHash: evidenceContentHash(["read"]),
        externalScopeHash: evidenceContentHash({ projectId }),
      },
    ],
    policyRefs: [ref("policy")],
    modeConfiguration: {
      schemaRef: ref("mode"),
      value: { mode: "MANUAL" },
      contentHash: evidenceContentHash({ mode: "MANUAL" }),
    },
    capturedAt: "2026-09-03T12:00:00.000Z",
    contentHash: evidenceContentHash({ target: "snapshot" }),
  };
  const first = buildEvidenceManifestV2({
    manifestRevisionId: "manifest-r1",
    manifestId: "manifest",
    version: 1,
    kind: "INITIAL",
    workspaceId,
    projectId,
    workItemId: "work",
    sessionId: "session",
    targetSnapshot,
    planItems: [{ planItemId: "plan", result: "PASS" }],
    attempts: [{ attemptId: "attempt", result: "PASS" }],
    findings: [],
    artifacts: [
      {
        artifactId: "artifact",
        checksum: evidenceContentHash("bytes"),
        classificationKey: "INTERNAL",
        classificationRank: 10,
        availability: "AVAILABLE",
      },
    ],
    provenance: [{ kind: "SESSION", id: "session" }],
    humanAttestation: {
      actor: { kind: "HUMAN", principalId: "qa-lead" },
      attestedAt: "2026-09-03T12:00:00.000Z",
    },
    createdAt: "2026-09-03T12:00:00.000Z",
  });
  const signer = new LocalEd25519EvidenceSigner(new LocalEvidenceSigningKeyStore([key]));
  const signature = await signer.signManifest(first, "local-evidence-signing");
  const signatureStatus = await signer.verifyManifest(first, signature);
  const second = correctEvidenceManifestV2(first, {
    manifestRevisionId: "manifest-r2",
    kind: "CLERICAL",
    reason: "label correction",
    createdAt: "2026-09-03T13:00:00.000Z",
    humanAttestation: first.humanAttestation,
  });
  const ledger = new InMemoryArtifactRetentionLedger();
  ledger.register({
    artifactId: "artifact",
    workspaceId,
    projectId,
    checksum: evidenceContentHash("bytes"),
    state: "AVAILABLE",
  });
  ledger.observe("artifact", "EXPIRED");
  const exported = await exportVerifiedEvidence({
    authorized: async () => true,
    verified: async () => signatureStatus === "VALID",
    payload: { manifestRef: ref(first.manifestRevisionId), artifact: ledger.current("artifact") },
    redact: ({ manifestRef, artifact }) => ({
      manifestRef,
      artifact: {
        artifactId: artifact?.artifactId,
        checksum: artifact?.checksum,
        state: artifact?.state,
      },
    }),
    audit: () => undefined,
  });
  assembleEvidencePackage({
    workspaceId,
    projectId,
    workItemId: "work",
    manifestRefs: [ref(first.manifestRevisionId)],
    signatureRefs: [{ ...ref(signature.signatureId), status: signatureStatus }],
    qaVerdict: { ...ref("verdict"), actorKind: "HUMAN", signed: true },
    createdBy: { kind: "HUMAN", principalId: "qa-lead" },
    createdAt: "2026-09-03T13:00:00.000Z",
  });
  return Object.freeze({
    status: "PASS" as const,
    signatureStatus,
    revisionCount: [first, second].length,
    artifactState: ledger.current("artifact")?.state,
    metadataPreserved: ledger.current("artifact")?.checksum === evidenceContentHash("bytes"),
    legacyStatus: evidenceIntegrityModeForSchema("urn:awp:schemas:qa:evidence:v1"),
    exportResultHash: exported.resultHash,
  });
}

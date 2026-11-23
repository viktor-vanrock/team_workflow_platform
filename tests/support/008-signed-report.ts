import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { vi } from "vitest";

import { type ExactRevisionRef, pilotContentHash } from "../../packages/platform-core/src/index.ts";
import {
  type PilotReportArtifactStore,
  type PilotReportDocument,
  pilotReportSigningBytes,
  type PilotReportVerificationPolicy,
  SignedPilotReportVerifier,
} from "../../packages/runtime-composition/src/pilot/report-verifier.ts";

export function create008SignedReportFixture(suppliedScope?: {
  workspaceId: string;
  projectId: string;
}) {
  const scope = {
    workspaceId: suppliedScope?.workspaceId ?? randomUUID(),
    projectId: suppliedScope?.projectId ?? randomUUID(),
  };
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "jwk" });
  const ref = (id: string): ExactRevisionRef => ({
    id,
    version: 1,
    contentHash: pilotContentHash({ id }) as `sha256:${string}`,
  });
  let now = Date.parse("2026-09-04T09:00:00.000Z");
  const keyRef: ExactRevisionRef = {
    ...ref("executor-key"),
    contentHash: pilotContentHash(publicKey) as `sha256:${string}`,
  };
  const executorId = randomUUID();
  const policyBody: Omit<PilotReportVerificationPolicy, "policyRef"> = {
    ...scope,
    subjectRef: ref("deployment"),
    fingerprints: Object.fromEntries(
      ["source", "contracts", "migrations", "lockfile", "configuration", "inputs", "suite"].map(
        (key) => [key, pilotContentHash({ key })],
      ),
    ),
    deploymentProfiles: ["local"],
    executionGates: {
      engineering: ["foundation"],
      compatibility: ["foundation"],
      inputs: ["inputs"],
      N2: ["integration"],
    },
    maximumAgeMs: 2_000,
    keys: [{ executorId, keyRef, publicKey }],
  };
  const policy: PilotReportVerificationPolicy = {
    ...policyBody,
    policyRef: {
      ...ref("report-policy"),
      contentHash: pilotContentHash(policyBody) as `sha256:${string}`,
    },
  };
  const evidence = Buffer.from("independently counted effects: one");
  const digest = (bytes: Uint8Array) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  const artifact = {
    path: "reports/008-pilot-hardening-and-conformance/evidence/proof.json",
    sha256: digest(evidence),
  };
  const report = {
    schemaVersion: 1,
    feature: "008-pilot-hardening-and-conformance",
    runId: "foundation-proof",
    gate: "foundation",
    status: "PASS",
    deploymentProfile: "local",
    scope: { workspaceId: scope.workspaceId, projectIds: [scope.projectId] },
    startedAt: new Date(now - 1_500).toISOString(),
    finishedAt: new Date(now - 1_000).toISOString(),
    fingerprints: policy.fingerprints,
    executorIdentity: executorId,
    checks: [{ id: "effect-count", status: "PASS", evidence: [artifact], reasonCodes: [] }],
    prerequisites: [],
    reasonCodes: [],
  };
  const documents = new Map<string, PilotReportDocument>();
  const publish = (body: unknown = report) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const unsigned = {
      bytes,
      reportRef: { id: randomUUID(), version: 1, contentHash: digest(bytes) },
      signature: { executorId, keyRef, subjectRef: policy.subjectRef },
    };
    const document = {
      ...unsigned,
      signature: {
        ...unsigned.signature,
        value: sign(null, pilotReportSigningBytes(unsigned), pair.privateKey).toString("base64url"),
      },
    };
    documents.set(document.reportRef.id, document);
    return document;
  };
  const store: PilotReportArtifactStore = {
    report: vi.fn<PilotReportArtifactStore["report"]>(async (_scope, reference) =>
      structuredClone(documents.get(reference.id)!),
    ),
    prerequisite: vi.fn<PilotReportArtifactStore["prerequisite"]>(
      async (_scope, _parent, reference) =>
        structuredClone(
          [...documents.values()].find(
            (value) => value.reportRef.contentHash === reference.sha256,
          )!,
        ),
    ),
    evidence: vi.fn(async () => evidence),
  };
  const policies = { current: vi.fn(async () => structuredClone(policy)) };
  const verifier = new SignedPilotReportVerifier(store, policies, () => now);
  return {
    scope,
    policy,
    policies,
    store,
    verifier,
    publish,
    report,
    artifact,
    documents,
    digest,
    setNow: (value: number) => {
      now = value;
    },
  };
}

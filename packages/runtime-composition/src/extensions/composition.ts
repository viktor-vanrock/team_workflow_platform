import { dummyManifest } from "@awp/competency-dummy";
import { techWritingManifest } from "@awp/competency-tech-writing";
import type { StaticExtensionCandidate } from "@awp/platform-core";

export { coreOnlyExtensionCandidates, nonLocalExtensionCandidates } from "./core-composition.ts";

export const sampleRecordCapabilityContract = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "CapabilityContract",
  key: "sample.record",
  version: "1.0.0",
  description: "Phase-1 conformance capability for one idempotent typed external write.",
  operations: [
    {
      key: "record.publish",
      effect: "WRITE",
      targetSchemaRef: {
        id: "urn:awp:schemas:sample:record-target:v1",
        version: 1,
        digest: "sha256:7c41ac1a56e06a8bdb45648c5ad725dc0fc2ca18c38bcb1e09e5d36d00346b8d",
      },
      inputSchemaRef: {
        id: "urn:awp:schemas:sample:record-publish-input:v1",
        version: 1,
        digest: "sha256:bae7056e53491527d857350ecc5073069e7e99cb9a515ce3b9e72f2cec9f40cc",
      },
      resultSchemaRef: {
        id: "urn:awp:schemas:sample:record-publish-result:v1",
        version: 1,
        digest: "sha256:98c064aa6c063c5db5f39a09d4826d66fefda72bf2549584830474573a011e0a",
      },
      externalScopeSchemaRef: {
        id: "urn:awp:schemas:sample:record-external-scope:v1",
        version: 1,
        digest: "sha256:8d22db38aa2b6fcef661afb8785bc0e20cb739a8023ebcab6076893d12638ea3",
      },
      idempotency: { required: true, supportedStrategies: ["NATIVE_KEY"] },
      confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
    },
  ],
});

export const localExtensionCandidates = Object.freeze([
  {
    sourceComponentRef: "tech-writing.manifest",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: techWritingManifest,
    required: true,
  },
  {
    sourceComponentRef: "contracts.sample-record",
    manifestSchemaId: "urn:awp:contracts:extensions:capability-contract:v1",
    manifest: sampleRecordCapabilityContract,
    required: true,
  },
  {
    sourceComponentRef: "dummy.manifest",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: dummyManifest,
    required: true,
  },
] satisfies readonly StaticExtensionCandidate[]);

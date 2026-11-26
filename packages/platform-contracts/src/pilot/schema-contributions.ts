import type { DesignContractContribution } from "../schema-contributions.ts";

export const pilotContractContribution: DesignContractContribution = Object.freeze({
  key: "008-pilot-hardening-and-conformance",
  order: 800,
  schemaRoot: "specs/008-pilot-hardening-and-conformance/contracts/runtime-schemas",
  openapiDocuments: Object.freeze([]),
  asyncapiDocuments: Object.freeze([]),
});
export const pilotSchemaIds = Object.freeze({
  gateReport: "urn:awp:contracts:pilot:gate-report:v1",
  event: "urn:awp:contracts:pilot:event:v1",
  fenceAction: "urn:awp:contracts:pilot:fence-action:v1",
});
export const pilotEventContributions = Object.freeze(
  [
    "PILOT_GATE_RECORDED",
    "PILOT_COHORT_PUBLISHED",
    "PILOT_FENCE_CHANGED",
    "PILOT_RECOVERY_RECORDED",
  ].map((eventType) =>
    Object.freeze({
      eventType,
      schemaId: pilotSchemaIds.event,
      scope: "PROJECT" as const,
      permissionGrant: false as const,
    }),
  ),
);

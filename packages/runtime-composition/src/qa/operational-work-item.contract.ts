import type { StaticExtensionCandidate } from "@awp/platform-core";

const schema = (id: string, digest: `sha256:${string}`) =>
  Object.freeze({
    id,
    version: 1,
    digest,
  });

export const operationalWorkItemSchemaRefs = Object.freeze({
  target: schema(
    "urn:awp:schemas:operational-work-item:target:v1",
    "sha256:eb047baff11b9fb39c576d7823551a4b1932b535df4db273b13e314fb41f249d",
  ),
  externalScope: schema(
    "urn:awp:schemas:operational-work-item:external-scope:v1",
    "sha256:ae5c7e2f084eb7da2c13fbbdf30bd9afa52ce06cbd092cd566f4a6f23d2be173",
  ),
  requestCreate: schema(
    "urn:awp:schemas:operational-work-item:request-create:v1",
    "sha256:39b2ad100affd526647f81ebfd8ba5dee53d9725ba43b1dbd4ce117e9be290de",
  ),
  requestTransition: schema(
    "urn:awp:schemas:operational-work-item:request-transition:v1",
    "sha256:2881e1c48cb3ce45de017e88c21c84ab5db9f8c654bb3f24c1fe4bb0b25fd02c",
  ),
  defectCreate: schema(
    "urn:awp:schemas:operational-work-item:defect-create:v1",
    "sha256:a749c7ac95142f2ddcab0d0ab912989be36861521d1543ddbd5749b5e9474447",
  ),
  result: schema(
    "urn:awp:schemas:operational-work-item:result:v1",
    "sha256:d6ec1f91e7fe3231a87514d84919559ec88f4646abf18b9b2a26fa6879d2c85b",
  ),
});

const operation = (
  key: "request.create" | "request.transition" | "defect.create",
  inputSchemaRef: Readonly<{ id: string; version: number; digest: `sha256:${string}` }>,
) =>
  Object.freeze({
    key,
    effect: "WRITE" as const,
    targetSchemaRef: operationalWorkItemSchemaRefs.target,
    inputSchemaRef,
    resultSchemaRef: operationalWorkItemSchemaRefs.result,
    externalScopeSchemaRef: operationalWorkItemSchemaRefs.externalScope,
    idempotency: Object.freeze({
      required: true,
      supportedStrategies: Object.freeze(["NATIVE_KEY", "RECONCILIATION"] as const),
    }),
    confirmationModes: Object.freeze(["SYNC_RECEIPT", "READ_BACK"] as const),
  });

/** The immutable contract is complete even though the first runtime slice exposes create only. */
export const operationalWorkItemCapabilityContract = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "CapabilityContract",
  key: "operational-work-item",
  version: "1.0.0",
  description: "Vendor-neutral operational QA request and defect writes.",
  operations: Object.freeze([
    operation("request.create", operationalWorkItemSchemaRefs.requestCreate),
    operation("request.transition", operationalWorkItemSchemaRefs.requestTransition),
    operation("defect.create", operationalWorkItemSchemaRefs.defectCreate),
  ]),
});

export const operationalWorkItemCapabilityCandidate = Object.freeze({
  sourceComponentRef: "contracts.operational-work-item",
  manifestSchemaId: "urn:awp:contracts:extensions:capability-contract:v1",
  manifest: operationalWorkItemCapabilityContract,
  required: true,
} satisfies StaticExtensionCandidate);

/** Initial immutable Mock Profile revision. Later stories publish a successor. */
export const qaUs1MockProfileCapability = Object.freeze({
  capabilityKey: "operational-work-item",
  exactContractVersion: "1.0.0",
  operations: Object.freeze([
    Object.freeze({
      operation: "request.create",
      effect: "WRITE",
      idempotencyStrategy: "NATIVE_KEY",
      confirmationMode: "READ_BACK",
    }),
  ]),
  environmentScopes: Object.freeze(["LOCAL"] as const),
  allowedDataClassifications: Object.freeze(["PUBLIC", "INTERNAL"] as const),
});

/** Initial QA requirement Binding revision; transition/defect are intentionally absent. */
export const qaUs1RequestAuthorityBindingEntry = Object.freeze({
  logicalRole: "QA_REQUEST_AUTHORITY",
  capabilityKey: "operational-work-item",
  exactContractVersion: "1.0.0",
  environmentScope: "LOCAL",
  classificationCeilingKey: "INTERNAL",
  operations: Object.freeze(["request.create"] as const),
});

/** Immutable US2 successor; the US1 revision remains valid historical input. */
export const qaUs2MockProfileCapability = Object.freeze({
  ...qaUs1MockProfileCapability,
  operations: Object.freeze([
    ...qaUs1MockProfileCapability.operations,
    Object.freeze({
      operation: "request.transition",
      effect: "WRITE",
      idempotencyStrategy: "NATIVE_KEY",
      confirmationMode: "READ_BACK",
    }),
  ]),
});

export const qaUs2RequestAuthorityBindingEntry = Object.freeze({
  ...qaUs1RequestAuthorityBindingEntry,
  operations: Object.freeze(["request.create", "request.transition"] as const),
});

/** Immutable US4 successor adds defect.create without changing historical request revisions. */
export const qaUs4MockProfileCapability = Object.freeze({
  ...qaUs2MockProfileCapability,
  operations: Object.freeze([
    ...qaUs2MockProfileCapability.operations,
    Object.freeze({
      operation: "defect.create",
      effect: "WRITE",
      idempotencyStrategy: "NATIVE_KEY",
      confirmationMode: "READ_BACK",
    }),
  ]),
});

export const qaUs4DefectDestinationBindingEntry = Object.freeze({
  logicalRole: "DEFECT_DESTINATION",
  capabilityKey: "operational-work-item",
  exactContractVersion: "1.0.0",
  environmentScope: "LOCAL",
  classificationCeilingKey: "INTERNAL",
  operations: Object.freeze(["defect.create"] as const),
});

/** Immutable US5 successor makes structured DONE summary support explicit. */
export const qaUs5MockProfileCapability = Object.freeze({
  ...qaUs4MockProfileCapability,
  completion: Object.freeze({
    requestedNormalizedStatus: "DONE" as const,
    structuredSummarySchemaRef: Object.freeze({
      id: "urn:awp:schemas:operational-work-item:completion-summary:v1",
      version: 1,
    }),
    requiresDigestReceipt: true as const,
  }),
});

export const qaUs5RequestAuthorityBindingEntry = Object.freeze({
  ...qaUs2RequestAuthorityBindingEntry,
  operations: Object.freeze(["request.create", "request.transition"] as const),
  completionSummaryRequiredForDone: true as const,
});

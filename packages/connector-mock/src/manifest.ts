export const sampleMockConnectorManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "Connector",
  metadata: { key: "sample.mock", version: "1.0.0", displayName: "Sample Stateful Mock Connector" },
  requires: { coreContracts: ">=1.0.0 <2.0.0", connectorSdk: ">=1.0.0 <2.0.0" },
  connectorType: "sample.mock",
  runtimeComponentRef: "sample.mock.runtime",
  connectionSchemaRef: {
    id: "urn:awp:schemas:sample:connection-config:v1",
    version: 1,
    digest: "sha256:3a47ffc7a93f2e4dcfc699c4091642c29ff620615f70b6e041adc79bd0992b0f",
  },
  profileSchemaRef: {
    id: "urn:awp:schemas:sample:profile-config:v1",
    version: 1,
    digest: "sha256:be2e35b4733379ddb970e3329c831c7e945cf974ec70f074baba98d1ca169c62",
  },
  implements: [
    {
      capabilityKey: "sample.record",
      exactContractVersions: ["1.0.0"],
      operations: ["record.publish"],
      supportedIdempotencyStrategies: ["NATIVE_KEY"],
      supportedConfirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
      handlerComponentRef: "sample.mock.record-handler",
    },
  ],
});

export const operationalMockConnectorManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "Connector",
  metadata: Object.freeze({
    key: "operational.mock",
    version: "1.0.0",
    displayName: "Local Operational Work Item Mock Connector",
  }),
  requires: Object.freeze({ coreContracts: ">=1.0.0 <2.0.0", connectorSdk: ">=1.0.0 <2.0.0" }),
  connectorType: "operational.mock",
  runtimeComponentRef: "operational.mock.runtime",
  connectionSchemaRef: Object.freeze({
    id: "urn:awp:schemas:mock:operational-connection:v1",
    version: 1,
    digest: "sha256:867a54a2de2bb49f033056f01e69ee2a5034870d5ec61475f45640e6b0902ec7",
  }),
  profileSchemaRef: Object.freeze({
    id: "urn:awp:schemas:mock:operational-profile:v1",
    version: 1,
    digest: "sha256:0fa04e6ac850c4c3e8eb43098c34795e9601588295df0bb7cd307631767e07ac",
  }),
  implements: Object.freeze([
    Object.freeze({
      capabilityKey: "operational-work-item",
      exactContractVersions: Object.freeze(["1.0.0"]),
      operations: Object.freeze(["request.create", "request.transition", "defect.create"]),
      supportedIdempotencyStrategies: Object.freeze(["NATIVE_KEY"]),
      supportedConfirmationModes: Object.freeze(["SYNC_RECEIPT", "READ_BACK"]),
      handlerComponentRef: "operational.mock.work-item-handler",
      completion: Object.freeze({
        requestedNormalizedStatus: "DONE",
        structuredSummary: true,
        digestReceipt: true,
        partialEffectReadBack: true,
      }),
    }),
  ]),
});

export const gitLabAdapterFamilies = Object.freeze(["gitlab-rest-v4"] as const);

export const gitLabCapabilitySurface = Object.freeze([
  Object.freeze({
    capabilityKey: "source-context.read",
    exactContractVersions: Object.freeze(["1.0.0"]),
    operations: Object.freeze(["merge-request.read", "commit.read", "build.read"]),
    supportedIdempotencyStrategies: Object.freeze(["NONE"]),
    supportedConfirmationModes: Object.freeze(["AUTHORITATIVE_READ"]),
    handlerComponentRef: "gitlab.source-context.handler",
  }),
  Object.freeze({
    capabilityKey: "test-executor.trigger-status",
    exactContractVersions: Object.freeze(["1.0.0"]),
    operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"]),
    supportedIdempotencyStrategies: Object.freeze(["EFFECT_MARKER_RECONCILIATION"]),
    supportedConfirmationModes: Object.freeze(["EXACT_LOOKUP"]),
    handlerComponentRef: "gitlab.test-executor.handler",
  }),
  Object.freeze({
    capabilityKey: "artifact.ci-read",
    exactContractVersions: Object.freeze(["1.0.0"]),
    operations: Object.freeze(["artifact.metadata", "artifact.stream"]),
    supportedIdempotencyStrategies: Object.freeze(["NONE"]),
    supportedConfirmationModes: Object.freeze(["AUTHORITATIVE_READ"]),
    handlerComponentRef: "gitlab.ci-artifact.handler",
  }),
] as const);

export const gitLabProhibitedOperations = Object.freeze([
  "pipeline.retry",
  "pipeline.cancel",
  "pipeline.delete",
  "repository.push",
  "repository.file.read",
  "repository.file.write",
  "ci-config.read",
  "ci-config.write",
  "branch.create",
  "branch.update",
  "variable.read",
  "variable.write",
  "secret.read",
  "job.play",
  "job.retry",
  "deployment.create",
  "deployment.approve",
  "production.target",
] as const);

export const gitLabSupportMetadata = Object.freeze({
  adapterContractVersion: "1.0.0",
  connectionConfigurationSchemaId: "urn:awp:schemas:005:gitlab-connection-configuration:v1",
  profileConfigurationSchemaId: "urn:awp:schemas:005:gitlab-profile-configuration:v1",
  discoverySnapshotSchemaVersion: "gitlab-discovery-snapshot@1.0.0",
  supportedApiFamilies: Object.freeze(["v4"] as const),
  supportedWebhookVerificationModes: Object.freeze(["STANDARD_WEBHOOKS_HMAC_SHA256"] as const),
  supportedTriggerDialects: Object.freeze(["TYPED_INPUTS", "BOUNDED_VARIABLES"] as const),
  productionRunsSupported: false,
} as const);

export const gitLabConnectorManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "Connector",
  metadata: Object.freeze({
    key: "gitlab.automated-validation",
    version: "1.0.0",
    displayName: "GitLab Automated Validation Connector",
  }),
  requires: Object.freeze({
    coreContracts: ">=1.0.0 <2.0.0",
    connectorSdk: ">=1.0.0 <2.0.0",
  }),
  connectorType: "gitlab",
  runtimeComponentRef: "gitlab.automated-validation.runtime",
  adapterFamilies: gitLabAdapterFamilies,
  implements: gitLabCapabilitySurface,
  prohibitedOperations: gitLabProhibitedOperations,
  support: gitLabSupportMetadata,
});

export const mattermostAdapterFamilies = Object.freeze(["mattermost-v4"] as const);

export const mattermostConnectorManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "Connector",
  metadata: Object.freeze({
    key: "mattermost.hermes-intake",
    version: "1.0.0",
    displayName: "Mattermost Hermes Intake Connector",
  }),
  requires: Object.freeze({
    coreContracts: ">=1.0.0 <2.0.0",
    connectorSdk: ">=1.0.0 <2.0.0",
  }),
  connectorType: "mattermost",
  runtimeComponentRef: "mattermost.hermes-intake.runtime",
  adapterFamilies: mattermostAdapterFamilies,
  implements: Object.freeze([
    Object.freeze({
      capabilityKey: "messaging.intake",
      exactContractVersions: Object.freeze(["1.0.0"]),
      operations: Object.freeze(["intake.present"]),
      supportedIdempotencyStrategies: Object.freeze(["RECONCILIATION"]),
      supportedConfirmationModes: Object.freeze(["READ_BACK"]),
      handlerComponentRef: "mattermost.hermes-intake.intake-handler",
    }),
    Object.freeze({
      capabilityKey: "messaging.notify",
      exactContractVersions: Object.freeze(["1.0.0"]),
      operations: Object.freeze(["notification.send"]),
      supportedIdempotencyStrategies: Object.freeze(["RECONCILIATION"]),
      supportedConfirmationModes: Object.freeze(["READ_BACK"]),
      handlerComponentRef: "mattermost.hermes-intake.notification-handler",
    }),
    Object.freeze({
      capabilityKey: "messaging.callback",
      exactContractVersions: Object.freeze(["1.0.0"]),
      operations: Object.freeze(["callback.present"]),
      optional: true,
      supportedIdempotencyStrategies: Object.freeze(["RECONCILIATION"]),
      supportedConfirmationModes: Object.freeze(["READ_BACK"]),
      handlerComponentRef: "mattermost.hermes-intake.callback-handler",
    }),
  ]),
});

export const mattermostIngressDeclarations = Object.freeze([
  Object.freeze({
    key: "mattermost.ingress.dialog-submission",
    version: "1.0.0",
    routeKind: "DIALOG_SUBMISSION",
    authentication: "AWP_OPAQUE_INTENT",
    deliveryIdentityMode: "EXACT_BODY_FINGERPRINT",
    handlerComponentRef: "mattermost.hermes-intake.dialog-ingress",
  }),
  Object.freeze({
    key: "mattermost.ingress.post-action",
    version: "1.0.0",
    routeKind: "POST_ACTION",
    authentication: "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT",
    deliveryIdentityMode: "PROVIDER_DELIVERY_ID",
    handlerComponentRef: "mattermost.hermes-intake.post-action-ingress",
  }),
]);

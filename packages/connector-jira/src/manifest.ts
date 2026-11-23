export const jiraAdapterFamilies = Object.freeze([
  "jira-cloud-v3",
  "jira-dc-9-v2",
  "jira-dc-10-v2",
  "jira-dc-11-v2",
] as const);

export const jiraConnectorManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "Connector",
  metadata: Object.freeze({
    key: "jira.operational-authority",
    version: "1.0.0",
    displayName: "Jira Operational Authority Connector",
  }),
  requires: Object.freeze({
    coreContracts: ">=1.0.0 <2.0.0",
    connectorSdk: ">=1.0.0 <2.0.0",
  }),
  connectorType: "jira",
  runtimeComponentRef: "jira.operational-authority.runtime",
  adapterFamilies: jiraAdapterFamilies,
  implements: Object.freeze([
    Object.freeze({
      capabilityKey: "operational-work-item",
      exactContractVersions: Object.freeze(["1.0.0", "1.1.0"]),
      operations: Object.freeze([
        "request.create",
        "request.transition",
        "request.assign",
        "request.set-priority",
        "request.set-due-date",
        "defect.create",
      ]),
      supportedIdempotencyStrategies: Object.freeze(["RECONCILIATION"]),
      supportedConfirmationModes: Object.freeze(["READ_BACK"]),
      handlerComponentRef: "jira.operational-authority.handler",
    }),
  ]),
});

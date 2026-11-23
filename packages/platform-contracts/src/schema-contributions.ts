import { pilotContractContribution } from "./pilot/schema-contributions.ts";

export interface DesignContractContribution {
  readonly key: string;
  readonly order: number;
  readonly schemaRoot: string;
  readonly openapiDocuments: readonly string[];
  readonly asyncapiDocuments: readonly string[];
  readonly exampleManifest?: string;
}

export const designContractContributions = Object.freeze([
  Object.freeze({
    key: "001-extension-kernel-local-skeleton",
    order: 100,
    schemaRoot: "specs/001-extension-kernel-local-skeleton/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/001-extension-kernel-local-skeleton/contracts/openapi/core-api.v1.yaml",
      "specs/001-extension-kernel-local-skeleton/contracts/openapi/dummy-pack-api.v1.yaml",
      "specs/001-extension-kernel-local-skeleton/contracts/openapi/mock-hub-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/001-extension-kernel-local-skeleton/contracts/asyncapi/platform-events.v1.yaml",
    ]),
  }),
  Object.freeze({
    key: "002-qa-manual-walking-skeleton",
    order: 200,
    schemaRoot: "specs/002-qa-manual-walking-skeleton/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/002-qa-manual-walking-skeleton/contracts/openapi/qa-pack-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/002-qa-manual-walking-skeleton/contracts/asyncapi/qa-events.v1.yaml",
    ]),
    exampleManifest: "specs/002-qa-manual-walking-skeleton/contracts/examples/manifest.json",
  }),
  Object.freeze({
    key: "003-jira-operational-authority",
    order: 300,
    schemaRoot: "specs/003-jira-operational-authority/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/003-jira-operational-authority/contracts/openapi/jira-operational-authority-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/003-jira-operational-authority/contracts/asyncapi/jira-operational-events.v1.yaml",
    ]),
  }),
  Object.freeze({
    key: "004-mattermost-hermes-intake",
    order: 400,
    schemaRoot: "specs/004-mattermost-hermes-intake/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/004-mattermost-hermes-intake/contracts/openapi/mattermost-hermes-intake-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/004-mattermost-hermes-intake/contracts/asyncapi/mattermost-hermes-events.v1.yaml",
    ]),
  }),
  Object.freeze({
    key: "005-gitlab-automated-validation",
    order: 500,
    schemaRoot: "specs/005-gitlab-automated-validation/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/005-gitlab-automated-validation/contracts/openapi/gitlab-automated-validation-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/005-gitlab-automated-validation/contracts/asyncapi/gitlab-automated-validation-events.v1.yaml",
    ]),
    exampleManifest:
      "specs/005-gitlab-automated-validation/contracts/examples/negative/manifest.v1.json",
  }),
  Object.freeze({
    key: "006-queue-triage-capacity-sla",
    order: 600,
    schemaRoot: "specs/006-queue-triage-capacity-sla/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/006-queue-triage-capacity-sla/contracts/openapi/queue-triage-capacity-sla-api.v1.yaml",
      "specs/006-queue-triage-capacity-sla/contracts/openapi/core-approval-api.v1.1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/006-queue-triage-capacity-sla/contracts/asyncapi/queue-triage-capacity-sla-events.v1.yaml",
    ]),
  }),
  Object.freeze({
    key: "007-project-onboarding-evidence-security",
    order: 700,
    schemaRoot: "specs/007-project-onboarding-evidence-security/contracts/schemas",
    openapiDocuments: Object.freeze([
      "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-evidence-api.v1.yaml",
      "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-api.v1.1.yaml",
      "specs/007-project-onboarding-evidence-security/contracts/openapi/project-reads-api.v1.yaml",
    ]),
    asyncapiDocuments: Object.freeze([
      "specs/007-project-onboarding-evidence-security/contracts/asyncapi/project-onboarding-evidence-events.v1.yaml",
    ]),
  }),
  pilotContractContribution,
] as const satisfies readonly DesignContractContribution[]);

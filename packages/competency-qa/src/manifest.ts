import type {
  CompetencyPackManifest,
  UiContributionDeclaration,
  WorkTypeDefinition,
} from "@awp/competency-sdk";
import type { SchemaReference } from "@awp/platform-contracts";

export const qaRequestKinds = Object.freeze([
  "feature-validation",
  "smoke",
  "regression",
  "retest",
  "investigation",
] as const);
export type QaRequestKind = (typeof qaRequestKinds)[number];

export const qaSessionModes = Object.freeze(["MANUAL"] as const);
export type QaSessionMode = (typeof qaSessionModes)[number];

export const qaPermissionCatalog = Object.freeze([
  "qa.request.create",
  "qa.request.confirm",
  "qa.request.input.revise",
  "qa.readiness.evaluate",
  "qa.readiness.confirm",
  "qa.readiness.waive",
  "qa.required-session-plan.publish",
  "qa.session.plan",
  "qa.session.execute",
  "qa.session.review",
  "qa.plan-item.result",
  "qa.finding.classify",
  "qa.finding.accept-risk",
  "qa.defect.draft",
  "qa.defect.publish",
  "qa.evidence.write",
  "qa.evidence.read",
  "qa.evidence.post-close-correction.record",
  "qa.verdict.sign",
  "qa.verdict.cosign",
  "qa.waiver.approve",
  "qa.completion.request",
  "qa.completion.approve",
] as const);
export type QaPermission = (typeof qaPermissionCatalog)[number];

export interface QaPermissionDeclaration {
  readonly key: QaPermission;
  readonly version: "1.0.0";
  readonly owner: "competency-qa";
}

export const qaPermissionDeclarations = Object.freeze(
  qaPermissionCatalog.map((key): QaPermissionDeclaration =>
    Object.freeze({
      key,
      version: "1.0.0",
      owner: "competency-qa",
    }),
  ),
);

export const qaSchemaReferences = Object.freeze({
  intake: Object.freeze({
    id: "urn:awp:schemas:qa:intake:v1",
    version: 1,
    digest: "sha256:ad12fce95a79e073efd7a4d853db05628211104a93e330d5455a81c2fab54837",
  } satisfies SchemaReference),
  eventEnvelope: Object.freeze({
    id: "urn:awp:schemas:qa:event-envelope:v1",
    version: 1,
    digest: "sha256:e1dd2d32206967f4fd4637f05b26a7da3ad8b9f465e46936d829c94d31079030",
  } satisfies SchemaReference),
  events: Object.freeze({
    id: "urn:awp:schemas:qa:events:v1",
    version: 1,
    digest: "sha256:f4fefa58296b1cd7157c93b8cda88e9cafab223a29844d40635d6350a6140571",
  } satisfies SchemaReference),
});

export const qaEventTypes = Object.freeze([
  "qa.request.accepted",
  "qa.request.input-revised",
  "qa.readiness.assessed",
  "qa.readiness.confirmed",
  "qa.required-session-plan.published",
  "qa.test-session.state-changed",
  "qa.test-session.reviewed",
  "qa.plan-item.result-recorded",
  "qa.finding.classified",
  "qa.finding.disposed",
  "qa.defect.linked",
  "qa.evidence.manifest-signed",
  "qa.verdict.signed",
  "qa.dod.assessed",
  "qa.dod.satisfied",
  "qa.post-close-correction.recorded",
  "qa.automation-attempt.created",
  "qa.automation-attempt.status-observed",
  "qa.automation-attempt.completed",
  "qa.automation-artifact.registered",
  "qa.automation-retry.decided",
  "qa.automation-quarantine.changed",
] as const);
/** Additive event identities are declared only by manifest v1.3. */
export const qaAdditiveEventTypes = Object.freeze([
  "qa.triage-assessment.created",
  "qa.triage-assessment.stale",
  "qa.automated-session.ready",
  "qa.queue-facts.changed",
] as const);
export type QaEventType = (typeof qaEventTypes)[number] | (typeof qaAdditiveEventTypes)[number];

export const qaEventDeclarations = Object.freeze(
  qaEventTypes.map((eventType) =>
    Object.freeze({
      eventType,
      payloadVersion: 1,
      payloadSchemaRef: qaSchemaReferences.events,
    }),
  ),
);

export const qaUiContributionDeclarations = Object.freeze([
  Object.freeze({
    slot: "WORK_ITEM_DETAIL_TAB",
    routeSegment: "qa",
    componentRef: "qa.ui.work-item-detail",
  }),
] as const satisfies readonly UiContributionDeclaration[]);

export interface QaRuntimeContributionDeclaration {
  readonly kind:
    "PLATFORM_ACTION_HANDLER" | "OPERATIONAL_CONFIRMATION_HOOK" | "EXTERNAL_COMMAND_LIFECYCLE_HOOK";
  readonly componentRef: string;
}

export const qaActionContributionDeclarations = Object.freeze([
  Object.freeze({
    kind: "PLATFORM_ACTION_HANDLER",
    componentRef: "qa.actions",
  }),
] as const satisfies readonly QaRuntimeContributionDeclaration[]);

export const qaHookContributionDeclarations = Object.freeze([
  Object.freeze({
    kind: "OPERATIONAL_CONFIRMATION_HOOK",
    componentRef: "qa.confirmation-hooks",
  }),
  Object.freeze({
    kind: "EXTERNAL_COMMAND_LIFECYCLE_HOOK",
    componentRef: "qa.external-command-lifecycle-hooks",
  }),
] as const satisfies readonly QaRuntimeContributionDeclaration[]);

export const qaValidationWorkTypeDefinition = Object.freeze({
  key: "qa.validation",
  definitionVersion: "1.0.0",
  displayName: "QA Validation",
  intakeSchemaRef: qaSchemaReferences.intake,
  applicationComponentRef: "qa.application.module",
  migrationNamespace: "competency_qa",
  uiContributions: qaUiContributionDeclarations,
  capabilityRequirements: Object.freeze([
    Object.freeze({
      requirementKey: "qa-request-authority",
      capabilityKey: "operational-work-item",
      versionRange: ">=1.0.0 <2.0.0",
      logicalRole: "QA_REQUEST_AUTHORITY",
      operations: Object.freeze(["request.create", "request.transition"]),
      requirement: "REQUIRED",
      featureKey: "qa.request-authority",
      allowedEnvironmentScopes: Object.freeze(["LOCAL"] as const),
      maxDataClassification: "INTERNAL",
    }),
    Object.freeze({
      requirementKey: "defect-destination",
      capabilityKey: "operational-work-item",
      versionRange: ">=1.0.0 <2.0.0",
      logicalRole: "DEFECT_DESTINATION",
      operations: Object.freeze(["defect.create"]),
      requirement: "OPTIONAL",
      featureKey: "qa.defect-destination",
      allowedEnvironmentScopes: Object.freeze(["LOCAL"] as const),
      maxDataClassification: "INTERNAL",
    }),
  ]),
} as const satisfies WorkTypeDefinition);

export const qaCompetencyManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "CompetencyPack",
  metadata: Object.freeze({
    key: "competency-qa",
    version: "1.0.0",
    displayName: "QA Competency Pack",
  }),
  requires: Object.freeze({
    coreContracts: ">=1.0.0 <2.0.0",
    competencySdk: ">=1.0.0 <2.0.0",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinition]),
  events: qaEventDeclarations,
} as const satisfies CompetencyPackManifest);

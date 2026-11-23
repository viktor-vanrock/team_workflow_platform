import { qaCompetencyManifest, qaValidationWorkTypeDefinition } from "./manifest.ts";

const messagingRequirements = Object.freeze([
  Object.freeze({
    requirementKey: "intake-messaging",
    capabilityKey: "messaging.intake",
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "INTAKE_MESSAGING",
    operations: Object.freeze(["intake.present"]),
    requirement: "REQUIRED",
    featureKey: "qa.intake-messaging",
    allowedEnvironmentScopes: Object.freeze(["LOCAL"]),
    maxDataClassification: "INTERNAL",
  }),
  Object.freeze({
    requirementKey: "notification-messaging",
    capabilityKey: "messaging.notify",
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "NOTIFICATION_MESSAGING",
    operations: Object.freeze(["notification.send"]),
    requirement: "REQUIRED",
    featureKey: "qa.notification-messaging",
    allowedEnvironmentScopes: Object.freeze(["LOCAL"]),
    maxDataClassification: "INTERNAL",
  }),
  Object.freeze({
    requirementKey: "interaction-messaging",
    capabilityKey: "messaging.callback",
    versionRange: ">=1.0.0 <2.0.0",
    logicalRole: "INTERACTION_MESSAGING",
    operations: Object.freeze(["callback.present"]),
    requirement: "OPTIONAL",
    featureKey: "qa.interaction-messaging",
    allowedEnvironmentScopes: Object.freeze(["LOCAL"]),
    maxDataClassification: "INTERNAL",
  }),
] as const);

export const qaValidationWorkTypeDefinitionV11 = Object.freeze({
  ...qaValidationWorkTypeDefinition,
  definitionVersion: "1.1.0",
  capabilityRequirements: Object.freeze([
    ...qaValidationWorkTypeDefinition.capabilityRequirements,
    ...messagingRequirements,
  ]),
});

export const qaCompetencyManifestV11 = Object.freeze({
  ...qaCompetencyManifest,
  metadata: Object.freeze({
    ...qaCompetencyManifest.metadata,
    version: "1.1.0",
    displayName: "QA Competency Pack with Mattermost and Hermes",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinitionV11]),
});

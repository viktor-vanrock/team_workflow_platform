import type { EntitySchema } from "typeorm";

import { agentNotificationEntities } from "./agent-notification.entities.ts";
import { approvalsIdempotencyEntities } from "./approvals-idempotency.entities.ts";
import { auditEntities } from "./audit.entities.ts";
import { connectorDeliveryEntities } from "./connector-delivery.entities.ts";
import { corporateSessionEntities } from "./corporate-session.entities.ts";
import { extensionRegistryEntities } from "./extension-registry.entities.ts";
import { identityWorkspaceEntities } from "./identity-workspace.entities.ts";
import { intakeInteractionEntities } from "./intake-interaction.entities.ts";
import { integrationConfigurationEntities } from "./integration-configuration.entities.ts";
import { operationalAuthorityEntities } from "./operational-authority.entities.ts";
import { pilotEntities } from "./pilot.entities.ts";
import { platformPrimitiveEntities } from "./platform-primitives.entities.ts";
import { projectOnboardingEntities } from "./project-onboarding.entities.ts";
import { projectEntitlementEntities } from "./projects-entitlements.entities.ts";
import { queueManagementEntities } from "./queue-management.entities.ts";
import { runtimeConfigurationEntities } from "./runtime-configuration.entities.ts";
import { RuntimeRegistrationEntity } from "./runtime-registration.entities.ts";
import { workAndArtifactEntities } from "./work-and-artifacts.entities.ts";

export const coreEntities: readonly EntitySchema[] = Object.freeze([
  ...platformPrimitiveEntities,
  ...identityWorkspaceEntities,
  ...projectEntitlementEntities,
  ...extensionRegistryEntities,
  ...integrationConfigurationEntities,
  ...workAndArtifactEntities,
  ...approvalsIdempotencyEntities,
  ...connectorDeliveryEntities,
  ...auditEntities,
  ...operationalAuthorityEntities,
  ...intakeInteractionEntities,
  ...agentNotificationEntities,
  ...queueManagementEntities,
  ...projectOnboardingEntities,
  ...pilotEntities,
  ...corporateSessionEntities,
  RuntimeRegistrationEntity,
  ...runtimeConfigurationEntities,
]);

export const onboardingFoundationEntities: readonly EntitySchema[] = Object.freeze([
  ...projectOnboardingEntities,
  ...projectEntitlementEntities.filter(({ options }) =>
    String(options.tableName).startsWith("project_entitlement_"),
  ),
  ...integrationConfigurationEntities.filter(({ options }) =>
    [
      "binding_functional_acceptances",
      "capability_probe_results",
      "capability_mode_assessments",
      "project_operational_action_candidates",
    ].includes(String(options.tableName)),
  ),
  ...workAndArtifactEntities.filter(({ options }) =>
    [
      "artifact_availability_heads",
      "artifact_availability_revisions",
      "artifact_retention_decisions",
      "evidence_export_records",
    ].includes(String(options.tableName)),
  ),
]);

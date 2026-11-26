import type { OwnedMigration } from "../../migration-registry.ts";
import { M0001PlatformPrimitives1700000000001 } from "./0001-platform-primitives.ts";
import { M0010IdentityWorkspace1700000000010 } from "./0010-identity-workspace.ts";
import { M0020ProjectsEntitlements1700000000020 } from "./0020-projects-entitlements.ts";
import { M0030ExtensionRegistry1700000000030 } from "./0030-extension-registry.ts";
import { M0040IntegrationConfiguration1700000000040 } from "./0040-integration-configuration.ts";
import { M0050WorkAndArtifacts1700000000050 } from "./0050-work-and-artifacts.ts";
import { M0060ApprovalsIdempotency1700000000060 } from "./0060-approvals-idempotency.ts";
import { M0070ConnectorDelivery1700000000070 } from "./0070-connector-delivery.ts";
import { M0080Audit1700000000080 } from "./0080-audit.ts";
import { M0090OperationalAuthority1700000000090 } from "./0090-operational-authority.ts";
import { M0095ExternalIdentityImportReconciliation1700000000095 } from "./0095-external-identity-import-reconciliation.ts";
import { M0100ActionCandidateDraft1700000000100 } from "./0100-action-candidate-draft.ts";
import { M0105InteractionIntents1700000000105 } from "./0105-interaction-intents.ts";
import { M0110AgentRuntime1700000000110 } from "./0110-agent-runtime.ts";
import { M0120NotificationIntents1700000000120 } from "./0120-notification-intents.ts";
import { M0130QueuePolicyCalendar1700000000130 } from "./0130-queue-policy-calendar.ts";
import { M0135QueueProjectionSla1700000000135 } from "./0135-queue-projection-sla.ts";
import { M0140QueueControlsCapacity1700000000140 } from "./0140-queue-controls-capacity.ts";
import { M0150ProjectOnboarding1700000000150 } from "./0150-project-onboarding.ts";
import { M0155ProjectBindingEntitlements1700000000155 } from "./0155-project-binding-entitlements.ts";
import { M0160ArtifactRetentionExport1700000000160 } from "./0160-artifact-retention-export.ts";
import { M0165PilotHardening1700000000165 } from "./0165-pilot-hardening.ts";
import { M0170CorporateSessions1700000000170 } from "./0170-corporate-sessions.ts";
import { M0175RuntimeRegistration1700000000175 } from "./0175-runtime-registration.ts";
import { M0180RuntimeConfiguration1700000000180 } from "./0180-runtime-configuration.ts";
import { M0185DeadLetterReplay1700000000185 } from "./0185-dead-letter-replay.ts";
import { M0190ProjectScopeConstraints1700000000190 } from "./0190-project-scope-constraints.ts";
import { M0195ProjectIncidentDispositions1700000000195 } from "./0195-project-incident-dispositions.ts";
import { M0200CapabilityProbeRequests1700000000200 } from "./0200-capability-probe-requests.ts";
import { M0205WorkspaceTeamAccess1700000000205 } from "./0205-workspace-team-access.ts";
import { M0210UnifiedSystemRoles1700000000210 } from "./0210-unified-system-roles.ts";
import { M0215PlatformAccess1700000000215 } from "./0215-platform-access.ts";
import { M0220CustomerProjectDialogues1700000000220 } from "./0220-customer-project-dialogues.ts";
import { M0225FirstCorporateAdministrator1700000000225 } from "./0225-first-corporate-administrator.ts";
import { M0230FirstLocalAdministrator1700000000230 } from "./0230-first-local-administrator.ts";
import { M0235QaWorkspaceBootstrap1700000000235 } from "./0235-qa-workspace-bootstrap.ts";
import { M0240DevBootstrapSource1700000000240 } from "./0240-dev-bootstrap-source.ts";
import { M0245PilotCommandAdmission1700000000245 } from "./0245-pilot-command-admission.ts";
import { M0250PilotFenceAction1700000000250 } from "./0250-pilot-fence-action.ts";
import { M0255NotificationTemplateEvidence1700000000255 } from "./0255-notification-template-evidence.ts";

export const coreMigrationRegistry = Object.freeze([
  { order: 1, owner: "core", migration: M0001PlatformPrimitives1700000000001 },
  { order: 10, owner: "core", migration: M0010IdentityWorkspace1700000000010 },
  { order: 20, owner: "core", migration: M0020ProjectsEntitlements1700000000020 },
  { order: 30, owner: "core", migration: M0030ExtensionRegistry1700000000030 },
  { order: 40, owner: "core", migration: M0040IntegrationConfiguration1700000000040 },
  { order: 50, owner: "core", migration: M0050WorkAndArtifacts1700000000050 },
  { order: 60, owner: "core", migration: M0060ApprovalsIdempotency1700000000060 },
  { order: 70, owner: "core", migration: M0070ConnectorDelivery1700000000070 },
  { order: 80, owner: "core", migration: M0080Audit1700000000080 },
  { order: 90, owner: "core", migration: M0090OperationalAuthority1700000000090 },
  { order: 95, owner: "core", migration: M0095ExternalIdentityImportReconciliation1700000000095 },
  { order: 100, owner: "core", migration: M0100ActionCandidateDraft1700000000100 },
  { order: 105, owner: "core", migration: M0105InteractionIntents1700000000105 },
  { order: 110, owner: "core", migration: M0110AgentRuntime1700000000110 },
  { order: 120, owner: "core", migration: M0120NotificationIntents1700000000120 },
  { order: 130, owner: "core", migration: M0130QueuePolicyCalendar1700000000130 },
  { order: 135, owner: "core", migration: M0135QueueProjectionSla1700000000135 },
  { order: 140, owner: "core", migration: M0140QueueControlsCapacity1700000000140 },
  { order: 150, owner: "core", migration: M0150ProjectOnboarding1700000000150 },
  { order: 155, owner: "core", migration: M0155ProjectBindingEntitlements1700000000155 },
  { order: 160, owner: "core", migration: M0160ArtifactRetentionExport1700000000160 },
  { order: 165, owner: "core", migration: M0165PilotHardening1700000000165 },
  { order: 170, owner: "core", migration: M0170CorporateSessions1700000000170 },
  { order: 175, owner: "core", migration: M0175RuntimeRegistration1700000000175 },
  { order: 180, owner: "core", migration: M0180RuntimeConfiguration1700000000180 },
  { order: 185, owner: "core", migration: M0185DeadLetterReplay1700000000185 },
  { order: 190, owner: "core", migration: M0190ProjectScopeConstraints1700000000190 },
  { order: 195, owner: "core", migration: M0195ProjectIncidentDispositions1700000000195 },
  { order: 200, owner: "core", migration: M0200CapabilityProbeRequests1700000000200 },
  { order: 205, owner: "core", migration: M0205WorkspaceTeamAccess1700000000205 },
  { order: 210, owner: "core", migration: M0210UnifiedSystemRoles1700000000210 },
  { order: 215, owner: "core", migration: M0215PlatformAccess1700000000215 },
  { order: 220, owner: "core", migration: M0220CustomerProjectDialogues1700000000220 },
  { order: 225, owner: "core", migration: M0225FirstCorporateAdministrator1700000000225 },
  { order: 230, owner: "core", migration: M0230FirstLocalAdministrator1700000000230 },
  { order: 235, owner: "core", migration: M0235QaWorkspaceBootstrap1700000000235 },
  { order: 240, owner: "core", migration: M0240DevBootstrapSource1700000000240 },
  { order: 245, owner: "core", migration: M0245PilotCommandAdmission1700000000245 },
  { order: 250, owner: "core", migration: M0250PilotFenceAction1700000000250 },
  { order: 255, owner: "core", migration: M0255NotificationTemplateEvidence1700000000255 },
] satisfies readonly OwnedMigration[]);

export {
  M0001PlatformPrimitives1700000000001,
  M0010IdentityWorkspace1700000000010,
  M0020ProjectsEntitlements1700000000020,
  M0030ExtensionRegistry1700000000030,
  M0040IntegrationConfiguration1700000000040,
  M0050WorkAndArtifacts1700000000050,
  M0060ApprovalsIdempotency1700000000060,
  M0070ConnectorDelivery1700000000070,
  M0080Audit1700000000080,
  M0090OperationalAuthority1700000000090,
  M0095ExternalIdentityImportReconciliation1700000000095,
  M0100ActionCandidateDraft1700000000100,
  M0105InteractionIntents1700000000105,
  M0110AgentRuntime1700000000110,
  M0120NotificationIntents1700000000120,
  M0130QueuePolicyCalendar1700000000130,
  M0135QueueProjectionSla1700000000135,
  M0140QueueControlsCapacity1700000000140,
  M0150ProjectOnboarding1700000000150,
  M0155ProjectBindingEntitlements1700000000155,
  M0160ArtifactRetentionExport1700000000160,
};
export { M0165PilotHardening1700000000165 };
export { M0170CorporateSessions1700000000170 };
export { M0175RuntimeRegistration1700000000175 };

export { M0180RuntimeConfiguration1700000000180 };
export { M0185DeadLetterReplay1700000000185 };
export { M0190ProjectScopeConstraints1700000000190 };

export { M0200CapabilityProbeRequests1700000000200 };

export { M0205WorkspaceTeamAccess1700000000205 };

export { M0210UnifiedSystemRoles1700000000210 };

export { M0215PlatformAccess1700000000215 };
export { M0220CustomerProjectDialogues1700000000220 };
export { M0225FirstCorporateAdministrator1700000000225 };
export { M0230FirstLocalAdministrator1700000000230 };

export { M0235QaWorkspaceBootstrap1700000000235 };
export { M0240DevBootstrapSource1700000000240 };
export { M0245PilotCommandAdmission1700000000245 };
export { M0250PilotFenceAction1700000000250 };
export { M0255NotificationTemplateEvidence1700000000255 };

export type AuthorizationSurface =
  "REGISTRY" | "WORK" | "CONFIGURATION" | "COMMAND" | "APPROVAL" | "AUDIT" | "ARTIFACT" | "WEBHOOK";
export type AuthorizationScopeKind = "WORKSPACE" | "PROJECT" | "CONTEXT" | "SYSTEM";

export interface AuthorizationCatalogEntry {
  readonly operation: `${string}.${string}`;
  readonly permission: string;
  readonly surface: AuthorizationSurface;
  readonly scope: AuthorizationScopeKind;
}

const entry = (
  operation: AuthorizationCatalogEntry["operation"],
  permission: string,
  surface: AuthorizationSurface,
  scope: AuthorizationScopeKind,
): AuthorizationCatalogEntry => Object.freeze({ operation, permission, surface, scope });

export const authorizationCatalog: readonly AuthorizationCatalogEntry[] = Object.freeze([
  entry(
    "ExtensionRegistryController.listPackRegistrations",
    "extension-registry.read",
    "REGISTRY",
    "WORKSPACE",
  ),
  entry(
    "ExtensionRegistryController.listConnectorRegistrations",
    "extension-registry.read",
    "REGISTRY",
    "WORKSPACE",
  ),
  entry(
    "ExtensionRegistryController.listCapabilityContracts",
    "extension-registry.read",
    "REGISTRY",
    "WORKSPACE",
  ),
  entry("ProjectsController.listVisibleProjects", "project.list-visible", "WORK", "WORKSPACE"),
  entry("WorkTypesController.changeEnablement", "work-type.manage", "WORK", "WORKSPACE"),
  entry("IntakeDraftsController.createIntakeDraft", "intake.create", "WORK", "PROJECT"),
  entry("IntakeDraftsController.getIntakeDraft", "intake.read", "WORK", "PROJECT"),
  entry("IntakeDraftsController.submitIntakeDraft", "intake.submit", "WORK", "PROJECT"),
  entry("WorkItemsController.getWorkItem", "work-item.read", "WORK", "PROJECT"),
  entry(
    "IntegrationRegistryController.createConnection",
    "integration.connection.write",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.getConnection",
    "integration.connection.read",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.validateConnection",
    "integration.connection.validate",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.publishConnection",
    "integration.connection.publish",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.health",
    "integration.connection.read",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.createMapping",
    "integration.mapping.write",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.getMapping",
    "integration.mapping.read",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.validateMapping",
    "integration.mapping.validate",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.publishMapping",
    "integration.mapping.publish",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.createProfile",
    "integration.profile.write",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.getProfile",
    "integration.profile.read",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.validateProfile",
    "integration.profile.validate",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.publishProfile",
    "integration.profile.publish",
    "CONFIGURATION",
    "WORKSPACE",
  ),
  entry(
    "IntegrationRegistryController.createBinding",
    "integration.binding.write",
    "CONFIGURATION",
    "PROJECT",
  ),
  entry(
    "IntegrationRegistryController.getBinding",
    "integration.binding.read",
    "CONFIGURATION",
    "PROJECT",
  ),
  entry(
    "IntegrationRegistryController.validateBinding",
    "integration.binding.validate",
    "CONFIGURATION",
    "PROJECT",
  ),
  entry(
    "IntegrationRegistryController.availability",
    "integration.binding.read",
    "CONFIGURATION",
    "PROJECT",
  ),
  entry(
    "IntegrationRegistryController.report",
    "integration.validation-report.read",
    "CONFIGURATION",
    "CONTEXT",
  ),
  entry("ControlPlaneController.command", "command.read", "COMMAND", "PROJECT"),
  entry(
    "ControlPlaneController.requestPublication",
    "integration.binding.request-publication",
    "COMMAND",
    "PROJECT",
  ),
  entry("ControlPlaneController.approval", "approval.read", "APPROVAL", "PROJECT"),
  entry("ControlPlaneController.decide", "approval.decide", "APPROVAL", "PROJECT"),
  entry("ControlPlaneController.webhook", "webhook.ingest", "WEBHOOK", "SYSTEM"),
  entry("AuditController.project", "audit.project.read", "AUDIT", "PROJECT"),
  entry("AuditController.workspace", "audit.workspace-security.read", "AUDIT", "WORKSPACE"),
  entry("ArtifactsController.getArtifactMetadata", "artifact.read", "ARTIFACT", "PROJECT"),
  entry("ArtifactsController.streamArtifactContent", "artifact.read", "ARTIFACT", "PROJECT"),
]);

export function authorizationEntry(
  operation: AuthorizationCatalogEntry["operation"],
): AuthorizationCatalogEntry {
  const found = authorizationCatalog.find((candidate) => candidate.operation === operation);
  if (found === undefined) throw new Error(`AUTHORIZATION_OPERATION_UNCATALOGED:${operation}`);
  return found;
}

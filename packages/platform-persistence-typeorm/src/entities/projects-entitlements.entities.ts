import { EntitySchema } from "typeorm";

export const ProjectEntity = new EntitySchema({
  name: "Project",
  tableName: "projects",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    key: { type: String },
    name: { type: String },
    state: { type: String },
    classificationKey: { name: "classification_key", type: String },
    registrationStatus: { name: "registration_status", type: String, default: "ACTIVE" },
    currentRegistryVersion: { name: "current_registry_version", type: Number, default: 1 },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
  uniques: [{ columns: ["workspaceId", "id"] }, { columns: ["workspaceId", "key"] }],
});
export const ProjectEntitlementEntity = new EntitySchema({
  name: "ProjectEntitlement",
  tableName: "project_entitlements",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    principalId: { name: "principal_id", type: "uuid" },
    effect: { type: String },
    classificationCeilingKey: { name: "classification_ceiling_key", type: String },
    permissions: { type: "jsonb" },
    validFrom: { name: "valid_from", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz", nullable: true },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    currentVersion: { name: "current_version", type: Number, default: 1 },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});
export const ProjectEntitlementPermissionEntity = new EntitySchema({
  name: "ProjectEntitlementPermission",
  tableName: "project_entitlement_permissions",
  columns: {
    entitlementId: { name: "entitlement_id", type: "uuid", primary: true },
    permissionKey: { name: "permission_key", type: String, primary: true },
  },
});
export const ProjectEntitlementHeaderEntity = new EntitySchema({
  name: "ProjectEntitlementHeader",
  tableName: "project_entitlement_headers",
  columns: {
    entitlementId: { name: "entitlement_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    principalId: { name: "principal_id", type: "uuid" },
    currentVersion: { name: "current_version", type: Number },
    currentEffect: { name: "current_effect", type: String },
    currentPermissions: { name: "current_permissions", type: "jsonb" },
    classificationCeilingKey: { name: "classification_ceiling_key", type: String },
    validFrom: { name: "valid_from", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz", nullable: true },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    rowVersion: { name: "row_version", type: Number, default: 1 },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "entitlementId"] }],
});
export const ProjectEntitlementRevisionEntity = new EntitySchema({
  name: "ProjectEntitlementRevision",
  tableName: "project_entitlement_revisions",
  columns: {
    revisionId: { name: "revision_id", type: "uuid", primary: true },
    entitlementId: { name: "entitlement_id", type: "uuid" },
    version: { type: Number },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    principalId: { name: "principal_id", type: "uuid" },
    operation: { type: String },
    effect: { type: String },
    permissions: { type: "jsonb" },
    classificationCeilingKey: { name: "classification_ceiling_key", type: String },
    validFrom: { name: "valid_from", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz", nullable: true },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    previousRevisionId: { name: "previous_revision_id", type: "uuid", nullable: true },
    previousVersion: { name: "previous_version", type: Number, nullable: true },
    previousContentHash: { name: "previous_content_hash", type: String, nullable: true },
    actor: { type: "jsonb" },
    reason: { type: String },
    correlationId: { name: "correlation_id", type: String },
    createdAt: { name: "created_at", type: "timestamptz" },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [
    { columns: ["workspaceId", "projectId", "entitlementId", "version"] },
    {
      columns: [
        "revisionId",
        "workspaceId",
        "projectId",
        "entitlementId",
        "version",
        "contentHash",
      ],
    },
  ],
});
export const projectEntitlementEntities = Object.freeze([
  ProjectEntity,
  ProjectEntitlementEntity,
  ProjectEntitlementPermissionEntity,
  ProjectEntitlementHeaderEntity,
  ProjectEntitlementRevisionEntity,
]);

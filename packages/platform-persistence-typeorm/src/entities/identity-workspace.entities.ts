import { EntitySchema } from "typeorm";

const revisionColumns = {
  rowVersion: { name: "row_version", type: Number, default: 1 },
  createdAt: { name: "created_at", type: "timestamptz", createDate: true },
} as const;
export const IdentityEntity = new EntitySchema({
  name: "Identity",
  tableName: "identities",
  columns: {
    id: { type: "uuid", primary: true },
    issuer: { type: String },
    subject: { type: String },
    kind: { type: String },
    displayName: { name: "display_name", type: String },
    ...revisionColumns,
  },
  uniques: [{ columns: ["issuer", "subject"] }],
});
export const WorkspaceEntity = new EntitySchema({
  name: "Workspace",
  tableName: "workspaces",
  columns: {
    id: { type: "uuid", primary: true },
    key: { type: String, unique: true },
    name: { type: String },
    state: { type: String },
    ...revisionColumns,
  },
});
export const WorkspaceMembershipEntity = new EntitySchema({
  name: "WorkspaceMembership",
  tableName: "workspace_memberships",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    principalId: { name: "principal_id", type: "uuid" },
    state: { type: String },
    validFrom: { name: "valid_from", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz", nullable: true },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    ...revisionColumns,
  },
});
export const RoleAssignmentEntity = new EntitySchema({
  name: "RoleAssignment",
  tableName: "role_assignments",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid", nullable: true },
    principalId: { name: "principal_id", type: "uuid" },
    roleKey: { name: "role_key", type: String },
    effect: { type: String },
    permissions: { type: "jsonb" },
    validFrom: { name: "valid_from", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz", nullable: true },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    ...revisionColumns,
  },
});
export const identityWorkspaceEntities = Object.freeze([
  IdentityEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  RoleAssignmentEntity,
]);

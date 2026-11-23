/** Separate management plane; this context cannot be used as WorkspaceContext. */
export const platformAccessPermissions = [
  "platform.users.read",
  "platform.workspace-roles.manage",
] as const;
export type PlatformAccessPermission = (typeof platformAccessPermissions)[number];
export interface PlatformAccessContext {
  readonly principalId: string;
  readonly permission: PlatformAccessPermission;
  readonly assignmentSource:
    "LOCAL_BOOTSTRAP" | "LOCAL_FIRST_LOGIN" | "CORPORATE_GROUP" | "CORPORATE_FIRST_LOGIN";
}

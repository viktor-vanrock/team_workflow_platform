/** Read historical aliases without changing identity, permissions, scope or approval hashes. */
export function canonicalRoleKey(role: string): string {
  const key = role.toLowerCase().replaceAll("_", "-");
  if (
    [
      "workspace-owner",
      "integration-admin",
      "integration-administrator",
      "system-administrator",
    ].includes(key)
  )
    return "system-administrator";
  if (["limited-reader", "viewer", "reader"].includes(key)) return "reader";
  return role;
}

export const isSystemAdministratorRole = (role: string) =>
  canonicalRoleKey(role) === "system-administrator";

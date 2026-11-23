export function createOperationalNotifications(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    state: "SUSPENDED" | "ACTIVE";
    incidentRef: string;
  }>,
) {
  return Object.freeze(
    ["system-administrator", "qa-lead"].map((role) =>
      Object.freeze({
        dedupeKey: `project:${input.projectId}:${input.state}:${role}`,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        targetRole: role,
        payload: { state: input.state, incidentRef: input.incidentRef },
        fallback: "WEB_AND_OUTBOX" as const,
      }),
    ),
  );
}

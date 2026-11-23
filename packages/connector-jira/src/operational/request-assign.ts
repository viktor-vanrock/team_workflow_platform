export interface JiraAssignmentBinding {
  readonly canonicalPrincipalId: string;
  readonly providerSubject: string;
  readonly state: "VERIFIED" | "REVOKED" | "PENDING";
}
export function resolveJiraAssignmentSubject(
  input: Readonly<{
    canonicalPrincipalId: string;
    clientPayload: Readonly<Record<string, unknown>>;
    bindings: readonly JiraAssignmentBinding[];
  }>,
): string {
  if ("accountId" in input.clientPayload || "providerSubject" in input.clientPayload)
    throw new Error("ASSIGNMENT_PROVIDER_ID_FORBIDDEN");
  const matches = input.bindings.filter(
    (value) =>
      value.canonicalPrincipalId === input.canonicalPrincipalId && value.state === "VERIFIED",
  );
  if (matches.length !== 1) throw new Error("ASSIGNMENT_SUBJECT_NOT_VERIFIED");
  return matches[0]!.providerSubject;
}
export function mapJiraAssignment(
  input: Readonly<{
    canonicalPrincipalId?: string;
    verifiedProviderSubject?: string;
    unassign?: boolean;
  }>,
) {
  if (input.unassign === true) {
    if (input.canonicalPrincipalId || input.verifiedProviderSubject)
      throw new Error("ASSIGNMENT_INPUT_CONFLICT");
    return Object.freeze({ fields: Object.freeze({ assignee: null }) });
  }
  if (!input.canonicalPrincipalId || !input.verifiedProviderSubject)
    throw new Error("ASSIGNMENT_VERIFIED_SUBJECT_REQUIRED");
  return Object.freeze({
    fields: Object.freeze({
      assignee: Object.freeze({ accountId: input.verifiedProviderSubject }),
    }),
  });
}

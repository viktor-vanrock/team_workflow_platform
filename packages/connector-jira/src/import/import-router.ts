export interface ImportRouteCandidate {
  readonly workspaceId?: string;
  readonly connectionHeaderId?: string;
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly discriminator: string;
  readonly externalEntityId: string;
}
export interface ImportRouteProfile {
  readonly workspaceId?: string;
  readonly connectionHeaderId?: string;
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly discriminator: string;
  readonly profileStatus: "VALID" | "DRIFTED" | "INVALID";
}
export type ImportRouteResult =
  | Readonly<{
      state: "IGNORED_OUT_OF_SCOPE" | "REJECTED_SECURITY" | "BLOCKED_MAPPING";
      reasonCode: string;
      externalEntityId: string;
    }>
  | Readonly<{ state: "ROUTED"; externalEntityId: string; authoritativeContent: unknown }>;
export async function routeImportCandidate(
  candidate: ImportRouteCandidate,
  profile: ImportRouteProfile,
  authoritativeRead: () => Promise<unknown>,
): Promise<ImportRouteResult> {
  if (candidate.workspaceId && profile.workspaceId && candidate.workspaceId !== profile.workspaceId)
    return Object.freeze({
      state: "REJECTED_SECURITY",
      reasonCode: "WORKSPACE_SCOPE_MISMATCH",
      externalEntityId: candidate.externalEntityId,
    });
  if (
    candidate.connectionHeaderId &&
    profile.connectionHeaderId &&
    candidate.connectionHeaderId !== profile.connectionHeaderId
  )
    return Object.freeze({
      state: "REJECTED_SECURITY",
      reasonCode: "CONNECTION_SCOPE_MISMATCH",
      externalEntityId: candidate.externalEntityId,
    });
  if (profile.profileStatus !== "VALID")
    return Object.freeze({
      state: "BLOCKED_MAPPING",
      reasonCode: "PROFILE_UNAVAILABLE",
      externalEntityId: candidate.externalEntityId,
    });
  if (candidate.projectId !== profile.projectId)
    return Object.freeze({
      state: "IGNORED_OUT_OF_SCOPE",
      reasonCode: "PROJECT_MISMATCH",
      externalEntityId: candidate.externalEntityId,
    });
  if (candidate.issueTypeId !== profile.issueTypeId)
    return Object.freeze({
      state: "IGNORED_OUT_OF_SCOPE",
      reasonCode: "ISSUE_TYPE_MISMATCH",
      externalEntityId: candidate.externalEntityId,
    });
  if (candidate.discriminator !== profile.discriminator)
    return Object.freeze({
      state: "IGNORED_OUT_OF_SCOPE",
      reasonCode: "DISCRIMINATOR_MISMATCH",
      externalEntityId: candidate.externalEntityId,
    });
  return Object.freeze({
    state: "ROUTED",
    externalEntityId: candidate.externalEntityId,
    authoritativeContent: await authoritativeRead(),
  });
}

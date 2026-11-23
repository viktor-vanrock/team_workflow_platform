import type { MattermostPilotMetadataPackage } from "@awp/platform-contracts";

export interface MattermostProfileCandidate {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly teamId: string;
  readonly botUserId: string;
  readonly channelIds: readonly string[];
}

export interface MattermostProfileValidationInput {
  readonly metadata: MattermostPilotMetadataPackage;
  readonly profile: MattermostProfileCandidate;
  readonly activeAliases?: readonly MattermostProfileCandidate[];
}

export function validateMattermostProfile(input: MattermostProfileValidationInput): Readonly<{
  status: "VALID";
  projectId: string;
  reconciliation: "PENDING_POST_ID" | "EFFECT_MARKER";
}> {
  const { metadata, profile } = input;
  if (profile.workspaceId !== metadata.workspaceId || profile.projectId !== metadata.projectId)
    throw new Error("MATTERMOST_PROFILE_SCOPE_MISMATCH");
  if (profile.teamId !== metadata.teamId || profile.botUserId !== metadata.botUserId)
    throw new Error("MATTERMOST_PROFILE_IDENTITY_MISMATCH");
  if (
    profile.channelIds.length === 0 ||
    new Set(profile.channelIds).size !== profile.channelIds.length ||
    profile.channelIds.some((id) => !metadata.channelIds.includes(id))
  )
    throw new Error("MATTERMOST_PROFILE_CHANNEL_INVALID");
  for (const alias of input.activeAliases ?? []) {
    if (alias.workspaceId === profile.workspaceId && alias.projectId === profile.projectId)
      continue;
    if (
      alias.botUserId === profile.botUserId ||
      alias.channelIds.some((id) => profile.channelIds.includes(id))
    )
      throw new Error("MATTERMOST_PROFILE_ACTIVE_ALIAS_CONFLICT");
  }
  const limits = metadata.validatedServerLimits as Readonly<Record<string, unknown>>;
  if (limits.pendingPostIdLookupSupported !== true && limits.effectMarkerLookupSupported !== true)
    throw new Error("MATTERMOST_PROFILE_RECONCILIATION_UNSUPPORTED");
  return Object.freeze({
    status: "VALID",
    projectId: profile.projectId,
    reconciliation:
      limits.pendingPostIdLookupSupported === true ? "PENDING_POST_ID" : "EFFECT_MARKER",
  });
}

export interface NormalizedPostAction {
  readonly intentToken: string;
  readonly externalUserId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly postId: string;
  readonly actionId: string;
}
export function normalizePostAction(input: unknown): NormalizedPostAction {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("MATTERMOST_ACTION_SHAPE_INVALID");
  const value = input as Record<string, unknown>;
  const context = value.context as Record<string, unknown> | undefined;
  const result = {
    intentToken: String(context?.intentToken ?? context?.intent_token ?? ""),
    externalUserId: String(value.user_id ?? ""),
    teamId: String(value.team_id ?? ""),
    channelId: String(value.channel_id ?? ""),
    postId: String(value.post_id ?? ""),
    actionId: String(value.action_id ?? ""),
  };
  if (Object.values(result).some((item) => item.length === 0 || item.length > 512))
    throw new Error("MATTERMOST_ACTION_REQUIRED_FIELD_INVALID");
  return Object.freeze(result);
}

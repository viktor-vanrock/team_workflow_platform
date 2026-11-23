export interface NormalizedDialogSubmission {
  readonly intentToken: string;
  readonly externalUserId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly callbackId: string;
  readonly values: Readonly<Record<string, string>>;
}
export function normalizeDialogSubmission(
  input: unknown,
  maxFields = 32,
): NormalizedDialogSubmission {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("MATTERMOST_DIALOG_SHAPE_INVALID");
  const value = input as Record<string, unknown>;
  const submission = value.submission;
  if (
    !submission ||
    typeof submission !== "object" ||
    Array.isArray(submission) ||
    Object.keys(submission).length > maxFields
  )
    throw new Error("MATTERMOST_DIALOG_VALUES_INVALID");
  const values: Record<string, string> = {};
  for (const [key, field] of Object.entries(submission)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) ||
      typeof field !== "string" ||
      field.length > 4_000
    )
      throw new Error("MATTERMOST_DIALOG_VALUE_INVALID");
    values[key] = field;
  }
  const token = String(value.state ?? value.callback_id ?? "");
  const result = {
    intentToken: token,
    externalUserId: String(value.user_id ?? ""),
    teamId: String(value.team_id ?? ""),
    channelId: String(value.channel_id ?? ""),
    callbackId: String(value.callback_id ?? ""),
    values: Object.freeze(values),
  };
  if (Object.values(result).some((item) => typeof item === "string" && item.length === 0))
    throw new Error("MATTERMOST_DIALOG_REQUIRED_FIELD_MISSING");
  return Object.freeze(result);
}

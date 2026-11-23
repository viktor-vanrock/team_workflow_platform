export interface MattermostBootstrapEnvelope {
  readonly command: string;
  readonly text: string;
  readonly [key: string]: unknown;
}

const allowedFields = new Set([
  "token",
  "team_id",
  "team_domain",
  "channel_id",
  "channel_name",
  "user_id",
  "user_name",
  "command",
  "text",
  "response_url",
  "trigger_id",
]);

export class MattermostBootstrapAdapter {
  readonly #acknowledgement: Readonly<{ response_type: "ephemeral"; text: string }>;
  constructor(
    oidcContinuationUrl: string,
    private readonly maxBytes = 16_384,
  ) {
    const url = new URL(oidcContinuationUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash)
      throw new Error("MATTERMOST_BOOTSTRAP_CONTINUATION_INVALID");
    this.#acknowledgement = Object.freeze({ response_type: "ephemeral", text: url.toString() });
  }
  respond(envelope: unknown): Readonly<{ response_type: "ephemeral"; text: string }> {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      throw new Error("MATTERMOST_BOOTSTRAP_SHAPE_INVALID");
    const value = envelope as Readonly<Record<string, unknown>>;
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > this.maxBytes)
      throw new Error("MATTERMOST_BOOTSTRAP_TOO_LARGE");
    if (Object.keys(value).some((key) => !allowedFields.has(key)))
      throw new Error("MATTERMOST_BOOTSTRAP_FIELD_INVALID");
    if (value.command !== "/awp" || value.text !== "create")
      throw new Error("MATTERMOST_BOOTSTRAP_COMMAND_INVALID");
    for (const field of Object.values(value))
      if (typeof field !== "string" || field.length > 2_048)
        throw new Error("MATTERMOST_BOOTSTRAP_FIELD_INVALID");
    return this.#acknowledgement;
  }
}

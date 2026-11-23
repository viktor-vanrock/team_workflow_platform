import { createHmac, timingSafeEqual } from "node:crypto";

export type CallbackAuthResult = Readonly<{
  authenticated: true;
  mode: "AWP_OPAQUE_INTENT" | "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT";
  intentToken: string;
  evidenceHash: string;
}>;
const opaque = (value: string) => value.length >= 16 && !/\s/u.test(value);
export function verifyOpaqueIntent(token: string): CallbackAuthResult {
  if (!opaque(token)) throw new Error("MATTERMOST_INTENT_TOKEN_INVALID");
  return Object.freeze({
    authenticated: true,
    mode: "AWP_OPAQUE_INTENT",
    intentToken: token,
    evidenceHash: "opaque-intent-present",
  });
}
export function verifySignedProxy(input: {
  token: string;
  body: Uint8Array;
  timestamp: string;
  signatureHex: string;
  secret: string;
  now: Date;
  maxSkewSeconds: number;
}): CallbackAuthResult {
  if (!opaque(input.token)) throw new Error("MATTERMOST_INTENT_TOKEN_INVALID");
  const at = Date.parse(input.timestamp);
  if (!Number.isFinite(at) || Math.abs(input.now.getTime() - at) > input.maxSkewSeconds * 1_000)
    throw new Error("MATTERMOST_CALLBACK_STALE");
  const expected = createHmac("sha256", input.secret)
    .update(input.timestamp)
    .update(".")
    .update(input.body)
    .digest();
  const actual = Buffer.from(input.signatureHex, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("MATTERMOST_CALLBACK_SIGNATURE_INVALID");
  return Object.freeze({
    authenticated: true,
    mode: "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT",
    intentToken: input.token,
    evidenceHash: `hmac:${input.timestamp}`,
  });
}

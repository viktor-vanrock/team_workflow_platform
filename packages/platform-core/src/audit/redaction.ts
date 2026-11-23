const deniedKey =
  /authorization|cookie|secret|token|password|payload|body|locator|object[_-]?key|credential|evidence|prompt|foreign|cross[_-]?project|other[_-]?project/iu;
const deniedValue =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|secretref:\/\/|s3:\/\/|https?:\/\/[^\s/@]+:[^\s/@]+@|eyJ[a-z0-9_-]{12,}\.)/iu;
const allowedKeys = new Set([
  "entityId",
  "entityType",
  "operation",
  "commandId",
  "actionId",
  "bindingId",
  "profileId",
  "version",
  "reason",
  "effectCount",
  "latencyMs",
]);

export function redactAuditAttributes(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (deniedKey.test(key) || !allowedKeys.has(key)) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean")
      output[key] = value;
    else if (typeof value === "string" && !deniedValue.test(value)) output[key] = value;
  }
  return Object.freeze(output);
}

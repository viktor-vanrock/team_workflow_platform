/** Runtime view only: immutable stored content and its hash remain unchanged. */
export function jiraConnectionRuntimeContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  const envelope = content.connectorConfiguration;
  if (envelope === undefined) return { ...content };
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw new Error("JIRA_CONNECTION_CONFIGURATION_INVALID");
  const value = (envelope as Record<string, unknown>).value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JIRA_CONNECTION_CONFIGURATION_INVALID");
  const config = value as Record<string, unknown>;
  return {
    ...content,
    ...config,
    endpoint: config.baseUrl ?? content.endpoint,
    environmentScope: config.environment ?? content.environmentScope ?? content.environmentClass,
  };
}

export function connectorKey(content: Record<string, unknown>): unknown {
  const ref = content.connectorRef;
  return (
    content.connectorKey ??
    (ref && typeof ref === "object" && !Array.isArray(ref)
      ? (ref as Record<string, unknown>).key
      : undefined)
  );
}

/** Mapping revisions use a schema-bound value; local seed revisions use top-level fields. */
export function jiraMappingRuntimeContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  const envelope = content.mapping;
  if (envelope === undefined) return { ...content };
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw new Error("JIRA_MAPPING_CONFIGURATION_INVALID");
  const value = (envelope as Record<string, unknown>).value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JIRA_MAPPING_CONFIGURATION_INVALID");
  return { ...content, ...(value as Record<string, unknown>) };
}

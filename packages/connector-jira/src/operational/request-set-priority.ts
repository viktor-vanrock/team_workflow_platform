export function mapJiraPriority(
  input: Readonly<{ normalizedKey: string; mapping: Readonly<Record<string, string>> }>,
) {
  const id = input.mapping[input.normalizedKey];
  if (!id) throw new Error("JIRA_PRIORITY_MAPPING_REQUIRED");
  return Object.freeze({ fields: Object.freeze({ priority: Object.freeze({ id }) }) });
}

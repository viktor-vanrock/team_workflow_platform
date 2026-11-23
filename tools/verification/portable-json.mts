export function stringifyPortableJson(value: unknown, workspace: string): string {
  const normalizeString = (input: string): string =>
    input.replaceAll(process.execPath, "node").replaceAll(workspace, ".");

  return `${JSON.stringify(
    value,
    (_key, current: unknown) => (typeof current === "string" ? normalizeString(current) : current),
    2,
  )}\n`;
}

export function normalizePortableJson(json: string, workspace: string): string {
  return stringifyPortableJson(JSON.parse(json) as unknown, workspace);
}

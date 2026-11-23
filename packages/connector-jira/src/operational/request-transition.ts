export function mapJiraTransition(
  input: Readonly<{
    contractVersion: "1.0.0" | "1.1.0";
    toStatusKey: string;
    available: readonly Readonly<{ id: string; toStatusKey: string }>[];
  }>,
) {
  if (input.contractVersion === "1.0.0" && !new Set(["READY", "DONE"]).has(input.toStatusKey))
    throw new Error("TRANSITION_NOT_IN_1_0_CONTRACT");
  const matches = input.available.filter((value) => value.toStatusKey === input.toStatusKey);
  if (matches.length !== 1) throw new Error("JIRA_TRANSITION_NOT_EXACTLY_AVAILABLE");
  return Object.freeze({ transition: Object.freeze({ id: matches[0]!.id }) });
}

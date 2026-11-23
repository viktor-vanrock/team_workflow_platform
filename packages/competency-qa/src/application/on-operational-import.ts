export interface QaOperationalImportCompleteness {
  readonly workItemId: string;
  readonly completeness: "COMPLETE" | "NEEDS_INFO";
  readonly missingFields: readonly string[];
  readonly normalizedOperationalStatus: string;
}
export function onOperationalImport(
  input: Readonly<{
    workItemId: string;
    normalizedOperationalStatus: string;
    requiredFields: readonly string[];
    fields: Readonly<Record<string, unknown>>;
  }>,
): QaOperationalImportCompleteness {
  const missingFields = input.requiredFields.filter(
    (key) =>
      input.fields[key] === undefined || input.fields[key] === null || input.fields[key] === "",
  );
  return Object.freeze({
    workItemId: input.workItemId,
    completeness: missingFields.length ? "NEEDS_INFO" : "COMPLETE",
    missingFields: Object.freeze(missingFields),
    normalizedOperationalStatus: input.normalizedOperationalStatus,
  });
}

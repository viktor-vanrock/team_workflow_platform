export interface ImportDiscoveryProfile {
  readonly projectKey: string;
  readonly issueTypeId: string;
  readonly discriminatorField: string;
  readonly discriminatorValue: string;
}
export function buildImportDiscoveryQuery(profile: ImportDiscoveryProfile) {
  const values: readonly string[] = [
    profile.projectKey,
    profile.issueTypeId,
    profile.discriminatorField,
    profile.discriminatorValue,
  ];
  for (const value of values)
    if (!/^[A-Za-z0-9_.-]+$/u.test(value)) throw new Error("IMPORT_PROFILE_SCOPE_UNSAFE");
  return Object.freeze({
    jql: `project = "${profile.projectKey}" AND issuetype = "${profile.issueTypeId}" AND ${profile.discriminatorField} = "${profile.discriminatorValue}" ORDER BY updated ASC, key ASC`,
    fields: Object.freeze(["id", "key", "updated", "creator"] as const),
  });
}
export interface MinimalImportCandidate {
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly providerUpdatedAt: string;
  readonly creatorSubject: string;
}
export function minimalImportCandidates(
  rows: readonly Readonly<{
    id: string;
    key: string;
    updated: string;
    creator: Readonly<{ accountId: string }>;
  }>[],
): readonly MinimalImportCandidate[] {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        externalEntityId: row.id,
        externalDisplayKey: row.key,
        providerUpdatedAt: row.updated,
        creatorSubject: row.creator.accountId,
      }),
    ),
  );
}
export function sanitizeImportDiagnostic(
  input: Readonly<{ externalEntityId: string; reasonCode: string }>,
): Readonly<{ externalEntityId: string; reasonCode: string }> {
  return Object.freeze({ externalEntityId: input.externalEntityId, reasonCode: input.reasonCode });
}

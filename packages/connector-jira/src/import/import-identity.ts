export interface ImportExternalBinding {
  readonly workspaceId: string;
  readonly connectionHeaderId: string;
  readonly externalPrincipalId: string;
  readonly kind: "EXTERNAL_HUMAN" | "EXTERNAL_SERVICE";
  readonly state: "PENDING" | "VERIFIED" | "REVOKED" | "CONFLICT";
  readonly principalId: string;
}
export function resolveImportCreator(
  input: Readonly<{
    workspaceId: string;
    connectionHeaderId: string;
    creatorSubject: string;
    bindings: readonly ImportExternalBinding[];
  }>,
): string {
  if (input.creatorSubject.includes("@")) throw new Error("IMPORT_CREATOR_EMAIL_FORBIDDEN");
  const matches = input.bindings.filter(
    (binding) =>
      binding.workspaceId === input.workspaceId &&
      binding.connectionHeaderId === input.connectionHeaderId &&
      binding.externalPrincipalId === input.creatorSubject &&
      binding.kind === "EXTERNAL_HUMAN" &&
      binding.state === "VERIFIED",
  );
  if (matches.length !== 1) throw new Error("IMPORT_CREATOR_NOT_VERIFIED");
  return matches[0]!.principalId;
}

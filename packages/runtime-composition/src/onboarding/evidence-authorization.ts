import type { AuthorizedProjectQueryToken } from "@awp/platform-core";

export type EvidenceBoundaryOperation =
  | "ARTIFACT_METADATA"
  | "ARTIFACT_CONTENT"
  | "MANIFEST_VERIFY"
  | "PACKAGE_VERIFY"
  | "EVIDENCE_EXPORT";

export async function authorizeEvidenceBoundary<TResult>(
  input: Readonly<{
    token: AuthorizedProjectQueryToken;
    workspaceId: string;
    projectId: string;
    classificationRank: number;
    operation: EvidenceBoundaryOperation;
  }>,
  storage: () => Promise<TResult>,
): Promise<TResult> {
  if (input.workspaceId !== input.token.workspaceId)
    throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  input.token.assert(
    input.projectId,
    input.classificationRank,
    input.operation === "EVIDENCE_EXPORT" ? "MUTATE" : "READ",
  );
  return storage();
}

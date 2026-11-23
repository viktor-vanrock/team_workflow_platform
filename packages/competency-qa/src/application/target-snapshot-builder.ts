import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaExternalImmutableRef } from "../domain/qa-project-context.ts";
import { makeTargetSnapshot, type QaTargetSnapshot } from "../domain/snapshots.ts";
import { createTargetSnapshotV2, type QaTargetSnapshotV2 } from "../domain/snapshots-v2.ts";

type LegacyTargetSnapshotInput = Readonly<{
  scope: QaScope;
  buildRef: QaExternalImmutableRef;
  environmentRef: { id: string; revision: number; scope: "LOCAL" | "NON_PROD" | "PREPROD" };
  allowedEnvironments: readonly {
    environmentId: string;
    revision: number;
    scope: "LOCAL" | "NON_PROD" | "PREPROD";
  }[];
  testDataRef?: QaExternalImmutableRef;
  accountLeaseRef?: QaExternalImmutableRef;
  checklistRefs: readonly QaExternalImmutableRef[];
  bindingRef: { id: string; version: number };
  profileRefs: readonly { id: string; version: number }[];
}>;
type TargetSnapshotV2Input = Parameters<typeof createTargetSnapshotV2>[0];

export function buildTargetSnapshot(input: LegacyTargetSnapshotInput): QaTargetSnapshot;
export function buildTargetSnapshot(input: TargetSnapshotV2Input): QaTargetSnapshotV2;
export function buildTargetSnapshot(
  input: LegacyTargetSnapshotInput | TargetSnapshotV2Input,
): QaTargetSnapshot | QaTargetSnapshotV2 {
  if ("snapshotId" in input) return createTargetSnapshotV2(input);
  if (
    !input.allowedEnvironments.some(
      (allowed) =>
        allowed.environmentId === input.environmentRef.id &&
        allowed.revision === input.environmentRef.revision &&
        allowed.scope === input.environmentRef.scope,
    )
  )
    throw new QaDomainError("QA_SESSION_ENVIRONMENT_NOT_ALLOWED");
  return makeTargetSnapshot({
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    buildRef: input.buildRef,
    environmentRef: input.environmentRef,
    ...(input.testDataRef ? { testDataRef: input.testDataRef } : {}),
    ...(input.accountLeaseRef ? { accountLeaseRef: input.accountLeaseRef } : {}),
    checklistRefs: input.checklistRefs,
    bindingRef: input.bindingRef,
    profileRefs: input.profileRefs,
  });
}

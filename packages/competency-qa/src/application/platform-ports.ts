import type { QaContentHash, QaExactReference, QaWorkspaceContext } from "../domain/primitives.ts";

export interface QaProjectRegistryStatus {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly lifecycleState: "ACTIVE" | "INACTIVE";
  readonly verificationState: "CURRENT" | "NEEDS_REVIEW";
  readonly verificationRef: Readonly<{ id: string; version: number }>;
}

export interface QaProjectRegistryPort {
  current(context: QaWorkspaceContext): Promise<QaProjectRegistryStatus | undefined>;
}

export interface QaOperationalProjection {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly workTypeKey: string;
  readonly workTypeVersion: string;
  readonly normalizedStatus:
    | "NEW"
    | "NEEDS_INFO"
    | "READY"
    | "PLANNED"
    | "IN_PROGRESS"
    | "REVIEW"
    | "BLOCKED"
    | "DONE"
    | "CANCELLED";
  readonly rawExternalState: string;
  readonly externalVersion?: string;
  readonly resourceVersion: number;
}

export interface QaCurrentOperationalProjectionPort {
  current(
    context: QaWorkspaceContext,
    workItemId: string,
  ): Promise<QaOperationalProjection | undefined>;
}

export interface QaBindingHealth {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly bindingState: string;
  readonly health: "CURRENT" | "NEEDS_REVIEW" | "UNAVAILABLE";
  readonly profiles: readonly unknown[];
  readonly resourceVersion: number;
}

export interface QaBindingHealthPort {
  current(
    context: QaWorkspaceContext,
    bindingRef: Readonly<{ id: string; version: number }>,
  ): Promise<QaBindingHealth | undefined>;
}

export type QaCompletionState =
  | "CANDIDATE"
  | "AWAITING_APPROVAL"
  | "AUTHORIZED"
  | "DISPATCHED"
  | "CONFIRMED"
  | "FAILED"
  | "REJECTED"
  | "INVALIDATED";

export interface QaAdjudicativeProjection {
  readonly normalizedStatus: "NEW" | "READY" | "IN_PROGRESS" | "DONE";
  readonly aggregateSnapshotHash: QaContentHash;
  readonly completionCandidate?: QaExactReference &
    Readonly<{
      state: QaCompletionState;
    }>;
}

export interface QaAdjudicativeProjectionPort {
  current(context: QaWorkspaceContext, workItemId: string): Promise<QaAdjudicativeProjection>;
}

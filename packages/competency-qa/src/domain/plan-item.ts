import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";
import type { QaExternalImmutableRef } from "./qa-project-context.ts";

export type QaPlanItemDefinition =
  | QaExternalImmutableRef
  | Readonly<{
      kind: "session-plan-item-snapshot";
      snapshotHash: QaContentHash;
    }>;

export interface QaPlanItem {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly mode: "MANUAL";
  readonly state: "PLANNED" | "RUNNING" | "TERMINAL" | "WAIVED";
  readonly title: string;
  readonly instructions?: string;
  readonly expectedOutcome: string;
  readonly definition: QaPlanItemDefinition;
  readonly createdBy: QaHumanActor;
  readonly latestResultRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly waiverRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
  readonly contentHash: QaContentHash;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QaAutomatedPlanItem {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly ordinal: 1;
  readonly mode: "AUTOMATED";
  readonly state: "PLANNED" | "RUNNING" | "TERMINAL" | "WAIVED";
  readonly generatedFrom: "SUITE_BINDING";
  readonly suiteBindingRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly scopeSnapshotHash: QaContentHash;
  readonly targetSnapshotHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly latestResultRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly contentHash: QaContentHash;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createAutomatedPlanItem(
  input: Omit<
    QaAutomatedPlanItem,
    | "schemaVersion"
    | "ordinal"
    | "mode"
    | "state"
    | "generatedFrom"
    | "contentHash"
    | "resourceVersion"
    | "updatedAt"
  >,
): QaAutomatedPlanItem {
  if (
    [
      input.id,
      input.workspaceId,
      input.projectId,
      input.workItemId,
      input.sessionId,
      input.suiteBindingRef.id,
    ].some((value) => !value) ||
    input.suiteBindingRef.version < 1 ||
    ![input.suiteBindingRef.contentHash, input.scopeSnapshotHash, input.targetSnapshotHash].every(
      (value) => /^sha256:[a-f0-9]{64}$/u.test(value),
    ) ||
    input.createdBy.kind !== "HUMAN" ||
    Number.isNaN(Date.parse(input.createdAt))
  )
    throw new QaDomainError("QA_AUTOMATED_PLAN_ITEM_INVALID");
  const body = Object.freeze({
    schemaVersion: 2 as const,
    ...structuredClone(input),
    ordinal: 1 as const,
    mode: "AUTOMATED" as const,
    state: "PLANNED" as const,
    generatedFrom: "SUITE_BINDING" as const,
    resourceVersion: 1,
    updatedAt: input.createdAt,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
export function createQaPlanItem(
  input: Omit<
    QaPlanItem,
    "schemaVersion" | "mode" | "state" | "contentHash" | "resourceVersion" | "updatedAt"
  >,
): QaPlanItem {
  const definitionHash =
    "snapshotHash" in input.definition
      ? input.definition.snapshotHash
      : input.definition.contentHash;
  if (
    !input.id ||
    input.ordinal < 1 ||
    !input.title.trim() ||
    input.title.length > 500 ||
    !input.expectedOutcome.trim() ||
    input.expectedOutcome.length > 4_000 ||
    (input.instructions?.length ?? 0) > 10_000 ||
    !definitionHash.startsWith("sha256:")
  )
    throw new QaDomainError("QA_PLAN_ITEM_INVALID");
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    mode: "MANUAL" as const,
    state: "PLANNED" as const,
    resourceVersion: 1,
    updatedAt: input.createdAt,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

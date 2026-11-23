import {
  createQaPlanItem,
  type QaPlanItem,
  type QaPlanItemDefinition,
} from "../domain/plan-item.ts";
import { qaAggregateSnapshotHash, QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import { editPlannedSessionStructure, type QaTestSession } from "../domain/test-session.ts";

export interface QaPlanItemDraft {
  readonly id: string;
  readonly title: string;
  readonly instructions?: string;
  readonly expectedOutcome: string;
  readonly definition: QaPlanItemDefinition;
  readonly createdAt?: string;
}

export function replacePlannedItems(
  input: Readonly<{
    session: QaTestSession;
    expectedResourceVersion: number;
    actor: QaHumanActor;
    at: string;
    reason: string;
    items: readonly QaPlanItemDraft[];
  }>,
): Readonly<{ session: QaTestSession; items: readonly QaPlanItem[] }> {
  if (input.session.startedAt) throw new QaDomainError("SESSION_SNAPSHOT_LOCKED");
  const ids = new Set(input.items.map(({ id }) => id));
  if (ids.size !== input.items.length) throw new QaDomainError("QA_PLAN_ITEM_DUPLICATE");
  const items = Object.freeze(
    input.items.map((item, index) =>
      createQaPlanItem({
        ...item,
        workspaceId: input.session.workspaceId,
        projectId: input.session.projectId,
        workItemId: input.session.workItemId,
        sessionId: input.session.id,
        ordinal: index + 1,
        createdBy: input.actor,
        createdAt: item.createdAt ?? input.at,
      }),
    ),
  );
  if (items.length === 0) throw new QaDomainError("QA_SESSION_PLAN_ITEMS_REQUIRED");
  const planItemSetHash = qaAggregateSnapshotHash(
    items.map(({ id, ordinal, contentHash }) => ({ id, ordinal, contentHash })) as never,
  );
  const session = editPlannedSessionStructure(input.session, {
    actor: input.actor,
    at: input.at,
    reason: input.reason,
    expectedResourceVersion: input.expectedResourceVersion,
    planItemSetHash,
  });
  return Object.freeze({ session, items });
}

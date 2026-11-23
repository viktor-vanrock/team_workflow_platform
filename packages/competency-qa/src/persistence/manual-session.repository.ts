import type { QaPlanItem } from "../domain/plan-item.ts";
import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaTestSession } from "../domain/test-session.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export interface ManualSessionStore {
  insert(session: QaTestSession): Promise<void>;
  get(scope: QaScope, sessionId: string): Promise<QaTestSession | undefined>;
  list(scope: QaScope, workItemId: string): Promise<readonly QaTestSession[]>;
}

export interface ManualPlanItemStore {
  get(scope: QaScope, sessionId: string, planItemId: string): Promise<QaPlanItem | undefined>;
  list(scope: QaScope, sessionId: string): Promise<readonly QaPlanItem[]>;
}

export class InMemoryManualSessionRepository implements ManualSessionStore {
  readonly #sessions = new Map<string, QaTestSession>();
  async insert(session: QaTestSession): Promise<void> {
    if (
      [...this.#sessions.values()].some(
        (value) =>
          value.workspaceId === session.workspaceId &&
          value.projectId === session.projectId &&
          value.workItemId === session.workItemId &&
          value.ordinal === session.ordinal,
      )
    )
      throw new QaDomainError("QA_SESSION_ORDINAL_CONFLICT");
    if (session.parentSessionId) {
      const parent = this.#sessions.get(session.parentSessionId);
      if (
        !parent ||
        parent.workspaceId !== session.workspaceId ||
        parent.projectId !== session.projectId ||
        parent.workItemId !== session.workItemId
      )
        throw new QaDomainError("QA_SESSION_PARENT_SCOPE_MISMATCH");
    }
    this.#sessions.set(session.id, structuredClone(session));
  }
  async get(scope: QaScope, id: string) {
    const value = this.#sessions.get(id);
    return value?.workspaceId === scope.workspaceId && value.projectId === scope.projectId
      ? structuredClone(value)
      : undefined;
  }
  async list(scope: QaScope, workItemId: string) {
    return Object.freeze(
      [...this.#sessions.values()]
        .filter(
          (value) =>
            value.workspaceId === scope.workspaceId &&
            value.projectId === scope.projectId &&
            value.workItemId === workItemId,
        )
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((value) => structuredClone(value)),
    );
  }
  async reparent(sessionId: string, parentSessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    const parent = this.#sessions.get(parentSessionId);
    if (
      !session ||
      !parent ||
      session.workspaceId !== parent.workspaceId ||
      session.projectId !== parent.projectId ||
      session.workItemId !== parent.workItemId
    )
      throw new QaDomainError("QA_SESSION_PARENT_SCOPE_MISMATCH");
    let cursor: QaTestSession | undefined = parent;
    while (cursor) {
      if (cursor.id === sessionId) throw new QaDomainError("QA_SESSION_PARENT_CYCLE");
      cursor = cursor.parentSessionId ? this.#sessions.get(cursor.parentSessionId) : undefined;
    }
    this.#sessions.set(sessionId, structuredClone({ ...session, parentSessionId }));
  }
}

const rows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class TypeOrmManualSessionRepository implements ManualSessionStore {
  constructor(private readonly source: QaQueryExecutor) {}
  async insert(session: QaTestSession): Promise<void> {
    await this.source.query(
      `INSERT INTO qa_test_sessions(session_id,workspace_id,project_id,work_item_id,ordinal,parent_session_id,plan_version_id,requirement_id,requirement_key,mode,state,owner_id,required_capabilities,target_snapshot,target_hash,scope_snapshot,scope_hash,structure_revision,structure_hash,ready_against_structure_hash,resource_version,content,created_by,created_at,ready_at,started_at,blocked_at,cancelled_at,blocked_from,cancelled_from,state_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
      [
        session.id,
        session.workspaceId,
        session.projectId,
        session.workItemId,
        session.ordinal,
        session.parentSessionId ?? null,
        session.planRevisionRef.id,
        session.requirementRef.id,
        session.requirementRef.requirementKey,
        session.state,
        session.ownerId,
        JSON.stringify(session.requiredCapabilities),
        JSON.stringify(session.targetSnapshot),
        session.targetSnapshot.contentHash,
        JSON.stringify(session.scopeSnapshot),
        session.scopeSnapshot.contentHash,
        session.structureRevision,
        session.structureHash,
        session.readyAgainstStructureHash,
        session.resourceVersion,
        JSON.stringify(session),
        JSON.stringify(session.createdBy),
        session.createdAt,
        session.readyAt ?? null,
        session.startedAt ?? null,
        session.blockedAt ?? null,
        session.cancelledAt ?? null,
        session.blockedFrom ?? null,
        session.cancelledFrom ?? null,
        session.stateReason ?? null,
      ],
    );
  }
  async get(scope: QaScope, sessionId: string) {
    const found = rows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='MANUAL'",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return found[0] ? json<QaTestSession>(found[0].content) : undefined;
  }
  async list(scope: QaScope, workItemId: string) {
    const found = rows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND mode='MANUAL' ORDER BY ordinal",
        [scope.workspaceId, scope.projectId, workItemId],
      ),
    );
    return Object.freeze(found.map((row) => json<QaTestSession>(row.content)));
  }
}

export class TypeOrmManualPlanItemRepository implements ManualPlanItemStore {
  constructor(private readonly source: QaQueryExecutor) {}
  async get(scope: QaScope, sessionId: string, planItemId: string) {
    const found = rows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4 AND mode='MANUAL'",
        [scope.workspaceId, scope.projectId, sessionId, planItemId],
      ),
    );
    return found[0] ? json<QaPlanItem>(found[0].content) : undefined;
  }
  async list(scope: QaScope, sessionId: string) {
    const found = rows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode='MANUAL' ORDER BY ordinal",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(found.map((row) => json<QaPlanItem>(row.content)));
  }
}

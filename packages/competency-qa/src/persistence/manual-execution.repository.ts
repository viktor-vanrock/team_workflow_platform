import type { QaManualAttempt } from "../domain/manual-attempt.ts";
import type { QaObservation } from "../domain/observation.ts";
import type { QaPlanItemResultRevision } from "../domain/plan-item-result.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaScope,
} from "../domain/primitives.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export interface ManualExecutionSeed {
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly sessionState: "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED" | "BLOCKED";
  readonly sessionResourceVersion: number;
  readonly targetSnapshotHash: QaContentHash;
  readonly planItems: readonly Readonly<{
    planItemId: string;
    expectedOutcome: string;
    state?: "PLANNED" | "RUNNING" | "TERMINAL" | "WAIVED";
  }>[];
}

export interface ManualExecutionSessionProjection {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly state: ManualExecutionSeed["sessionState"];
  readonly targetSnapshotHash: QaContentHash;
  readonly resourceVersion: number;
}

export interface ManualExecutionPlanItemProjection {
  readonly id: string;
  readonly expectedOutcome: string;
  readonly state: "PLANNED" | "RUNNING" | "TERMINAL" | "WAIVED";
  readonly latestResultRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
}

export interface ManualExecutionSnapshot {
  readonly attempts: readonly QaManualAttempt[];
  readonly observations: readonly QaObservation[];
  readonly resultRevisions: readonly QaPlanItemResultRevision[];
  readonly attemptSetHash: QaContentHash;
  readonly observationSetHash: QaContentHash;
  readonly maximumAttemptNo: number;
}

export class InMemoryManualExecutionRepository {
  readonly #attempts = new Map<string, QaManualAttempt>();
  readonly #observations = new Map<string, QaObservation>();
  readonly #results = new Map<string, QaPlanItemResultRevision>();
  readonly #items = new Map<string, ManualExecutionPlanItemProjection>();
  #session: ManualExecutionSessionProjection;
  #tail: Promise<void> = Promise.resolve();

  constructor(seed: ManualExecutionSeed) {
    this.#session = Object.freeze({
      id: seed.sessionId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      workItemId: seed.workItemId,
      state: seed.sessionState,
      targetSnapshotHash: seed.targetSnapshotHash,
      resourceVersion: seed.sessionResourceVersion,
    });
    for (const item of seed.planItems)
      this.#items.set(
        item.planItemId,
        Object.freeze({
          id: item.planItemId,
          expectedOutcome: item.expectedOutcome,
          state: item.state ?? "PLANNED",
        }),
      );
  }

  async locked<T>(work: () => T | Promise<T>): Promise<T> {
    const predecessor = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await work();
    } finally {
      release();
    }
  }

  session(): ManualExecutionSessionProjection {
    return structuredClone(this.#session);
  }
  planItem(id: string): ManualExecutionPlanItemProjection {
    const value = this.#items.get(id);
    if (!value) throw new QaDomainError("QA_PLAN_ITEM_NOT_FOUND");
    return structuredClone(value);
  }
  attempt(id: string): QaManualAttempt {
    const value = this.#attempts.get(id);
    if (!value) throw new QaDomainError("QA_ATTEMPT_NOT_FOUND");
    return structuredClone(value);
  }
  attempts(planItemId: string): readonly QaManualAttempt[] {
    return Object.freeze(
      [...this.#attempts.values()]
        .filter((value) => value.planItemId === planItemId)
        .sort((a, b) => a.attemptNo - b.attemptNo)
        .map((value) => structuredClone(value)),
    );
  }
  observations(planItemId: string): readonly QaObservation[] {
    return Object.freeze(
      [...this.#observations.values()]
        .filter((value) => value.planItemId === planItemId)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
        .map((value) => structuredClone(value)),
    );
  }
  resultRevisions(planItemId: string): readonly QaPlanItemResultRevision[] {
    return Object.freeze(
      [...this.#results.values()]
        .filter((value) => value.planItemId === planItemId)
        .sort((a, b) => a.version - b.version)
        .map((value) => structuredClone(value)),
    );
  }

  snapshot(planItemId: string): ManualExecutionSnapshot {
    const attempts = this.attempts(planItemId).filter(({ state }) => state === "COMPLETED");
    const history = this.observations(planItemId);
    const corrected = new Set(
      history.flatMap(({ correctsObservationRef }) =>
        correctsObservationRef ? [correctsObservationRef.id] : [],
      ),
    );
    const observations = history.filter(
      ({ id, attemptId }) =>
        !corrected.has(id) && attempts.some((attempt) => attempt.id === attemptId),
    );
    const attemptRefs = attempts.map(({ id, contentHash }) => ({ id, contentHash }));
    const observationRefs = observations
      .map(({ id, contentHash }) => ({ id, contentHash }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({
      attempts,
      observations,
      resultRevisions: this.resultRevisions(planItemId),
      attemptSetHash: qaAggregateSnapshotHash(attemptRefs as never),
      observationSetHash: qaAggregateSnapshotHash(observationRefs as never),
      maximumAttemptNo: attempts.at(-1)?.attemptNo ?? 0,
    });
  }

  assertSession(sessionId: string, expectedVersion: number): ManualExecutionSessionProjection {
    if (this.#session.id !== sessionId) throw new QaDomainError("QA_SESSION_NOT_FOUND");
    if (this.#session.resourceVersion !== expectedVersion)
      throw new QaDomainError("QA_SESSION_STALE_VERSION");
    return this.session();
  }
  saveAttempt(value: QaManualAttempt): void {
    this.#attempts.set(value.id, structuredClone(value));
  }
  saveObservation(value: QaObservation): void {
    this.#observations.set(value.id, structuredClone(value));
  }
  saveResult(value: QaPlanItemResultRevision): void {
    this.#results.set(value.id, structuredClone(value));
  }
  updatePlanItem(value: ManualExecutionPlanItemProjection): void {
    this.#items.set(value.id, structuredClone(value));
  }
  advanceSession(state = this.#session.state): ManualExecutionSessionProjection {
    this.#session = Object.freeze({
      ...this.#session,
      state,
      resourceVersion: this.#session.resourceVersion + 1,
    });
    return this.session();
  }
}

const dbRows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};
const dbJson = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class TypeOrmManualExecutionRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async session(
    scope: QaScope,
    sessionId: string,
  ): Promise<ManualExecutionSessionProjection | undefined> {
    const found = dbRows<Record<string, unknown>>(
      await this.source.query(
        "SELECT session_id,workspace_id,project_id,work_item_id,state,target_hash,resource_version FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    const row = found[0];
    return row
      ? Object.freeze({
          id: String(row.session_id),
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          state: String(row.state) as ManualExecutionSessionProjection["state"],
          targetSnapshotHash: String(row.target_hash) as QaContentHash,
          resourceVersion: Number(row.resource_version),
        })
      : undefined;
  }

  async planItem(
    scope: QaScope,
    sessionId: string,
    planItemId: string,
  ): Promise<ManualExecutionPlanItemProjection | undefined> {
    const found = dbRows<Record<string, unknown>>(
      await this.source.query(
        "SELECT plan_item_id,expected_outcome,state,latest_result_revision_id FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4",
        [scope.workspaceId, scope.projectId, sessionId, planItemId],
      ),
    );
    const row = found[0];
    if (!row) return undefined;
    let latestResultRevisionRef: ManualExecutionPlanItemProjection["latestResultRevisionRef"];
    if (row.latest_result_revision_id) {
      const revisions = dbRows<Record<string, unknown>>(
        await this.source.query(
          "SELECT result_revision_id,version,content_hash FROM qa_plan_item_result_revisions WHERE workspace_id=$1 AND project_id=$2 AND result_revision_id=$3",
          [scope.workspaceId, scope.projectId, row.latest_result_revision_id],
        ),
      );
      if (revisions[0])
        latestResultRevisionRef = {
          id: String(revisions[0].result_revision_id),
          version: Number(revisions[0].version),
          contentHash: String(revisions[0].content_hash) as QaContentHash,
        };
    }
    return Object.freeze({
      id: String(row.plan_item_id),
      expectedOutcome: String(row.expected_outcome),
      state: String(row.state) as ManualExecutionPlanItemProjection["state"],
      ...(latestResultRevisionRef ? { latestResultRevisionRef } : {}),
    });
  }

  async attempts(scope: QaScope, planItemId: string): Promise<readonly QaManualAttempt[]> {
    const found = dbRows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_manual_attempts WHERE workspace_id=$1 AND project_id=$2 AND plan_item_id=$3 ORDER BY attempt_no",
        [scope.workspaceId, scope.projectId, planItemId],
      ),
    );
    return Object.freeze(found.map(({ content }) => dbJson<QaManualAttempt>(content)));
  }
  async attempt(scope: QaScope, attemptId: string): Promise<QaManualAttempt | undefined> {
    const found = dbRows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_manual_attempts WHERE workspace_id=$1 AND project_id=$2 AND attempt_id=$3",
        [scope.workspaceId, scope.projectId, attemptId],
      ),
    );
    return found[0] ? dbJson<QaManualAttempt>(found[0].content) : undefined;
  }
  async observations(scope: QaScope, planItemId: string): Promise<readonly QaObservation[]> {
    const found = dbRows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_observations WHERE workspace_id=$1 AND project_id=$2 AND plan_item_id=$3 ORDER BY observed_at,observation_id",
        [scope.workspaceId, scope.projectId, planItemId],
      ),
    );
    return Object.freeze(found.map(({ content }) => dbJson<QaObservation>(content)));
  }
  async observation(scope: QaScope, observationId: string): Promise<QaObservation | undefined> {
    const found = dbRows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_observations WHERE workspace_id=$1 AND project_id=$2 AND observation_id=$3",
        [scope.workspaceId, scope.projectId, observationId],
      ),
    );
    return found[0] ? dbJson<QaObservation>(found[0].content) : undefined;
  }
  async resultRevisions(
    scope: QaScope,
    planItemId: string,
  ): Promise<readonly QaPlanItemResultRevision[]> {
    const found = dbRows<Readonly<{ content: unknown }>>(
      await this.source.query(
        "SELECT content FROM qa_plan_item_result_revisions WHERE workspace_id=$1 AND project_id=$2 AND plan_item_id=$3 ORDER BY version",
        [scope.workspaceId, scope.projectId, planItemId],
      ),
    );
    return Object.freeze(found.map(({ content }) => dbJson<QaPlanItemResultRevision>(content)));
  }
  async snapshot(scope: QaScope, planItemId: string): Promise<ManualExecutionSnapshot> {
    const attempts = (await this.attempts(scope, planItemId)).filter(
      ({ state }) => state === "COMPLETED",
    );
    const history = await this.observations(scope, planItemId);
    const corrected = new Set(
      history.flatMap(({ correctsObservationRef }) =>
        correctsObservationRef ? [correctsObservationRef.id] : [],
      ),
    );
    const observations = history.filter(
      ({ id, attemptId }) =>
        !corrected.has(id) && attempts.some((attempt) => attempt.id === attemptId),
    );
    const attemptRefs = attempts.map(({ id, contentHash }) => ({ id, contentHash }));
    const observationRefs = observations
      .map(({ id, contentHash }) => ({ id, contentHash }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({
      attempts,
      observations,
      resultRevisions: await this.resultRevisions(scope, planItemId),
      attemptSetHash: qaAggregateSnapshotHash(attemptRefs as never),
      observationSetHash: qaAggregateSnapshotHash(observationRefs as never),
      maximumAttemptNo: attempts.at(-1)?.attemptNo ?? 0,
    });
  }
  async executionFacts(scope: QaScope, sessionId: string) {
    const found = dbRows<Record<string, unknown>>(
      await this.source.query(
        `SELECT
      (SELECT count(*) FROM qa_manual_attempts WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3)::int attempts,
      (SELECT count(*) FROM qa_observations WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3)::int observations,
      (SELECT count(*) FROM qa_plan_item_result_revisions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3)::int results,
      (SELECT count(*) FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3)::int total_plan_items,
      (SELECT count(*) FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND state IN('TERMINAL','WAIVED'))::int terminal_plan_items`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    const row = found[0]!;
    return Object.freeze({
      attempts: Number(row.attempts),
      observations: Number(row.observations),
      results: Number(row.results),
      totalPlanItems: Number(row.total_plan_items),
      terminalPlanItems: Number(row.terminal_plan_items),
    });
  }
}

import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  finishManualAttempt,
  type QaManualAttemptResult,
  startManualAttempt,
} from "../domain/manual-attempt.ts";
import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import {
  InMemoryManualExecutionRepository,
  TypeOrmManualExecutionRepository,
} from "../persistence/manual-execution.repository.ts";
import { ManualExecutionUnitOfWork } from "../persistence/manual-execution.uow.ts";

export class ManualAttemptService {
  constructor(private readonly repository: InMemoryManualExecutionRepository) {}

  async start(
    input: Readonly<{
      sessionId: string;
      planItemId: string;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      at: string;
    }>,
  ) {
    return await this.repository.locked(() => {
      const session = this.repository.assertSession(input.sessionId, input.expectedSessionVersion);
      if (session.state !== "RUNNING")
        throw new QaDomainError("QA_SESSION_EXECUTION_STATE_INVALID");
      const item = this.repository.planItem(input.planItemId);
      if (item.state === "TERMINAL" || item.state === "WAIVED")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const history = this.repository.attempts(input.planItemId);
      if (history.some(({ state }) => state === "RUNNING"))
        throw new QaDomainError("QA_ATTEMPT_ALREADY_RUNNING");
      const attempt = startManualAttempt({
        id: randomUUID(),
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        workItemId: session.workItemId,
        sessionId: session.id,
        planItemId: input.planItemId,
        attemptNo: history.length + 1,
        actor: input.actor,
        targetSnapshotHash: session.targetSnapshotHash,
        startedAt: input.at,
      });
      this.repository.saveAttempt(attempt);
      this.repository.updatePlanItem({ ...item, state: "RUNNING" });
      return Object.freeze({ attempt, session: this.repository.advanceSession() });
    });
  }

  async complete(
    input: Readonly<{
      attemptId: string;
      actor: QaHumanActor;
      result: QaManualAttemptResult;
      cancellationReason?: string;
      notes?: string;
      expectedSessionVersion: number;
      at: string;
    }>,
  ) {
    return await this.repository.locked(() => {
      const previous = this.repository.attempt(input.attemptId);
      this.repository.assertSession(previous.sessionId, input.expectedSessionVersion);
      const item = this.repository.planItem(previous.planItemId);
      if (item.state === "TERMINAL" || item.state === "WAIVED")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const attempt = finishManualAttempt(previous, {
        actor: input.actor,
        at: input.at,
        result: input.result,
        ...(input.cancellationReason === undefined
          ? {}
          : { cancellationReason: input.cancellationReason }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        expectedResourceVersion: previous.resourceVersion,
      });
      this.repository.saveAttempt(attempt);
      return Object.freeze({ attempt, session: this.repository.advanceSession() });
    });
  }
}

export class TypeOrmManualAttemptService {
  constructor(private readonly source: DataSource) {}
  async start(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      sessionId: string;
      planItemId: string;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      at: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const scope = { workspaceId: input.workspaceId, projectId: input.projectId };
      const repository = new TypeOrmManualExecutionRepository(manager);
      const session = await repository.session(scope, input.sessionId);
      if (!session) throw new QaDomainError("QA_SESSION_NOT_FOUND");
      if (session.resourceVersion !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      if (session.state !== "RUNNING")
        throw new QaDomainError("QA_SESSION_EXECUTION_STATE_INVALID");
      const item = await repository.planItem(scope, input.sessionId, input.planItemId);
      if (!item) throw new QaDomainError("QA_PLAN_ITEM_NOT_FOUND");
      if (item.state === "TERMINAL" || item.state === "WAIVED")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const history = await repository.attempts(scope, input.planItemId);
      if (history.some(({ state }) => state === "RUNNING"))
        throw new QaDomainError("QA_ATTEMPT_ALREADY_RUNNING");
      const attempt = startManualAttempt({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: session.workItemId,
        sessionId: input.sessionId,
        planItemId: input.planItemId,
        attemptNo: history.length + 1,
        actor: input.actor,
        targetSnapshotHash: session.targetSnapshotHash,
        startedAt: input.at,
      });
      const sessionResourceVersion = await new ManualExecutionUnitOfWork(
        manager,
      ).persistAttemptStart(attempt, input.expectedSessionVersion);
      return Object.freeze({ attempt, sessionResourceVersion });
    });
  }
  async complete(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      attemptId: string;
      actor: QaHumanActor;
      result: QaManualAttemptResult;
      cancellationReason?: string;
      notes?: string;
      expectedSessionVersion: number;
      at: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const scope = { workspaceId: input.workspaceId, projectId: input.projectId };
      const repository = new TypeOrmManualExecutionRepository(manager);
      const previous = await repository.attempt(scope, input.attemptId);
      if (!previous) throw new QaDomainError("QA_ATTEMPT_NOT_FOUND");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${previous.sessionId}`,
      ]);
      const session = await repository.session(scope, previous.sessionId);
      if (!session || session.resourceVersion !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      const item = await repository.planItem(scope, previous.sessionId, previous.planItemId);
      if (!item || item.state === "TERMINAL" || item.state === "WAIVED")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const attempt = finishManualAttempt(previous, {
        actor: input.actor,
        at: input.at,
        result: input.result,
        ...(input.cancellationReason === undefined
          ? {}
          : { cancellationReason: input.cancellationReason }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        expectedResourceVersion: previous.resourceVersion,
      });
      const sessionResourceVersion = await new ManualExecutionUnitOfWork(
        manager,
      ).persistAttemptCompletion(previous, attempt, input.expectedSessionVersion);
      return Object.freeze({ attempt, sessionResourceVersion });
    });
  }
}

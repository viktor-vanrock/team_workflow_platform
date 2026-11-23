import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  createQaObservation,
  type QaObservationKind,
  type QaObservationSeverity,
} from "../domain/observation.ts";
import { type QaContentHash, QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import {
  InMemoryManualExecutionRepository,
  TypeOrmManualExecutionRepository,
} from "../persistence/manual-execution.repository.ts";
import { ManualExecutionUnitOfWork } from "../persistence/manual-execution.uow.ts";
import { TypeOrmObservationCorrectionFindingInvalidator } from "./observation-correction-invalidation-port.ts";

export class RecordObservationService {
  constructor(private readonly repository: InMemoryManualExecutionRepository) {}

  async record(
    input: Readonly<{
      sessionId: string;
      planItemId: string;
      attemptId: string;
      kind: QaObservationKind;
      expectedOutcome: string;
      actualOutcome: string;
      severity: QaObservationSeverity;
      notes?: string;
      artifactIds?: readonly string[];
      correctsObservationRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
      correctionReason?: string;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      at: string;
    }>,
  ) {
    return await this.repository.locked(() => {
      const session = this.repository.assertSession(input.sessionId, input.expectedSessionVersion);
      if (session.state === "COMPLETED")
        throw new QaDomainError("QA_SESSION_REVIEWED_EXECUTION_FROZEN");
      const item = this.repository.planItem(input.planItemId);
      const attempt = this.repository.attempt(input.attemptId);
      if (attempt.sessionId !== session.id || attempt.planItemId !== item.id)
        throw new QaDomainError("QA_OBSERVATION_ATTEMPT_SCOPE_MISMATCH");
      if (input.correctsObservationRef === undefined && item.state === "TERMINAL")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      if (input.correctsObservationRef !== undefined) {
        const history = this.repository.observations(item.id);
        const predecessor = history.find(({ id }) => id === input.correctsObservationRef!.id);
        if (
          !predecessor ||
          predecessor.contentHash !== input.correctsObservationRef.contentHash ||
          predecessor.attemptId !== attempt.id
        )
          throw new QaDomainError("QA_OBSERVATION_CORRECTION_PREDECESSOR_INVALID");
        if (
          history.some(
            ({ correctsObservationRef }) => correctsObservationRef?.id === predecessor.id,
          )
        )
          throw new QaDomainError("QA_OBSERVATION_CORRECTION_NOT_CURRENT_LEAF");
      }
      const observation = createQaObservation({
        id: randomUUID(),
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        workItemId: session.workItemId,
        sessionId: session.id,
        planItemId: item.id,
        attemptId: attempt.id,
        kind: input.kind,
        expectedOutcome: input.expectedOutcome,
        actualOutcome: input.actualOutcome,
        severity: input.severity,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        artifactIds: input.artifactIds ?? [],
        ...(input.correctsObservationRef === undefined
          ? {}
          : { correctsObservationRef: input.correctsObservationRef }),
        ...(input.correctionReason === undefined
          ? {}
          : { correctionReason: input.correctionReason }),
        actor: input.actor,
        observedAt: input.at,
      });
      this.repository.saveObservation(observation);
      return Object.freeze({ observation, session: this.repository.advanceSession() });
    });
  }
}

export class TypeOrmRecordObservationService {
  constructor(private readonly source: DataSource) {}
  async record(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      sessionId: string;
      planItemId: string;
      attemptId: string;
      kind: QaObservationKind;
      expectedOutcome: string;
      actualOutcome: string;
      severity: QaObservationSeverity;
      notes?: string;
      artifactIds?: readonly string[];
      correctsObservationRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
      correctionReason?: string;
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
      if (session.state === "COMPLETED")
        throw new QaDomainError("QA_SESSION_REVIEWED_EXECUTION_FROZEN");
      const item = await repository.planItem(scope, input.sessionId, input.planItemId);
      const attempt = await repository.attempt(scope, input.attemptId);
      if (
        !item ||
        !attempt ||
        attempt.sessionId !== input.sessionId ||
        attempt.planItemId !== input.planItemId
      )
        throw new QaDomainError("QA_OBSERVATION_ATTEMPT_SCOPE_MISMATCH");
      if (!input.correctsObservationRef && item.state === "TERMINAL")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      if (input.correctsObservationRef) {
        const predecessor = await repository.observation(scope, input.correctsObservationRef.id);
        const history = await repository.observations(scope, input.planItemId);
        if (
          !predecessor ||
          predecessor.contentHash !== input.correctsObservationRef.contentHash ||
          predecessor.attemptId !== input.attemptId
        )
          throw new QaDomainError("QA_OBSERVATION_CORRECTION_PREDECESSOR_INVALID");
        if (
          history.some(
            ({ correctsObservationRef }) => correctsObservationRef?.id === predecessor.id,
          )
        )
          throw new QaDomainError("QA_OBSERVATION_CORRECTION_NOT_CURRENT_LEAF");
      }
      const observation = createQaObservation({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: session.workItemId,
        sessionId: input.sessionId,
        planItemId: input.planItemId,
        attemptId: input.attemptId,
        kind: input.kind,
        expectedOutcome: input.expectedOutcome,
        actualOutcome: input.actualOutcome,
        severity: input.severity,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        artifactIds: input.artifactIds ?? [],
        ...(input.correctsObservationRef === undefined
          ? {}
          : { correctsObservationRef: input.correctsObservationRef }),
        ...(input.correctionReason === undefined
          ? {}
          : { correctionReason: input.correctionReason }),
        actor: input.actor,
        observedAt: input.at,
      });
      const sessionResourceVersion = await new ManualExecutionUnitOfWork(
        manager,
      ).persistObservation(observation, input.expectedSessionVersion);
      if (input.correctsObservationRef) {
        const current = await repository.snapshot(scope, input.planItemId);
        await new TypeOrmObservationCorrectionFindingInvalidator(manager).invalidate({
          scope,
          workItemId: session.workItemId,
          sessionId: input.sessionId,
          planItemId: input.planItemId,
          predecessorObservationId: input.correctsObservationRef.id,
          successorObservationId: observation.id,
          currentLeafSetHash: current.observationSetHash,
          actor: input.actor,
          at: input.at,
        });
      }
      return Object.freeze({ observation, sessionResourceVersion });
    });
  }
}

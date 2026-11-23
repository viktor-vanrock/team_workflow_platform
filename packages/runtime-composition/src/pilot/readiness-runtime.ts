import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  confirmQaReadiness,
  evaluateQaReadiness,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  type QaReadinessAssessment,
  type QaReadinessEvaluationInput,
  QaReadinessRepository,
  type QaRequestExtension,
  QaRequestInputRepository,
  type QaRequestInputRevision,
  QaRequestRepository,
  type QaRetestLineageResolver,
  type QaScope,
} from "@awp/competency-qa/node";
import {
  CommandGateway,
  type ConnectorCommand,
  type ExternalCommandLifecycleContribution,
} from "@awp/platform-core";
import { TypeOrmCommandRepository, TypeOrmUnitOfWork } from "@awp/platform-persistence-typeorm";

import { assertCurrentQaReadinessInitiator } from "./readiness-requester.ts";
import { readQaRequestRevisionGuards } from "./readiness-revision-guards.ts";

export interface QaReadinessAuthority extends QaScope {
  authorize(
    permission:
      "qa.readiness.evaluate" | "qa.readiness.confirm" | "command.execute" | "integration.use",
  ): Promise<Readonly<{ actor: QaHumanActor; basis: QaAuthorizationBasis; scope: QaScope }>>;
}
export interface QaReadinessFacts extends Pick<
  QaReadinessEvaluationInput,
  | "acceptedRequest"
  | "project"
  | "requesterEntitlement"
  | "mappingHealth"
  | "contextRef"
  | "dorRuleSetRef"
  | "allowedEnvironmentRefs"
  | "maximumClassificationKey"
> {
  readonly authorityScopeKey: string;
}
/** Resolves current scoped provider/configuration/Core facts, including the original requester. */
export interface QaReadinessFactsPort {
  load(
    source: EntityManager,
    extension: QaRequestExtension,
    current: QaRequestInputRevision,
  ): Promise<QaReadinessFacts>;
}
export interface QaReadinessRuntime {
  assess(
    authority: QaReadinessAuthority,
    workItemId: string,
    expectedVersion: number,
  ): Promise<QaReadinessAssessment>;
  confirm(
    authority: QaReadinessAuthority,
    workItemId: string,
  ): Promise<
    Readonly<{
      state: "READY_PENDING_SYNC" | "SYNC_ERROR" | "READY";
      inputFrozen: boolean;
      commandId: string;
      approvalId?: string;
      replayed: boolean;
    }>
  >;
}
const same = (left: unknown, right: unknown) =>
  left !== undefined &&
  right !== undefined &&
  qaAggregateSnapshotHash(left as never) === qaAggregateSnapshotHash(right as never);
const versionRef = ({ id, version }: Readonly<{ id: string; version: number }>) => ({
  id,
  version,
});

/** HTTP never executes a provider write. Core persists command, approval, audit and held outbox together. */
export class DurableQaReadinessRuntime implements QaReadinessRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly facts: QaReadinessFactsPort,
    private readonly lineage: QaRetestLineageResolver,
  ) {}

  lifecycleContribution(): ExternalCommandLifecycleContribution {
    return {
      key: "qa.readiness.request-transition-lifecycle",
      order: 2200,
      matches: (input) =>
        input.commandType === "qa.readiness.ready" &&
        input.capabilityKey === "operational-work-item" &&
        input.capabilityVersion === "1.0.0" &&
        input.operation === "request.transition",
      apply: async (phase, input, transaction) => {
        if (phase === "APPROVAL_RELEASED" || phase === "EFFECT_INVOCATION_STARTED") {
          const manager = transaction.native as EntityManager;
          if (!manager.queryRunner?.isTransactionActive)
            throw new Error("QA_READINESS_TRANSACTION_REQUIRED");
          const command = await new TypeOrmCommandRepository(this.source).get(
            input.workspaceId,
            input.projectId,
            input.commandId,
            manager,
          );
          if (
            !command ||
            command.rowVersion !== input.commandResourceVersion ||
            command.effectIdempotencyKey !== input.effectIdempotencyKey
          )
            throw new Error("QA_READINESS_COMMAND_STALE");
          await this.assertCommandCurrent(manager, command);
        }
        return {
          idempotencyKey: transaction.idempotencyKey,
          replayed: false,
          events: [],
          audit: [],
        };
      },
    };
  }

  /** Must run in the caller's approval/dispatch transaction, before releasing the Core outbox. */
  async assertCommandCurrent(manager: EntityManager, command: ConnectorCommand): Promise<void> {
    const stale = () => new Error("QA_READINESS_COMMAND_STALE");
    if (
      command.commandType !== "qa.readiness.ready" ||
      command.actor.kind !== "HUMAN" ||
      !command.source.sourceWorkItemId
    )
      throw stale();
    await assertCurrentQaReadinessInitiator(this.source, command);
    await this.lock(manager, command, command.source.sourceWorkItemId);
    const { extension, current } = await this.request(
      manager,
      command,
      command.source.sourceWorkItemId,
    );
    const assessment = await new QaReadinessRepository(manager).latest(
      command,
      command.source.sourceWorkItemId,
    );
    const expected = command.expectedExternalState as Readonly<{
      qaReadiness?: Readonly<{
        assessmentRef: unknown;
        inputRef: unknown;
        inputFingerprint: string;
      }>;
    }>;
    if (
      !assessment ||
      !expected.qaReadiness ||
      !same(expected.qaReadiness.inputRef, extension.currentRequestInputRevisionRef) ||
      !same(expected.qaReadiness.assessmentRef, extension.latestReadinessAssessmentRef) ||
      !same(expected.qaReadiness.assessmentRef, {
        id: assessment.assessmentId,
        version: assessment.version,
        contentHash: assessment.contentHash,
      })
    )
      throw stale();
    const facts = await this.facts.load(manager, extension, current);
    const evaluated = await this.evaluate(
      manager,
      extension,
      current,
      command.actor,
      assessment.version,
      facts,
    );
    const payload = command.payload as Readonly<{
      requestedNormalizedStatus?: string;
      expectedExternalVersion?: string;
    }>;
    const target = command.target as Readonly<{
      workspaceId?: string;
      projectId?: string;
      workItemId?: string;
      authorityScopeKey?: string;
      externalEntityId?: string;
    }>;
    if (
      evaluated.state !== "READY" ||
      evaluated.inputFingerprint !== expected.qaReadiness.inputFingerprint ||
      evaluated.inputFingerprint !== assessment.inputFingerprint ||
      !same(versionRef(facts.mappingHealth.bindingRef), command.bindingRef) ||
      !same(versionRef(facts.mappingHealth.profileRef), command.profileRef) ||
      payload.requestedNormalizedStatus !== "READY" ||
      payload.expectedExternalVersion !== facts.acceptedRequest.externalVersion ||
      target.workspaceId !== command.workspaceId ||
      target.projectId !== command.projectId ||
      target.workItemId !== current.workItemId ||
      target.authorityScopeKey !== facts.authorityScopeKey ||
      target.externalEntityId !== current.externalRequestRef.id
    )
      throw stale();
  }

  async assess(authority: QaReadinessAuthority, workItemId: string, expectedVersion: number) {
    await this.authorize(authority, "qa.readiness.evaluate");
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await this.lock(manager, authority, workItemId);
      const authorization = await this.authorize(authority, "qa.readiness.evaluate");
      const { extension, current } = await this.request(manager, authority, workItemId);
      if (extension.resourceVersion !== expectedVersion)
        throw new Error("QA_READINESS_EXTENSION_CAS_CONFLICT");
      const repository = new QaReadinessRepository(manager);
      const latest = await repository.latest(authority, workItemId);
      const assessment = await this.evaluate(
        manager,
        extension,
        current,
        authorization.actor,
        (latest?.version ?? 0) + 1,
      );
      await this.authorize(authority, "qa.readiness.evaluate");
      await repository.appendAndMoveLatest(manager, assessment, expectedVersion);
      await repository.ensurePlanHeader(manager, {
        id: randomUUID(),
        extensionId: extension.extensionId,
        scope: authority,
        workItemId,
        createdAt: assessment.evaluatedAt,
      });
      return assessment;
    });
  }

  async confirm(authority: QaReadinessAuthority, workItemId: string) {
    await this.authorize(authority, "qa.readiness.confirm");
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await this.lock(manager, authority, workItemId);
      const authorization = await this.authorize(authority, "qa.readiness.confirm");
      const { extension, current } = await this.request(manager, authority, workItemId);
      const assessment = await new QaReadinessRepository(manager).latest(authority, workItemId);
      if (
        !assessment ||
        !same(extension.latestReadinessAssessmentRef, {
          id: assessment.assessmentId,
          version: assessment.version,
          contentHash: assessment.contentHash,
        })
      )
        throw new Error("QA_READINESS_NOT_ASSESSED");
      const candidate = confirmQaReadiness({
        assessment,
        currentInputRef: extension.currentRequestInputRevisionRef,
        actor: authorization.actor,
        confirmedAt: new Date().toISOString(),
      });
      for (const permission of ["command.execute", "integration.use"] as const) {
        if (
          (await this.authorize(authority, permission)).actor.principalId !==
          authorization.actor.principalId
        )
          throw new Error("QA_READINESS_AUTHORITY_CHANGED");
      }
      const [existing] = (await manager.query(
        `SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2
        AND payload->'metadata'->'source'->>'sourceWorkItemId'=$3 AND payload->'metadata'->>'commandType'='qa.readiness.ready'
        AND payload->'metadata'->'expectedExternalState'->'qaReadiness'->'assessmentRef'->>'id'=$4 FOR UPDATE`,
        [authority.workspaceId, authority.projectId, workItemId, assessment.assessmentId],
      )) as { id: string }[];
      const existingCommand = existing
        ? await new TypeOrmCommandRepository(this.source).get(
            authority.workspaceId,
            authority.projectId,
            existing.id,
            manager,
          )
        : undefined;
      if (existing && !existingCommand) throw new Error("QA_READINESS_COMMAND_MISSING");
      if (existingCommand?.status === "CONFIRMED") return this.submission(existingCommand, true);
      const currentFacts = await this.facts.load(manager, extension, current);
      const evaluated = await this.evaluate(
        manager,
        extension,
        current,
        authorization.actor,
        assessment.version,
        currentFacts,
      );
      if (evaluated.state !== "READY" || evaluated.inputFingerprint !== assessment.inputFingerprint)
        throw new Error("QA_READINESS_FACTS_CHANGED");
      if (!["NEW", "NEEDS_INFO"].includes(currentFacts.acceptedRequest.normalizedStatus ?? ""))
        throw new Error("QA_READINESS_EXTERNAL_STATE_CONFLICT");
      if (existingCommand) return this.submission(existingCommand, true);
      const guards = await readQaRequestRevisionGuards(manager, authority, workItemId);
      if (guards.readyDispatchState === "CONFIRMED" || guards.hasSessions)
        throw new Error("QA_REQUEST_INPUT_FROZEN_READY");
      if (guards.readyDispatchState === "DISPATCHED")
        throw new Error("QA_READINESS_DISPATCH_IN_FLIGHT");
      if (!currentFacts.authorityScopeKey || !currentFacts.acceptedRequest.externalVersion)
        throw new Error("QA_READY_TRANSITION_TARGET_INVALID");
      const fresh = await this.authorize(authority, "qa.readiness.confirm");
      const gateway = new CommandGateway(
        new TypeOrmUnitOfWork(this.source, manager),
        { now: () => new Date() },
        { next: randomUUID },
      );
      const submitted = await gateway.submit(
        {
          scope: {
            kind: "PROJECT",
            workspaceId: authority.workspaceId,
            projectId: authority.projectId,
          },
          actor: fresh.actor,
          authorizationBasis: fresh.basis,
          correlationId: randomUUID(),
          causationId: randomUUID(),
        },
        {
          clientRequestKey: `qa-readiness:${assessment.assessmentId}`,
          commandType: "qa.readiness.ready",
          capability: {
            key: "operational-work-item",
            exactContractVersion: "1.0.0",
            operation: "request.transition",
            logicalRole: "QA_REQUEST_AUTHORITY",
          },
          target: {
            workspaceId: authority.workspaceId,
            projectId: authority.projectId,
            workItemId,
            entityKind: "REQUEST",
            authorityScopeKey: currentFacts.authorityScopeKey,
            externalEntityId: current.externalRequestRef.id,
          },
          payload: {
            requestedNormalizedStatus: "READY",
            expectedExternalVersion: currentFacts.acceptedRequest.externalVersion,
          },
          expectedExternalState: {
            externalVersion: currentFacts.acceptedRequest.externalVersion,
            qaReadiness: {
              assessmentRef: candidate.assessmentRef,
              inputRef: candidate.inputRef,
              inputFingerprint: candidate.inputFingerprint,
            },
          },
          bindingRef: versionRef(currentFacts.mappingHealth.bindingRef),
          profileRef: versionRef(currentFacts.mappingHealth.profileRef),
          dataClassificationKey: current.dataClassificationKey,
          source: { sourceWorkItemId: workItemId },
          recoveryPolicy: "LOOKUP_REQUIRED",
          approvalRequired: true,
        },
      );
      return this.submission(submitted.command, submitted.replayed);
    });
  }

  private submission(command: ConnectorCommand, replayed: boolean) {
    if (command.status === "CONFIRMED") {
      const receipt = command.terminalResult?.receipt as
        | Readonly<{
            operation?: string;
            entityKind?: string;
            normalizedStatus?: string;
            externalEntityId?: string;
            externalVersion?: string;
            profileRef?: unknown;
            scope?: Readonly<{ workspaceId?: string; projectId?: string }>;
          }>
        | undefined;
      const target = command.target as Readonly<{ externalEntityId: string }>;
      if (
        command.terminalResult?.outcome !== "SUCCEEDED" ||
        receipt?.operation !== "request.transition" ||
        receipt.entityKind !== "REQUEST" ||
        receipt.normalizedStatus !== "READY" ||
        receipt.externalEntityId !== target.externalEntityId ||
        !receipt.externalVersion ||
        receipt.scope?.workspaceId !== command.workspaceId ||
        receipt.scope.projectId !== command.projectId ||
        !same(receipt.profileRef, command.profileRef)
      )
        throw new Error("QA_READY_CONFIRMATION_STATE_MISMATCH");
    }
    const state =
      command.status === "CONFIRMED"
        ? ("READY" as const)
        : ["FAILED", "CONFLICT", "CANCELLED"].includes(command.status)
          ? ("SYNC_ERROR" as const)
          : ("READY_PENDING_SYNC" as const);
    return {
      state,
      inputFrozen: state === "READY",
      commandId: command.id,
      ...(command.approvalId ? { approvalId: command.approvalId } : {}),
      replayed,
    };
  }
  private async evaluate(
    manager: EntityManager,
    extension: QaRequestExtension,
    current: QaRequestInputRevision,
    actor: QaHumanActor,
    version: number,
    facts?: QaReadinessFacts,
  ) {
    return evaluateQaReadiness(
      {
        ...(facts ?? (await this.facts.load(manager, extension, current))),
        scope: { workspaceId: extension.workspaceId, projectId: extension.projectId },
        workItemId: extension.workItemId,
        currentInput: current,
        extensionResourceVersion: extension.resourceVersion,
        assessmentId: randomUUID(),
        assessmentVersion: version,
        evaluatedBy: actor,
        evaluatedAt: new Date().toISOString(),
      },
      this.lineage,
    );
  }
  private async request(manager: EntityManager, scope: QaScope, workItemId: string) {
    const extension = await new QaRequestRepository(manager).byWorkItem(scope, workItemId);
    if (!extension) throw new Error("QA_REQUEST_NOT_FOUND");
    const current = await new QaRequestInputRepository(manager).get(
      scope,
      workItemId,
      extension.currentRequestInputRevisionRef.version,
    );
    if (
      !current ||
      !same(extension.currentRequestInputRevisionRef, {
        id: current.inputRevisionId,
        version: current.version,
        contentHash: current.contentHash,
      })
    )
      throw new Error("QA_REQUEST_INPUT_NOT_FOUND");
    return { extension, current };
  }
  private async lock(manager: EntityManager, scope: QaScope, workItemId: string) {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `qa-request:${scope.workspaceId}:${scope.projectId}:${workItemId}`,
    ]);
    await manager.query(
      "SELECT extension_id FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
      [scope.workspaceId, scope.projectId, workItemId],
    );
  }
  private async authorize(
    authority: QaReadinessAuthority,
    permission: Parameters<QaReadinessAuthority["authorize"]>[0],
  ) {
    const result = await authority.authorize(permission);
    if (
      result.actor.kind !== "HUMAN" ||
      !result.actor.principalId ||
      !result.actor.issuer ||
      !result.actor.subject ||
      result.scope.workspaceId !== authority.workspaceId ||
      result.scope.projectId !== authority.projectId ||
      result.basis.kind !== "PROJECT" ||
      !result.basis.membershipRef ||
      !result.basis.entitlementRefs.length ||
      !result.basis.roleAssignmentRefs.length
    )
      throw new Error("QA_READINESS_AUTHORITY_DENIED");
    return result;
  }
}

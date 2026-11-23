import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createCompletionCandidate,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaCompletionCandidateAggregate,
  type QaExactReference,
  type QaHumanActor,
  type QaScope,
  TypeOrmQaVerdictDodRepository,
} from "@awp/competency-qa/node";
import type { JsonValue } from "@awp/platform-contracts";
import {
  CommandGateway,
  type ConnectorCommand,
  defaultClassificationCatalog,
  externalCommandLifecycleContext,
  type ExternalCommandLifecycleContribution,
} from "@awp/platform-core";
import {
  type CommandDeliveryScope,
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandRepository,
  TypeOrmUnitOfWork,
} from "@awp/platform-persistence-typeorm";

import type { QaDodRuntime } from "./dod-runtime.ts";

type Ref = Readonly<{ id: string; version: number; contentHash?: string }>;
type Row = Record<string, unknown>;
export interface QaCompletionAuthority extends QaScope {
  authorize(permission: string): Promise<
    Readonly<{
      actor: QaHumanActor;
      basis: QaAuthorizationBasis;
      scope: QaScope;
      classificationCeiling: string;
    }>
  >;
}
export interface QaCompletionConfiguration {
  readonly bindingRef: Ref;
  readonly profileRef: Ref;
  readonly profileRefs: readonly Ref[];
  readonly authorityScopeKey: string;
  readonly maximumClassificationKey: string;
  readonly allowedDataClassifications: readonly string[];
  readonly configurationChain: readonly Readonly<{
    logicalRole: string;
    profileRef: Ref;
    mappingRef?: Ref;
    connectionRef?: Ref;
  }>[];
  readonly projection: Readonly<{
    externalEntityId: string;
    normalizedStatus: string;
    externalVersion: string;
  }>;
}
export interface QaCompletionConfigurationPort {
  load(
    manager: EntityManager,
    scope: QaScope,
    workItemId: string,
  ): Promise<QaCompletionConfiguration>;
}
export interface QaCompletionRuntime {
  create(
    authority: QaCompletionAuthority,
    workItemId: string,
    assessmentRef: QaExactReference,
  ): Promise<QaCompletionCandidateAggregate>;
  publish(
    authority: QaCompletionAuthority,
    workItemId: string,
    candidateId: string,
    expectedVersion: number,
  ): Promise<
    Readonly<{
      candidateId: string;
      commandId: string;
      approvalId: string;
      state: string;
      resourceVersion: number;
      replayed: boolean;
    }>
  >;
}
const rows = (value: unknown): Row[] => {
  const raw = value as unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const same = (a: unknown, b: unknown) =>
  a !== undefined &&
  b !== undefined &&
  qaAggregateSnapshotHash(a as never) === qaAggregateSnapshotHash(b as never);
const ref = (value: Ref) => ({ id: value.id, version: value.version });
const stale = () => new Error("QA_COMPLETION_STALE");

/** Candidate, command, approval and outbox use one request lock and one transaction. */
export class DurableQaCompletionRuntime implements QaCompletionRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly dod: QaDodRuntime,
    private readonly configuration: QaCompletionConfigurationPort,
  ) {}
  async create(
    authority: QaCompletionAuthority,
    workItemId: string,
    assessmentRef: QaExactReference,
  ) {
    await this.authorize(authority, false);
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await this.lock(manager, authority, workItemId);
      const proof = await this.dod.prepareCompletion(manager, authority, workItemId, assessmentRef);
      const config = await this.configuration.load(manager, authority, workItemId);
      const authorization = await this.authorize(authority, false);
      const [work] = rows(
        await manager.query(
          "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [authority.workspaceId, authority.projectId, workItemId],
        ),
      );
      if (!work) throw stale();
      this.classification(
        authorization.classificationCeiling,
        String(work.classification_key),
        config,
      );
      const [existing] = rows(
        await manager.query(
          "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND state IN('CANDIDATE','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED') FOR UPDATE",
          [authority.workspaceId, authority.projectId, workItemId],
        ),
      );
      const [latest] = rows(
        await manager.query(
          "SELECT COALESCE(max(candidate_number),0) AS number FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
          [authority.workspaceId, authority.projectId, workItemId],
        ),
      );
      const aggregate = createCompletionCandidate({
        ...proof,
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        workItemId,
        candidateId: existing ? String(existing.candidate_id) : randomUUID(),
        candidateNumber: existing ? Number(existing.candidate_number) : Number(latest!.number) + 1,
        expectedExternalState: config.projection.normalizedStatus,
        expectedExternalVersion: config.projection.externalVersion,
        bindingRef: ref(config.bindingRef),
        profileRefs: config.profileRefs.map(ref),
        initiatedBy: authorization.actor,
        createdAt: existing
          ? (existing.created_at as Date).toISOString()
          : new Date().toISOString(),
      });
      if (existing) {
        if (existing.state !== "CANDIDATE" || existing.content_hash !== aggregate.contentHash)
          throw stale();
        return aggregate;
      }
      await new TypeOrmQaVerdictDodRepository(manager).insertCompletionCandidate(aggregate);
      return aggregate;
    });
  }
  async publish(
    authority: QaCompletionAuthority,
    workItemId: string,
    candidateId: string,
    expectedVersion: number,
  ) {
    await this.authorize(authority, true);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw stale();
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await this.lock(manager, authority, workItemId);
      const candidate = await this.candidate(manager, authority, workItemId, candidateId);
      const authorization = await this.authorize(authority, true);
      if (!same(candidate.initiated_by, authorization.actor)) throw stale();
      const approvalRef = json<{ id: string; subjectHash: string } | null>(candidate.approval_ref);
      if (approvalRef && ["DISPATCHED", "CONFIRMED"].includes(String(candidate.state))) {
        this.classification(
          authorization.classificationCeiling,
          String(candidate.classification_key),
        );
        const command = await this.existing(manager, authority, approvalRef.id);
        if (
          !same(command.actor, authorization.actor) ||
          !same(json<{ id: string }>(candidate.command_ref), { id: command.id }) ||
          !same((command.payload as Row).completionSummary, candidate.summary) ||
          !same(
            (command.expectedExternalState as { qaCompletion?: { candidateRef?: unknown } })
              .qaCompletion?.candidateRef,
            { id: candidateId, version: 1, contentHash: candidate.content_hash },
          ) ||
          (expectedVersion !== Number(candidate.resource_version) &&
            expectedVersion !== this.publicationVersion(command))
        )
          throw stale();
        return this.result(candidate, command, true);
      }
      const current = await this.current(manager, authority, workItemId, candidateId);
      if (approvalRef) {
        const command = await this.existing(manager, authority, approvalRef.id);
        this.assertSemantics(command, current, this.publicationVersion(command));
        if (
          !same(command.actor, authorization.actor) ||
          (expectedVersion !== Number(candidate.resource_version) &&
            expectedVersion !== this.publicationVersion(command))
        )
          throw stale();
        return this.result(candidate, command, true);
      }
      if (candidate.state !== "CANDIDATE" || Number(candidate.resource_version) !== expectedVersion)
        throw stale();
      const semantics = this.semantics(current, expectedVersion);
      const fresh = await this.authorize(authority, true);
      if (!same(fresh.actor, authorization.actor)) throw stale();
      this.classification(
        fresh.classificationCeiling,
        String(candidate.classification_key),
        current.configuration,
      );
      const submitted = await new CommandGateway(
        new TypeOrmUnitOfWork(this.source, manager),
        { now: () => new Date() },
        { next: randomUUID },
      ).submit(
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
          clientRequestKey: `qa:completion:${candidateId}:1`,
          commandType: "qa.completion.done",
          capability: {
            key: "operational-work-item",
            exactContractVersion: "1.0.0",
            operation: "request.transition",
            logicalRole: "QA_REQUEST_AUTHORITY",
          },
          target: semantics.target,
          payload: semantics.payload,
          expectedExternalState: semantics.expectedExternalState,
          bindingRef: ref(current.configuration.bindingRef),
          profileRef: ref(current.configuration.profileRef),
          dataClassificationKey: String(candidate.classification_key),
          source: { sourceWorkItemId: workItemId },
          approvalRequired: true,
          recoveryPolicy: "LOOKUP_REQUIRED",
        },
      );
      const command = submitted.command;
      if (
        !command.approvalId ||
        command.status !== "AWAITING_APPROVAL" ||
        command.outboxStatus !== "HELD"
      )
        throw stale();
      const [approval] = rows(
        await manager.query(
          "SELECT subject_hash FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND action_id=$4",
          [authority.workspaceId, authority.projectId, command.approvalId, command.id],
        ),
      );
      if (!approval) throw stale();
      const [changed] = rows(
        await manager.query(
          "UPDATE qa_completion_candidates SET state='AWAITING_APPROVAL',approval_ref=$1,resource_version=resource_version+1 WHERE workspace_id=$2 AND project_id=$3 AND work_item_id=$4 AND candidate_id=$5 AND resource_version=$6 AND state='CANDIDATE' RETURNING *",
          [
            { id: command.approvalId, subjectHash: approval.subject_hash },
            authority.workspaceId,
            authority.projectId,
            workItemId,
            candidateId,
            expectedVersion,
          ],
        ),
      );
      if (!changed) throw stale();
      return this.result(changed, command, submitted.replayed);
    });
  }
  async assertCommandCurrent(
    manager: EntityManager,
    command: ConnectorCommand,
    authority: QaCompletionAuthority,
  ) {
    const authorized = await this.authorize(authority, true);
    if (
      authority.workspaceId !== command.workspaceId ||
      authority.projectId !== command.projectId ||
      !same(authorized.actor, command.actor) ||
      !command.source.sourceWorkItemId
    )
      throw stale();
    const candidateId = (
      command.expectedExternalState as { qaCompletion?: { candidateRef?: { id?: string } } }
    ).qaCompletion?.candidateRef?.id;
    if (!candidateId) throw stale();
    await this.lock(manager, authority, command.source.sourceWorkItemId);
    const current = await this.current(
      manager,
      authority,
      command.source.sourceWorkItemId,
      candidateId,
    );
    this.classification(
      authorized.classificationCeiling,
      String(current.candidate.classification_key),
      current.configuration,
    );
    if (
      !same(current.candidate.initiated_by, command.actor) ||
      json<{ id: string }>(current.candidate.approval_ref)?.id !== command.approvalId ||
      !["AWAITING_APPROVAL", "AUTHORIZED"].includes(String(current.candidate.state))
    )
      throw stale();
    this.assertSemantics(command, current, this.publicationVersion(command));
    return current.candidate;
  }
  async dispatch(
    authority: QaCompletionAuthority,
    scope: CommandDeliveryScope,
    now: Date,
    leaseMs: number,
  ) {
    if (authority.workspaceId !== scope.workspaceId || authority.projectId !== scope.projectId)
      throw stale();
    const authorized = await this.authorize(authority, true);
    const contribution = this.lifecycleContribution(() => authority);
    return new TypeOrmCommandDeliveryStore(this.source).markDispatched(
      scope,
      now,
      leaseMs,
      {
        evaluatedAt: now,
        authorizationBasis: authorized.basis,
        authorizationBasisHash: qaAggregateSnapshotHash(authorized.basis as never),
      },
      async (manager, command) => {
        const context = externalCommandLifecycleContext(command);
        if (!contribution.matches(context)) throw stale();
        await contribution.apply("EFFECT_INVOCATION_STARTED", context, {
          native: manager,
          transactionId: randomUUID(),
          contributionKey: contribution.key,
          phase: "EFFECT_INVOCATION_STARTED",
          idempotencyKey: `${command.id}:EFFECT_INVOCATION_STARTED:${contribution.key}`,
        });
      },
    );
  }
  lifecycleContribution(
    authorityFor: (command: ConnectorCommand) => QaCompletionAuthority,
  ): ExternalCommandLifecycleContribution {
    return {
      key: "qa.completion-current-inputs",
      order: 2440,
      matches: (command) =>
        command.commandType === "qa.completion.done" &&
        command.capabilityKey === "operational-work-item" &&
        command.capabilityVersion === "1.0.0" &&
        command.operation === "request.transition",
      apply: async (phase, input, transaction) => {
        const manager = transaction.native as EntityManager;
        if (!manager.queryRunner?.isTransactionActive) throw stale();
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
          throw stale();
        const authority = authorityFor(command);
        if (phase === "APPROVAL_RELEASED" || phase === "EFFECT_INVOCATION_STARTED") {
          const candidate = await this.assertCommandCurrent(manager, command, authority);
          if (phase === "EFFECT_INVOCATION_STARTED") {
            if (
              candidate.state !== "AUTHORIZED" ||
              command.status !== "QUEUED" ||
              command.effectAuthorizationStatus !== "CONSUMED"
            )
              throw stale();
            const [guard] = rows(
              await manager.query(
                "UPDATE qa_request_extensions SET completion_in_flight_candidate_id=$1,completion_dispatch_guard=jsonb_build_object('state','DISPATCHED','candidateId',$1::text,'commandId',$2::text),resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$3 AND project_id=$4 AND work_item_id=$5 AND completion_in_flight_candidate_id IS NULL AND adjudicative_aggregate_hash=$6 RETURNING extension_id",
                [
                  candidate.candidate_id,
                  command.id,
                  command.workspaceId,
                  command.projectId,
                  command.source.sourceWorkItemId,
                  candidate.aggregate_snapshot_hash,
                ],
              ),
            );
            const [changed] = rows(
              await manager.query(
                "UPDATE qa_completion_candidates SET state='DISPATCHED',command_ref=$1,effect_key_hash=$2,dispatched_at=clock_timestamp(),resource_version=resource_version+1 WHERE candidate_id=$3 AND state='AUTHORIZED' RETURNING candidate_id",
                [
                  { id: command.id },
                  qaAggregateSnapshotHash(command.effectIdempotencyKey as never),
                  candidate.candidate_id,
                ],
              ),
            );
            if (!guard || !changed) throw stale();
          }
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
  private async current(
    manager: EntityManager,
    authority: QaCompletionAuthority,
    workItemId: string,
    candidateId: string,
  ) {
    const candidate = await this.candidate(manager, authority, workItemId, candidateId);
    const authorization = await this.authorize(authority, false);
    this.classification(authorization.classificationCeiling, String(candidate.classification_key));
    const proof = await this.dod.prepareCompletion(
      manager,
      authority,
      workItemId,
      json(candidate.ready_to_close_dod_ref),
    );
    const configuration = await this.configuration.load(manager, authority, workItemId);
    this.classification(
      authorization.classificationCeiling,
      String(candidate.classification_key),
      configuration,
    );
    const aggregate = createCompletionCandidate({
      ...proof,
      workspaceId: authority.workspaceId,
      projectId: authority.projectId,
      workItemId,
      candidateId,
      candidateNumber: Number(candidate.candidate_number),
      initiatedBy: json(candidate.initiated_by),
      createdAt: (candidate.created_at as Date).toISOString(),
      expectedExternalState: configuration.projection.normalizedStatus,
      expectedExternalVersion: configuration.projection.externalVersion,
      bindingRef: ref(configuration.bindingRef),
      profileRefs: configuration.profileRefs.map(ref),
    });
    if (
      candidate.content_hash !== aggregate.contentHash ||
      candidate.summary_content_hash !== aggregate.summary.contentHash ||
      !same(candidate.summary, aggregate.summary)
    )
      throw stale();
    return { candidate, configuration };
  }
  private semantics(
    current: { candidate: Row; configuration: QaCompletionConfiguration },
    publicationResourceVersion: number,
  ) {
    const { candidate, configuration } = current;
    return {
      target: {
        workspaceId: String(candidate.workspace_id),
        projectId: String(candidate.project_id),
        entityKind: "REQUEST",
        authorityScopeKey: configuration.authorityScopeKey,
        externalEntityId: configuration.projection.externalEntityId,
      },
      payload: {
        requestedNormalizedStatus: "DONE",
        expectedExternalVersion: configuration.projection.externalVersion,
        completionSummary: json<JsonValue>(candidate.summary),
      },
      expectedExternalState: {
        normalizedStatus: configuration.projection.normalizedStatus,
        externalVersion: configuration.projection.externalVersion,
        bindingRef: configuration.bindingRef,
        configurationChain: configuration.configurationChain,
        qaCompletion: {
          candidateRef: {
            id: String(candidate.candidate_id),
            version: 1,
            contentHash: String(candidate.content_hash),
          },
          publicationResourceVersion,
        },
      },
    };
  }
  private assertSemantics(
    command: ConnectorCommand,
    current: { candidate: Row; configuration: QaCompletionConfiguration },
    version: number,
  ) {
    const semantics = this.semantics(current, version);
    if (
      command.commandType !== "qa.completion.done" ||
      command.capability.key !== "operational-work-item" ||
      command.capability.exactContractVersion !== "1.0.0" ||
      command.capability.operation !== "request.transition" ||
      command.recoveryPolicy !== "LOOKUP_REQUIRED" ||
      !same(command.target, semantics.target) ||
      !same(command.payload, semantics.payload) ||
      !same(command.expectedExternalState, semantics.expectedExternalState) ||
      !same(command.bindingRef, ref(current.configuration.bindingRef)) ||
      !same(command.profileRef, ref(current.configuration.profileRef)) ||
      command.dataClassificationKey !== current.candidate.classification_key
    )
      throw stale();
  }
  private publicationVersion(command: ConnectorCommand) {
    const version = (
      command.expectedExternalState as { qaCompletion?: { publicationResourceVersion?: number } }
    ).qaCompletion?.publicationResourceVersion;
    if (!Number.isSafeInteger(version) || !version || version < 1) throw stale();
    return version;
  }
  private async candidate(
    manager: EntityManager,
    scope: QaScope,
    workItemId: string,
    candidateId: string,
  ) {
    const [candidate] = rows(
      await manager.query(
        "SELECT c.*,w.classification_key FROM qa_completion_candidates c JOIN work_items w ON w.workspace_id=c.workspace_id AND w.project_id=c.project_id AND w.id=c.work_item_id WHERE c.workspace_id=$1 AND c.project_id=$2 AND c.work_item_id=$3 AND c.candidate_id=$4 FOR UPDATE OF c,w",
        [scope.workspaceId, scope.projectId, workItemId, candidateId],
      ),
    );
    if (!candidate) throw new Error("QA_COMPLETION_CANDIDATE_NOT_FOUND");
    return candidate;
  }
  private async existing(manager: EntityManager, scope: QaScope, approvalId: string) {
    const [approval] = rows(
      await manager.query(
        "SELECT action_id FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [scope.workspaceId, scope.projectId, approvalId],
      ),
    );
    const command = approval
      ? await new TypeOrmCommandRepository(this.source).get(
          scope.workspaceId,
          scope.projectId,
          String(approval.action_id),
          manager,
        )
      : undefined;
    if (
      !command ||
      command.approvalId !== approvalId ||
      command.commandType !== "qa.completion.done"
    )
      throw stale();
    return command;
  }
  private async authorize(authority: QaCompletionAuthority, effect: boolean) {
    const result = await authority.authorize("qa.completion.request");
    const grants = [
      result,
      ...(effect
        ? [
            await authority.authorize("command.execute"),
            await authority.authorize("integration.use"),
          ]
        : []),
    ];
    for (const value of grants) {
      if (
        value.actor.kind !== "HUMAN" ||
        !same(value.actor, result.actor) ||
        value.scope.workspaceId !== authority.workspaceId ||
        value.scope.projectId !== authority.projectId ||
        value.basis.kind !== "PROJECT" ||
        !value.basis.membershipRef ||
        !value.basis.entitlementRefs.length ||
        !value.basis.roleAssignmentRefs.length
      )
        throw stale();
    }
    const ceiling = grants
      .map((value) => defaultClassificationCatalog.reference(value.classificationCeiling))
      .sort((a, b) => a.rank - b.rank)[0]!;
    return { ...result, classificationCeiling: ceiling.key };
  }
  private classification(ceiling: string, key: string, config?: QaCompletionConfiguration) {
    const value = defaultClassificationCatalog.reference(key);
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(ceiling),
        value,
      ) ||
      (config &&
        (!config.allowedDataClassifications.includes(key) ||
          !defaultClassificationCatalog.permits(
            defaultClassificationCatalog.reference(config.maximumClassificationKey),
            value,
          )))
    )
      throw new Error("QA_COMPLETION_CLASSIFICATION_DENIED");
  }
  private async lock(manager: EntityManager, scope: QaScope, workItemId: string) {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `qa-request:${scope.workspaceId}:${scope.projectId}:${workItemId}`,
    ]);
  }
  private result(candidate: Row, command: ConnectorCommand, replayed: boolean) {
    if (!command.approvalId) throw stale();
    return {
      candidateId: String(candidate.candidate_id),
      commandId: command.id,
      approvalId: command.approvalId,
      state: command.status,
      resourceVersion: Number(candidate.resource_version),
      replayed,
    };
  }
}

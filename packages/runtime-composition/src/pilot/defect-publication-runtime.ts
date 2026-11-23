import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "@awp/competency-qa/node";
import {
  CommandGateway,
  type ConnectorCommand,
  defaultClassificationCatalog,
  type ExternalCommandLifecycleContribution,
} from "@awp/platform-core";
import { TypeOrmCommandRepository, TypeOrmUnitOfWork } from "@awp/platform-persistence-typeorm";

type Ref = Readonly<{ id: string; version: number; contentHash?: string }>;
type Row = Readonly<Record<string, unknown>>;
export interface QaDefectPublicationAuthority extends QaScope {
  authorize(permission: "qa.defect.publish" | "command.execute" | "integration.use"): Promise<
    Readonly<{
      actor: QaHumanActor;
      basis: QaAuthorizationBasis;
      scope: QaScope;
      classificationCeiling: string;
    }>
  >;
}
export interface QaDefectPublicationConfiguration {
  readonly bindingRef: Ref;
  readonly profileRef: Ref;
  readonly profileRefs: readonly Ref[];
  readonly authorityScopeKey: string;
  readonly maximumClassificationKey: string;
  readonly allowedDataClassifications: readonly string[];
  readonly externalTarget?: Readonly<{ externalProjectId: string; externalIssueTypeId: string }>;
  readonly configurationChain: readonly Readonly<{
    logicalRole: string;
    profileRef: Ref;
    mappingRef?: Ref;
    connectionRef?: Ref;
  }>[];
}
export interface QaDefectPublicationConfigurationPort {
  /** Current published configuration, resolved exclusively from server-owned project pins. */
  load(manager: EntityManager, scope: QaScope): Promise<QaDefectPublicationConfiguration>;
}
export interface QaDefectPublicationRuntime {
  publish(
    authority: QaDefectPublicationAuthority,
    workItemId: string,
    defectDraftId: string,
    expectedResourceVersion: number,
  ): Promise<
    Readonly<{
      operationId: string;
      state: string;
      approvalId: string;
      defectDraftId: string;
      resourceVersion: number;
      replayed: boolean;
    }>
  >;
}
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const same = (a: unknown, b: unknown) =>
  a !== undefined &&
  b !== undefined &&
  qaAggregateSnapshotHash(a as never) === qaAggregateSnapshotHash(b as never);
const versionRef = ({ id, version }: Ref) => ({ id, version });
const stale = () => new QaDomainError("QA_DEFECT_PUBLICATION_STALE");

/** The draft projection and Core command/approval/held outbox commit or roll back together. */
export class DurableQaDefectPublicationRuntime implements QaDefectPublicationRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly configuration: QaDefectPublicationConfigurationPort,
  ) {}

  async publish(
    authority: QaDefectPublicationAuthority,
    workItemId: string,
    defectDraftId: string,
    expectedResourceVersion: number,
  ) {
    await this.authorize(authority);
    if (!Number.isSafeInteger(expectedResourceVersion) || expectedResourceVersion < 1)
      throw stale();
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-defect:${authority.workspaceId}:${authority.projectId}:${workItemId}`,
      ]);
      const draft = await this.draft(manager, authority, workItemId, defectDraftId);
      const authorization = await this.authorize(authority);
      this.classification(authorization.classificationCeiling, String(draft.classification_key));
      const configuration = await this.configuration.load(manager, authority);
      const reference = json<{ id: string } | null>(draft.command_ref);
      if (reference) {
        const existing = await new TypeOrmCommandRepository(this.source).get(
          authority.workspaceId,
          authority.projectId,
          reference.id,
          manager,
        );
        if (!existing) throw stale();
        const semantics = this.semantics(draft, configuration, this.publicationVersion(existing));
        if (
          !["AWAITING_APPROVAL", "AUTHORIZED", "DISPATCHED", "LINKED"].includes(
            String(draft.state),
          ) ||
          !same(existing.expectedExternalState, semantics.expectedExternalState) ||
          !same(existing.payload, semantics.payload) ||
          !same(existing.target, semantics.target) ||
          !existing.approvalId ||
          (expectedResourceVersion !== Number(draft.resource_version) &&
            expectedResourceVersion !== semantics.qaDefect.publicationResourceVersion)
        )
          throw stale();
        await this.authorize(authority);
        return this.result(existing, draft, true);
      }
      if (
        Number(draft.resource_version) !== expectedResourceVersion ||
        !["DRAFT", "READY_FOR_APPROVAL"].includes(String(draft.state))
      )
        throw stale();
      const semantics = this.semantics(draft, configuration, expectedResourceVersion);
      const fresh = await this.authorize(authority);
      let readyVersion = expectedResourceVersion;
      if (draft.state === "DRAFT") {
        const [ready] = rows(
          await manager.query(
            "UPDATE qa_defect_drafts SET state='READY_FOR_APPROVAL',accepted_by=$1,accepted_at=clock_timestamp(),resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$2 AND project_id=$3 AND work_item_id=$4 AND defect_draft_id=$5 AND state='DRAFT' AND resource_version=$6 RETURNING resource_version",
            [
              JSON.stringify(fresh.actor),
              authority.workspaceId,
              authority.projectId,
              workItemId,
              defectDraftId,
              expectedResourceVersion,
            ],
          ),
        );
        if (!ready) throw stale();
        readyVersion = Number(ready.resource_version);
      }
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
          clientRequestKey: `qa:defect:${defectDraftId}:${String(draft.version)}`,
          commandType: "qa.defect.create",
          capability: {
            key: "operational-work-item",
            exactContractVersion: "1.0.0",
            operation: "defect.create",
            logicalRole: "DEFECT_DESTINATION",
          },
          target: semantics.target,
          payload: semantics.payload,
          expectedExternalState: semantics.expectedExternalState,
          bindingRef: versionRef(configuration.bindingRef),
          profileRef: versionRef(configuration.profileRef),
          dataClassificationKey: String(draft.classification_key),
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
          `UPDATE qa_defect_drafts SET state='AWAITING_APPROVAL',accepted_by=COALESCE(accepted_by,$1::jsonb),accepted_at=COALESCE(accepted_at,clock_timestamp()),
        binding_ref=$2,profile_refs=$3,approval_ref=$4,command_ref=$5,resource_version=resource_version+$6,updated_at=clock_timestamp()
        WHERE workspace_id=$7 AND project_id=$8 AND work_item_id=$9 AND defect_draft_id=$10 AND resource_version=$11 AND state IN('DRAFT','READY_FOR_APPROVAL') RETURNING *`,
          [
            JSON.stringify(fresh.actor),
            JSON.stringify(versionRef(configuration.bindingRef)),
            JSON.stringify(configuration.profileRefs.map(versionRef)),
            JSON.stringify({ id: command.approvalId, subjectHash: approval.subject_hash }),
            JSON.stringify({ id: command.id }),
            1,
            authority.workspaceId,
            authority.projectId,
            workItemId,
            defectDraftId,
            readyVersion,
          ],
        ),
      );
      if (!changed) throw stale();
      return this.result(command, changed, submitted.replayed);
    });
  }

  /** A worker/approval composition installs this guard before releasing or invoking the effect. */
  lifecycleContribution(
    authorityFor: (command: ConnectorCommand) => QaDefectPublicationAuthority,
  ): ExternalCommandLifecycleContribution {
    return {
      key: "qa.defect-publication-current-inputs",
      order: 2340,
      matches: (command) =>
        command.commandType === "qa.defect.create" &&
        command.capabilityKey === "operational-work-item" &&
        command.capabilityVersion === "1.0.0" &&
        command.operation === "defect.create",
      apply: async (phase, input, transaction) => {
        if (phase === "APPROVAL_RELEASED" || phase === "EFFECT_INVOCATION_STARTED") {
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
          await this.assertCommandCurrent(manager, command, authorityFor(command));
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

  async assertCommandCurrent(
    manager: EntityManager,
    command: ConnectorCommand,
    authority: QaDefectPublicationAuthority,
  ): Promise<void> {
    const auth = await this.authorize(authority);
    if (
      authority.workspaceId !== command.workspaceId ||
      authority.projectId !== command.projectId ||
      !same(auth.actor, command.actor) ||
      command.commandType !== "qa.defect.create"
    )
      throw stale();
    const expected = command.expectedExternalState as { qaDefect?: { draftRef?: { id: string } } };
    if (!command.source.sourceWorkItemId || !expected.qaDefect?.draftRef?.id) throw stale();
    const draft = await this.draft(
      manager,
      command,
      command.source.sourceWorkItemId,
      expected.qaDefect.draftRef.id,
    );
    this.classification(auth.classificationCeiling, String(draft.classification_key));
    const configuration = await this.configuration.load(manager, command);
    const current = this.semantics(draft, configuration, this.publicationVersion(command));
    if (
      json<{ id: string } | null>(draft.command_ref)?.id !== command.id ||
      !["AWAITING_APPROVAL", "AUTHORIZED", "DISPATCHED"].includes(String(draft.state)) ||
      command.capability.operation !== "defect.create" ||
      command.recoveryPolicy !== "LOOKUP_REQUIRED" ||
      !same(command.expectedExternalState, current.expectedExternalState) ||
      !same(command.payload, current.payload) ||
      !same(command.target, current.target) ||
      !same(command.bindingRef, versionRef(configuration.bindingRef)) ||
      !same(command.profileRef, versionRef(configuration.profileRef))
    )
      throw stale();
    await this.authorize(authority);
  }

  private async draft(
    manager: EntityManager,
    scope: QaScope,
    workItemId: string,
    defectDraftId: string,
  ): Promise<Row> {
    const [draft] = rows(
      await manager.query(
        `SELECT d.*,w.classification_key,r.version AS review_version,r.content_hash AS review_hash,
      r.stage AS review_stage,r.classification AS review_classification,r.disposition_decision AS review_disposition,
      f.frozen_review_revision_id AS current_review_id,p.version AS predecessor_version,p.content_hash AS predecessor_hash
      FROM qa_defect_drafts d JOIN work_items w ON w.id=d.work_item_id AND w.workspace_id=d.workspace_id AND w.project_id=d.project_id
      JOIN qa_findings f ON f.finding_id=d.finding_id AND f.workspace_id=d.workspace_id AND f.project_id=d.project_id AND f.work_item_id=d.work_item_id AND f.session_id=d.session_id
      JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=d.frozen_finding_review_id AND r.workspace_id=d.workspace_id AND r.project_id=d.project_id AND r.work_item_id=d.work_item_id AND r.session_id=d.session_id AND r.finding_id=d.finding_id
      LEFT JOIN qa_defect_drafts p ON p.defect_draft_id=d.predecessor_draft_id AND p.workspace_id=d.workspace_id AND p.project_id=d.project_id AND p.finding_id=d.finding_id
      WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.work_item_id=$3 AND d.defect_draft_id=$4 FOR UPDATE OF f,w,d`,
        [scope.workspaceId, scope.projectId, workItemId, defectDraftId],
      ),
    );
    if (!draft) throw new QaDomainError("QA_DEFECT_DRAFT_NOT_FOUND");
    if (
      draft.review_stage !== "FROZEN" ||
      draft.review_classification !== "PRODUCT" ||
      draft.review_disposition !== "CREATE_DEFECT" ||
      draft.current_review_id !== draft.frozen_finding_review_id
    )
      throw stale();
    return draft;
  }

  private semantics(
    draft: Row,
    configuration: QaDefectPublicationConfiguration,
    publicationResourceVersion: number,
  ) {
    this.classification(configuration.maximumClassificationKey, String(draft.classification_key));
    if (!configuration.allowedDataClassifications.includes(String(draft.classification_key)))
      throw new QaDomainError("QA_DEFECT_PUBLICATION_CLASSIFICATION_DENIED");
    const payload = json<{
      title: string;
      description: string;
      evidenceRefs: readonly { id: string; version: string; contentHash: string }[];
    }>(draft.payload);
    const frozenFindingReviewRef = {
      id: String(draft.frozen_finding_review_id),
      version: Number(draft.review_version),
      contentHash: String(draft.review_hash),
    };
    const content = {
      version: Number(draft.version),
      findingId: String(draft.finding_id),
      frozenFindingReviewRef,
      payload,
      provenance: json(draft.provenance),
      predecessorDraftRef: draft.predecessor_draft_id
        ? {
            id: String(draft.predecessor_draft_id),
            version: Number(draft.predecessor_version),
            contentHash: String(draft.predecessor_hash),
          }
        : null,
    };
    if (
      qaAggregateSnapshotHash(content as never) !== draft.content_hash ||
      !Array.isArray(payload.evidenceRefs) ||
      !payload.evidenceRefs.length
    )
      throw stale();
    // Acceptance uses one transition, publication another. The first publication's CAS remains stable for lost-response replay.
    const qaDefect = {
      draftRef: {
        id: String(draft.defect_draft_id),
        version: Number(draft.version),
        contentHash: draft.content_hash,
      },
      frozenFindingReviewRef,
      publicationResourceVersion,
    };
    return {
      qaDefect,
      target: {
        workspaceId: String(draft.workspace_id),
        projectId: String(draft.project_id),
        entityKind: "DEFECT",
        authorityScopeKey: configuration.authorityScopeKey,
        naturalKey: String(draft.finding_id),
        ...configuration.externalTarget,
      },
      payload: {
        sourceWorkItemId: String(draft.work_item_id),
        summary: payload.title,
        description: payload.description,
        dataClassificationKey: String(draft.classification_key),
        sourceRefs: [
          {
            kind: "QA_FINDING_REVIEW",
            id: frozenFindingReviewRef.id,
            version: String(frozenFindingReviewRef.version),
            contentHash: frozenFindingReviewRef.contentHash,
          },
          ...payload.evidenceRefs.map(
            (ref: { id: string; version: string; contentHash: string }) => ({
              kind: "ARTIFACT",
              ...ref,
            }),
          ),
        ],
      },
      expectedExternalState: {
        normalizedStatus: "ABSENT",
        qaDefect,
        configurationChain: configuration.configurationChain,
        bindingRef: configuration.bindingRef,
      },
    };
  }

  private publicationVersion(command: ConnectorCommand): number {
    const version = (
      command.expectedExternalState as { qaDefect?: { publicationResourceVersion?: number } }
    ).qaDefect?.publicationResourceVersion;
    if (!Number.isSafeInteger(version) || !version || version < 1) throw stale();
    return version;
  }

  private async authorize(authority: QaDefectPublicationAuthority) {
    const result = await authority.authorize("qa.defect.publish");
    for (const authorization of [
      result,
      await authority.authorize("command.execute"),
      await authority.authorize("integration.use"),
    ]) {
      if (
        authorization.actor.kind !== "HUMAN" ||
        !same(authorization.actor, result.actor) ||
        authorization.scope.workspaceId !== authority.workspaceId ||
        authorization.scope.projectId !== authority.projectId ||
        authorization.basis.kind !== "PROJECT" ||
        !authorization.basis.membershipRef ||
        !authorization.basis.entitlementRefs.length ||
        !authorization.basis.roleAssignmentRefs.length
      )
        throw stale();
    }
    return result;
  }
  private classification(ceiling: string, classification: string): void {
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(ceiling),
        defaultClassificationCatalog.reference(classification),
      )
    )
      throw new QaDomainError("QA_DEFECT_PUBLICATION_CLASSIFICATION_DENIED");
  }
  private result(command: ConnectorCommand, draft: Row, replayed: boolean) {
    if (!command.approvalId) throw stale();
    return Object.freeze({
      operationId: command.id,
      state: command.status,
      approvalId: command.approvalId,
      defectDraftId: String(draft.defect_draft_id),
      resourceVersion: Number(draft.resource_version),
      replayed,
    });
  }
}

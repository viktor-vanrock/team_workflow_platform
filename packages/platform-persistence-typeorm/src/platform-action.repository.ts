import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ActorReference,
  type Approval,
  assertBindingPublicationDecision,
  assertQueueActionPair,
  type BindingAction,
  type BindingCandidateSnapshot,
  type BindingPublicationApprover,
  consumeEffectAuthorization,
  createExactApproval,
  isSystemAdministratorRole,
  type PlatformAction,
  type PlatformActionPort,
  type PublishedBinding,
  type QueueActionPair,
  type QueueActionPairPort,
  recomputeExactApprovalSubjectHash,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
const returned = (value: unknown): Row[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as Row[]) : (value as Row[]);
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

function parseApproval(value: unknown): Approval {
  const stored = parse<
    Omit<Approval, "expiresAt" | "createdAt" | "decision" | "invalidatedAt" | "consumedAt"> & {
      readonly expiresAt: string;
      readonly createdAt: string;
      readonly decision?: Omit<NonNullable<Approval["decision"]>, "decidedAt"> & {
        readonly decidedAt: string;
      };
      readonly invalidatedAt?: string;
      readonly consumedAt?: string;
    }
  >(value);
  const { expiresAt, createdAt, decision, invalidatedAt, consumedAt, ...base } = stored;
  return {
    ...base,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(createdAt),
    ...(decision
      ? {
          decision: {
            ...decision,
            decidedAt: new Date(decision.decidedAt),
          },
        }
      : {}),
    ...(invalidatedAt ? { invalidatedAt: new Date(invalidatedAt) } : {}),
    ...(consumedAt ? { consumedAt: new Date(consumedAt) } : {}),
  };
}

export class TypeOrmPlatformActionRepository<TCandidate = unknown, TResult = unknown>
  implements PlatformActionPort<TCandidate, TResult>, QueueActionPairPort
{
  constructor(
    private readonly source: DataSource,
    private readonly workspaceId: string,
    private readonly projectId: string,
  ) {}

  async save(value: PlatformAction<TCandidate, TResult>): Promise<void> {
    await this.source.query(
      "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,result,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())",
      [
        value.id,
        this.workspaceId,
        this.projectId,
        value.kind,
        JSON.stringify({
          candidate: value.candidate,
          initiatorId: value.initiatorId,
        }),
        value.candidateHash,
        value.state,
        value.result ? JSON.stringify(value.result) : null,
        value.rowVersion,
      ],
    );
  }

  async saveQueueActionPair(
    input: Readonly<{
      pair: QueueActionPair;
      initiatorId: string;
      initiatorAuthorizationBasis: JsonValue;
      initiatorAuthorizationBasisHash: string;
      createdAt: string;
    }>,
  ): Promise<void> {
    assertQueueActionPair(input.pair);
    const { pair } = input;
    if (
      pair.candidate.target.workspaceId !== this.workspaceId ||
      pair.candidate.target.projectId !== this.projectId ||
      pair.candidate.scope.workspaceId !== this.workspaceId ||
      sha256(input.initiatorAuthorizationBasis) !== input.initiatorAuthorizationBasisHash
    ) {
      throw new Error("QUEUE_ACTION_PERSISTENCE_SCOPE_OR_BASIS_MISMATCH");
    }
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(
        "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,result,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING_APPROVAL',NULL,1,$7)",
        [
          pair.actionId,
          this.workspaceId,
          this.projectId,
          pair.candidate.actionKind,
          JSON.stringify({
            schemaRef: { id: pair.candidateSchemaId, version: pair.candidateSchemaVersion },
            candidate: pair.candidate,
            privateWitnessRef: {
              id: pair.actionId,
              version: pair.witnessSchemaVersion,
              semanticHash: pair.actionHash,
            },
            initiatorId: input.initiatorId,
          }),
          pair.publicIntentHash,
          input.createdAt,
        ],
      );
      await manager.query(
        "INSERT INTO queue_action_candidates(action_id,workspace_id,project_id,action_kind,public_schema_id,public_schema_version,public_candidate,public_intent_hash,private_schema_id,private_schema_version,private_witness,action_hash,initiator_authorization_basis,initiator_authorization_basis_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          pair.actionId,
          this.workspaceId,
          this.projectId,
          pair.candidate.actionKind,
          pair.candidateSchemaId,
          pair.candidateSchemaVersion,
          JSON.stringify(pair.candidate),
          pair.publicIntentHash,
          pair.witnessSchemaId,
          pair.witnessSchemaVersion,
          JSON.stringify(pair.witness),
          pair.actionHash,
          JSON.stringify(input.initiatorAuthorizationBasis),
          input.initiatorAuthorizationBasisHash,
          pair.candidate.expiresAt ?? null,
          input.createdAt,
        ],
      );
    });
  }

  async getQueueActionPair(
    workspaceId: string,
    projectId: string,
    actionId: string,
  ): Promise<QueueActionPair | undefined> {
    if (workspaceId !== this.workspaceId || projectId !== this.projectId) {
      throw new Error("QUEUE_ACTION_REPOSITORY_SCOPE_MISMATCH");
    }
    const rows = (await this.source.query(
      "SELECT q.*,p.candidate_hash,p.action_kind AS platform_action_kind FROM queue_action_candidates q JOIN platform_actions p ON p.workspace_id=q.workspace_id AND p.project_id=q.project_id AND p.id=q.action_id WHERE q.workspace_id=$1 AND q.project_id=$2 AND q.action_id=$3",
      [workspaceId, projectId, actionId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const pair: QueueActionPair = {
      actionId: String(row.action_id),
      candidateSchemaId: String(row.public_schema_id) as QueueActionPair["candidateSchemaId"],
      candidateSchemaVersion: Number(row.public_schema_version) as 1,
      candidate: parse<QueueActionPair["candidate"]>(row.public_candidate),
      publicIntentHash: String(row.public_intent_hash) as QueueActionPair["publicIntentHash"],
      witnessSchemaId: String(row.private_schema_id) as QueueActionPair["witnessSchemaId"],
      witnessSchemaVersion: Number(row.private_schema_version) as 1,
      witness: parse<QueueActionPair["witness"]>(row.private_witness),
      actionHash: String(row.action_hash) as QueueActionPair["actionHash"],
    };
    if (
      row.candidate_hash !== pair.publicIntentHash ||
      row.platform_action_kind !== pair.candidate.actionKind
    ) {
      throw new Error("QUEUE_ACTION_PLATFORM_ACTION_BINDING_MISMATCH");
    }
    assertQueueActionPair(pair);
    return Object.freeze(pair);
  }

  async get(id: string): Promise<PlatformAction<TCandidate, TResult> | undefined> {
    const rows = (await this.source.query(
      "SELECT * FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [this.workspaceId, this.projectId, id],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const stored = parse<{
      readonly candidate: TCandidate;
      readonly initiatorId: string;
    }>(row.candidate_ref);
    const state = String(row.state);
    if (
      state !== "PENDING_APPROVAL" &&
      state !== "EXECUTING" &&
      state !== "COMPLETED" &&
      state !== "FAILED"
    ) {
      throw new Error("PLATFORM_ACTION_STATE_INVALID");
    }
    return {
      id: String(row.id),
      kind: String(row.action_kind),
      candidate: stored.candidate,
      candidateHash: String(row.candidate_hash),
      initiatorId: stored.initiatorId,
      state,
      ...(row.result !== null && row.result !== undefined
        ? { result: parse<TResult>(row.result) }
        : {}),
      rowVersion: Number(row.row_version),
    };
  }

  async claim(id: string, expectedVersion: number): Promise<PlatformAction<TCandidate, TResult>> {
    const rows = returned(
      await this.source.query(
        "UPDATE platform_actions SET state='EXECUTING',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4 AND state='PENDING_APPROVAL' RETURNING id",
        [this.workspaceId, this.projectId, id, expectedVersion],
      ),
    );
    if (rows.length !== 1) throw new Error("PLATFORM_ACTION_CAS_CONFLICT");
    return (await this.get(id))!;
  }

  async complete(
    id: string,
    expectedVersion: number,
    result: TResult,
  ): Promise<PlatformAction<TCandidate, TResult>> {
    const rows = returned(
      await this.source.query(
        "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$5 AND state='EXECUTING' RETURNING *",
        [this.workspaceId, this.projectId, id, JSON.stringify(result), expectedVersion],
      ),
    );
    if (rows.length !== 1) {
      throw new Error("PLATFORM_ACTION_CAS_CONFLICT");
    }
    return (await this.get(id))!;
  }

  async fail(id: string, expectedVersion: number): Promise<PlatformAction<TCandidate, TResult>> {
    const rows = returned(
      await this.source.query(
        "UPDATE platform_actions SET state='FAILED',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4 AND state='EXECUTING' RETURNING id",
        [this.workspaceId, this.projectId, id, expectedVersion],
      ),
    );
    if (rows.length !== 1) throw new Error("PLATFORM_ACTION_CAS_CONFLICT");
    return (await this.get(id))!;
  }
}

export interface BindingPublicationRequestInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actionId: string;
  readonly approvalId: string;
  readonly initiator: ActorReference;
  readonly initiatorRole: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly expectedResourceVersion: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export class TypeOrmBindingPublicationRequestRepository {
  constructor(private readonly source: DataSource) {}

  async request(
    input: BindingPublicationRequestInput,
  ): Promise<Readonly<{ action: BindingAction; approval: Approval }>> {
    if (!isSystemAdministratorRole(input.initiatorRole)) {
      throw new Error("BINDING_PUBLICATION_INITIATOR_UNAUTHORIZED");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const headers = (await manager.query(
        "SELECT * FROM project_integration_binding_headers WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, input.bindingRef.id],
      )) as Row[];
      const header = headers[0];
      const revisions = (await manager.query(
        "SELECT * FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4 FOR UPDATE",
        [input.workspaceId, input.projectId, input.bindingRef.id, input.bindingRef.version],
      )) as Row[];
      const revision = revisions[0];
      if (!header || !revision) {
        throw new Error("BINDING_CANDIDATE_NOT_FOUND");
      }
      if (Number(header.row_version) !== input.expectedResourceVersion) {
        throw new Error("ETAG_MISMATCH");
      }
      if (revision.status !== "VALIDATED") {
        throw new Error("BINDING_CANDIDATE_NOT_VALIDATED");
      }
      const reports = (await manager.query(
        "SELECT id FROM integration_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 AND subject_version=$4 AND outcome='VALID' AND content_hash=$5 LIMIT 1",
        [
          input.workspaceId,
          input.projectId,
          input.bindingRef.id,
          input.bindingRef.version,
          revision.content_hash,
        ],
      )) as Row[];
      if (reports.length !== 1) {
        throw new Error("BINDING_VALIDATION_REPORT_REQUIRED");
      }

      const candidate: BindingCandidateSnapshot = {
        bindingId: input.bindingRef.id,
        version: input.bindingRef.version,
        resourceVersion: Number(header.row_version),
        contentHash: String(revision.content_hash),
        currentPublishedVersion:
          header.current_published_version === null
            ? null
            : Number(header.current_published_version),
        state: "VALIDATED",
      };
      const candidateHash = sha256(candidate as unknown as JsonValue);
      const action: BindingAction = {
        id: input.actionId,
        kind: "BINDING_PUBLICATION",
        candidate,
        candidateHash,
        initiatorId: input.initiator.principalId,
        state: "PENDING_APPROVAL",
        rowVersion: 1,
      };
      const target = {
        bindingId: candidate.bindingId,
        version: candidate.version,
      };
      const expectedState = {
        resourceVersion: candidate.resourceVersion,
        contentHash: candidate.contentHash,
        currentPublishedVersion: candidate.currentPublishedVersion,
      };
      const approval = createExactApproval({
        id: input.approvalId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        initiatorId: input.initiator.principalId,
        initiator: input.initiator,
        action: {
          actionKind: "PLATFORM_ACTION",
          actionId: action.id,
          commandType: "integration.binding.publish",
        },
        target,
        targetHash: sha256(target as JsonValue),
        payloadHash: candidateHash,
        expectedState,
        bindingRef: input.bindingRef,
        profileRefs: [],
        requiredPermission: "project.admin",
        separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
        effectIdempotencyKey: `awp:platform-action:${action.id}`,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      });

      await manager.query(
        "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,result,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)",
        [
          action.id,
          input.workspaceId,
          input.projectId,
          action.kind,
          JSON.stringify({
            candidate: action.candidate,
            initiatorId: action.initiatorId,
          }),
          action.candidateHash,
          action.state,
          action.rowVersion,
          input.createdAt,
        ],
      );
      await manager.query(
        "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13)",
        [
          approval.id,
          input.workspaceId,
          input.projectId,
          approval.action.actionKind,
          approval.action.actionId,
          JSON.stringify(approval),
          approval.subjectHash,
          approval.decisionStatus,
          approval.effectAuthorizationStatus,
          approval.initiatorId,
          approval.expiresAt,
          approval.resourceVersion,
          approval.createdAt,
        ],
      );
      return Object.freeze({ action, approval });
    });
  }
}

export interface BindingPublicationCasInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actionId: string;
  readonly approvalId: string;
  readonly approver: BindingPublicationApprover;
  readonly now: Date;
}

export class TypeOrmBindingPublicationExecutor {
  constructor(private readonly source: DataSource) {}

  async publish(input: BindingPublicationCasInput): Promise<PublishedBinding> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const actions = (await manager.query(
        "SELECT * FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, input.actionId],
      )) as Row[];
      const actionRow = actions[0];
      if (!actionRow) throw new Error("PLATFORM_ACTION_NOT_FOUND");
      if (actionRow.state === "COMPLETED") {
        if (!actionRow.result) throw new Error("PLATFORM_ACTION_RESULT_REQUIRED");
        return parse<PublishedBinding>(actionRow.result);
      }
      if (actionRow.state !== "PENDING_APPROVAL") {
        throw new Error("PLATFORM_ACTION_NOT_PENDING");
      }
      const storedAction = parse<{
        readonly candidate: BindingCandidateSnapshot;
        readonly initiatorId: string;
      }>(actionRow.candidate_ref);
      if (
        sha256(storedAction.candidate as unknown as JsonValue) !== String(actionRow.candidate_hash)
      ) {
        throw new Error("PLATFORM_ACTION_CANDIDATE_HASH_MISMATCH");
      }
      assertBindingPublicationDecision(storedAction.initiatorId, input.approver);

      const approvals = (await manager.query(
        "SELECT * FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND action_kind='PLATFORM_ACTION' AND action_id=$4 FOR UPDATE",
        [input.workspaceId, input.projectId, input.approvalId, input.actionId],
      )) as Row[];
      const approvalRow = approvals[0];
      if (!approvalRow) throw new Error("PLATFORM_ACTION_NOT_AUTHORIZED");
      const approval = parseApproval(approvalRow.subject);
      if (
        approval.decisionStatus !== "APPROVED" ||
        approval.effectAuthorizationStatus !== "AUTHORIZED" ||
        approval.action.actionKind !== "PLATFORM_ACTION" ||
        approval.action.actionId !== input.actionId ||
        approval.initiatorId !== storedAction.initiatorId ||
        approval.decision?.approverId !== input.approver.approverId ||
        approval.decision.approverRole !== input.approver.approverRole ||
        approval.requiredPermission !== "project.admin" ||
        approval.payloadHash !== String(actionRow.candidate_hash) ||
        approval.bindingRef?.id !== storedAction.candidate.bindingId ||
        approval.bindingRef.version !== storedAction.candidate.version ||
        approval.subjectHash !== String(approvalRow.subject_hash) ||
        recomputeExactApprovalSubjectHash(approval) !== approval.subjectHash
      ) {
        throw new Error("PLATFORM_ACTION_EXACT_APPROVAL_MISMATCH");
      }

      const candidate = storedAction.candidate;
      const headers = (await manager.query(
        "SELECT * FROM project_integration_binding_headers WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, candidate.bindingId],
      )) as Row[];
      const header = headers[0];
      const revisions = (await manager.query(
        "SELECT * FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4 FOR UPDATE",
        [input.workspaceId, input.projectId, candidate.bindingId, candidate.version],
      )) as Row[];
      const revision = revisions[0];
      const currentPublishedVersion =
        header?.current_published_version === null
          ? null
          : Number(header?.current_published_version);
      if (
        !header ||
        !revision ||
        Number(header.row_version) !== candidate.resourceVersion ||
        String(revision.content_hash) !== candidate.contentHash ||
        currentPublishedVersion !== candidate.currentPublishedVersion ||
        revision.status !== "VALIDATED"
      ) {
        throw new Error("CANDIDATE_DRIFT");
      }

      if (header.current_published_version !== null) {
        await manager.query(
          "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4 AND status='PUBLISHED'",
          [
            input.workspaceId,
            input.projectId,
            candidate.bindingId,
            Number(header.current_published_version),
          ],
        );
      }
      await manager.query(
        "UPDATE project_integration_binding_revisions SET status='PUBLISHED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4",
        [input.workspaceId, input.projectId, candidate.bindingId, candidate.version],
      );
      await manager.query(
        "UPDATE project_integration_binding_headers SET current_published_version=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [input.workspaceId, input.projectId, candidate.bindingId, candidate.version],
      );
      const result: PublishedBinding = {
        ...candidate,
        state: "PUBLISHED",
        resourceVersion: candidate.resourceVersion + 1,
        currentPublishedVersion: candidate.version,
      };
      const actionUpdate = returned(
        await manager.query(
          "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='PENDING_APPROVAL' AND row_version=$5 RETURNING id",
          [
            input.workspaceId,
            input.projectId,
            input.actionId,
            JSON.stringify(result),
            Number(actionRow.row_version),
          ],
        ),
      );
      if (actionUpdate.length !== 1) {
        throw new Error("PLATFORM_ACTION_CAS_CONFLICT");
      }
      const consumed = await consumeEffectAuthorization(approval, {
        subjectHash: recomputeExactApprovalSubjectHash(approval),
        approverAuthorized: true,
        now: input.now,
      });
      const approvalUpdate = returned(
        await manager.query(
          "UPDATE approvals SET effect_authorization_state='CONSUMED',subject=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND effect_authorization_state='AUTHORIZED' AND row_version=$5 RETURNING id",
          [
            input.workspaceId,
            input.projectId,
            input.approvalId,
            JSON.stringify(consumed),
            approval.resourceVersion,
          ],
        ),
      );
      if (approvalUpdate.length !== 1) {
        throw new Error("APPROVAL_CAS_CONFLICT");
      }
      return result;
    });
  }
}

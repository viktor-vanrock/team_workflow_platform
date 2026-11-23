import type { DataSource } from "typeorm";

import {
  type Approval,
  APPROVAL_SUBJECT_V2_SCHEMA_ID,
  type ApprovalCasPort,
  type ApprovalSubjectV2,
  parseApprovalSubject,
  type ReadableApprovalSubject,
  validateApprovalSubjectV2,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
type SerializedApproval = Omit<
  Approval,
  "expiresAt" | "createdAt" | "decision" | "invalidatedAt" | "consumedAt"
> &
  Readonly<{
    expiresAt: string;
    createdAt: string;
    decision?: Omit<NonNullable<Approval["decision"]>, "decidedAt"> &
      Readonly<{ decidedAt: string }>;
    invalidatedAt?: string;
    consumedAt?: string;
  }>;

const returned = (value: unknown): Row[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as Row[]) : (value as Row[]);

function parseApproval(value: unknown): Approval {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as SerializedApproval;
  const { expiresAt, createdAt, decision, invalidatedAt, consumedAt, ...base } = parsed;
  return {
    ...base,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(createdAt),
    ...(decision ? { decision: { ...decision, decidedAt: new Date(decision.decidedAt) } } : {}),
    ...(invalidatedAt ? { invalidatedAt: new Date(invalidatedAt) } : {}),
    ...(consumedAt ? { consumedAt: new Date(consumedAt) } : {}),
  };
}

export class TypeOrmApprovalRepository {
  constructor(private readonly source: DataSource) {}

  async insert(value: Approval): Promise<void> {
    if (!value.workspaceId || !value.projectId) {
      throw new Error("APPROVAL_SCOPE_REQUIRED");
    }
    await this.source.query(
      "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        value.id,
        value.workspaceId,
        value.projectId,
        value.action.actionKind,
        value.action.actionId,
        JSON.stringify(value),
        value.subjectHash,
        value.decisionStatus,
        value.effectAuthorizationStatus,
        value.initiatorId,
        value.decision?.approverId ?? null,
        value.expiresAt,
        value.resourceVersion,
        value.createdAt,
      ],
    );
  }

  async insertV2(value: ApprovalSubjectV2): Promise<void> {
    validateApprovalSubjectV2(value);
    await this.source.query(
      "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject_schema_id,subject_schema_version,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14,$15)",
      [
        value.approvalId,
        value.workspaceId,
        value.projectId,
        value.action.actionKind,
        value.action.actionId,
        value.subjectSchemaId,
        value.subjectSchemaVersion,
        JSON.stringify(value),
        value.subjectHash,
        value.decisionStatus,
        value.effectAuthorizationStatus,
        value.initiator.principalId,
        value.expiresAt,
        value.resourceVersion,
        value.createdAt,
      ],
    );
  }

  async getSubject(
    workspaceId: string,
    projectId: string,
    id: string,
  ): Promise<ReadableApprovalSubject | undefined> {
    const rows = (await this.source.query(
      "SELECT subject,subject_schema_id,subject_schema_version FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, id],
    )) as Row[];
    const row = rows[0];
    if (row?.subject === undefined) return undefined;
    const subject = parseApprovalSubject(row.subject);
    if ("subjectSchemaId" in subject) {
      if (
        row.subject_schema_id !== subject.subjectSchemaId ||
        Number(row.subject_schema_version) !== subject.subjectSchemaVersion
      ) {
        throw new Error("APPROVAL_SUBJECT_SCHEMA_IDENTITY_MISMATCH");
      }
    } else if (
      row.subject_schema_id !== null &&
      row.subject_schema_id !== undefined &&
      row.subject_schema_id !== "urn:awp:contracts:commands:approval-subject:v1"
    ) {
      throw new Error("APPROVAL_SUBJECT_SCHEMA_IDENTITY_MISMATCH");
    }
    return subject;
  }

  async getV2(
    workspaceId: string,
    projectId: string,
    id: string,
  ): Promise<ApprovalSubjectV2 | undefined> {
    const subject = await this.getSubject(workspaceId, projectId, id);
    if (!subject) return undefined;
    if (
      !("subjectSchemaId" in subject) ||
      subject.subjectSchemaId !== APPROVAL_SUBJECT_V2_SCHEMA_ID
    ) {
      throw new Error("APPROVAL_V2_SUBJECT_REQUIRED");
    }
    return subject;
  }

  async saveV2(value: ApprovalSubjectV2, expectedVersion: number): Promise<void> {
    validateApprovalSubjectV2(value);
    const result = returned(
      await this.source.query(
        "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,approver_id=$7,row_version=$8 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$9 AND subject_hash=$10 AND subject_schema_id=$11 AND subject_schema_version=$12 RETURNING id",
        [
          value.workspaceId,
          value.projectId,
          value.approvalId,
          JSON.stringify(value),
          value.decisionStatus,
          value.effectAuthorizationStatus,
          value.decision?.approver.principalId ?? null,
          value.resourceVersion,
          expectedVersion,
          value.subjectHash,
          value.subjectSchemaId,
          value.subjectSchemaVersion,
        ],
      ),
    );
    if (result.length !== 1) throw new Error("APPROVAL_V2_CAS_CONFLICT");
  }

  async get(workspaceId: string, projectId: string, id: string): Promise<Approval | undefined> {
    const rows = (await this.source.query(
      "SELECT subject FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, id],
    )) as Row[];
    return rows[0]?.subject === undefined ? undefined : parseApproval(rows[0].subject);
  }

  async save(value: Approval, expectedVersion: number): Promise<void> {
    const result = returned(
      await this.source.query(
        "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,approver_id=$7,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$8 AND subject_hash=$9 RETURNING id",
        [
          value.workspaceId,
          value.projectId,
          value.id,
          JSON.stringify(value),
          value.decisionStatus,
          value.effectAuthorizationStatus,
          value.decision?.approverId ?? null,
          expectedVersion,
          value.subjectHash,
        ],
      ),
    );
    if (result.length !== 1) {
      throw new Error("APPROVAL_CAS_CONFLICT");
    }
  }

  effectAuthorization(workspaceId: string, projectId: string): ApprovalCasPort {
    return {
      getForEffect: async (approvalId) => await this.get(workspaceId, projectId, approvalId),
      saveEffectState: async (value, expectedVersion) => {
        if (value.workspaceId !== workspaceId || value.projectId !== projectId) {
          throw new Error("APPROVAL_SCOPE_MISMATCH");
        }
        await this.save(value, expectedVersion);
      },
    };
  }
}

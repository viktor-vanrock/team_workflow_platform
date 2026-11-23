import { EntitySchema } from "typeorm";

export const ApprovalEntity = new EntitySchema({
  name: "Approval",
  tableName: "approvals",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    actionKind: { name: "action_kind", type: String },
    actionId: { name: "action_id", type: "uuid" },
    subject: { type: "jsonb" },
    subjectHash: { name: "subject_hash", type: String },
    decisionState: { name: "decision_state", type: String },
    effectAuthorizationState: { name: "effect_authorization_state", type: String },
    initiatorId: { name: "initiator_id", type: "uuid" },
    approverId: { name: "approver_id", type: "uuid", nullable: true },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
  uniques: [
    { columns: ["workspaceId", "projectId", "id"] },
    { columns: ["actionKind", "actionId"] },
  ],
});
export const PlatformActionEntity = new EntitySchema({
  name: "PlatformAction",
  tableName: "platform_actions",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    actionKind: { name: "action_kind", type: String },
    candidateRef: { name: "candidate_ref", type: "jsonb" },
    candidateHash: { name: "candidate_hash", type: String },
    state: { type: String },
    result: { type: "jsonb", nullable: true },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "id"] }],
});
export const ClientRequestIdempotencyEntity = new EntitySchema({
  name: "ClientRequestIdempotency",
  tableName: "client_request_idempotency",
  columns: {
    workspaceId: { name: "workspace_id", type: "uuid", primary: true },
    projectId: { name: "project_id", type: "uuid", primary: true },
    actorId: { name: "actor_id", type: "uuid", primary: true },
    operation: { type: String, primary: true },
    clientKey: { name: "client_key", type: String, primary: true },
    requestHash: { name: "request_hash", type: String },
    resultRef: { name: "result_ref", type: "jsonb", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
export const approvalsIdempotencyEntities = Object.freeze([
  ApprovalEntity,
  PlatformActionEntity,
  ClientRequestIdempotencyEntity,
]);

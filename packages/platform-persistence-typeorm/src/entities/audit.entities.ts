import { EntitySchema } from "typeorm";

export const AuditEventEntity = new EntitySchema({
  name: "AuditEvent",
  tableName: "audit_events",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid", nullable: true },
    occurredAt: { name: "occurred_at", type: "timestamptz", primary: true },
    actor: { type: "jsonb" },
    action: { type: String },
    outcome: { type: String },
    reasonCode: { name: "reason_code", type: String },
    correlationId: { name: "correlation_id", type: "uuid" },
    causationId: { name: "causation_id", type: "uuid" },
    authorizationBasis: { name: "authorization_basis", type: "jsonb", nullable: true },
    classificationKey: { name: "classification_key", type: String },
    attributes: { type: "jsonb" },
  },
  indices: [
    { name: "audit_scope_time_idx", columns: ["workspaceId", "projectId", "occurredAt"] },
    { name: "audit_correlation_idx", columns: ["correlationId", "occurredAt"] },
  ],
});
export const auditEntities = Object.freeze([AuditEventEntity]);

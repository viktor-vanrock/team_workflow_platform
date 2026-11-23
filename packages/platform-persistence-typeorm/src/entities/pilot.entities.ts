import { EntitySchema } from "typeorm";

export const PilotRecordRevisionEntity = new EntitySchema({
  name: "PilotRecordRevision",
  tableName: "pilot_record_revisions",
  columns: {
    workspaceId: { name: "workspace_id", type: "uuid", primary: true },
    projectId: { name: "project_id", type: "uuid", primary: true },
    recordId: { name: "record_id", type: "uuid", primary: true },
    version: { type: Number, primary: true },
    kind: { type: String },
    schemaVersion: { name: "schema_version", type: Number },
    actorRef: { name: "actor_ref", type: "uuid" },
    correlationId: { name: "correlation_id", type: String },
    createdAt: { name: "created_at", type: "timestamptz" },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  indices: [{ columns: ["workspaceId", "projectId", "kind", "createdAt", "recordId", "version"] }],
});
export const PilotRecordHeaderEntity = new EntitySchema({
  name: "PilotRecordHeader",
  tableName: "pilot_record_headers",
  columns: {
    workspaceId: { name: "workspace_id", type: "uuid", primary: true },
    projectId: { name: "project_id", type: "uuid", primary: true },
    recordId: { name: "record_id", type: "uuid", primary: true },
    kind: { type: String },
    currentVersion: { name: "current_version", type: Number },
    currentHash: { name: "current_hash", type: String },
    rowVersion: { name: "row_version", type: "bigint" },
  },
  indices: [{ columns: ["workspaceId", "projectId", "kind", "recordId"] }],
});
export const pilotEntities = Object.freeze([PilotRecordRevisionEntity, PilotRecordHeaderEntity]);

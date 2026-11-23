import { EntitySchema } from "typeorm";

const scope = {
  workspaceId: { name: "workspace_id", type: "uuid" as const, primary: true },
  configurationId: { name: "configuration_id", type: String, primary: true },
};
export const runtimeConfigurationEntities = [
  new EntitySchema({
    name: "RuntimeConfigurationRevision",
    tableName: "runtime_configuration_revisions",
    columns: {
      ...scope,
      version: { type: Number, primary: true },
      kind: { type: String },
      contentHash: { name: "content_hash", type: String },
      publicationHash: { name: "publication_hash", type: String },
      semanticBody: { name: "semantic_body", type: "jsonb" },
      publishedBy: { name: "published_by", type: "uuid" },
      publishedAt: { name: "published_at", type: "timestamptz" },
      validUntil: { name: "valid_until", type: "timestamptz" },
    },
  }),
  new EntitySchema({
    name: "RuntimeConfigurationProject",
    tableName: "runtime_configuration_projects",
    columns: {
      ...scope,
      version: { type: Number, primary: true },
      projectId: { name: "project_id", type: "uuid", primary: true },
    },
  }),
  new EntitySchema({
    name: "RuntimeConfigurationHeader",
    tableName: "runtime_configuration_headers",
    columns: {
      ...scope,
      kind: { type: String },
      currentVersion: { name: "current_version", type: Number },
      currentHash: { name: "current_hash", type: String },
      state: { type: String },
      rowVersion: { name: "row_version", type: "bigint" },
    },
  }),
  new EntitySchema({
    name: "RuntimeConfigurationEvent",
    tableName: "runtime_configuration_events",
    columns: {
      eventId: { name: "event_id", type: "uuid", primary: true },
      workspaceId: { name: "workspace_id", type: "uuid" },
      configurationId: { name: "configuration_id", type: String },
      version: { type: Number },
      action: { type: String },
      actorRef: { name: "actor_ref", type: "uuid" },
      correlationId: { name: "correlation_id", type: String },
      occurredAt: { name: "occurred_at", type: "timestamptz" },
    },
  }),
];

import { EntitySchema } from "typeorm";

export const DummyRequestEntity = new EntitySchema({
  name: "DummyRequest",
  tableName: "dummy_requests",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    workItemId: { name: "work_item_id", type: "uuid" },
    sampleName: { name: "sample_name", type: String },
    message: { type: String },
    history: { type: "jsonb" },
    rowVersion: { name: "row_version", type: Number },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
export const dummyEntities = Object.freeze([DummyRequestEntity]);

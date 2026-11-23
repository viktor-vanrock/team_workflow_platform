import { EntitySchema } from "typeorm";

export const RuntimeRegistrationEntity = new EntitySchema({
  name: "PilotRuntimeRegistration",
  tableName: "pilot_runtime_registrations",
  columns: {
    instanceId: { name: "instance_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    deploymentId: { name: "deployment_id", type: "uuid" },
    deploymentVersion: { name: "deployment_version", type: Number },
    component: { type: String },
    configDigest: { name: "config_digest", type: String },
    imageDigest: { name: "image_digest", type: String },
    state: { type: String },
    startedAt: { name: "started_at", type: "timestamptz" },
    refreshedAt: { name: "refreshed_at", type: "timestamptz" },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    rowVersion: { name: "row_version", type: "bigint" },
  },
});

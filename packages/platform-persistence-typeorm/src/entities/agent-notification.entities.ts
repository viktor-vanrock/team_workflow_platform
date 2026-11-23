import { EntitySchema } from "typeorm";

const jsonb = { type: "jsonb" as const };
const timestamptz = { type: "timestamptz" as const };
const entity = (name: string, tableName: string, columns: Record<string, unknown>) =>
  new EntitySchema({ name, tableName, columns: columns as never });
export const AgentRunEntity = entity("AgentRun", "agent_runs", {
  id: { type: String, primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  requestKey: { name: "request_key", type: String },
  requestHash: { name: "request_hash", type: String },
  subject: jsonb,
  promptManifest: { name: "prompt_manifest", ...jsonb },
  grantSetHash: { name: "grant_set_hash", type: String },
  state: { type: String },
  createdAt: { name: "created_at", ...timestamptz },
});
export const AgentRunGrantEntity = entity("AgentRunGrant", "agent_run_grants", {
  runId: { name: "run_id", type: String, primary: true },
  ordinal: { type: Number, primary: true },
  grant: { name: "grant_payload", ...jsonb },
  grantHash: { name: "grant_hash", type: String },
});
export const AgentRunStepEntity = entity("AgentRunStep", "agent_run_steps", {
  runId: { name: "run_id", type: String, primary: true },
  ordinal: { type: Number, primary: true },
  state: { type: String },
  inputHash: { name: "input_hash", type: String },
});
export const AgentToolInvocationEntity = entity("AgentToolInvocation", "agent_tool_invocations", {
  id: { type: String, primary: true },
  runId: { name: "run_id", type: String },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  action: { type: String },
  state: { type: String },
  createdAt: { name: "created_at", ...timestamptz },
});
export const NotificationIntentEntity = entity("NotificationIntent", "notification_intents", {
  id: { type: String, primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  projectId: { name: "project_id", type: "uuid" },
  dedupeKey: { name: "dedupe_key", type: String },
  sourceEventRef: { name: "source_event_ref", type: String },
  target: jsonb,
  targetHash: { name: "target_hash", type: String },
  payloadHash: { name: "payload_hash", type: String },
  renderHash: { name: "render_hash", type: String },
  commandId: { name: "command_id", type: "uuid" },
  state: { type: String },
  expiresAt: { name: "expires_at", ...timestamptz },
  rowVersion: { name: "row_version", type: Number },
  createdAt: { name: "created_at", ...timestamptz },
});
export const NotificationDeliveryAttemptEntity = entity(
  "NotificationDeliveryAttempt",
  "notification_delivery_attempts",
  {
    notificationIntentId: { name: "notification_intent_id", type: String, primary: true },
    attempt: { type: Number, primary: true },
    fence: { type: Number },
    startedAt: { name: "started_at", ...timestamptz },
    effectInvocationStartedAt: {
      name: "effect_invocation_started_at",
      ...timestamptz,
      nullable: true,
    },
    outcome: { type: String, nullable: true },
  },
);
export const agentNotificationEntities = Object.freeze([
  AgentRunEntity,
  AgentRunGrantEntity,
  AgentRunStepEntity,
  AgentToolInvocationEntity,
  NotificationIntentEntity,
  NotificationDeliveryAttemptEntity,
]);

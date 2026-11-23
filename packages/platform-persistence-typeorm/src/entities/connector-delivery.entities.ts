import { EntitySchema } from "typeorm";

export const ConnectorCommandEntity = new EntitySchema({
  name: "ConnectorCommand",
  tableName: "connector_commands",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    actor: { type: "jsonb" },
    capabilityKey: { name: "capability_key", type: String },
    capabilityVersion: { name: "capability_version", type: String },
    operation: { type: String },
    target: { type: "jsonb" },
    payload: { type: "jsonb" },
    bindingRef: { name: "binding_ref", type: "jsonb" },
    profileRef: { name: "profile_ref", type: "jsonb" },
    effectIdempotencyKey: { name: "effect_idempotency_key", type: String, unique: true },
    state: { type: String },
    result: { type: "jsonb", nullable: true },
    correlationId: { name: "correlation_id", type: "uuid" },
    causationId: { name: "causation_id", type: "uuid" },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "id"] }],
});
export const CommandOutboxEntity = new EntitySchema({
  name: "CommandOutbox",
  tableName: "command_outbox",
  columns: {
    id: { type: "uuid", primary: true },
    commandId: { name: "command_id", type: "uuid" },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    state: { type: String },
    availableAt: { name: "available_at", type: "timestamptz" },
    leaseUntil: { name: "lease_until", type: "timestamptz", nullable: true },
    nextRepublishAt: { name: "next_republish_at", type: "timestamptz", nullable: true },
    attempts: { type: Number, default: 0 },
    envelopeHash: { name: "envelope_hash", type: String },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
  indices: [
    { name: "command_outbox_delivery_idx", columns: ["state", "availableAt", "nextRepublishAt"] },
  ],
});
export const WebhookReceiptEntity = new EntitySchema({
  name: "WebhookReceipt",
  tableName: "webhook_receipts",
  columns: {
    connectorKey: { name: "connector_key", type: String, primary: true },
    deliveryId: { name: "delivery_id", type: String, primary: true },
    bodyHash: { name: "body_hash", type: String },
    receivedAt: { name: "received_at", type: "timestamptz" },
  },
});
export const ConsumerInboxEntity = new EntitySchema({
  name: "ConsumerInbox",
  tableName: "consumer_inbox",
  columns: {
    consumerKey: { name: "consumer_key", type: String, primary: true },
    messageId: { name: "message_id", type: String, primary: true },
    messageHash: { name: "message_hash", type: String },
    processedAt: { name: "processed_at", type: "timestamptz" },
  },
});
export const EventOutboxEntity = new EntitySchema({
  name: "EventOutbox",
  tableName: "event_outbox",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    eventType: { name: "event_type", type: String },
    envelope: { type: "jsonb" },
    envelopeHash: { name: "envelope_hash", type: String },
    state: { type: String },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
export const connectorDeliveryEntities = Object.freeze([
  ConnectorCommandEntity,
  CommandOutboxEntity,
  WebhookReceiptEntity,
  ConsumerInboxEntity,
  EventOutboxEntity,
]);

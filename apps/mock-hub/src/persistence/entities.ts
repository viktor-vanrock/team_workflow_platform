import { EntitySchema } from "typeorm";

import { gitLabMockEntities } from "../gitlab/state/gitlab.entities.ts";
import { mattermostMockEntities } from "../mattermost/state/mattermost.entities.ts";
import { operationalEntities } from "../operational/operational.entities.ts";

export const MockCallEntity = new EntitySchema({
  name: "MockCall",
  tableName: "mock_calls",
  columns: {
    sequence: { type: Number, primary: true, generated: "increment" },
    effectIdempotencyKey: { name: "effect_idempotency_key", type: String },
    requestHash: { name: "request_hash", type: String },
    recordedAt: { name: "recorded_at", type: "timestamptz" },
  },
});
export const MockEffectEntity = new EntitySchema({
  name: "MockEffect",
  tableName: "mock_effects",
  columns: {
    effectIdempotencyKey: { name: "effect_idempotency_key", type: String, primary: true },
    requestHash: { name: "request_hash", type: String },
    effectCount: { name: "effect_count", type: Number },
    externalRecordId: { name: "external_record_id", type: String },
    result: { type: "jsonb" },
    recordedAt: { name: "recorded_at", type: "timestamptz" },
  },
});
export const MockEventEntity = new EntitySchema({
  name: "MockEvent",
  tableName: "mock_events",
  columns: {
    sequence: { type: Number, primary: true, generated: "increment" },
    eventId: { name: "event_id", type: String },
    scenario: { type: String },
    externalRecordId: { name: "external_record_id", type: String },
    recordedAt: { name: "recorded_at", type: "timestamptz" },
  },
});
export const MockScenarioEntity = new EntitySchema({
  name: "MockScenario",
  tableName: "mock_scenario",
  columns: {
    singleton: { type: Number, primary: true },
    scenario: { type: String },
    appliesToNext: { name: "applies_to_next", type: Number },
  },
});
export const MockSeedEntity = new EntitySchema({
  name: "MockSeed",
  tableName: "mock_seed_state",
  columns: { singleton: { type: Number, primary: true }, seed: { type: Number } },
});
export const mockHubEntities = Object.freeze([
  MockCallEntity,
  MockEffectEntity,
  MockEventEntity,
  MockScenarioEntity,
  MockSeedEntity,
  ...operationalEntities,
  ...mattermostMockEntities,
  ...gitLabMockEntities,
]);

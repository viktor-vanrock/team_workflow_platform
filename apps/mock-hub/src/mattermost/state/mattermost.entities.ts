import { EntitySchema } from "typeorm";

export const MattermostTeamEntity = new EntitySchema({
  name: "MattermostMockTeam",
  tableName: "mattermost_mock_teams",
  columns: {
    id: { type: String, primary: true },
    name: { type: String, unique: true },
    displayName: { name: "display_name", type: String },
  },
});

export const MattermostChannelEntity = new EntitySchema({
  name: "MattermostMockChannel",
  tableName: "mattermost_mock_channels",
  columns: {
    id: { type: String, primary: true },
    teamId: { name: "team_id", type: String },
    name: { type: String },
    displayName: { name: "display_name", type: String },
    purpose: { type: String },
  },
});

export const MattermostUserEntity = new EntitySchema({
  name: "MattermostMockUser",
  tableName: "mattermost_mock_users",
  columns: {
    id: { type: String, primary: true },
    username: { type: String, unique: true },
    displayName: { name: "display_name", type: String },
    isBot: { name: "is_bot", type: Boolean },
  },
});

export const MattermostMembershipEntity = new EntitySchema({
  name: "MattermostMockMembership",
  tableName: "mattermost_mock_memberships",
  columns: {
    teamId: { name: "team_id", type: String, primary: true },
    channelId: { name: "channel_id", type: String, primary: true },
    userId: { name: "user_id", type: String, primary: true },
    roles: { type: "text", array: true },
  },
});

export const MattermostPostEntity = new EntitySchema({
  name: "MattermostMockPost",
  tableName: "mock_mattermost_posts",
  columns: {
    id: { type: String, primary: true },
    channelId: { name: "channel_id", type: String },
    userId: { name: "user_id", type: String },
    message: { type: String },
    props: { type: "jsonb" },
    effectKey: { name: "effect_key", type: String, unique: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});

export const MattermostFaultEntity = new EntitySchema({
  name: "MattermostMockFault",
  tableName: "mattermost_mock_faults",
  columns: {
    singleton: { type: Number, primary: true },
    fault: { type: String },
    remaining: { type: Number },
  },
});

export const MattermostCallbackEntity = new EntitySchema({
  name: "MattermostMockCallback",
  tableName: "mattermost_mock_callbacks",
  columns: {
    id: { type: Number, primary: true, generated: "increment" },
    callbackKind: { name: "callback_kind", type: String },
    connectionId: { name: "connection_id", type: String },
    externalUserId: { name: "external_user_id", type: String },
    payload: { type: "jsonb" },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});

export const MattermostEffectCallEntity = new EntitySchema({
  name: "MattermostMockEffectCall",
  tableName: "mattermost_mock_effect_calls",
  columns: {
    sequence: { type: Number, primary: true, generated: "increment" },
    effectKey: { name: "effect_key", type: String },
    operation: { type: String },
    requestBody: { name: "request_body", type: "jsonb" },
    outcome: { type: String },
    externalPostId: { name: "external_post_id", type: String, nullable: true },
    recordedAt: { name: "recorded_at", type: "timestamptz" },
  },
});

export const mattermostMockEntities = Object.freeze([
  MattermostTeamEntity,
  MattermostChannelEntity,
  MattermostUserEntity,
  MattermostMembershipEntity,
  MattermostPostEntity,
  MattermostFaultEntity,
  MattermostCallbackEntity,
  MattermostEffectCallEntity,
]);

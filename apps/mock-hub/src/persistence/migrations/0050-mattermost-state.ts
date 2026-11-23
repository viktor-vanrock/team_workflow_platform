import type { MigrationInterface, QueryRunner } from "typeorm";

export class MattermostState00501700000002050 implements MigrationInterface {
  readonly name = "MattermostState00501700000002050";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mattermost_mock_teams (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        display_name text NOT NULL
      );
      CREATE TABLE mattermost_mock_channels (
        id text PRIMARY KEY,
        team_id text NOT NULL REFERENCES mattermost_mock_teams(id),
        name text NOT NULL,
        display_name text NOT NULL,
        purpose text NOT NULL,
        UNIQUE(team_id, name)
      );
      CREATE TABLE mattermost_mock_users (
        id text PRIMARY KEY,
        username text NOT NULL UNIQUE,
        display_name text NOT NULL,
        is_bot boolean NOT NULL DEFAULT false
      );
      CREATE TABLE mattermost_mock_memberships (
        team_id text NOT NULL REFERENCES mattermost_mock_teams(id),
        channel_id text NOT NULL REFERENCES mattermost_mock_channels(id),
        user_id text NOT NULL REFERENCES mattermost_mock_users(id),
        roles text[] NOT NULL DEFAULT ARRAY[]::text[],
        PRIMARY KEY(team_id, channel_id, user_id)
      );
      CREATE TABLE mock_mattermost_posts (
        id text PRIMARY KEY,
        channel_id text NOT NULL REFERENCES mattermost_mock_channels(id),
        user_id text NOT NULL REFERENCES mattermost_mock_users(id),
        message text NOT NULL,
        props jsonb NOT NULL DEFAULT '{}'::jsonb,
        effect_key text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE mock_mattermost_posts;
      DROP TABLE mattermost_mock_memberships;
      DROP TABLE mattermost_mock_users;
      DROP TABLE mattermost_mock_channels;
      DROP TABLE mattermost_mock_teams;
    `);
  }
}

import { qaJiraGitLabLocalComposition } from "../gitlab/composition.ts";

export const qaJiraGitLabMattermostLocalComposition = Object.freeze({
  ...qaJiraGitLabLocalComposition,
  key: "qa-jira-gitlab-mattermost-local" as const,
});
export const qaJiraGitLabMattermostLocalMigrationRegistry =
  qaJiraGitLabLocalComposition.migrationRegistry;
export const qaJiraGitLabMattermostLocalMigrations = qaJiraGitLabLocalComposition.migrations;
export const qaJiraGitLabMattermostLocalEntities = qaJiraGitLabLocalComposition.entities;

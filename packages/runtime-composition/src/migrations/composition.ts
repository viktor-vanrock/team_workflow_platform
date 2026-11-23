import { dummyMigrationRegistry } from "@awp/competency-dummy";
import { techWritingMigrations } from "@awp/competency-tech-writing/node";
import { gitLabMigrationRegistry } from "@awp/connector-gitlab-persistence-typeorm";
import { jiraMigrationRegistry } from "@awp/connector-jira-persistence-typeorm";
import {
  migrationClasses,
  type OwnedMigration,
  validateMigrationRegistry,
} from "@awp/platform-persistence-typeorm";

import { coreOnlyMigrationRegistry } from "./core-composition.ts";

export { coreOnlyMigrationRegistry, coreOnlyMigrations } from "./core-composition.ts";
export const localMigrationRegistry = Object.freeze([
  ...coreOnlyMigrationRegistry,
  ...dummyMigrationRegistry,
  ...techWritingMigrations,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(localMigrationRegistry);
export const localMigrations = migrationClasses(localMigrationRegistry);
export const jiraLocalMigrationRegistry = Object.freeze([
  ...localMigrationRegistry,
  ...jiraMigrationRegistry,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(jiraLocalMigrationRegistry);
export const jiraLocalMigrations = migrationClasses(jiraLocalMigrationRegistry);
export const gitLabLocalMigrationRegistry = Object.freeze([
  ...localMigrationRegistry,
  ...gitLabMigrationRegistry,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(gitLabLocalMigrationRegistry);
export const gitLabLocalMigrations = migrationClasses(gitLabLocalMigrationRegistry);
export const jiraGitLabLocalMigrationRegistry = Object.freeze([
  ...jiraLocalMigrationRegistry,
  ...gitLabMigrationRegistry,
] satisfies readonly OwnedMigration[]);
validateMigrationRegistry(jiraGitLabLocalMigrationRegistry);
export const jiraGitLabLocalMigrations = migrationClasses(jiraGitLabLocalMigrationRegistry);

/** Feature 006 static ownership markers: Core 0130/0135/0140 and QA 2070. */
export const queueFoundationMigrationOrders = Object.freeze([
  "0130",
  "0135",
  "0140",
  "2070",
] as const);

/** Feature 007 static ownership markers: Core 0150/0155/0160 and QA 2080/2085. */
export const onboardingFoundationMigrationOrders = Object.freeze([
  "0150",
  "0155",
  "0160",
  "2080",
  "2085",
] as const);

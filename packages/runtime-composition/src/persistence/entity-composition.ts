import type { EntitySchema } from "typeorm";

import { dummyEntities } from "@awp/competency-dummy";
import { qaEntities } from "@awp/competency-qa/node";
import { gitLabEntities } from "@awp/connector-gitlab-persistence-typeorm";
import { jiraEntities } from "@awp/connector-jira-persistence-typeorm";
import {
  onboardingFoundationEntities,
  queueManagementEntities,
} from "@awp/platform-persistence-typeorm";

import { coreOnlyEntities } from "./core-entity-composition.ts";

export { coreOnlyEntities } from "./core-entity-composition.ts";
export const localEntities: readonly EntitySchema[] = Object.freeze([
  ...coreOnlyEntities,
  ...dummyEntities,
]);
export const jiraLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...localEntities,
  ...jiraEntities,
]);
export const gitLabLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...localEntities,
  ...gitLabEntities,
]);
export const jiraGitLabLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...jiraLocalEntities,
  ...gitLabEntities,
]);
export const qaQueueEntities: readonly EntitySchema[] = Object.freeze(
  qaEntities.filter(({ options }) => String(options.tableName).startsWith("qa_queue_fact_")),
);
export const queueFoundationEntities: readonly EntitySchema[] = Object.freeze([
  ...queueManagementEntities,
  ...qaQueueEntities,
]);

const onboardingQaTableNames = new Set([
  "qa_project_context_headers_v2",
  "qa_project_context_revisions_v2",
  "qa_project_environment_headers",
  "qa_project_environment_revisions",
  "qa_test_data_catalog_entries",
  "qa_account_pool_references",
  "qa_test_account_leases",
  "qa_target_snapshots_v2",
  "qa_evidence_manifest_headers_v2",
  "qa_evidence_manifest_revisions_v2",
  "qa_evidence_manifest_artifact_memberships_v2",
  "qa_evidence_signature_envelopes",
  "qa_evidence_packages",
]);
export const onboardingQaEntities: readonly EntitySchema[] = Object.freeze(
  qaEntities.filter(({ options }) => onboardingQaTableNames.has(String(options.tableName))),
);
export const onboardingLocalEntities: readonly EntitySchema[] = Object.freeze([
  ...onboardingFoundationEntities,
  ...onboardingQaEntities,
]);

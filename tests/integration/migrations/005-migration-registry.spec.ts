import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  gitLabMockEntities,
  gitLabMockMigrations,
} from "../../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { qaEntities, qaMigrationContributions } from "../../../packages/competency-qa/src/node.ts";
import {
  gitLabEntities,
  gitLabMigrationRegistry,
} from "../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import {
  coreMigrationRegistry,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Feature 005 migration ownership and parity", () => {
  it("registers all nine migrations in their non-colliding owner ranges", () => {
    expect(
      qaMigrationContributions
        .filter(({ order }) => order >= 2050 && order <= 2060)
        .map(({ order, owner }) => [order, owner]),
    ).toEqual([
      [2050, "pack:qa"],
      [2055, "pack:qa"],
      [2060, "pack:qa"],
    ]);
    expect(gitLabMigrationRegistry.map(({ order, owner }) => [order, owner])).toEqual([
      [4000, "connector:gitlab"],
      [4010, "connector:gitlab"],
      [4020, "connector:gitlab"],
    ]);
    expect(gitLabMockMigrations.map((Migration) => new Migration().name)).toEqual([
      "GitLabMockProjectState00601700000002060",
      "GitLabMockPipelineArtifacts00611700000002061",
      "GitLabMockWebhookFaultAudit00621700000002062",
    ]);
    expect(() =>
      validateMigrationRegistry([
        ...coreMigrationRegistry,
        ...qaMigrationContributions,
        ...gitLabMigrationRegistry,
      ]),
    ).not.toThrow();
  });

  it("maps every newly owned table to exactly one entity", () => {
    const qaTables = qaEntities.map(({ options }) => String(options.tableName));
    const connectorTables = gitLabEntities.map(({ options }) => String(options.tableName));
    const mockTables = gitLabMockEntities.map(({ options }) => String(options.tableName));

    for (const table of [
      "qa_automation_suite_bindings",
      "qa_automation_suite_binding_versions",
      "qa_automation_suite_validation_reports",
      "qa_automation_session_configuration_pins",
      "qa_attempt_identities",
      "qa_automation_launch_requests",
      "qa_automation_attempts",
      "qa_automation_attempt_status_revisions",
      "qa_automation_attempt_results",
      "qa_automation_retry_decisions",
      "qa_automation_artifact_memberships",
      "qa_automation_quarantines",
      "qa_automation_quarantine_revisions",
      "qa_automation_review_freezes",
    ])
      expect(qaTables, table).toContain(table);
    for (const table of [
      "gitlab_discovery_snapshots",
      "gitlab_profile_validation_details",
      "gitlab_webhook_receipts",
      "gitlab_reconciliation_cursors",
      "gitlab_rate_limit_snapshots",
      "gitlab_effect_reconciliations",
      "gitlab_effect_lookup_observations",
      "gitlab_artifact_locator_revisions",
    ])
      expect(connectorTables, table).toContain(table);
    for (const table of [
      "mock_gitlab_projects",
      "mock_gitlab_merge_requests",
      "mock_gitlab_commits",
      "mock_gitlab_pipelines",
      "mock_gitlab_jobs",
      "mock_gitlab_artifacts",
      "mock_gitlab_webhook_deliveries",
      "mock_gitlab_faults",
      "mock_gitlab_call_audit",
    ])
      expect(mockTables, table).toContain(table);
  });

  it("keeps QA and Connector foreign-key direction one-way and creates no Core DDL", () => {
    const qa = [2050, 2055, 2060]
      .map((order) =>
        read(
          `packages/competency-qa/src/persistence/migrations/${order}-qa-automation-${order === 2050 ? "foundation" : order === 2055 ? "execution" : "review-quarantine"}.ts`,
        ),
      )
      .join("\n");
    const connector = [
      "4000-gitlab-discovery-profiles.ts",
      "4010-gitlab-webhook-rate-reconciliation.ts",
      "4020-gitlab-effect-artifact-reconciliation.ts",
    ]
      .map((name) => read(`packages/connector-gitlab-persistence-typeorm/src/migrations/${name}`))
      .join("\n");

    expect(qa).not.toMatch(/REFERENCES\s+gitlab_/iu);
    expect(connector).not.toMatch(
      /REFERENCES\s+qa_|CREATE\s+TABLE\s+(?:workspaces|projects|work_items|connector_commands|artifact_references)\b/iu,
    );
  });
});

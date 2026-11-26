import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { createCorporateGitLabAutomationWorkerAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-automation-authority.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";

describe("corporate GitLab automation authority", () => {
  it("rejects a previously queued attempt without a build before calling GitLab", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      payload: { automationAttemptId: "attempt" },
    };
    const body = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      workItemId: "work",
      testSessionId: "session",
      target: { commitSha: "a".repeat(40) },
      configurationPins: [],
    };
    const hash = sha256(body);
    const jira = vi.fn();
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: {
        isInitialized: true,
        query: async () => [
          {
            connector_command_id: command.id,
            target_snapshot_hash: hash,
            target_hash: hash,
            work_item_id: "work",
            session_id: "session",
            target_snapshot: { ...body, snapshotHash: hash },
          },
        ],
      },
      grants: [],
      factories: { gitlab: jira },
      commands: {},
    } as never);
    await expect(authority.materialize(command)).rejects.toThrow(
      "CORPORATE_GITLAB_BUILD_REF_REQUIRED",
    );
    expect(jira).not.toHaveBeenCalled();
  });
  it("requires an initialized source and an exact automation attempt before resolving a connector", async () => {
    expect(() =>
      createCorporateGitLabAutomationWorkerAuthority({ source: { isInitialized: false } } as never),
    ).toThrow("CORPORATE_GITLAB_AUTHORITY_REQUIRED");
    const query = vi.fn(async () => []);
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: { isInitialized: true, query },
      grants: [],
      factories: {},
      commands: {},
    } as never);
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      payload: { automationAttemptId: "attempt" },
    };
    await expect(authority.materialize(command)).rejects.toThrow(
      "GITLAB_AUTOMATION_ATTEMPT_COMMAND_MISMATCH",
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("rejects a test execution profile different from the command before resolving a connector", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      payload: { automationAttemptId: "attempt" },
    };
    const body = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      workItemId: "work",
      testSessionId: "session",
      target: { commitSha: "a".repeat(40), buildRef: "pipeline:101" },
      configurationPins: [
        { logicalRole: "TEST_EXECUTION", profileRef: { id: "another-profile", version: 1 } },
      ],
    };
    const hash = sha256(body);
    const query = vi.fn(async () => [
      {
        connector_command_id: command.id,
        target_snapshot_hash: hash,
        target_hash: hash,
        work_item_id: "work",
        session_id: "session",
        target_snapshot: { ...body, snapshotHash: hash },
      },
    ]);
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: { isInitialized: true, query },
      grants: [],
      factories: {},
      commands: {},
    } as never);
    await expect(authority.materialize(command)).rejects.toThrow(
      "GITLAB_AUTOMATION_TEST_EXECUTION_PIN_INVALID",
    );
    expect(query).toHaveBeenCalledOnce();
  });
  it("rejects a modified target snapshot before loading a GitLab connector", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      payload: { automationAttemptId: "attempt" },
    };
    const jira = vi.fn();
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: {
        isInitialized: true,
        query: async () => [
          {
            connector_command_id: command.id,
            target_snapshot_hash: "sha256:old",
            target_hash: "sha256:old",
            target_snapshot: { snapshotHash: "sha256:old", configurationPins: [] },
          },
        ],
      },
      grants: [],
      factories: { gitlab: jira },
      commands: {},
    } as never);
    await expect(authority.materialize(command)).rejects.toThrow(
      "GITLAB_AUTOMATION_TARGET_SNAPSHOT_STALE",
    );
    expect(jira).not.toHaveBeenCalled();
  });
  it("rejects an attempt assigned to a different execution service", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      payload: { automationAttemptId: "attempt" },
    };
    const profileRef = { ...command.profileRef, contentHash: "profile-hash" };
    const connectionRef = { id: "connection", version: 1, contentHash: "connection-hash" };
    const bindingRef = { id: "binding", version: 1, contentHash: "binding-hash" };
    const body = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      workItemId: "work",
      testSessionId: "session",
      target: { commitSha: "a".repeat(40), buildRef: "pipeline:101" },
      configurationPins: [
        {
          logicalRole: "TEST_EXECUTION",
          profileRef,
          connectionRef,
          projectIntegrationBindingRef: bindingRef,
        },
      ],
    };
    const hash = sha256(body);
    const query = vi.fn(async () => [
      {
        connector_command_id: command.id,
        target_snapshot_hash: hash,
        target_hash: hash,
        work_item_id: "work",
        session_id: "session",
        target_snapshot: { ...body, snapshotHash: hash },
        lineage_kind: "INITIAL",
        initiating_human_principal_id: command.actor.principalId,
        executing_service_principal_id: "different-service",
        effect_idempotency_key: command.effectIdempotencyKey,
      },
    ]);
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: { isInitialized: true, query },
      commands: {},
      factories: {},
      grants: [
        {
          binding: {
            provider: "GITLAB",
            workspaceId: command.workspaceId,
            projectId: command.projectId,
            profileRef,
            connectionRef,
            servicePrincipalId: "service",
          },
          integrationBindingRef: bindingRef,
        },
      ],
    } as never);
    await expect(authority.materialize(command)).rejects.toThrow(
      "GITLAB_AUTOMATION_ATTEMPT_AUTHORITY_MISMATCH",
    );
    expect(query).toHaveBeenCalledOnce();
  });
  it("keeps a queued automatic retry closed until Suite evidence is available", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      actor: { kind: "SERVICE" as const, principalId: "service", serviceKey: "gitlab" },
      payload: { automationAttemptId: "attempt" },
    };
    const profileRef = { ...command.profileRef, contentHash: "profile-hash" };
    const connectionRef = { id: "connection", version: 1, contentHash: "connection-hash" };
    const bindingRef = { id: "binding", version: 1, contentHash: "binding-hash" };
    const body = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      workItemId: "work",
      testSessionId: "session",
      target: { commitSha: "a".repeat(40), buildRef: "pipeline:101" },
      configurationPins: [
        {
          logicalRole: "TEST_EXECUTION",
          profileRef,
          connectionRef,
          projectIntegrationBindingRef: bindingRef,
        },
      ],
    };
    const hash = sha256(body);
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM qa_automation_attempts")
        ? [
            {
              connector_command_id: command.id,
              target_snapshot_hash: hash,
              target_hash: hash,
              work_item_id: "work",
              session_id: "session",
              target_snapshot: { ...body, snapshotHash: hash },
              lineage_kind: "AUTO_INFRA_RETRY",
              initiating_human_principal_id: "person",
              executing_service_principal_id: "service",
              effect_idempotency_key: command.effectIdempotencyKey,
            },
          ]
        : [],
    );
    const authority = createCorporateGitLabAutomationWorkerAuthority({
      source: { isInitialized: true, query },
      commands: {},
      factories: {},
      grants: [
        {
          binding: {
            provider: "GITLAB",
            workspaceId: command.workspaceId,
            projectId: command.projectId,
            profileRef,
            connectionRef,
            servicePrincipalId: "service",
          },
          integrationBindingRef: bindingRef,
        },
      ],
    } as never);
    await expect(authority.materialize(command)).rejects.toThrow(
      "GITLAB_SUITE_UNAVAILABLE_RUNNER_NETWORK_NO_DEPLOY_EVIDENCE_MISSING",
    );
    await expect(authority.materialize({ ...command, status: "DISPATCHED" })).rejects.toThrow(
      "GITLAB_AUTOMATION_CONFIGURATION_STALE",
    );
  });
});

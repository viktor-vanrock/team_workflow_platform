import { describe, expect, it } from "vitest";

import {
  createAutomatedPlanItem,
  createAutomatedRequiredSession,
  createAutomatedTargetSnapshot,
  createPlannedAutomatedTestSession,
  createPlannedTestSession,
} from "../node.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const human = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "human-1",
  issuer: "local",
  subject: "human-1",
});
const exact = (id: string, digit: string) => ({ id, version: 1, contentHash: hash(digit) });
const external = (kind: string, id: string, digit: string) => ({
  kind,
  id,
  version: "1",
  contentHash: hash(digit),
});

describe("AUTOMATED Session domain", () => {
  it("adds an automated requirement without widening the MANUAL requirement representation", () => {
    const automated = createAutomatedRequiredSession({
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      requiredSessionPlanId: "plan-1",
      planVersion: 2,
      requirementId: "requirement-1",
      suiteBindingKey: "smoke",
      allowedTargetTypes: ["MERGE_REQUEST"],
      allowedEnvironmentRefs: ["environment:local"],
      createdAt: "2026-09-01T08:00:00.000Z",
    });

    expect(automated).toMatchObject({
      schemaVersion: 2,
      mode: "AUTOMATED",
      suiteSelectionPolicy: "CURRENT_PUBLISHED_AT_SESSION_CREATION",
    });
    expect(automated.capabilityRequirements).toHaveLength(3);
    expect(() => createPlannedTestSession({ mode: "AUTOMATED" } as never)).toThrow();
  });

  it("captures the complete immutable MR/environment/data/Suite/configuration target", () => {
    const pins = [
      ["SOURCE_CONTEXT", "source-context.read"],
      ["TEST_EXECUTION", "test-executor.trigger-status"],
      ["ARTIFACT_SOURCE", "artifact.ci-read"],
    ].map(([logicalRole, capabilityKey], index) => ({
      ordinal: index + 1,
      logicalRole: logicalRole as "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE",
      capabilityKey: capabilityKey as
        "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read",
      exactContractVersion: "1.0.0" as const,
      projectIntegrationBindingRef: exact("binding-1", "1"),
      profileRef: exact(`profile-${index + 1}`, "2"),
      connectionRef: exact("connection-1", "3"),
      validationReportRef: exact(`validation-${index + 1}`, "4"),
      operationSetHash: hash("5"),
      externalScopeHash: hash("6"),
    }));
    const target = createAutomatedTargetSnapshot({
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      testSessionId: "session-1",
      sourceIssueKey: "QA-42",
      target: {
        type: "MERGE_REQUEST",
        mergeRequestRef: "gitlab:mr:42",
        commitSha: "a".repeat(40),
        buildRef: "gitlab:pipeline:10",
      },
      environment: { environmentRef: "environment:local", revision: 3, class: "LOCAL" },
      suite: {
        suiteKey: "smoke",
        suiteBindingRef: { id: "suite-1", version: 2 },
        suiteBindingHash: hash("7"),
        parameterSchemaRef: exact("urn:test:parameters", "8"),
        acceptedParameters: { browser: "chromium" },
        browser: "chromium",
      },
      configurationPins: pins,
      executionPolicies: {
        resultSchemaRef: exact("urn:test:result", "a"),
        artifactPolicyRef: exact("artifact-policy", "b"),
        retryPolicyRef: exact("retry-policy", "c"),
        quarantinePolicyRef: exact("quarantine-policy", "d"),
      },
      testDataRefs: [external("test-data", "data-1", "e")],
      accountLeaseRefs: [],
      capturedAt: "2026-09-01T08:00:00.000Z",
    });

    expect(target.configurationPins.map(({ logicalRole }) => logicalRole)).toEqual([
      "SOURCE_CONTEXT",
      "TEST_EXECUTION",
      "ARTIFACT_SOURCE",
    ]);
    expect(target.configurationPinSetHash).toMatch(/^sha256:/u);
    expect(Object.isFrozen(target.suite.acceptedParameters)).toBe(true);
    expect(() => ((target.target as { commitSha: string }).commitSha = "b".repeat(40))).toThrow();
  });

  it("creates exactly one generated Suite-root Plan Item and a READY automated Session", () => {
    const targetHash = hash("a");
    const scopeHash = hash("b");
    const suite = exact("suite-version-1", "c");
    const item = createAutomatedPlanItem({
      id: "item-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      sessionId: "session-1",
      suiteBindingRef: suite,
      scopeSnapshotHash: scopeHash,
      targetSnapshotHash: targetHash,
      createdBy: human,
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const session = createPlannedAutomatedTestSession({
      id: "session-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      ordinal: 1,
      planRevisionRef: exact("plan-revision-1", "d"),
      requirementRef: { ...exact("requirement-1", "e"), requirementKey: "automated-smoke" },
      ownerId: "human-1",
      requiredCapabilities: [
        "source-context.read@1.0.0",
        "test-executor.trigger-status@1.0.0",
        "artifact.ci-read@1.0.0",
      ],
      suiteBindingRef: suite,
      configurationPinSetHash: hash("f"),
      parameterSetHash: hash("1"),
      targetSnapshotRef: "qa-target:session-1",
      targetSnapshotHash: targetHash,
      scopeSnapshotRef: "qa-scope:session-1",
      scopeSnapshotHash: scopeHash,
      planItems: [item],
      createdBy: human,
      createdAt: "2026-09-01T08:00:00.000Z",
    });

    expect(item).toMatchObject({
      schemaVersion: 2,
      mode: "AUTOMATED",
      ordinal: 1,
      generatedFrom: "SUITE_BINDING",
    });
    expect(session).toMatchObject({
      schemaVersion: 2,
      mode: "AUTOMATED",
      state: "READY",
      planItemId: "item-1",
    });
    expect(() =>
      createPlannedAutomatedTestSession({
        ...session,
        planItems: [item, { ...item, id: "item-2" }],
      }),
    ).toThrow("QA_AUTOMATED_SESSION_EXACTLY_ONE_PLAN_ITEM_REQUIRED");
  });
});

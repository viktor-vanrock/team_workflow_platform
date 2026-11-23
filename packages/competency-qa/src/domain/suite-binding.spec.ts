import { describe, expect, it } from "vitest";

import {
  createAutomationSuiteDraft,
  createAutomationSuiteHeader,
  publishAutomationSuiteVersion,
  qaAutomationSuiteValidationCheckOrder,
  recordAutomationSuiteValidation,
} from "./suite-binding.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const human = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "human-1",
  issuer: "local",
  subject: "human-1",
});
const service = Object.freeze({
  kind: "SERVICE" as const,
  principalId: "worker-1",
  serviceKey: "qa-worker",
});

function content(environment = "environment:local") {
  return {
    ownerPrincipalId: "human-1",
    suiteDefinitionRef: { id: "suite-definition", version: 1, contentHash: hash("a") },
    logicalExecutionContract: {
      pipelineKey: "smoke",
      sourceRefPolicyRef: "policy:refs:main",
      resultJobKey: "machine-result",
      contractHash: hash("b"),
    },
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"] as const,
    allowedEnvironmentRefs: [environment],
    parameterSchemaRef: { id: "urn:test:parameters", version: 1, contentHash: hash("c") },
    resultSchemaRef: { id: "urn:test:result", version: 1, contentHash: hash("d") },
    artifactPolicyRef: { id: "artifact-policy", version: 1, contentHash: hash("e") },
    retryPolicyRef: { id: "retry-policy", version: 1, contentHash: hash("f") },
    quarantinePolicyRef: { id: "quarantine-policy", version: 1, contentHash: hash("1") },
    capabilityRequirements: [
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const,
  };
}

function validReport(version: ReturnType<typeof createAutomationSuiteDraft>, suffix = "1") {
  return {
    id: `report-${suffix}`,
    workspaceId: version.workspaceId,
    projectId: version.projectId,
    suiteBindingRef: { id: version.id, version: version.version, contentHash: version.contentHash },
    status: "VALID" as const,
    coreBindingRef: { id: "binding-1", version: 3, contentHash: hash("2") },
    profilePinSetHash: hash("3"),
    discoverySnapshotRef: "gitlab-discovery:1",
    discoverySnapshotHash: hash("4"),
    suiteProbeRef: "gitlab-suite-probe:1",
    suiteProbeHash: hash("5"),
    checks: qaAutomationSuiteValidationCheckOrder.map((key) => ({ key, passed: true })),
    issues: [],
    validatedBy: service,
    authorizationBasisHash: hash("6"),
    createdAt: "2026-09-01T08:01:00.000Z",
  };
}

describe("Automation Suite Binding domain", () => {
  it("derives contiguous immutable versions and semantic content hashes", () => {
    const header = createAutomationSuiteHeader({
      id: "suite-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      suiteKey: "smoke",
      createdBy: human,
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const first = createAutomationSuiteDraft({
      header,
      previousVersions: [],
      content: content(),
      createdBy: human,
      createdAt: header.createdAt,
    });
    const second = createAutomationSuiteDraft({
      header,
      previousVersions: [first],
      content: content("environment:test"),
      createdBy: human,
      createdAt: "2026-09-01T08:02:00.000Z",
    });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(Object.isFrozen(first.content)).toBe(true);
    expect(() =>
      createAutomationSuiteDraft({
        header,
        previousVersions: [first],
        content: content(),
        createdBy: human,
        createdAt: "2026-09-01T08:03:00.000Z",
      }),
    ).toThrow("QA_AUTOMATION_SUITE_CONTENT_ALREADY_EXISTS");
  });

  it("retains INVALID reports on DRAFT and accepts only an exact VALID report", () => {
    const header = createAutomationSuiteHeader({
      id: "suite-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      suiteKey: "smoke",
      createdBy: human,
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const draft = createAutomationSuiteDraft({
      header,
      previousVersions: [],
      content: content(),
      createdBy: human,
      createdAt: header.createdAt,
    });
    const invalid = recordAutomationSuiteValidation(draft, {
      ...validReport(draft),
      id: "report-invalid",
      status: "INVALID",
      issues: [{ code: "CI_LINT_INVALID", path: "/lint" }],
    });
    const validated = recordAutomationSuiteValidation(invalid.version, validReport(draft));

    expect(invalid.version.state).toBe("DRAFT");
    expect(invalid.report.status).toBe("INVALID");
    expect(validated.version).toMatchObject({ state: "VALIDATED", validationReportId: "report-1" });
    expect(() =>
      recordAutomationSuiteValidation(draft, {
        ...validReport(draft),
        suiteBindingRef: { id: draft.id, version: draft.version, contentHash: hash("9") },
      }),
    ).toThrow("QA_AUTOMATION_SUITE_VALIDATION_SUBJECT_MISMATCH");
  });

  it("publishes only current exact evidence and retires the previous published version", () => {
    const header = createAutomationSuiteHeader({
      id: "suite-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      suiteKey: "smoke",
      createdBy: human,
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const firstDraft = createAutomationSuiteDraft({
      header,
      previousVersions: [],
      content: content(),
      createdBy: human,
      createdAt: header.createdAt,
    });
    const firstValidation = recordAutomationSuiteValidation(firstDraft, validReport(firstDraft));
    const firstPublication = publishAutomationSuiteVersion({
      header,
      versions: [firstValidation.version],
      reports: [firstValidation.report],
      versionId: firstDraft.id,
      expectedResourceVersion: 1,
      evidence: {
        coreBindingRef: firstValidation.report.coreBindingRef,
        profilePinSetHash: firstValidation.report.profilePinSetHash,
        discoverySnapshotHash: firstValidation.report.discoverySnapshotHash,
        suiteProbeHash: firstValidation.report.suiteProbeHash,
        discoveryCurrent: true,
        nonProduction: true,
        noDeploySurface: true,
      },
      publishedAt: "2026-09-01T08:02:00.000Z",
    });
    const secondDraft = createAutomationSuiteDraft({
      header: firstPublication.header,
      previousVersions: firstPublication.versions,
      content: content("environment:test"),
      createdBy: human,
      createdAt: "2026-09-01T08:03:00.000Z",
    });
    const secondValidation = recordAutomationSuiteValidation(
      secondDraft,
      validReport(secondDraft, "2"),
    );
    const secondPublication = publishAutomationSuiteVersion({
      header: firstPublication.header,
      versions: [...firstPublication.versions, secondValidation.version],
      reports: [firstValidation.report, secondValidation.report],
      versionId: secondDraft.id,
      expectedResourceVersion: 2,
      evidence: {
        coreBindingRef: secondValidation.report.coreBindingRef,
        profilePinSetHash: secondValidation.report.profilePinSetHash,
        discoverySnapshotHash: secondValidation.report.discoverySnapshotHash,
        suiteProbeHash: secondValidation.report.suiteProbeHash,
        discoveryCurrent: true,
        nonProduction: true,
        noDeploySurface: true,
      },
      publishedAt: "2026-09-01T08:04:00.000Z",
    });

    expect(secondPublication.header.currentPublishedVersion).toBe(2);
    expect(secondPublication.versions.map(({ state }) => state)).toEqual(["RETIRED", "PUBLISHED"]);
    expect(() =>
      publishAutomationSuiteVersion({
        ...secondPublication,
        reports: [firstValidation.report, secondValidation.report],
        versionId: secondDraft.id,
        expectedResourceVersion: 3,
        evidence: {
          coreBindingRef: secondValidation.report.coreBindingRef,
          profilePinSetHash: hash("9"),
          discoverySnapshotHash: secondValidation.report.discoverySnapshotHash,
          suiteProbeHash: secondValidation.report.suiteProbeHash,
          discoveryCurrent: true,
          nonProduction: true,
          noDeploySurface: true,
        },
        publishedAt: "2026-09-01T08:05:00.000Z",
      }),
    ).toThrow();
  });
});

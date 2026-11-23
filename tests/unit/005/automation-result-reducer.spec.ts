import { describe, expect, it } from "vitest";

import { createQaAutomationAttemptResult } from "../../../packages/competency-qa/src/domain/automation-attempt.ts";

const hash = (character: string) => `sha256:${character.repeat(64).slice(0, 64)}` as const;
const common = Object.freeze({
  automationAttemptResultId: "result-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  automationAttemptId: "attempt-1",
  resultSchemaRef: Object.freeze({
    id: "urn:awp:schemas:005:gitlab-pipeline-result:v1",
    version: 1,
    digest: hash("1"),
  }),
  suiteKey: "smoke",
  environmentRef: "environment:test:qa-1@17",
  artifactDescriptorSetHash: hash("2"),
  artifactSyncState: "COMPLETE" as const,
  terminalAt: "2026-09-01T08:05:00.000Z",
  recordedAt: "2026-09-01T08:05:01.000Z",
});

describe("QA automation technical result reducer", () => {
  it.each(["PASS", "ASSERTION_FAILED", "INFRA_FAILED", "TIMEOUT", "CANCELLED"] as const)(
    "creates a closed schema-validated %s result",
    (outcome) => {
      const result = createQaAutomationAttemptResult({
        ...common,
        normalizationKind: "SCHEMA_VALIDATED",
        outcome,
        sourceResultArtifactRef: "artifact-reference:machine-result",
        normalizationStatus: "VALID",
        normalizationIssueCodes: [],
        externalPipelineId: "201",
        externalJobIds: ["1001"],
        target: Object.freeze({
          type: "MERGE_REQUEST",
          mergeRequestRef: "5001:17",
          commitSha: "a".repeat(40),
        }),
        durationMs: 120_000,
        ...(outcome === "INFRA_FAILED" ? { infrastructureCode: "RUNNER_UNAVAILABLE" } : {}),
        ...(outcome === "CANCELLED" ? { cancellationReasonCode: "HUMAN_CANCELLED" } : {}),
      });
      expect(result).toMatchObject({
        schemaVersion: "automation-attempt-result@1.0.0",
        outcome,
        normalizationReport: { status: "VALID", issueCodes: [] },
      });
      expect(result.contentHash).toMatch(/^sha256:/u);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it.each([
    "TRIGGER_AMBIGUOUS",
    "PIPELINE_IDENTITY_MISSING",
    "RESULT_MISSING",
    "RESULT_TOO_LARGE",
    "RESULT_SCOPE_MISMATCH",
    "RESULT_TARGET_MISMATCH",
    "ARTIFACT_CHECKSUM_MISMATCH",
    "ARTIFACT_EXPIRED",
    "PROVIDER_STATUS_UNKNOWN",
  ] as const)("fails closed to synthetic INCOMPLETE for %s", (issue) => {
    const result = createQaAutomationAttemptResult({
      ...common,
      normalizationKind: "SYNTHETIC_INCOMPLETE",
      outcome: "INCOMPLETE",
      normalizationStatus: issue === "RESULT_MISSING" ? "MISSING" : "INVALID",
      normalizationIssueCodes: [issue],
      syntheticReasonCode: issue,
      artifactSyncState: issue === "ARTIFACT_EXPIRED" ? "EXPIRED" : "UNAVAILABLE",
    });
    expect(result).toMatchObject({
      outcome: "INCOMPLETE",
      normalizationKind: "SYNTHETIC_INCOMPLETE",
      syntheticReasonCode: issue,
    });
  });

  it.each(["RESULT_SCHEMA_UNKNOWN", "RESULT_SCHEMA_DRIFT"] as const)(
    "retains observed schema provenance for %s",
    (issue) => {
      const result = createQaAutomationAttemptResult({
        ...common,
        normalizationKind: "SYNTHETIC_INCOMPLETE",
        outcome: "INCOMPLETE",
        normalizationStatus: "INVALID",
        normalizationIssueCodes: [issue],
        syntheticReasonCode: issue,
        sourceResultArtifactRef: "artifact-reference:untrusted-machine-result",
        observedResultSchemaRef: Object.freeze({
          id: "urn:foreign:result",
          version: 2,
          digest: hash("3"),
        }),
        artifactSyncState: "UNAVAILABLE",
      });
      expect(result.observedResultSchemaRef).toEqual({
        id: "urn:foreign:result",
        version: 2,
        digest: hash("3"),
      });
    },
  );

  it("rejects schema drift as PASS, target mismatch as validated, and a checksum issue omitted from the report", () => {
    expect(() =>
      createQaAutomationAttemptResult({
        ...common,
        normalizationKind: "SYNTHETIC_INCOMPLETE",
        outcome: "PASS",
        normalizationStatus: "INVALID",
        normalizationIssueCodes: ["RESULT_SCHEMA_DRIFT"],
        syntheticReasonCode: "RESULT_SCHEMA_DRIFT",
        sourceResultArtifactRef: "artifact:1",
        observedResultSchemaRef: { id: "urn:foreign", version: 2, digest: hash("4") },
      }),
    ).toThrow("QA_AUTOMATION_SYNTHETIC_RESULT_INVALID");
    expect(() =>
      createQaAutomationAttemptResult({
        ...common,
        normalizationKind: "SCHEMA_VALIDATED",
        outcome: "PASS",
        normalizationStatus: "VALID",
        normalizationIssueCodes: [],
        sourceResultArtifactRef: "artifact:1",
        externalPipelineId: "201",
        externalJobIds: ["1001"],
        durationMs: 1,
        target: { type: "COMMIT", commitSha: "foreign" },
      }),
    ).toThrow("QA_AUTOMATION_SCHEMA_VALIDATED_RESULT_INVALID");
    expect(() =>
      createQaAutomationAttemptResult({
        ...common,
        normalizationKind: "SYNTHETIC_INCOMPLETE",
        outcome: "INCOMPLETE",
        normalizationStatus: "INVALID",
        normalizationIssueCodes: ["RESULT_MISSING"],
        syntheticReasonCode: "ARTIFACT_CHECKSUM_MISMATCH",
      }),
    ).toThrow("QA_AUTOMATION_SYNTHETIC_RESULT_INVALID");
  });
});

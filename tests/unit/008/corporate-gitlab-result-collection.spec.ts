import { describe, expect, it, vi } from "vitest";
import { collectCorporateGitLabResultArtifacts } from "../../../packages/runtime-composition/src/gitlab/corporate-result-collection.ts";

vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-result-artifacts.ts", () => ({
  corporateGitLabArtifactForQa: (input: { logicalPath: string }) => ({
    logicalPath: input.logicalPath,
  }),
}));

describe("corporate GitLab result artifact collection", () => {
  const fixture = () => ({
    snapshot: {
      workItemId: "work",
      testSessionId: "session",
      suite: { suiteKey: "suite" },
      executionPolicies: { artifactPolicyRef: { id: "policy", version: 1 } },
    },
    attemptId: "attempt",
    pipeline: {
      observation: { externalPipelineId: "10", resultDescriptorRef: "descriptor" },
      resultJobExpiry: vi.fn(async () => "2026-12-31T00:00:00.000Z"),
    },
    artifacts: {
      profile: {
        suiteMappings: [{ suiteKey: "suite", resultArtifactPath: "awp/result.json" }],
        artifactPolicy: { allowedClassifications: ["INTERNAL", "CONFIDENTIAL"] },
      },
      resultByteSize: vi.fn(async () => 42),
      descriptor: vi.fn(async () => ({})),
    },
    normalized: {
      normalizationKind: "SCHEMA_VALIDATED",
      sourceResultArtifactRef: "descriptor",
      resultContentHash: `sha256:${"a".repeat(64)}`,
      result: {
        jobId: 20,
        finishedAt: "2026-01-01T00:00:00.000Z",
        artifacts: [
          {
            path: "awp/report.xml",
            mediaType: "application/xml",
            byteSize: 12,
            checksum: `sha256:${"b".repeat(64)}`,
            classification: "INTERNAL",
            expiresAt: "2026-12-01T00:00:00.000Z",
          },
        ],
      },
    },
    registeredAt: "2026-01-01T01:00:00.000Z",
    minimumClassificationRank: 10,
    artifactPolicy: {
      minimumRetentionSeconds: 3600,
      maximumRetentionSeconds: 31536000,
      allowedClassifications: ["INTERNAL", "CONFIDENTIAL"],
      allowedTypes: ["application/json", "application/xml"],
      maxBytes: 1024,
    },
  });
  it("registers the checked result and its manifest with conservative classification", async () => {
    const input = fixture();
    const result = await collectCorporateGitLabResultArtifacts(input as never);
    expect(result.descriptors).toHaveLength(2);
    expect(input.artifacts.descriptor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        artifactKind: "RESULT",
        classification: "CONFIDENTIAL",
        byteSize: 42,
      }),
    );
    expect(input.artifacts.descriptor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ artifactPath: "awp/report.xml", classification: "INTERNAL" }),
    );
  });
  it("rejects an expiry beyond the provider's retention", async () => {
    const input = fixture();
    input.normalized.result.artifacts[0]!.expiresAt = "2027-01-01T00:00:00.000Z";
    await expect(collectCorporateGitLabResultArtifacts(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_ARTIFACT_EXPIRY_UNVERIFIED",
    );
    expect(input.artifacts.descriptor).not.toHaveBeenCalled();
  });
  it("rejects a provider expiry shorter than the published minimum", async () => {
    const input = fixture();
    input.pipeline.resultJobExpiry.mockResolvedValueOnce("2026-01-01T00:10:00.000Z");
    await expect(collectCorporateGitLabResultArtifacts(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_ARTIFACT_EXPIRY_UNVERIFIED",
    );
    expect(input.artifacts.descriptor).not.toHaveBeenCalled();
  });
  it("rejects artifact classification below the project", async () => {
    const input = fixture();
    input.minimumClassificationRank = 1000;
    await expect(collectCorporateGitLabResultArtifacts(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_ARTIFACT_CLASSIFICATION_REQUIRED",
    );
    expect(input.artifacts.descriptor).not.toHaveBeenCalled();
  });

  it("rejects files outside the published type and size policy", async () => {
    const input = fixture();
    input.artifactPolicy.allowedTypes = ["application/json"];
    await expect(collectCorporateGitLabResultArtifacts(input as never)).rejects.toThrow(
      "CORPORATE_GITLAB_ARTIFACT_POLICY_MISMATCH",
    );
    expect(input.artifacts.descriptor).not.toHaveBeenCalled();
  });
  it("does not register descriptors after source authorization is revoked", async () => {
    const input = fixture();
    input.artifacts.resultByteSize.mockRejectedValueOnce(new Error("ACCESS_REVOKED"));
    await expect(collectCorporateGitLabResultArtifacts(input as never)).rejects.toThrow(
      "ACCESS_REVOKED",
    );
    expect(input.artifacts.descriptor).not.toHaveBeenCalled();
  });
});

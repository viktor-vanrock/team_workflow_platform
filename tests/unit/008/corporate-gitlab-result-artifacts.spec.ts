import { describe, expect, it } from "vitest";

import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { corporateGitLabArtifactForQa } from "../../../packages/runtime-composition/src/gitlab/corporate-result-artifacts.ts";

describe("corporate GitLab result artifacts", () => {
  const fixture = () => {
    const profile = { id: "profile", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
    const snapshotBody = {
      workItemId: "work",
      testSessionId: "session",
      target: { type: "COMMIT", commitSha: "a".repeat(40) },
      configurationPins: [{ logicalRole: "ARTIFACT_SOURCE", profileRef: profile }],
      executionPolicies: {
        artifactPolicyRef: { id: "retention", version: 1, contentHash: `sha256:${"b".repeat(64)}` },
      },
    };
    const body = {
      schemaVersion: "artifact.ci-read@1.0.0",
      messageType: "RESULT",
      operation: "artifact.metadata",
      descriptorId: "10000000-0000-4000-8000-000000000001",
      workItemId: "work",
      testSessionId: "session",
      automationAttemptId: "attempt",
      externalPipelineId: "100",
      externalJobId: "200",
      artifactKind: "RESULT",
      opaqueLocatorHash: `sha256:${"c".repeat(64)}`,
      fileName: "result.json",
      mediaType: "application/json",
      byteSize: 20,
      checksum: `sha256:${"d".repeat(64)}`,
      checksumSource: "CONNECTOR_CONTENT_SHA256",
      classification: "INTERNAL",
      availability: "AVAILABLE",
      sourceProfileRef: { id: "profile", version: 1 },
      sourceProfileHash: profile.contentHash,
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-02-01T00:00:00Z",
      provenanceHash: `sha256:${"e".repeat(64)}`,
    };
    const observationBody = {
      externalPipelineId: "100",
      externalJobIds: ["200"],
      terminal: true,
      sourceCommitSha: snapshotBody.target.commitSha,
    };
    return {
      snapshot: { ...snapshotBody, snapshotHash: sha256(snapshotBody) },
      observation: { ...observationBody, observationHash: sha256(observationBody) },
      attemptId: "attempt",
      descriptor: { ...body, descriptorHash: sha256(body) },
      logicalPath: "results/result.json",
      expectedChecksum: body.checksum,
      retentionPolicyRef: "retention@1",
      registeredAt: "2026-01-01T00:00:00Z",
    };
  };
  it("preserves verified descriptor metadata and the pinned profile", () => {
    expect(corporateGitLabArtifactForQa(fixture() as never)).toMatchObject({
      artifactReferenceId: "10000000-0000-4000-8000-000000000001",
      externalPipelineId: "100",
      logicalPath: "results/result.json",
      classificationKey: "INTERNAL",
    });
  });
  it("rejects a changed descriptor, profile or checksum", () => {
    const input = fixture();
    expect(() =>
      corporateGitLabArtifactForQa({
        ...input,
        descriptor: { ...input.descriptor, byteSize: 21 },
      } as never),
    ).toThrow("CORPORATE_GITLAB_ARTIFACT_INVALID");
    expect(() =>
      corporateGitLabArtifactForQa({
        ...input,
        expectedChecksum: `sha256:${"f".repeat(64)}`,
      } as never),
    ).toThrow("CORPORATE_GITLAB_ARTIFACT_INVALID");
    expect(() =>
      corporateGitLabArtifactForQa({ ...input, retentionPolicyRef: "other" } as never),
    ).toThrow("CORPORATE_GITLAB_ARTIFACT_INVALID");
  });
});

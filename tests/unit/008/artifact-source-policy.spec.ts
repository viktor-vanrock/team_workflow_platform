import { describe, expect, it } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  type ArtifactSourceObservation,
  type ArtifactSourcePolicy,
  assessArtifactSources,
  assessAuthorizedArtifactSources,
} from "../../../packages/runtime-composition/src/pilot/artifact-source-policy.ts";

const at = new Date("2026-09-04T00:00:00Z");
const ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` as const });
const policy: ArtifactSourcePolicy = {
  ref: ref("artifact-policy"),
  workspaceId: "workspace",
  projectId: "project",
  mode: "GITLAB_ONLY",
  allowManualGitLabReferences: false,
  minimumRetentionMs: 86_400_000,
  maximumObservationAgeMs: 60_000,
  retentionPolicyRef: ref("retention"),
  gitlab: [{ numericProjectId: 42, profileRef: ref("profile"), connectionRef: ref("connection") }],
};
function observation(): ArtifactSourceObservation {
  const descriptorBody = {
    schemaVersion: "artifact.ci-read@1.0.0" as const,
    messageType: "RESULT" as const,
    operation: "artifact.metadata" as const,
    descriptorId: "descriptor",
    workItemId: "work",
    testSessionId: "session",
    automationAttemptId: "attempt",
    externalPipelineId: "1",
    externalJobId: "2",
    artifactKind: "REPORT" as const,
    opaqueLocatorHash: ref("locator").contentHash,
    fileName: "report",
    mediaType: "application/json",
    byteSize: 12,
    checksum: ref("checksum").contentHash,
    checksumSource: "CONNECTOR_CONTENT_SHA256" as const,
    classification: "INTERNAL",
    availability: "AVAILABLE" as const,
    sourceProfileRef: { id: "profile", version: 1 },
    sourceProfileHash: ref("profile").contentHash,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 2 * 86_400_000).toISOString(),
    provenanceHash: ref("provenance").contentHash,
  };
  return {
    workspaceId: "workspace",
    projectId: "project",
    artifactId: "artifact",
    checksum: ref("checksum").contentHash,
    sizeBytes: 12,
    availability: "AVAILABLE",
    observedAt: at.toISOString(),
    retainedUntil: descriptorBody.expiresAt,
    retentionPolicyRef: ref("retention"),
    source: {
      kind: "GITLAB_CI",
      numericProjectId: 42,
      connectionRef: ref("connection"),
      descriptor: {
        ...descriptorBody,
        descriptorHash: sha256(descriptorBody as unknown as JsonValue),
      },
    },
  };
}
const requirement = {
  id: "required",
  capture: "CI" as const,
  required: true,
  artifactId: "artifact",
};
describe("008 evidence source sufficiency", () => {
  it("accepts an exact current scoped CI descriptor with sufficient retention", () => {
    expect(assessArtifactSources(policy, [requirement], [observation()], at)).toMatchObject({
      allowed: true,
      reasonCodes: [],
    });
  });
  it("blocks required manual attachments without an approved source in GitLab-only mode", () => {
    expect(
      assessArtifactSources(policy, [{ ...requirement, capture: "MANUAL" }], [], at).allowed,
    ).toBe(false);
    expect(
      assessArtifactSources(policy, [{ ...requirement, capture: "MANUAL" }], [observation()], at)
        .reasonCodes,
    ).toContain("MANUAL_ARTIFACT_SOURCE_UNSUPPORTED");
    expect(
      assessArtifactSources(
        { ...policy, allowManualGitLabReferences: true },
        [{ ...requirement, capture: "MANUAL" }],
        [observation()],
        at,
      ).allowed,
    ).toBe(true);
  });
  it("denies unavailable, expired, stale and cross-scope observations", () => {
    for (const patch of [
      { availability: "EXPIRED" as const },
      { retainedUntil: at.toISOString() },
      { observedAt: "2026-09-03T00:00:00Z" },
      { workspaceId: "other" },
      { projectId: "other" },
    ])
      expect(
        assessArtifactSources(policy, [requirement], [{ ...observation(), ...patch }], at).allowed,
      ).toBe(false);
  });
  it("denies descriptor tampering, source drift and retained-policy drift", () => {
    const value = observation();
    if (value.source.kind !== "GITLAB_CI") throw new Error();
    for (const source of [
      { ...value.source, numericProjectId: 43 },
      { ...value.source, connectionRef: ref("other") },
      {
        ...value.source,
        descriptor: { ...value.source.descriptor, checksum: `sha256:${"b".repeat(64)}` as const },
      },
    ])
      expect(assessArtifactSources(policy, [requirement], [{ ...value, source }], at).allowed).toBe(
        false,
      );
    expect(
      assessArtifactSources(
        policy,
        [requirement],
        [{ ...value, retentionPolicyRef: ref("other") }],
        at,
      ).allowed,
    ).toBe(false);
  });
  it("never treats missing required facts or conflicting observations as sufficient", () => {
    expect(assessArtifactSources(policy, [requirement], [], at).allowed).toBe(false);
    expect(
      assessArtifactSources(policy, [requirement], [observation(), observation()], at).allowed,
    ).toBe(false);
    expect(
      assessArtifactSources(policy, [{ ...requirement, required: false }], [], at).allowed,
    ).toBe(true);
  });
  it("authorizes before query and rechecks revocation before aggregating", async () => {
    let queries = 0;
    let allowed = false;
    const port = {
      authorize: async () => allowed,
      load: async (scope: { workspaceId: string; projectId: string }) => {
        expect(scope).toEqual({ workspaceId: "workspace", projectId: "project" });
        queries++;
        allowed = false;
        return [observation()];
      },
    };
    await expect(assessAuthorizedArtifactSources(policy, [requirement], port, at)).rejects.toThrow(
      "PROJECT_RESOURCE_NOT_AVAILABLE",
    );
    expect(queries).toBe(0);
    allowed = true;
    await expect(assessAuthorizedArtifactSources(policy, [requirement], port, at)).rejects.toThrow(
      "PROJECT_RESOURCE_NOT_AVAILABLE",
    );
    expect(queries).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  normalizeCorporateGitLabResult,
  corporateGitLabResultForQa,
  corporateGitLabMissingResultForQa,
} from "../../../packages/runtime-composition/src/gitlab/corporate-result-normalization.ts";

describe("corporate GitLab result selection", () => {
  const fixture = () => {
    const snapshotBody = {
      workspaceId: "workspace",
      projectId: "project",
      target: { type: "COMMIT", commitSha: "a".repeat(40) },
      suite: { suiteKey: "suite" },
      environment: { environmentRef: "test" },
    };
    const snapshot = { ...snapshotBody, snapshotHash: sha256(snapshotBody) };
    const observationBody = {
      externalPipelineId: "100",
      externalJobIds: ["200"],
      sourceCommitSha: snapshot.target.commitSha,
      terminal: true,
      providerState: "SUCCESS",
      providerRevisionToken: "revision",
      providerUpdatedAt: "2026-01-01T00:00:00.000Z",
      resultDescriptorRef: `gitlab-result:500:100:200:${sha256("result.json")}`,
    };
    const observation = { ...observationBody, observationHash: sha256(observationBody) };
    const normalizer = {
      downloadAndNormalize: vi.fn(async () => ({ normalizationKind: "SCHEMA_VALIDATED" })),
    };
    return {
      context: {
        scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
        actor: { kind: "SERVICE" },
        signal: new AbortController().signal,
      },
      profile: {
        numericGitLabProjectId: 500,
        suiteMappings: [
          {
            suiteKey: "suite",
            allowedEnvironmentRefs: ["test"],
            resultArtifactPath: "result.json",
          },
        ],
      },
      snapshot,
      observation,
      storedObservation: {
        external_pipeline_id: "100",
        external_job_ids: ["200"],
        source_commit_sha: snapshot.target.commitSha,
        provider_status: "SUCCESS",
        provider_revision_token: "revision",
        provider_updated_at: "2026-01-01T00:00:00.000Z",
        observation_hash: "stored-hash",
      },
      expectedStoredObservationHash: "stored-hash",
      attemptId: "attempt",
      requestMarkerHash: `sha256:${"b".repeat(64)}`,
      buildRef: "build",
      revalidate: vi.fn(async () => undefined),
      normalizer,
    };
  };
  it("uses only the job and artifact selected by the current terminal observation", async () => {
    const input = fixture();
    await normalizeCorporateGitLabResult(input as never);
    expect(input.normalizer.downloadAndNormalize).toHaveBeenCalledWith(
      input.context,
      expect.objectContaining({
        automationAttemptId: "attempt",
        externalPipelineId: "100",
        externalJobId: "200",
        sourceResultArtifactRef: input.observation.resultDescriptorRef,
      }),
    );
    expect(input.revalidate).toHaveBeenCalledTimes(2);
  });
  it("rejects the downloaded result if authority is revoked during the read", async () => {
    const input = fixture();
    input.revalidate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ACCESS_REVOKED"));
    await expect(normalizeCorporateGitLabResult(input as never)).rejects.toThrow("ACCESS_REVOKED");
    expect(input.normalizer.downloadAndNormalize).toHaveBeenCalledOnce();
  });
  it("rejects a modified observation before downloading", async () => {
    const input = fixture();
    await expect(
      normalizeCorporateGitLabResult({
        ...input,
        observation: { ...input.observation, externalJobIds: ["201"] },
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_OBSERVATION_CHANGED");
    expect(input.normalizer.downloadAndNormalize).not.toHaveBeenCalled();
  });
  it("preserves a missing result as INCOMPLETE and does not invent a success", () => {
    const input = fixture();
    const normalized = {
      normalizationKind: "SYNTHETIC_INCOMPLETE",
      normalizationStatus: "MISSING",
      issueCodes: ["RESULT_MISSING"],
      syntheticReasonCode: "RESULT_MISSING",
      outcome: "INCOMPLETE",
      sourceResultArtifactRef: input.observation.resultDescriptorRef,
      expectedSchemaRef: { id: "schema", version: 1, digest: `sha256:${"c".repeat(64)}` },
    };
    const observation = { ...input.observation, providerUpdatedAt: "2026-01-01T00:00:00Z" };
    expect(
      corporateGitLabResultForQa({ snapshot: input.snapshot, observation, normalized } as never),
    ).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "RESULT_MISSING",
      externalPipelineId: "100",
      terminalAt: "2026-01-01T00:00:00Z",
    });
  });
  it("rejects a validated result belonging to a different pipeline", () => {
    const input = fixture();
    const normalized = {
      normalizationKind: "SCHEMA_VALIDATED",
      normalizationStatus: "VALID",
      issueCodes: [],
      outcome: "PASS",
      sourceResultArtifactRef: input.observation.resultDescriptorRef,
      expectedSchemaRef: { id: "schema", version: 1, digest: `sha256:${"c".repeat(64)}` },
      result: {
        pipelineId: 999,
        jobId: 200,
        commitSha: input.snapshot.target.commitSha,
        suiteKey: "suite",
        environmentRef: "test",
        outcome: "PASS",
        finishedAt: "2026-01-01T00:00:00Z",
        durationMs: 1,
      },
    };
    expect(() =>
      corporateGitLabResultForQa({
        snapshot: input.snapshot,
        observation: input.observation,
        normalized,
      } as never),
    ).toThrow("CORPORATE_GITLAB_RESULT_SCOPE_INVALID");
  });
  it("records a terminal pipeline without a result job as incomplete", () => {
    const input = fixture();
    const schema = { id: "schema", version: 1, digest: `sha256:${"c".repeat(64)}` as const };
    const { snapshotHash: _snapshotHash, ...baseSnapshot } = input.snapshot;
    void _snapshotHash;
    const snapshotBody = {
      ...baseSnapshot,
      executionPolicies: {
        resultSchemaRef: { id: schema.id, version: schema.version, contentHash: schema.digest },
      },
    };
    const snapshot = { ...snapshotBody, snapshotHash: sha256(snapshotBody) };
    const observationBody = {
      externalPipelineId: "100",
      externalJobIds: [],
      sourceCommitSha: snapshot.target.commitSha,
      terminal: true,
      providerState: "SUCCESS",
      providerRevisionToken: "revision",
      providerUpdatedAt: "2026-01-01T00:00:00.000Z",
    };
    const observation = { ...observationBody, observationHash: sha256(observationBody) };
    expect(
      corporateGitLabMissingResultForQa({
        snapshot,
        observation,
        expectedStoredObservationHash: "stored-hash",
        resultSchemaRef: schema,
        storedObservation: {
          external_pipeline_id: "100",
          external_job_ids: [],
          source_commit_sha: snapshot.target.commitSha,
          provider_status: "SUCCESS",
          provider_revision_token: "revision",
          provider_updated_at: "2026-01-01T00:00:00Z",
          observation_hash: "stored-hash",
        },
      } as never),
    ).toMatchObject({ outcome: "INCOMPLETE", syntheticReasonCode: "RESULT_MISSING" });
  });
});

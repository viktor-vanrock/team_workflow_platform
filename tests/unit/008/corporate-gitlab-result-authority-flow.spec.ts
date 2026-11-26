import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  loadTerminal: vi.fn(),
  provider: vi.fn(),
  retry: vi.fn(),
  policy: vi.fn(),
  missing: vi.fn(),
  getProject: vi.fn(),
  artifactProvider: vi.fn(),
  normalize: vi.fn(),
  convert: vi.fn(),
  collect: vi.fn(),
}));
vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-result-state.ts", () => ({
  createCorporateGitLabResultState: () => ({ load: mocks.loadState }),
}));
vi.mock(
  "../../../packages/runtime-composition/src/gitlab/corporate-terminal-observation.ts",
  () => ({ createCorporateGitLabTerminalObservation: () => ({ load: mocks.loadTerminal }) }),
);
vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-result-provider.ts", () => ({
  createCorporateGitLabResultProvider: mocks.provider,
}));
vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-retry-authority.ts", () => ({
  createCorporateGitLabRetryAuthority: () => ({ resolve: mocks.retry }),
}));
vi.mock(
  "../../../packages/runtime-composition/src/gitlab/corporate-retry-policy-authority.ts",
  () => ({
    createCorporateGitLabRetryPolicyAuthority: () => ({ resolve: mocks.policy }),
  }),
);
vi.mock(
  "../../../packages/runtime-composition/src/gitlab/corporate-result-normalization.ts",
  () => ({
    corporateGitLabMissingResultForQa: mocks.missing,
    corporateGitLabResultForQa: mocks.convert,
    normalizeCorporateGitLabResult: mocks.normalize,
  }),
);
vi.mock(
  "../../../packages/runtime-composition/src/gitlab/corporate-result-artifact-provider.ts",
  () => ({ createCorporateGitLabResultArtifactProvider: mocks.artifactProvider }),
);
vi.mock("../../../packages/runtime-composition/src/gitlab/corporate-result-collection.ts", () => ({
  collectCorporateGitLabResultArtifacts: mocks.collect,
}));
vi.mock("@awp/platform-persistence-typeorm", async (original) => ({
  ...(await original<typeof import("@awp/platform-persistence-typeorm")>()),
  TypeOrmScopedAccessRepository: class {
    getProject = mocks.getProject;
  },
}));
import { createCorporateGitLabResultAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-result-authority.ts";

const candidate = {
  workspaceId: "w",
  projectId: "p",
  attemptId: "a",
  commandId: "c",
  observationId: "o",
  observationHash: `sha256:${"a".repeat(64)}`,
};
const attempt = {
  workspaceId: "w",
  projectId: "p",
  automationAttemptId: "a",
  connectorCommandId: "c",
  correlationId: "correlation",
  causationId: "cause",
  resultSchemaRef: { id: "schema", version: 1, digest: `sha256:${"b".repeat(64)}` },
};
const snapshot = { workspaceId: "w", projectId: "p" };
const decision = {
  executingService: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
  decidedAt: "2026-01-01T00:00:00.000Z",
  policy: {},
  authority: {},
  causalAuthorizationBasis: {},
};
const saved = { observation: { observed_at: "2026-01-01T00:00:00.000Z", source_kind: "POLL" } };
const observation = {
  externalPipelineId: "100",
  externalJobIds: [],
  providerState: "SUCCESS",
  providerRevisionToken: "revision",
  providerUpdatedAt: "2026-01-01T00:00:00.000Z",
};
const authority = (allowValidatedIncomplete = false) =>
  createCorporateGitLabResultAuthority({
    source: {},
    environment: {},
    grants: [],
    factories: {},
    connectorAuthority: {},
    guard: {},
    allowValidatedIncomplete,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadState.mockResolvedValue({
    attempt,
    previousStatus: {},
    targetSnapshot: snapshot,
    previousLineageResults: [],
    lineage: [attempt],
    session: { state: "RUNNING", resourceVersion: 1 },
  });
  mocks.loadTerminal.mockResolvedValue(saved);
  mocks.provider.mockResolvedValue({ observation });
  mocks.retry.mockResolvedValue(decision);
  mocks.policy.mockResolvedValue({
    metadataHash: "metadata",
    numericProjectId: 5001,
    server: { edition: "EE", exactVersion: "17.0.0", exactBuild: "build" },
  });
  mocks.missing.mockReturnValue({
    outcome: "INCOMPLETE",
    normalizationKind: "SYNTHETIC_INCOMPLETE",
  });
  mocks.getProject.mockResolvedValue({ state: "ACTIVE", classification: { rank: 10 } });
});

describe("corporate GitLab result authority flow", () => {
  it("builds incomplete result from the verified terminal head and server service identity", async () => {
    const result = await authority().prepare(candidate, new AbortController().signal);
    expect(result.facts).toMatchObject({
      context: { actor: decision.executingService },
      attempt,
      observation: { source: "POLL_READ", observationHash: candidate.observationHash },
      normalization: { outcome: "INCOMPLETE" },
    });
    expect(mocks.retry).toHaveBeenCalledWith(attempt, snapshot, undefined, expect.any(AbortSignal));
    expect(result.facts.artifactDescriptors).toEqual([]);
  });
  it("fails closed when the scoped terminal observation was revoked", async () => {
    mocks.loadTerminal.mockRejectedValueOnce(new Error("ACCESS_REVOKED"));
    await expect(authority().prepare(candidate, new AbortController().signal)).rejects.toThrow(
      "ACCESS_REVOKED",
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("passes pinned C1 server facts to the provider and rejects a changed publication", async () => {
    await authority().prepare(candidate, new AbortController().signal);
    const argumentsForProvider = mocks.provider.mock.calls[0]![0] as {
      server: { exactVersion: string };
      numericProjectId: number;
      revalidateConfiguration(): Promise<void>;
    };
    expect(argumentsForProvider.server.exactVersion).toBe("17.0.0");
    expect(argumentsForProvider.numericProjectId).toBe(5001);
    mocks.policy.mockResolvedValueOnce({ metadataHash: "changed" });
    await expect(argumentsForProvider.revalidateConfiguration()).rejects.toThrow(
      "CORPORATE_GITLAB_RESULT_CONFIGURATION_STALE",
    );
  });
  it("defers commit if the result file changes after preparation", async () => {
    const fullSnapshot = { ...snapshot, target: { buildRef: "pipeline:101" } };
    mocks.loadState.mockResolvedValueOnce({ attempt, targetSnapshot: fullSnapshot });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
    });
    mocks.artifactProvider.mockResolvedValueOnce({
      context: {},
      profile: {},
      revalidate: vi.fn(),
      normalizer: {},
    });
    mocks.normalize.mockResolvedValueOnce({ normalizationKind: "SCHEMA_VALIDATED" });
    mocks.convert.mockReturnValueOnce({
      normalizationKind: "SCHEMA_VALIDATED",
      outcome: "ASSERTION_FAILED",
    });
    await expect(
      authority().revalidate(candidate, new AbortController().signal, {
        facts: {
          normalization: { sourceResultArtifactRef: "descriptor", outcome: "PASS" },
          artifactDescriptors: [],
        },
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
  });
  it("defers a missing-result decision if a result file appears before commit", async () => {
    mocks.loadState.mockResolvedValueOnce({ attempt, targetSnapshot: snapshot });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
    });
    await expect(
      authority().revalidate(candidate, new AbortController().signal, {
        facts: { normalization: { outcome: "INCOMPLETE" }, artifactDescriptors: [] },
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("defers commit if artifact metadata changes after preparation", async () => {
    const fullSnapshot = { ...snapshot, target: { buildRef: "pipeline:101" } };
    const normalization = {
      sourceResultArtifactRef: "descriptor",
      normalizationKind: "SCHEMA_VALIDATED",
      outcome: "PASS",
    };
    mocks.loadState.mockResolvedValueOnce({ attempt, targetSnapshot: fullSnapshot });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
    });
    mocks.artifactProvider.mockResolvedValueOnce({
      context: {},
      profile: {},
      revalidate: vi.fn(),
      normalizer: {},
    });
    mocks.normalize.mockResolvedValueOnce({ normalizationKind: "SCHEMA_VALIDATED" });
    mocks.convert.mockReturnValueOnce(normalization);
    mocks.collect.mockResolvedValueOnce({
      descriptors: [{ registeredAt: "2026-01-01T00:00:00.000Z", availability: "MISSING" }],
      manifest: [],
    });
    await expect(
      authority().revalidate(candidate, new AbortController().signal, {
        facts: {
          normalization,
          artifactDescriptors: [
            {
              registeredAt: "2026-01-01T00:00:00.000Z",
              classificationKey: "INTERNAL",
              availability: "AVAILABLE",
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
          ],
          machineArtifactManifest: [],
        },
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_FACTS_CHANGED");
  });
  it("defers recovery if retry authority changes after preparation", async () => {
    mocks.loadState.mockResolvedValueOnce({
      attempt,
      targetSnapshot: snapshot,
      terminalResult: { automationAttemptResultId: "result" },
    });
    mocks.retry.mockResolvedValueOnce({ ...decision, authority: { quarantineActive: true } });
    await expect(
      authority().revalidate(
        { workspaceId: "w", projectId: "p", attemptId: "a", resultId: "result" },
        new AbortController().signal,
        {
          attempt,
          result: { automationAttemptResultId: "result" },
          targetSnapshot: snapshot,
          retry: { ...decision, authority: { quarantineActive: false } },
        } as never,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_RETRY_AUTHORITY_CHANGED");
  });
  it("does not recover a different stored result", async () => {
    mocks.loadState.mockResolvedValueOnce({
      attempt,
      targetSnapshot: snapshot,
      terminalResult: { automationAttemptResultId: "other" },
      lineage: [attempt],
    });
    await expect(
      authority().prepareRecovery(
        { workspaceId: "w", projectId: "p", attemptId: "a", resultId: "expected" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_ATTEMPT_STALE");
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("uses the verified artifact provider and binds infrastructure retry to the result", async () => {
    const fullSnapshot = { ...snapshot, target: { buildRef: "pipeline:101" } };
    mocks.loadState.mockResolvedValueOnce({
      attempt,
      previousStatus: {},
      targetSnapshot: fullSnapshot,
      previousLineageResults: [],
      lineage: [attempt],
      session: { state: "RUNNING", resourceVersion: 1 },
    });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
      profile: { numericGitLabProjectId: 5001 },
    });
    const artifact = { context: {}, profile: {}, revalidate: vi.fn(), normalizer: {} };
    mocks.artifactProvider.mockResolvedValueOnce(artifact);
    const normalized = { normalizationKind: "SCHEMA_VALIDATED" };
    mocks.normalize.mockResolvedValueOnce(normalized);
    mocks.convert.mockReturnValueOnce({
      outcome: "INFRA_FAILED",
      infrastructureCode: "RUNNER_UNAVAILABLE",
    });
    mocks.collect.mockResolvedValueOnce({
      descriptors: [{ logicalPath: "result.json" }],
      manifest: [],
    });
    const result = await authority().prepare(candidate, new AbortController().signal);
    expect(mocks.retry).toHaveBeenCalledWith(
      attempt,
      fullSnapshot,
      "RUNNER_UNAVAILABLE",
      expect.any(AbortSignal),
    );
    expect(mocks.collect).toHaveBeenCalledWith(
      expect.objectContaining({ normalized, artifacts: artifact }),
    );
    expect(result.facts.artifactDescriptors).toHaveLength(1);
  });
  it("preserves a valid INCOMPLETE outcome without inventing a synthetic failure reason", async () => {
    mocks.loadState.mockResolvedValueOnce({
      attempt,
      previousStatus: {},
      targetSnapshot: { ...snapshot, target: { buildRef: "pipeline:101" } },
      previousLineageResults: [],
      lineage: [attempt],
      session: { state: "RUNNING", resourceVersion: 1 },
    });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
      profile: { numericGitLabProjectId: 5001 },
    });
    mocks.artifactProvider.mockResolvedValueOnce({
      context: {},
      profile: {},
      revalidate: vi.fn(),
      normalizer: {},
    });
    mocks.normalize.mockResolvedValueOnce({ normalizationKind: "SCHEMA_VALIDATED" });
    mocks.convert.mockReturnValueOnce({
      normalizationKind: "SCHEMA_VALIDATED",
      outcome: "INCOMPLETE",
    });
    mocks.collect.mockResolvedValueOnce({ descriptors: [], manifest: [] });
    const prepared = await authority(true).prepare(candidate, new AbortController().signal);
    expect(prepared.facts.normalization).toMatchObject({
      normalizationKind: "SCHEMA_VALIDATED",
      outcome: "INCOMPLETE",
    });
    expect(mocks.retry).toHaveBeenCalledWith(
      attempt,
      expect.anything(),
      undefined,
      expect.any(AbortSignal),
    );
  });
  it("keeps the new outcome pending until explicitly enabled", async () => {
    mocks.loadState.mockResolvedValueOnce({
      attempt,
      previousStatus: {},
      targetSnapshot: { ...snapshot, target: { buildRef: "pipeline:101" } },
      previousLineageResults: [],
      lineage: [attempt],
      session: { state: "RUNNING", resourceVersion: 1 },
    });
    mocks.provider.mockResolvedValueOnce({
      observation: { ...observation, resultDescriptorRef: "descriptor" },
      profile: { numericGitLabProjectId: 5001 },
    });
    mocks.artifactProvider.mockResolvedValueOnce({
      context: {},
      profile: {},
      revalidate: vi.fn(),
      normalizer: {},
    });
    mocks.normalize.mockResolvedValueOnce({ normalizationKind: "SCHEMA_VALIDATED" });
    mocks.convert.mockReturnValueOnce({
      normalizationKind: "SCHEMA_VALIDATED",
      outcome: "INCOMPLETE",
    });
    await expect(authority().prepare(candidate, new AbortController().signal)).rejects.toThrow(
      "CORPORATE_GITLAB_VALID_INCOMPLETE_NOT_ENABLED",
    );
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});

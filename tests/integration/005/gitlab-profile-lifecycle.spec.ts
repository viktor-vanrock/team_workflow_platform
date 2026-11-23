import { describe, expect, it } from "vitest";

import {
  createGitLabDialect,
  discoverGitLab,
  type GitLabProfileConfiguration,
  type GitLabSuiteProbe,
  validateGitLabConnectionConfiguration,
  validateGitLabProfile,
} from "../../../packages/connector-gitlab/src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const schemaRef = Object.freeze({
  id: "urn:awp:schemas:005:gitlab-pipeline-result:v1",
  version: 1,
  digest: digest("a"),
});

function profile(): GitLabProfileConfiguration {
  return {
    schemaVersion: "gitlab-profile-configuration@1.0.0",
    numericGitLabProjectId: 5001,
    apiFamily: "v4",
    credentialRoutingMode: "NAMED_CONNECTION_SLOTS_V1",
    allowedRefs: ["refs/heads/qa/smoke"],
    sourceContext: { mergeRequestRead: true, commitRead: true, buildRead: true },
    trigger: {
      logicalPipelineKey: "qa.validation",
      sourceRefPolicyRef: "policy:source:smoke:v1",
      dialect: "TYPED_INPUTS",
      ref: "refs/heads/qa/smoke",
      pipelineNameTemplate: "awp:{attemptId}:{requestHash}",
      markerInputName: "AWP_REQUEST_MARKER",
      allowedInputNames: ["AWP_REQUEST_MARKER"],
      inputMappings: [
        {
          logicalField: "REQUEST_MARKER",
          providerInputName: "AWP_REQUEST_MARKER",
          inputType: "STRING",
          source: "SERVER_CONTEXT",
        },
      ],
      inputMappingHash: digest("b"),
    },
    suiteMappings: [
      {
        suiteKey: "smoke",
        logicalPipelineKey: "qa.validation",
        sourceRefPolicyRef: "policy:source:smoke:v1",
        resultJobKey: "machine-result",
        logicalExecutionContractHash: digest("c"),
        resultJobName: "awp:result",
        resultArtifactPath: "awp/results/result.json",
        allowedEnvironmentRefs: ["environment:test:qa-1@17"],
      },
    ],
    resultContract: { schemaRef, maxBytes: 1_048_576 },
    artifactPolicy: {
      policyRef: "policy:artifact:qa:v1",
      maxArtifactBytes: 104_857_600,
      allowedClassifications: ["INTERNAL"],
      checksumAlgorithm: "SHA-256",
    },
    webhook: {
      verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
      deliverySemantics: "AT_LEAST_ONCE_SIGNAL_ONLY",
      eventKinds: ["PIPELINE_HOOK", "JOB_HOOK"],
      freshnessSeconds: 300,
      dedupeHorizonSeconds: 86_400,
    },
    reconciliation: {
      webhookGraceSeconds: 30,
      pollIntervalSeconds: 30,
      lookupConsistencyWindowSeconds: 120,
      freshnessTargetSeconds: 120,
      executionTimeoutSeconds: 3600,
      maxConcurrentReads: 4,
    },
    ratePolicy: {
      rateBudgetPerMinute: 120,
      maxConcurrentRequests: 4,
      requestTimeoutMs: 10_000,
      costBudgetRef: "budget:gitlab:qa:v1",
    },
    normalizedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
    transportRetry: {
      maxPreEffectTransportRetries: 1,
      retryableHttpStatuses: [429, 500, 502, 503, 504],
      minimumBackoffMs: 1000,
      maximumBackoffMs: 30_000,
    },
    productionDenied: true,
  };
}

function suiteProbe(): GitLabSuiteProbe {
  return {
    suiteKey: "smoke",
    exactRef: "refs/heads/qa/smoke",
    logicalExecutionContractHash: digest("c"),
    result: {
      jobName: "awp:result",
      artifactPath: "awp/results/result.json",
      schemaRef,
      fixtureValid: true,
      fixtureBytes: 512,
    },
    artifacts: [
      {
        mediaType: "application/xml",
        byteSize: 2048,
        classification: "INTERNAL",
        checksumAlgorithm: "SHA-256",
        checksumVerified: true,
      },
    ],
    allowedEnvironmentRefs: ["environment:test:qa-1@17"],
    runnerReady: true,
    networkReady: true,
    noDeployAttested: true,
  };
}

async function discovery() {
  const dialect = createGitLabDialect({
    adapterFamily: "gitlab-rest-v4",
    apiFamily: "v4",
    edition: "EE",
    exactVersion: "18.1.0-mock.1",
    exactBuild: "mock-build-1",
    triggerDialect: "TYPED_INPUTS",
    webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
  });
  const transport = {
    async get(path: string) {
      if (path.endsWith("/version"))
        return { version: "18.1.0-mock.1", revision: "mock-build-1", edition: "EE" };
      if (path.endsWith("/repository/branches/refs%2Fheads%2Fqa%2Fsmoke"))
        return { protected: false, commit: { id: "abcdef123456" } };
      return {
        id: 5001,
        path_with_namespace: "local/qa-smoke",
        default_branch: "qa/smoke",
        archived: false,
        jobs_enabled: true,
        capabilities: {
          pipelineRead: true,
          pipelineTrigger: true,
          artifactRead: true,
          standardWebhookHmacSha256: true,
        },
      };
    },
    async post() {
      return {
        valid: true,
        errors: [],
        warnings: [],
        jobs: [
          {
            name: "awp:result",
            stage: "test",
            environment: { name: "qa-1" },
            when: "always",
            allow_failure: false,
          },
        ],
      };
    },
  };
  return await discoverGitLab(transport, dialect, {
    numericProjectId: 5001,
    exactRef: "refs/heads/qa/smoke",
    expectedEdition: "EE",
    expectedVersion: "18.1.0-mock.1",
    expectedBuild: "mock-build-1",
  });
}

describe("GitLab Profile lifecycle foundation", () => {
  it("collects a bounded exact-project CI Lint dry-run and validates the Suite contracts", async () => {
    const snapshot = await discovery();
    expect(snapshot).toMatchObject({
      numericProjectId: 5001,
      exactRef: "refs/heads/qa/smoke",
      productionDenied: true,
    });
    expect(snapshot.lint).toMatchObject({
      dryRun: true,
      includeJobs: true,
      valid: true,
      productionOrDeployReachable: false,
    });
    expect(
      validateGitLabProfile({
        profile: profile(),
        discovery: snapshot,
        suiteProbes: [suiteProbe()],
        expectedEdition: "EE",
        expectedVersion: "18.1.0-mock.1",
        expectedBuild: "mock-build-1",
      }),
    ).toMatchObject({ status: "VALID", issues: [] });
  });

  it("fails closed on numeric-project, deploy, result, or artifact drift", async () => {
    const snapshot = await discovery();
    const invalidProject = validateGitLabProfile({
      profile: { ...profile(), numericGitLabProjectId: 5002 },
      discovery: snapshot,
      suiteProbes: [suiteProbe()],
    });
    expect(invalidProject.status).toBe("INVALID");
    expect(invalidProject.issues.map(({ code }) => code)).toContain("GITLAB_PROJECT_SCOPE_INVALID");

    const deploySnapshot = {
      ...snapshot,
      productionDenied: false,
      lint: { ...snapshot.lint, productionOrDeployReachable: true },
    } as const;
    expect(
      validateGitLabProfile({
        profile: profile(),
        discovery: deploySnapshot,
        suiteProbes: [suiteProbe()],
      }).issues.map(({ code }) => code),
    ).toContain("GITLAB_PRODUCTION_OR_DEPLOY_REACHABLE");

    const oversized = {
      ...suiteProbe(),
      result: { ...suiteProbe().result, fixtureBytes: 2_000_000 },
      artifacts: [{ ...suiteProbe().artifacts[0]!, byteSize: 200_000_000 }],
    };
    const policyDrift = validateGitLabProfile({
      profile: profile(),
      discovery: snapshot,
      suiteProbes: [oversized],
    });
    expect(policyDrift.checks).toMatchObject({ resultContracts: false, artifactPolicies: false });
  });

  it("requires three distinct immutable identity references and exact role routing", () => {
    const common = {
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotate",
      revocationRunbookRef: "runbook:revoke",
    };
    const candidate = {
      schemaVersion: "gitlab-connection-configuration@1.0.0",
      identityReferences: {
        read: {
          ...common,
          identityKind: "NON_HUMAN_PROJECT",
          scope: "read_api",
          nonHumanIdentityEvidenceRef: "evidence:read",
          reference: "secretref://gitlab/read",
          referenceFingerprint: digest("1"),
        },
        trigger: {
          ...common,
          identityKind: "NON_HUMAN_PROJECT",
          scope: "pipeline_trigger",
          nonHumanIdentityEvidenceRef: "evidence:trigger",
          reference: "secretref://gitlab/trigger",
          referenceFingerprint: digest("2"),
        },
        webhook: {
          ...common,
          identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
          keyVersionRef: "key:v1",
          reference: "secretref://gitlab/webhook",
          referenceFingerprint: digest("3"),
        },
      },
      operationIdentityRouting: {
        mergeRequestRead: "READ",
        commitRead: "READ",
        buildRead: "READ",
        pipelineTrigger: "TRIGGER",
        pipelineRead: "READ",
        pipelineLookup: "READ",
        artifactMetadata: "READ",
        artifactStream: "READ",
        webhookVerify: "WEBHOOK",
      },
      identitySeparationEvidenceHash: digest("4"),
    };
    expect(validateGitLabConnectionConfiguration(candidate).identityReferences.trigger.scope).toBe(
      "pipeline_trigger",
    );
    expect(() =>
      validateGitLabConnectionConfiguration({
        ...candidate,
        identityReferences: {
          ...candidate.identityReferences,
          trigger: {
            ...candidate.identityReferences.trigger,
            reference: candidate.identityReferences.read.reference,
          },
        },
      }),
    ).toThrow("GITLAB_IDENTITY_SEPARATION_INVALID");
  });
});

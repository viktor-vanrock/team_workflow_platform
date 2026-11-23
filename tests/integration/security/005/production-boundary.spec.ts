import { describe, expect, it, vi } from "vitest";

import {
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabRestClient,
  type GitLabSecretResolver,
  preflightGitLabProfile,
} from "../../../../packages/connector-gitlab/src/index.ts";

const digest = `sha256:${"a".repeat(64)}` as const;
const configuration = {
  schemaVersion: "gitlab-connection-configuration@1.0.0",
  identityReferences: {
    read: {
      identityKind: "NON_HUMAN_PROJECT",
      scope: "read_api",
      nonHumanIdentityEvidenceRef: "evidence:read",
      reference: "secretref://read",
      referenceFingerprint: digest,
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotate",
      revocationRunbookRef: "runbook:revoke",
    },
    trigger: {
      identityKind: "NON_HUMAN_PROJECT",
      scope: "pipeline_trigger",
      nonHumanIdentityEvidenceRef: "evidence:trigger",
      reference: "secretref://trigger",
      referenceFingerprint: `sha256:${"b".repeat(64)}`,
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotate",
      revocationRunbookRef: "runbook:revoke",
    },
    webhook: {
      identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
      keyVersionRef: "key:v1",
      reference: "secretref://webhook",
      referenceFingerprint: `sha256:${"c".repeat(64)}`,
      ownerRef: "team:qa",
      rotationPolicyRef: "policy:rotate",
      revocationRunbookRef: "runbook:revoke",
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
  identitySeparationEvidenceHash: `sha256:${"d".repeat(64)}`,
} as GitLabConnectionConfiguration;

describe("GitLab production boundary", () => {
  it("denies a production composition before credential materialization or provider I/O", () => {
    const secretResolution = vi.fn();
    const providerCall = vi.fn();
    const resolver: GitLabSecretResolver = {
      async resolve() {
        secretResolution();
        throw new Error("SHOULD_NOT_RESOLVE");
      },
    };
    const auth = new GitLabAuth(configuration, resolver);
    expect(
      () =>
        new GitLabRestClient({
          baseUrl: "https://gitlab.production.invalid",
          numericProjectId: 5001,
          environmentClass: "PRODUCTION" as never,
          allowedOrigins: ["https://gitlab.production.invalid"],
          auth,
          transport: providerCall,
        }),
    ).toThrow("GITLAB_PRODUCTION_FORBIDDEN");
    expect(secretResolution).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("denies plaintext non-local egress before resolving identities or calling fetch", () => {
    const secretResolution = vi.fn();
    const providerCall = vi.fn();
    const resolver: GitLabSecretResolver = {
      async resolve() {
        secretResolution();
        throw new Error("SHOULD_NOT_RESOLVE");
      },
    };
    expect(
      () =>
        new GitLabRestClient({
          baseUrl: "http://gitlab.test.invalid",
          numericProjectId: 5001,
          environmentClass: "TEST",
          allowedOrigins: ["http://gitlab.test.invalid"],
          auth: new GitLabAuth(configuration, resolver),
          transport: providerCall,
        }),
    ).toThrow("GITLAB_TLS_REQUIRED");
    expect(secretResolution).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("denies deploy-capable Profile configuration before discovery can resolve a secret or call the provider", () => {
    const secretResolution = vi.fn();
    const providerCall = vi.fn();
    const deployProfile = {
      schemaVersion: "gitlab-profile-configuration@1.0.0",
      numericGitLabProjectId: 5001,
      apiFamily: "v4",
      credentialRoutingMode: "NAMED_CONNECTION_SLOTS_V1",
      allowedRefs: ["refs/heads/qa/smoke"],
      sourceContext: { mergeRequestRead: true, commitRead: true, buildRead: true },
      trigger: {
        logicalPipelineKey: "qa.validation",
        sourceRefPolicyRef: "policy:source:v1",
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
        inputMappingHash: digest,
      },
      suiteMappings: [
        {
          suiteKey: "smoke",
          logicalPipelineKey: "qa.validation",
          sourceRefPolicyRef: "policy:source:v1",
          resultJobKey: "result",
          logicalExecutionContractHash: digest,
          resultJobName: "deploy-production",
          resultArtifactPath: "awp/result.json",
          allowedEnvironmentRefs: ["environment:production:primary"],
        },
      ],
      resultContract: { schemaRef: { id: "urn:test", version: 1, digest }, maxBytes: 1024 },
      artifactPolicy: {
        policyRef: "policy:artifact:v1",
        maxArtifactBytes: 1024,
        allowedClassifications: ["INTERNAL"],
        checksumAlgorithm: "SHA-256",
      },
      webhook: {
        verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
        deliverySemantics: "AT_LEAST_ONCE_SIGNAL_ONLY",
        eventKinds: ["PIPELINE_HOOK"],
        freshnessSeconds: 300,
        dedupeHorizonSeconds: 3600,
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
        rateBudgetPerMinute: 60,
        maxConcurrentRequests: 4,
        requestTimeoutMs: 1000,
        costBudgetRef: "budget:v1",
      },
      normalizedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
      transportRetry: {
        maxPreEffectTransportRetries: 1,
        retryableHttpStatuses: [429],
        minimumBackoffMs: 100,
        maximumBackoffMs: 1000,
      },
      productionDenied: true,
    };
    expect(preflightGitLabProfile(deployProfile, configuration)).toMatchObject({
      status: "DENIED",
      issues: [{ code: "GITLAB_PRODUCTION_OR_DEPLOY_REACHABLE" }],
    });
    expect(secretResolution).not.toHaveBeenCalled();
    expect(providerCall).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";

import {
  InMemoryQaProjectResourceStore,
  ManageQaProjectResources,
} from "../../../packages/competency-qa/src/application/manage-project-resources.ts";
import {
  exactRef,
  onboardingFixture,
  projectScope,
  qaHumanActor,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

const qaRef = (kind: string, id: string, contentHash: `sha256:${string}`) => ({
  kind,
  id,
  version: "1",
  contentHash,
});

describe("Feature 007 US1 QA Project resources", () => {
  it("publishes same-scope environment, test data, account pool and Context v2 exact refs", async () => {
    const store = new InMemoryQaProjectResourceStore();
    const service = new ManageQaProjectResources(store);
    const environment = await service.publishEnvironment({
      revisionId: "environment-r1",
      environmentId: "environment",
      version: 1,
      ...projectScope(),
      key: "local",
      name: "Local",
      scope: "LOCAL",
      ownerPrincipalId: onboardingFixture.qaLeadId,
      dataClassificationKey: "INTERNAL",
      status: "PUBLISHED",
      configurationRef: {
        key: "runtime",
        schemaRef: { id: "schema", version: 1, digest: testHash("schema") },
        resourceRef: exactRef("runtime"),
      },
      allowedTestDataPolicyRefs: [exactRef("test-policy")],
      createdBy: qaHumanActor(),
      createdAt: onboardingFixture.now,
      publishedAt: onboardingFixture.now,
    });
    const environmentRef = {
      id: environment.environmentId,
      version: environment.version,
      contentHash: environment.contentHash,
    };
    const testData = await service.publishTestData({
      entryId: "data",
      version: 1,
      ...projectScope(),
      kind: "DATASET",
      externalRef: exactRef("opaque-data"),
      ownerPrincipalId: onboardingFixture.qaLeadId,
      allowedEnvironmentRefs: [environmentRef],
      dataClassificationKey: "INTERNAL",
      retentionPolicyRef: exactRef("retention"),
      state: "PUBLISHED",
    });
    const pool = await service.publishAccountPool({
      poolId: "pool",
      version: 1,
      ...projectScope(),
      environmentRef,
      resolverRef: {
        key: "local",
        schemaRef: { id: "resolver", version: 1, digest: testHash("resolver") },
        resourceRef: exactRef("secret-adapter"),
      },
      ownerPrincipalId: onboardingFixture.qaLeadId,
      maximumConcurrentLeases: 1,
      maximumLeaseDurationSeconds: 3600,
      dataClassificationKey: "INTERNAL",
      state: "PUBLISHED",
    });
    const policy = qaRef("POLICY", "policy", testHash({ kind: "POLICY", id: "policy" }));
    const context = await service.publishContext({
      schemaVersion: 2,
      contextId: "context",
      version: 1,
      ...projectScope(),
      state: "PUBLISHED",
      environmentRefs: [qaRef("ENVIRONMENT", environment.environmentId, environment.contentHash)],
      testDataCatalogRefs: [qaRef("TEST_DATA", testData.entryId, testData.contentHash)],
      accountPoolRefs: [qaRef("ACCOUNT_POOL", pool.poolId, pool.contentHash)],
      targetPolicyRefs: [policy],
      scopePolicyRefs: [policy],
      checklistPolicyRefs: [policy],
      defaultTargetPolicyRef: policy,
      defaultScopePolicyRef: policy,
      defaultChecklistRefs: [policy],
      evidencePolicyRef: policy,
      retentionPolicyRef: policy,
      redactionPolicyRef: policy,
      exportPolicyRef: policy,
      riskReviewPolicyRef: policy,
      dorRuleSetRef: policy,
      dodRuleSetRef: policy,
      capabilityRequirementSetRef: policy,
      maximumClassificationKey: "INTERNAL",
      resourceVersion: 1,
      createdBy: qaHumanActor(),
      publishedBy: qaHumanActor(),
      publishedAt: onboardingFixture.now,
    });
    expect(context.environmentRefs[0]?.id).toBe(environment.environmentId);
  });

  it("rejects secret-bearing, production and cross-Project resources", async () => {
    const service = new ManageQaProjectResources(new InMemoryQaProjectResourceStore());
    const base = {
      revisionId: "environment-r1",
      environmentId: "environment",
      version: 1,
      ...projectScope(),
      key: "local",
      name: "Local",
      ownerPrincipalId: onboardingFixture.qaLeadId,
      dataClassificationKey: "INTERNAL",
      status: "PUBLISHED" as const,
      configurationRef: {
        key: "runtime",
        schemaRef: { id: "schema", version: 1, digest: testHash("schema") },
        resourceRef: exactRef("runtime"),
      },
      allowedTestDataPolicyRefs: [exactRef("test-policy")],
      createdBy: qaHumanActor(),
      createdAt: onboardingFixture.now,
      publishedAt: onboardingFixture.now,
    };
    await expect(
      service.publishEnvironment({ ...base, scope: "PLATFORM_PROD" as never }),
    ).rejects.toThrow("QA_PROJECT_ENVIRONMENT_INVALID");
    await expect(
      service.publishEnvironment({
        ...base,
        scope: "LOCAL",
        configurationRef: { ...base.configurationRef, password: "secret" } as never,
      }),
    ).rejects.toThrow("QA_PROJECT_RESOURCE_SECRET_FORBIDDEN");
  });
});

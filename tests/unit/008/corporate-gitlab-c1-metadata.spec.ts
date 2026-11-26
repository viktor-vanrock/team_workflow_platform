import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  gitLabPilotMetadataContentHash,
  type GitLabPilotMetadataPackage,
} from "../../../packages/platform-contracts/src/extensions/gitlab-pilot-metadata.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/pilot/model.ts";
import {
  corporateGitLabRetryPolicy,
  resolveCorporateGitLabC1,
} from "../../../packages/runtime-composition/src/gitlab/corporate-c1-metadata.ts";

const fixture = () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../specs/005-gitlab-automated-validation/contracts/examples/gitlab-pilot-metadata.local.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as GitLabPilotMetadataPackage;
  const policyDocument = {
    policyRef: String(fixture.qaRetryPolicy.policyRef),
    maxAutomaticRetries: 1,
    allowedInfrastructureCodes: fixture.qaRetryPolicy.allowedInfrastructureCodes as string[],
  };
  const changed = {
    ...fixture,
    contourKey: "qa-jira-gitlab-test" as const,
    environmentClass: "TEST" as const,
    qaRetryPolicy: { ...fixture.qaRetryPolicy, policyHash: sha256(policyDocument) },
    server: { ...fixture.server, baseUrl: "https://gitlab.example.test" },
  };
  const metadata = { ...changed, contentHash: gitLabPilotMetadataContentHash(changed) };
  const pin = metadata.configurationPins.find((value) => value.logicalRole === "TEST_EXECUTION")!;
  const ref = (value: Readonly<{ id: string; version: number }>, hash: string) => ({
    ...value,
    contentHash: hash,
  });
  const project = {
    projectId: metadata.projectId,
    gitlabPilotMetadata: metadata,
    integrationBindingRef: ref(pin.projectIntegrationBindingRef, pin.projectIntegrationBindingHash),
    profileRef: ref(pin.profileRef, pin.profileHash),
    connectionRef: ref(pin.connectionRef, pin.connectionHash),
  };
  const document = { provider: "gitlab", projects: [project] };
  const publicationRef = {
    id: "gitlab-publication",
    version: 1,
    contentHash: pilotContentHash(document),
  };
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    composition: metadata.contourKey,
    deployment: {
      workspaceId: metadata.workspaceId,
      projectIds: [metadata.projectId],
      connectorBindings: [{ provider: "gitlab", ref: publicationRef }],
      endpoints: [{ purpose: "gitlab", url: metadata.server.baseUrl }],
    },
  };
  const publication = {
    kind: "CONNECTOR_BINDING",
    workspaceId: metadata.workspaceId,
    projectIds: [metadata.projectId],
    ref: publicationRef,
    document,
    validUntil: "2999-01-01T00:00:00Z",
  };
  const attempt = {
    workspaceId: metadata.workspaceId,
    projectId: metadata.projectId,
    retryPolicyRef: policyDocument.policyRef,
    retryPolicyHash: metadata.qaRetryPolicy.policyHash,
    configurationPins: metadata.configurationPins.map((p) => ({
      logicalRole: p.logicalRole,
      capabilityKey: p.capabilityKey,
      exactContractVersion: p.exactContractVersion,
      operationSetHash: p.operationSetHash,
      projectIntegrationBindingRef: ref(
        p.projectIntegrationBindingRef,
        p.projectIntegrationBindingHash,
      ),
      profileRef: ref(p.profileRef, p.profileHash),
      connectionRef: ref(p.connectionRef, p.connectionHash),
      validationReportRef: {
        id: p.validationReportId,
        version: 1,
        contentHash: p.validationEvidenceHash,
      },
    })),
  };
  return { environment, publication, metadata, attempt, policyDocument };
};

describe("published GitLab C1 retry policy", () => {
  it("resolves the approved project metadata and its exact pinned retry policy", () => {
    const f = fixture();
    const metadata = resolveCorporateGitLabC1(
      f.environment as never,
      [f.publication] as never,
      f.metadata.projectId,
    );
    expect(corporateGitLabRetryPolicy(metadata, f.attempt as never)).toMatchObject({
      automaticRetryBudget: 1,
      allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE", "SERVICE_DEPENDENCY_TIMEOUT"],
    });
  });
  it("rejects changed C1 content, unrelated projects, and a different retry policy", () => {
    const f = fixture();
    expect(() =>
      resolveCorporateGitLabC1(f.environment as never, [f.publication] as never, "other"),
    ).toThrow("CORPORATE_GITLAB_C1_SCOPE_DENIED");
    const bad = { ...f.publication, document: { ...f.publication.document, provider: "altered" } };
    expect(() =>
      resolveCorporateGitLabC1(f.environment as never, [bad] as never, f.metadata.projectId),
    ).toThrow("CORPORATE_GITLAB_C1_PUBLICATION_REQUIRED");
    const metadata = resolveCorporateGitLabC1(
      f.environment as never,
      [f.publication] as never,
      f.metadata.projectId,
    );
    expect(() =>
      corporateGitLabRetryPolicy(metadata, {
        ...f.attempt,
        retryPolicyHash: "sha256:wrong",
      } as never),
    ).toThrow("CORPORATE_GITLAB_RETRY_POLICY_MISMATCH");
    expect(() =>
      corporateGitLabRetryPolicy(
        {
          ...metadata,
          qaRetryPolicy: { ...metadata.qaRetryPolicy, allowedInfrastructureCodes: [] },
        },
        f.attempt as never,
      ),
    ).toThrow("CORPORATE_GITLAB_RETRY_POLICY_MISMATCH");
  });
  it("rejects a modified metadata package even inside a newly hashed publication", () => {
    const f = fixture();
    const tampered = {
      ...f.metadata,
      qaRetryPolicy: { ...f.metadata.qaRetryPolicy, allowedInfrastructureCodes: [] },
    };
    const document = {
      provider: "gitlab",
      projects: [{ ...f.publication.document.projects[0]!, gitlabPilotMetadata: tampered }],
    };
    const ref = { ...f.publication.ref, contentHash: pilotContentHash(document) };
    const publication = { ...f.publication, document, ref };
    const environment = {
      ...f.environment,
      deployment: { ...f.environment.deployment, connectorBindings: [{ provider: "gitlab", ref }] },
    };
    expect(() =>
      resolveCorporateGitLabC1(environment as never, [publication] as never, f.metadata.projectId),
    ).toThrow("CORPORATE_GITLAB_C1_METADATA_INVALID");
  });
  it("rejects expired publication and changed attempt configuration pins", () => {
    const f = fixture();
    expect(() =>
      resolveCorporateGitLabC1(
        f.environment as never,
        [{ ...f.publication, validUntil: "2020-01-01T00:00:00Z" }] as never,
        f.metadata.projectId,
      ),
    ).toThrow("CORPORATE_GITLAB_C1_PUBLICATION_REQUIRED");
    const metadata = resolveCorporateGitLabC1(
      f.environment as never,
      [f.publication] as never,
      f.metadata.projectId,
    );
    const [first, ...rest] = f.attempt.configurationPins;
    expect(() =>
      corporateGitLabRetryPolicy(metadata, {
        ...f.attempt,
        configurationPins: [{ ...first!, operationSetHash: `sha256:${"0".repeat(64)}` }, ...rest],
      } as never),
    ).toThrow("CORPORATE_GITLAB_RETRY_POLICY_MISMATCH");
  });
});

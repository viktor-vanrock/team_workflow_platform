import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import {
  assertDeploymentAgreement,
  parseDeploymentPolicy,
} from "../../../packages/runtime-composition/src/pilot/deployment-config.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const ref = { id: "published-policy", version: 1, contentHash: hash };
export const policy = () => ({
  schemaVersion: 1,
  deploymentId: "pilot",
  version: 1,
  deploymentProfile: "pilot",
  runtimeProfile: "non-local",
  environmentScope: "NON_PROD",
  compositionKey: "qa-jira-gitlab-mattermost-test",
  workspaceId: "w1",
  projectIds: ["p1"],
  imageDigest: hash,
  inputPackageRef: ref,
  identityPolicyRef: ref,
  secretResolverPolicyRef: ref,
  signingPolicyRef: ref,
  telemetryPolicyRef: ref,
  networkPolicyRef: ref,
  artifactPolicyRef: ref,
  modelPolicyRef: ref,
  recoveryPolicyRef: ref,
  artifactMode: "GITLAB_ONLY",
  connectorBindings: ["jira", "gitlab", "mattermost"].map((provider) => ({ provider, ref })),
  endpoints: [
    {
      purpose: "identity",
      url: "https://identity.example.test/oidc",
      allowedOrigin: "https://identity.example.test",
    },
  ],
});

describe("008 deployment policy", () => {
  it("accepts explicit corporate policy and freezes nested values", () => {
    const parsed = parseDeploymentPolicy(policy());
    expect(parsed.deploymentProfile).toBe("pilot");
    expect(Object.isFrozen(parsed.projectIds)).toBe(true);
    expect(Object.isFrozen(parsed.connectorBindings[0]?.ref)).toBe(true);
  });
  it.each([
    { deploymentProfile: "production" },
    { runtimeProfile: "local" },
    { environmentScope: "PLATFORM_PROD" },
    { environmentScope: "PREPROD" },
    { compositionKey: "foundation" },
    { compositionKey: "qa-local" },
  ])("rejects closed-matrix conflicts %j", (patch) => {
    expect(() => parseDeploymentPolicy({ ...policy(), ...patch })).toThrow(
      "CONFIG_PROFILE_CONFLICT",
    );
  });
  it("requires exact references, complete connectors and no unknown secret fields", () => {
    expect(() => parseDeploymentPolicy({ ...policy(), inputPackageRef: undefined })).toThrow(
      "BLOCKED_INPUT",
    );
    expect(() => parseDeploymentPolicy({ ...policy(), connectorBindings: [] })).toThrow(
      "REQUIRED_CONNECTOR_MISSING",
    );
    expect(() => parseDeploymentPolicy({ ...policy(), password: "canary-private-value" })).toThrow(
      "CONFIG_UNKNOWN_FIELD",
    );
    expect(() =>
      parseDeploymentPolicy({ ...policy(), signingPolicyRef: { ...ref, id: "local-ed25519" } }),
    ).toThrow("LOCAL_COMPONENT_FORBIDDEN");
    expect(() =>
      parseDeploymentPolicy({ ...policy(), inputPackageRef: { ...ref, contentHash: "PASS" } }),
    ).toThrow("BLOCKED_INPUT");
  });
  it.each([
    "http://identity.example.test/oidc",
    "https://user:password@identity.example.test/oidc",
    "https://identity.example.test/oidc#token",
    "https://evil.test/oidc",
    "https://169.254.169.254/latest",
    "https://localhost/oidc",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(() =>
      parseDeploymentPolicy({ ...policy(), endpoints: [{ ...policy().endpoints[0], url }] }),
    ).toThrow("ENDPOINT_POLICY_DENIED");
  });
  it("preserves local legacy mapping but cannot select non-local implicit credentials", () => {
    expect(loadEnvironment({ AWP_RUNTIME_PROFILE: "test" }).environmentScope).toBe("LOCAL");
    expect(() =>
      loadEnvironment({
        AWP_ENVIRONMENT: "NON_PROD",
        AWP_IDENTITY_ISSUER: "https://identity.example.test",
      }),
    ).toThrow("BLOCKED_INPUT");
    expect(() =>
      loadEnvironment({
        AWP_ENVIRONMENT: "LOCAL",
        AWP_DEPLOYMENT_CONFIG: JSON.stringify(policy()),
      }),
    ).toThrow("CONFIG_PROFILE_CONFLICT");
  });
  it("rejects default infrastructure credentials even with an otherwise valid config", () => {
    expect(() =>
      loadEnvironment({
        AWP_ENVIRONMENT: "NON_PROD",
        AWP_COMPOSITION: "qa-jira-gitlab-mattermost-test",
        AWP_IDENTITY_ISSUER: "https://identity.example.test",
        AWP_DEPLOYMENT_CONFIG: JSON.stringify(policy()),
        AWP_DATABASE_URL: "postgresql://awp_local:local-only@localhost/awp",
      }),
    ).toThrow("LOCAL_COMPONENT_FORBIDDEN");
  });
  it("binds both processes to exact config and artifact digests", () => {
    const parsed = parseDeploymentPolicy(policy());
    expect(() => assertDeploymentAgreement(parsed, parsed)).not.toThrow();
    expect(() =>
      assertDeploymentAgreement(
        parsed,
        parseDeploymentPolicy({ ...policy(), imageDigest: `sha256:${"b".repeat(64)}` }),
      ),
    ).toThrow("DEPLOYMENT_DIGEST_MISMATCH");
  });
  it("validates actual environment endpoints against the deployment policy", () => {
    const source = {
      AWP_ENVIRONMENT: "NON_PROD",
      AWP_COMPOSITION: "qa-jira-gitlab-mattermost-test",
      AWP_DEPLOYMENT_CONFIG: JSON.stringify(policy()),
      AWP_DATABASE_URL: "postgresql://service@database.example.test/awp?sslmode=verify-full",
      AWP_IDENTITY_ISSUER: "https://identity.example.test/oidc",
      AWP_IDENTITY_AUDIENCE: "awp",
    };
    expect(loadEnvironment(source).deployment?.deploymentProfile).toBe("pilot");
    expect(loadEnvironment(source)).not.toHaveProperty("s3Endpoint");
    expect(() =>
      loadEnvironment({ ...source, AWP_IDENTITY_ISSUER: "http://169.254.169.254/" }),
    ).toThrow("ENDPOINT_POLICY_DENIED");
    expect(() =>
      loadEnvironment({
        ...source,
        AWP_DATABASE_URL: "postgresql://postgres:postgres@database.example.test/awp",
      }),
    ).toThrow("LOCAL_COMPONENT_FORBIDDEN");
  });
});

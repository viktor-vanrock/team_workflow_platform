import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
} from "@awp/platform-core";

import type {
  RuntimeCompositionKey,
  RuntimeEnvironmentScope,
  RuntimeProfile,
} from "../config/environment.ts";

export type DeploymentProfile = "local" | "integration" | "pilot";
const policyKeys = [
  "inputPackageRef",
  "identityPolicyRef",
  "secretResolverPolicyRef",
  "signingPolicyRef",
  "telemetryPolicyRef",
  "networkPolicyRef",
  "artifactPolicyRef",
  "modelPolicyRef",
  "recoveryPolicyRef",
] as const;
type PolicyReferences = Readonly<Record<(typeof policyKeys)[number], ExactRevisionRef>>;
export interface DeploymentPolicy extends PolicyReferences {
  readonly schemaVersion: 1;
  readonly deploymentId: string;
  readonly version: number;
  readonly deploymentProfile: DeploymentProfile;
  readonly runtimeProfile: RuntimeProfile;
  readonly environmentScope: RuntimeEnvironmentScope;
  readonly compositionKey: RuntimeCompositionKey;
  readonly workspaceId: string;
  readonly projectIds: readonly string[];
  readonly imageDigest: string;
  readonly artifactMode: "GITLAB_ONLY";
  readonly connectorBindings: readonly Readonly<{
    provider: "jira" | "gitlab" | "mattermost";
    ref: ExactRevisionRef;
  }>[];
  readonly endpoints: readonly Readonly<{ purpose: string; url: string; allowedOrigin: string }>[];
}
const keys = new Set([
  "schemaVersion",
  "deploymentId",
  "version",
  "deploymentProfile",
  "runtimeProfile",
  "environmentScope",
  "compositionKey",
  "workspaceId",
  "projectIds",
  "imageDigest",
  "artifactMode",
  "connectorBindings",
  "endpoints",
  ...policyKeys,
]);
const corporateCompositions = new Set([
  "qa-jira-gitlab-mattermost-development",
  "qa-jira-gitlab-mattermost-test",
]);
const localCompositions = new Set([
  "foundation",
  "qa-local",
  "qa-jira-local",
  "qa-jira-mattermost-local",
  "qa-jira-gitlab-local",
  "qa-jira-gitlab-mattermost-local",
]);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BLOCKED_INPUT");
  return value as Record<string, unknown>;
};
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,255}$/u.test(value);
const localComponent = (value: string): boolean =>
  /(?:^|[/:._-])(?:local|fake|fixture|mock|dev|awp_local)(?:$|[/:._-])/iu.test(value);
const digest = (value: unknown): boolean =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);

function exactRef(value: unknown, local: boolean): void {
  const ref = object(value);
  if (Object.keys(ref).some((key) => !["id", "version", "contentHash"].includes(key)))
    throw new Error("CONFIG_UNKNOWN_FIELD");
  try {
    assertExactRevisionRef(ref as unknown as ExactRevisionRef);
  } catch {
    throw new Error("BLOCKED_INPUT");
  }
  if (!nonempty(ref.id)) throw new Error("BLOCKED_INPUT");
  if (!local && localComponent(ref.id)) throw new Error("LOCAL_COMPONENT_FORBIDDEN");
}

/** Syntax/origin validation only. DNS, TLS, method/path and redirects are checked at transport invocation. */
export function validateDeploymentEndpoint(
  urlValue: unknown,
  originValue: unknown,
  local: boolean,
): void {
  if (typeof urlValue !== "string" || typeof originValue !== "string")
    throw new Error("ENDPOINT_POLICY_DENIED");
  let url: URL;
  let origin: URL;
  try {
    url = new URL(urlValue);
    origin = new URL(originValue);
  } catch {
    throw new Error("ENDPOINT_POLICY_DENIED");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    originValue !== origin.origin ||
    url.origin !== origin.origin ||
    (local ? !["http:", "https:"].includes(url.protocol) : url.protocol !== "https:") ||
    (!local &&
      (/^(?:localhost|127\.|0\.|169\.254\.|\[?::1\]?|\[?::ffff:|\[?fe80:)/iu.test(url.hostname) ||
        url.hostname.endsWith(".localhost") ||
        localComponent(url.hostname)))
  )
    throw new Error("ENDPOINT_POLICY_DENIED");
}

export function parseDeploymentPolicy(value: unknown): DeploymentPolicy {
  const input = object(value);
  if (Object.keys(input).some((key) => !keys.has(key))) throw new Error("CONFIG_UNKNOWN_FIELD");
  const local = input.deploymentProfile === "local";
  if (
    !["local", "integration", "pilot"].includes(String(input.deploymentProfile)) ||
    (local
      ? !["local", "test"].includes(String(input.runtimeProfile)) ||
        input.environmentScope !== "LOCAL" ||
        !localCompositions.has(String(input.compositionKey))
      : input.runtimeProfile !== "non-local" ||
        input.environmentScope !== "NON_PROD" ||
        !corporateCompositions.has(String(input.compositionKey)))
  )
    throw new Error("CONFIG_PROFILE_CONFLICT");
  if (
    input.schemaVersion !== 1 ||
    !nonempty(input.deploymentId) ||
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 1 ||
    !nonempty(input.workspaceId) ||
    !digest(input.imageDigest) ||
    input.artifactMode !== "GITLAB_ONLY"
  )
    throw new Error("BLOCKED_INPUT");
  if (
    !Array.isArray(input.projectIds) ||
    !input.projectIds.length ||
    input.projectIds.length > 100 ||
    !input.projectIds.every(nonempty) ||
    new Set(input.projectIds).size !== input.projectIds.length
  )
    throw new Error("BLOCKED_INPUT");
  for (const key of policyKeys) exactRef(input[key], local);
  if (!Array.isArray(input.connectorBindings)) throw new Error("REQUIRED_CONNECTOR_MISSING");
  const providers = new Set<string>();
  for (const value of input.connectorBindings) {
    const binding = object(value);
    if (
      Object.keys(binding).some((key) => !["provider", "ref"].includes(key)) ||
      !["jira", "gitlab", "mattermost"].includes(String(binding.provider)) ||
      providers.has(String(binding.provider))
    )
      throw new Error("REQUIRED_CONNECTOR_MISSING");
    providers.add(String(binding.provider));
    exactRef(binding.ref, local);
  }
  if (!local && providers.size !== 3) throw new Error("REQUIRED_CONNECTOR_MISSING");
  if (!Array.isArray(input.endpoints) || !input.endpoints.length || input.endpoints.length > 32)
    throw new Error("BLOCKED_INPUT");
  const purposes = new Set<string>();
  for (const value of input.endpoints) {
    const endpoint = object(value);
    if (
      Object.keys(endpoint).some((key) => !["purpose", "url", "allowedOrigin"].includes(key)) ||
      !nonempty(endpoint.purpose) ||
      purposes.has(endpoint.purpose)
    )
      throw new Error("ENDPOINT_POLICY_DENIED");
    purposes.add(endpoint.purpose);
    validateDeploymentEndpoint(endpoint.url, endpoint.allowedOrigin, local);
  }
  return freezePilotValue(structuredClone(input)) as unknown as DeploymentPolicy;
}

export function assertDeploymentAgreement(api: DeploymentPolicy, worker: DeploymentPolicy): void {
  if (pilotContentHash(api) !== pilotContentHash(worker))
    throw new Error("DEPLOYMENT_DIGEST_MISMATCH");
}

export function deploymentFromEnvironment(
  source: NodeJS.ProcessEnv,
  profile: RuntimeProfile,
  environment: RuntimeEnvironmentScope,
  composition: RuntimeCompositionKey,
): DeploymentPolicy | undefined {
  if (!source.AWP_DEPLOYMENT_CONFIG) {
    if (profile === "non-local") throw new Error("BLOCKED_INPUT:AWP_DEPLOYMENT_CONFIG");
    return undefined;
  }
  let value: unknown;
  try {
    if (source.AWP_DEPLOYMENT_CONFIG.length > 65536) throw new Error();
    value = JSON.parse(source.AWP_DEPLOYMENT_CONFIG);
  } catch {
    throw new Error("CONFIG_INVALID_JSON");
  }
  const policy = parseDeploymentPolicy(value);
  if (
    policy.runtimeProfile !== profile ||
    policy.environmentScope !== environment ||
    policy.compositionKey !== composition ||
    (source.AWP_DEPLOYMENT_PROFILE !== undefined &&
      policy.deploymentProfile !== source.AWP_DEPLOYMENT_PROFILE)
  )
    throw new Error("CONFIG_PROFILE_CONFLICT");
  if (profile === "non-local") {
    const controlledSandbox =
      source.NODE_ENV === "test" &&
      source.AWP_PILOT_ADAPTER_MODE === "controlled-sandbox" &&
      environment === "NON_PROD";
    for (const key of ["AWP_DATABASE_URL"] as const) {
      const value = source[key];
      if (!value) throw new Error(`BLOCKED_INPUT:${key}`);
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error("ENDPOINT_POLICY_DENIED");
      }
      if (
        !controlledSandbox &&
        (localComponent(value) ||
          /^(?:localhost|127\.|0\.|169\.254\.|\[?::1)/iu.test(parsed.hostname) ||
          ["postgres", "password", "changeme", "local-only", "awp-test-only"].includes(
            decodeURIComponent(parsed.password).toLowerCase(),
          ))
      )
        throw new Error("LOCAL_COMPONENT_FORBIDDEN");
      if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.hash)
        throw new Error("ENDPOINT_POLICY_DENIED");
    }
    for (const key of ["AWP_IDENTITY_ISSUER", "AWP_IDENTITY_AUDIENCE"] as const)
      if (!source[key]) throw new Error(`BLOCKED_INPUT:${key}`);
    if (
      policy.endpoints.find(({ purpose }) => purpose === "identity")?.url !==
      source.AWP_IDENTITY_ISSUER
    )
      throw new Error("ENDPOINT_POLICY_DENIED");
    if (source.AWP_EVIDENCE_SIGNER && localComponent(source.AWP_EVIDENCE_SIGNER))
      throw new Error("LOCAL_COMPONENT_FORBIDDEN");
  }
  return policy;
}

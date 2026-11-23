import { deploymentFromEnvironment, type DeploymentPolicy } from "../pilot/deployment-config.ts";

export type RuntimeProfile = "local" | "test" | "non-local";
export type RuntimeEnvironmentScope = "LOCAL" | "NON_PROD" | "PREPROD" | "PLATFORM_PROD";
export type RuntimeCompositionKey =
  | "foundation"
  | "qa-local"
  | "qa-jira-local"
  | "qa-jira-mattermost-local"
  | "qa-jira-nonprod"
  | "qa-jira-mattermost-nonprod"
  | "qa-jira-gitlab-local"
  | "qa-jira-gitlab-mattermost-local"
  | "qa-jira-gitlab-development"
  | "qa-jira-gitlab-test"
  | "qa-jira-gitlab-mattermost-development"
  | "qa-jira-gitlab-mattermost-test";

export interface ParsedRuntimeEnvironmentScope {
  readonly scope: RuntimeEnvironmentScope;
  readonly source: "CANONICAL" | "LEGACY";
  readonly raw: string;
}

export interface RuntimeEnvironment {
  readonly deployment?: DeploymentPolicy;
  readonly profile: RuntimeProfile;
  readonly environmentScope: RuntimeEnvironmentScope;
  readonly environmentInput: ParsedRuntimeEnvironmentScope;
  readonly composition: RuntimeCompositionKey;
  readonly databaseUrl: string;
  readonly mockHubUrl?: string;
  readonly identityIssuer: string;
  readonly identityAudience: string;
  readonly externalNetworkMode: "deny" | "allowlisted";
  readonly modelProvider?: string;
  readonly gitLabBaseUrl?: string;
  readonly gitLabReadSecretRef?: string;
  readonly gitLabTriggerSecretRef?: string;
  readonly gitLabWebhookSecretRef?: string;
}

const canonicalScopes = new Set<RuntimeEnvironmentScope>([
  "LOCAL",
  "NON_PROD",
  "PREPROD",
  "PLATFORM_PROD",
]);
const legacyScopes = Object.freeze({
  local: "LOCAL",
  test: "LOCAL",
  "non-local": "NON_PROD",
} as const);
export const runtimeCompositionKeys = Object.freeze([
  "foundation",
  "qa-local",
  "qa-jira-local",
  "qa-jira-mattermost-local",
  "qa-jira-nonprod",
  "qa-jira-mattermost-nonprod",
  "qa-jira-gitlab-local",
  "qa-jira-gitlab-mattermost-local",
  "qa-jira-gitlab-development",
  "qa-jira-gitlab-test",
  "qa-jira-gitlab-mattermost-development",
  "qa-jira-gitlab-mattermost-test",
] as const satisfies readonly RuntimeCompositionKey[]);

const gitLabLocalCompositions = new Set<RuntimeCompositionKey>([
  "qa-jira-gitlab-local",
  "qa-jira-gitlab-mattermost-local",
]);
const gitLabNonLocalCompositions = new Set<RuntimeCompositionKey>([
  "qa-jira-gitlab-development",
  "qa-jira-gitlab-test",
  "qa-jira-gitlab-mattermost-development",
  "qa-jira-gitlab-mattermost-test",
]);
const qaJiraLocalCompositions = new Set<RuntimeCompositionKey>([
  "qa-jira-local",
  "qa-jira-mattermost-local",
  "qa-jira-gitlab-local",
  "qa-jira-gitlab-mattermost-local",
]);
const mattermostLocalCompositions = new Set<RuntimeCompositionKey>([
  "qa-jira-mattermost-local",
  "qa-jira-gitlab-mattermost-local",
]);

export function isQaJiraLocalComposition(value: RuntimeCompositionKey): boolean {
  return qaJiraLocalCompositions.has(value);
}

export function isMattermostLocalComposition(value: RuntimeCompositionKey): boolean {
  return mattermostLocalCompositions.has(value);
}

export function isGitLabLocalComposition(value: RuntimeCompositionKey): boolean {
  return gitLabLocalCompositions.has(value);
}

export const queueLocalComposition = "qa-jira-gitlab-mattermost-local" as const;
export const onboardingLocalCompositionKey = queueLocalComposition;

export function isQueueLocalComposition(value: RuntimeCompositionKey): boolean {
  return value === queueLocalComposition;
}

export function parseRuntimeEnvironmentScope(
  source: NodeJS.ProcessEnv,
): ParsedRuntimeEnvironmentScope {
  const canonical = source.AWP_ENVIRONMENT?.trim();
  const legacy = source.AWP_RUNTIME_PROFILE?.trim();
  if (!canonical && !legacy)
    throw new Error("Missing required environment variable AWP_ENVIRONMENT or AWP_RUNTIME_PROFILE");
  if (canonical) {
    if (!canonicalScopes.has(canonical as RuntimeEnvironmentScope))
      throw new Error(`Invalid AWP_ENVIRONMENT: ${canonical}`);
    if (legacy) {
      const legacyScope = legacyScopes[legacy as keyof typeof legacyScopes];
      if (!legacyScope) throw new Error(`Invalid AWP_RUNTIME_PROFILE: ${legacy}`);
      if (legacyScope !== canonical)
        throw new Error(`RUNTIME_ENVIRONMENT_CONFLICT:${canonical}:${legacy}`);
    }
    return Object.freeze({
      scope: canonical as RuntimeEnvironmentScope,
      source: "CANONICAL",
      raw: canonical,
    });
  }
  const scope = legacyScopes[legacy as keyof typeof legacyScopes];
  if (!scope) throw new Error(`Invalid AWP_RUNTIME_PROFILE: ${String(legacy)}`);
  return Object.freeze({ scope, source: "LEGACY", raw: legacy! });
}

function compatibleProfile(
  parsed: ParsedRuntimeEnvironmentScope,
  source: NodeJS.ProcessEnv,
): RuntimeProfile {
  const legacy = source.AWP_RUNTIME_PROFILE?.trim();
  if (legacy && legacy in legacyScopes) return legacy as RuntimeProfile;
  return parsed.scope === "LOCAL" ? "local" : "non-local";
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): RuntimeEnvironment {
  const environmentInput = parseRuntimeEnvironmentScope(source);
  const profile = compatibleProfile(environmentInput, source);
  const local = environmentInput.scope === "LOCAL";
  const composition = source.AWP_COMPOSITION?.trim() || "foundation";
  if (!(runtimeCompositionKeys as readonly string[]).includes(composition))
    throw new Error(`Invalid AWP_COMPOSITION: ${composition}`);
  const networkMode = source.AWP_EXTERNAL_NETWORK_MODE ?? (local ? "deny" : "allowlisted");
  if (networkMode !== "deny" && networkMode !== "allowlisted")
    throw new Error(`Invalid AWP_EXTERNAL_NETWORK_MODE: ${networkMode}`);
  const result: RuntimeEnvironment = {
    profile,
    environmentScope: environmentInput.scope,
    environmentInput,
    composition: composition as RuntimeCompositionKey,
    databaseUrl:
      source.AWP_DATABASE_URL ??
      (local ? "postgresql://awp_local:local-only@localhost:5432/awp" : ""),
    identityIssuer: source.AWP_IDENTITY_ISSUER ?? (local ? "https://fake-idp:4443/oidc" : ""),
    identityAudience: source.AWP_IDENTITY_AUDIENCE ?? (local ? "awp" : ""),
    externalNetworkMode: networkMode,
    ...(source.AWP_MODEL_PROVIDER ? { modelProvider: source.AWP_MODEL_PROVIDER } : {}),
    ...(source.AWP_GITLAB_BASE_URL ? { gitLabBaseUrl: source.AWP_GITLAB_BASE_URL } : {}),
    ...(source.AWP_GITLAB_READ_SECRET_REF
      ? { gitLabReadSecretRef: source.AWP_GITLAB_READ_SECRET_REF }
      : {}),
    ...(source.AWP_GITLAB_TRIGGER_SECRET_REF
      ? { gitLabTriggerSecretRef: source.AWP_GITLAB_TRIGGER_SECRET_REF }
      : {}),
    ...(source.AWP_GITLAB_WEBHOOK_SECRET_REF
      ? { gitLabWebhookSecretRef: source.AWP_GITLAB_WEBHOOK_SECRET_REF }
      : {}),
    ...(source.AWP_MOCK_HUB_URL || local
      ? { mockHubUrl: source.AWP_MOCK_HUB_URL ?? "http://localhost:4010" }
      : {}),
  };
  if (!result.identityIssuer) throw new Error("AWP_IDENTITY_ISSUER is required outside local/test");
  if (!local && result.mockHubUrl !== undefined)
    throw new Error("Mock Hub is forbidden outside local/test profiles");
  if (result.composition === "qa-local" && !local)
    throw new Error("QA_LOCAL_COMPOSITION_PROFILE_FORBIDDEN");
  if (result.composition === "qa-local" && result.externalNetworkMode !== "deny")
    throw new Error("QA_LOCAL_COMPOSITION_NETWORK_FORBIDDEN");
  if (result.composition === "qa-local" && !result.mockHubUrl)
    throw new Error("QA_LOCAL_COMPOSITION_MOCK_HUB_REQUIRED");
  if (result.composition === "qa-jira-local" && !local)
    throw new Error("QA_JIRA_LOCAL_COMPOSITION_PROFILE_FORBIDDEN");
  if (
    result.composition === "qa-jira-local" &&
    (result.externalNetworkMode !== "deny" || !result.mockHubUrl)
  )
    throw new Error("QA_JIRA_LOCAL_COMPOSITION_BARRIER_REQUIRED");
  if (
    result.composition === "qa-jira-mattermost-local" &&
    (!local || result.externalNetworkMode !== "deny" || !result.mockHubUrl)
  )
    throw new Error("QA_JIRA_MATTERMOST_LOCAL_COMPOSITION_BARRIER_REQUIRED");
  if (result.composition === "qa-jira-nonprod" && result.environmentScope !== "NON_PROD")
    throw new Error("QA_JIRA_NONPROD_SCOPE_REQUIRED");
  if (
    result.composition === "qa-jira-mattermost-nonprod" &&
    (result.environmentScope !== "NON_PROD" || result.externalNetworkMode !== "allowlisted")
  )
    throw new Error("QA_JIRA_MATTERMOST_NONPROD_SCOPE_REQUIRED");
  if (
    gitLabLocalCompositions.has(result.composition) &&
    (!local || result.externalNetworkMode !== "deny" || !result.mockHubUrl)
  ) {
    throw new Error("QA_JIRA_GITLAB_LOCAL_COMPOSITION_BARRIER_REQUIRED");
  }
  if (
    gitLabNonLocalCompositions.has(result.composition) &&
    (result.environmentScope !== "NON_PROD" || result.externalNetworkMode !== "allowlisted")
  ) {
    throw new Error("QA_JIRA_GITLAB_NONPROD_SCOPE_REQUIRED");
  }
  if (
    source.AWP_QUEUE_STATIC_CONTOUR === "true" &&
    (result.composition !== queueLocalComposition ||
      !local ||
      result.externalNetworkMode !== "deny" ||
      !result.mockHubUrl)
  ) {
    throw new Error("QUEUE_LOCAL_STATIC_CONTOUR_REQUIRED");
  }
  if (
    source.AWP_ONBOARDING_STATIC_CONTOUR === "true" &&
    (result.composition !== onboardingLocalCompositionKey ||
      !local ||
      result.externalNetworkMode !== "deny" ||
      !result.mockHubUrl ||
      source.AWP_EVIDENCE_SIGNER !== "local-ed25519")
  ) {
    throw new Error("ONBOARDING_LOCAL_STATIC_CONTOUR_REQUIRED");
  }
  const deployment = deploymentFromEnvironment(
    source,
    profile,
    environmentInput.scope,
    result.composition,
  );
  return Object.freeze({ ...result, ...(deployment ? { deployment } : {}) });
}

export interface JiraEffectBoundary {
  readonly environmentScope: RuntimeEnvironmentScope;
  readonly effects: "ALLOWED" | "DENIED";
  readonly credentialResolution: "ALLOWED" | "DENIED";
  readonly networkEgress: "ALLOWED" | "DENIED";
  readonly reasonCode: "JIRA_EFFECT_ENVIRONMENT_ALLOWED" | "JIRA_EFFECT_ENVIRONMENT_FORBIDDEN";
}

export function jiraEffectBoundary(
  environment: Pick<RuntimeEnvironment, "environmentScope">,
): JiraEffectBoundary {
  const allowed =
    environment.environmentScope === "LOCAL" || environment.environmentScope === "NON_PROD";
  return Object.freeze({
    environmentScope: environment.environmentScope,
    effects: allowed ? "ALLOWED" : "DENIED",
    credentialResolution: allowed ? "ALLOWED" : "DENIED",
    networkEgress: allowed ? "ALLOWED" : "DENIED",
    reasonCode: allowed ? "JIRA_EFFECT_ENVIRONMENT_ALLOWED" : "JIRA_EFFECT_ENVIRONMENT_FORBIDDEN",
  });
}

export function assertJiraEffectsAllowed(
  environment: Pick<RuntimeEnvironment, "environmentScope">,
): void {
  const boundary = jiraEffectBoundary(environment);
  if (boundary.effects !== "ALLOWED") throw new Error(boundary.reasonCode);
}

export interface MattermostEffectBoundary {
  readonly environmentScope: RuntimeEnvironmentScope;
  readonly effects: "ALLOWED" | "DENIED";
  readonly credentialResolution: "ALLOWED" | "DENIED";
  readonly networkEgress: "ALLOWED" | "DENIED";
  readonly reasonCode:
    "MATTERMOST_EFFECT_ENVIRONMENT_ALLOWED" | "MATTERMOST_EFFECT_ENVIRONMENT_FORBIDDEN";
}

export function mattermostEffectBoundary(
  environment: Pick<RuntimeEnvironment, "environmentScope">,
): MattermostEffectBoundary {
  const allowed =
    environment.environmentScope === "LOCAL" || environment.environmentScope === "NON_PROD";
  return Object.freeze({
    environmentScope: environment.environmentScope,
    effects: allowed ? "ALLOWED" : "DENIED",
    credentialResolution: allowed ? "ALLOWED" : "DENIED",
    networkEgress: allowed ? "ALLOWED" : "DENIED",
    reasonCode: allowed
      ? "MATTERMOST_EFFECT_ENVIRONMENT_ALLOWED"
      : "MATTERMOST_EFFECT_ENVIRONMENT_FORBIDDEN",
  });
}

export function assertMattermostEffectsAllowed(
  environment: Pick<RuntimeEnvironment, "environmentScope">,
): void {
  const boundary = mattermostEffectBoundary(environment);
  if (boundary.effects !== "ALLOWED") throw new Error(boundary.reasonCode);
}

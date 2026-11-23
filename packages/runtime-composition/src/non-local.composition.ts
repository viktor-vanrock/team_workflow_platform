import { nonLocalExtensionCandidates } from "./extensions/core-composition.ts";
import { coreOnlyMigrations } from "./migrations/core-composition.ts";
import { coreOnlyEntities } from "./persistence/core-entity-composition.ts";

export const nonLocalComposition = Object.freeze({
  extensionCandidates: nonLocalExtensionCandidates,
  entities: coreOnlyEntities,
  migrations: coreOnlyMigrations,
  localRoutes: Object.freeze([] as string[]),
  localProviders: Object.freeze([] as string[]),
});

const forbiddenNonLocalFragments = [
  "fake-idp",
  "mock-hub",
  "deterministic-fake",
  "local-only",
  "local-runtime-only",
  "local-secret",
];

export function assertNonLocalConfiguration(
  source: Readonly<Record<string, string | undefined>>,
): void {
  if (source.AWP_RUNTIME_PROFILE !== "non-local") throw new Error("NON_LOCAL_PROFILE_REQUIRED");
  if (source.AWP_EXTERNAL_NETWORK_MODE !== "allowlisted")
    throw new Error("NON_LOCAL_EGRESS_ALLOWLIST_REQUIRED");
  const values = Object.entries(source)
    .filter(([key, value]) => value !== undefined && !/^AWP_(?:REDIS|S3|OBJECT_STORE)/u.test(key))
    .map(([, value]) => value!.toLowerCase());
  if (
    values.some((value) => forbiddenNonLocalFragments.some((fragment) => value.includes(fragment)))
  )
    throw new Error("NON_LOCAL_LOCAL_COMPONENT_REFERENCE_FORBIDDEN");
  if (!source.AWP_IDENTITY_ISSUER?.startsWith("https://"))
    throw new Error("NON_LOCAL_HTTPS_ISSUER_REQUIRED");
  const allowlist =
    source.AWP_EXTERNAL_ENDPOINT_ALLOWLIST?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (allowlist.length === 0 || allowlist.some((entry) => !entry.startsWith("https://")))
    throw new Error("NON_LOCAL_ENDPOINT_ALLOWLIST_INVALID");
}

export function assertQaJiraMattermostNonProdConfiguration(
  source: Readonly<Record<string, string | undefined>>,
): void {
  assertNonLocalConfiguration(source);
  if (source.AWP_ENVIRONMENT !== "NON_PROD") throw new Error("MATTERMOST_NONPROD_SCOPE_REQUIRED");
  if (source.AWP_COMPOSITION !== "qa-jira-mattermost-nonprod")
    throw new Error("MATTERMOST_NONPROD_COMPOSITION_REQUIRED");
  const endpoints =
    source.AWP_EXTERNAL_ENDPOINT_ALLOWLIST?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  if (
    !endpoints.some(
      (entry) => /mattermost/iu.test(entry) || entry === source.AWP_MATTERMOST_BASE_URL,
    )
  )
    throw new Error("MATTERMOST_NONPROD_ENDPOINT_NOT_ALLOWLISTED");
  if (!source.AWP_MATTERMOST_BOT_SECRET_REF?.startsWith("secret-ref:"))
    throw new Error("MATTERMOST_NONPROD_SECRET_REF_REQUIRED");
}

const gitLabNonProductionCompositions = new Set([
  "qa-jira-gitlab-development",
  "qa-jira-gitlab-test",
  "qa-jira-gitlab-mattermost-development",
  "qa-jira-gitlab-mattermost-test",
]);

export function assertQaJiraGitLabNonProductionConfiguration(
  source: Readonly<Record<string, string | undefined>>,
): void {
  assertNonLocalConfiguration(source);
  if (source.AWP_ENVIRONMENT !== "NON_PROD") throw new Error("GITLAB_NONPROD_SCOPE_REQUIRED");
  if (!gitLabNonProductionCompositions.has(source.AWP_COMPOSITION ?? "")) {
    throw new Error("GITLAB_NONPROD_COMPOSITION_REQUIRED");
  }
  if (source.AWP_GITLAB_PRODUCTION_DENIED !== "true")
    throw new Error("GITLAB_PRODUCTION_DENIAL_REQUIRED");
  const baseUrl = source.AWP_GITLAB_BASE_URL;
  if (!baseUrl?.startsWith("https://")) throw new Error("GITLAB_NONPROD_HTTPS_ENDPOINT_REQUIRED");
  const endpoints =
    source.AWP_EXTERNAL_ENDPOINT_ALLOWLIST?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  if (!endpoints.includes(new URL(baseUrl).origin))
    throw new Error("GITLAB_NONPROD_ENDPOINT_NOT_ALLOWLISTED");
  const secretRefs = [
    source.AWP_GITLAB_READ_SECRET_REF,
    source.AWP_GITLAB_TRIGGER_SECRET_REF,
    source.AWP_GITLAB_WEBHOOK_SECRET_REF,
  ];
  if (
    secretRefs.some((reference) => !reference?.startsWith("secret-ref:")) ||
    new Set(secretRefs).size !== 3
  ) {
    throw new Error("GITLAB_NONPROD_SEPARATED_SECRET_REFS_REQUIRED");
  }
}

export * from "./artifacts/gitlab-ci-artifacts.ts";
export * from "./auth/gitlab-auth.ts";
export * from "./http/gitlab-rest-client.ts";
export * from "./manifest.ts";
export * from "./pipeline/gitlab-pipeline-reader.ts";
export * from "./pipeline/gitlab-pipeline-trigger.ts";
export * from "./pipeline/gitlab-result-normalizer.ts";
export * from "./profile/gitlab-dialect.ts";
export * from "./profile/gitlab-discovery.ts";
export * from "./profile/gitlab-profile-validator.ts";
export * from "./reconciliation/gitlab-rate-health.ts";
export * from "./reconciliation/gitlab-reconciliation.ts";
export * from "./reconciliation/gitlab-trigger-reconciliation.ts";
export * from "./source-context/gitlab-source-context.ts";
export * from "./webhooks/gitlab-webhook-normalizer.ts";

export const connectorGitLabPackage = Object.freeze({
  key: "gitlab.automated-validation",
  version: "1.0.0",
});

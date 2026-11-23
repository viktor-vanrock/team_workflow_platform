import { M4000GitLabDiscoveryProfiles1700000004000 } from "./4000-gitlab-discovery-profiles.ts";
import { M4010GitLabWebhookRateReconciliation1700000004010 } from "./4010-gitlab-webhook-rate-reconciliation.ts";
import { M4020GitLabEffectArtifactReconciliation1700000004020 } from "./4020-gitlab-effect-artifact-reconciliation.ts";

export const gitLabMigrationRegistry = Object.freeze([
  {
    order: 4000,
    owner: "connector:gitlab" as const,
    migration: M4000GitLabDiscoveryProfiles1700000004000,
  },
  {
    order: 4010,
    owner: "connector:gitlab" as const,
    migration: M4010GitLabWebhookRateReconciliation1700000004010,
  },
  {
    order: 4020,
    owner: "connector:gitlab" as const,
    migration: M4020GitLabEffectArtifactReconciliation1700000004020,
  },
]);

export const gitLabMigrations = Object.freeze(
  gitLabMigrationRegistry.map(({ migration }) => migration),
);

export {
  M4000GitLabDiscoveryProfiles1700000004000,
  M4010GitLabWebhookRateReconciliation1700000004010,
  M4020GitLabEffectArtifactReconciliation1700000004020,
};

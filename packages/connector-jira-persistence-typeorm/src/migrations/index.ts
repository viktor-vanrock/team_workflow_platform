import { M3000JiraDiscoveryProfiles1700000003000 } from "./3000-jira-discovery-profiles.ts";
import { M3010JiraWebhookRate1700000003010 } from "./3010-jira-webhook-rate.ts";
import { M3020JiraEffectReconciliation1700000003020 } from "./3020-jira-effect-reconciliation.ts";
import { M3030JiraAuthoritativeReadOutboxLease1700000003030 } from "./3030-jira-authoritative-read-outbox-lease.ts";
import { M3040JiraEffectLeaseOwner1700000003040 } from "./3040-jira-effect-lease-owner.ts";
import { M3050JiraInvocationMarker1700000003050 } from "./3050-jira-invocation-marker.ts";

export const jiraMigrationRegistry = Object.freeze([
  {
    order: 3000,
    owner: "connector:jira" as const,
    migration: M3000JiraDiscoveryProfiles1700000003000,
  },
  { order: 3010, owner: "connector:jira" as const, migration: M3010JiraWebhookRate1700000003010 },
  {
    order: 3020,
    owner: "connector:jira" as const,
    migration: M3020JiraEffectReconciliation1700000003020,
  },
  {
    order: 3030,
    owner: "connector:jira" as const,
    migration: M3030JiraAuthoritativeReadOutboxLease1700000003030,
  },
  {
    order: 3040,
    owner: "connector:jira" as const,
    migration: M3040JiraEffectLeaseOwner1700000003040,
  },
  {
    order: 3050,
    owner: "connector:jira" as const,
    migration: M3050JiraInvocationMarker1700000003050,
  },
]);
export const jiraMigrations = Object.freeze(
  jiraMigrationRegistry.map(({ migration }) => migration),
);
export { M3050JiraInvocationMarker1700000003050 };
export {
  M3000JiraDiscoveryProfiles1700000003000,
  M3010JiraWebhookRate1700000003010,
  M3020JiraEffectReconciliation1700000003020,
  M3030JiraAuthoritativeReadOutboxLease1700000003030,
  M3040JiraEffectLeaseOwner1700000003040,
};

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const queueDocumentedScenarioIds = Object.freeze([
  "setup-portfolio",
  "external-network-denied",
  "us1-candidate-has-no-operational-effects",
  "us1-confirmed-needs-info-backlog",
  "us1-dor-and-pending-jira-remain-backlog",
  "us1-confirmed-jira-ready-starts-clock",
  "us1-first-required-session-consumes-wip",
  "us1-completed-precedence",
  "us2-project-lanes-and-portfolio",
  "us2-comparator-tie-breakers",
  "us2-forbidden-project-interleaved",
  "us2-hidden-anchor-no-existence-signal",
  "us2-overlapping-order-views",
  "us2-order-invalidation-ref",
  "us2-portfolio-order-no-project-fanout",
  "us3-factorized-assessment",
  "us3-missing-business-impact",
  "us3-model-outage-fallback",
  "us3-assessment-drift-conflict",
  "us3-exact-lead-order-override",
  "us3-order-hidden-anchor-terminal-no-op",
  "us3-approval-v1-v2-compatibility",
  "us3-jira-priority-remains-separate",
  "us4-measure-only-observation",
  "us4-enforced-publication-requires-baseline",
  "us4-project-soft-limit-warning",
  "us4-automated-launch-reserves-review",
  "us4-running-automation-is-not-human-wip",
  "us4-terminal-result-converts-reservation",
  "us4-pre-review-cancel-releases-reservation",
  "us4-one-work-item-one-capacity-unit",
  "us4-concurrent-last-slot",
  "us4-concurrent-review-reservation",
  "us4-exact-wip-override",
  "us4-denial-without-override-intent",
  "us4-stale-or-self-approved-override-denied",
  "us4-concurrent-expedite-singleton",
  "us4-expedite-clear-and-expiry-lock",
  "us4-forced-external-overflow",
  "us4-blocked-release-and-resume",
  "us5-local-dor-does-not-start-sla",
  "us5-confirmed-ready-starts-at-confirmed-at",
  "us5-no-rollout-backdating",
  "us5-rollout-duplicate-read-receipt",
  "us5-business-calendar-golden-vectors",
  "us5-finite-calendar-policy-rejected",
  "us5-confirmed-pause-resume",
  "us5-unknown-pause-reason-keeps-running",
  "us5-policy-calendar-revision-pinning",
  "us5-measure-only-versus-enforced",
  "us5-notification-dedupe-and-outage",
  "us5-clock-revision-versus-evaluation-hash",
  "rebuild-duplicate-and-out-of-order-events",
  "rebuild-missed-event-and-gap",
  "rebuild-shadow-generation-cutover",
  "rebuild-worker-process-restart",
  "rebuild-no-duplicate-notification-or-effect",
] as const);

export type QueueDocumentedScenarioId = (typeof queueDocumentedScenarioIds)[number];

const queueDocumentedScenarioSet: ReadonlySet<string> = new Set(queueDocumentedScenarioIds);

export function validateQueueScenarioCatalog(
  ids: readonly string[] = queueDocumentedScenarioIds,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`QUEUE_SCENARIO_ID_DUPLICATE:${id}`);
    seen.add(id);
    if (!queueDocumentedScenarioSet.has(id)) throw new Error(`QUEUE_SCENARIO_ID_UNKNOWN:${id}`);
  }
  if (ids === queueDocumentedScenarioIds && seen.size !== 57) {
    throw new Error(`QUEUE_SCENARIO_CATALOG_CARDINALITY_INVALID:${seen.size}:57`);
  }
}

export function requireQueueScenarioId(value: string): QueueDocumentedScenarioId {
  if (!queueDocumentedScenarioSet.has(value)) throw new Error(`QUEUE_SCENARIO_ID_UNKNOWN:${value}`);
  return value as QueueDocumentedScenarioId;
}

function run(): void {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  validateQueueScenarioCatalog();
  if (args.length === 0 || args.includes("--check")) {
    console.log(
      `[queue-scenario-catalog] PASS ${queueDocumentedScenarioIds.length}/57 documented scenario IDs`,
    );
    return;
  }
  if (args.length === 1 && args[0] === "--list") {
    console.log(queueDocumentedScenarioIds.join("\n"));
    return;
  }
  if (args.length !== 1) throw new Error("QUEUE_SCENARIO_ARGUMENTS_INVALID");
  console.log(requireQueueScenarioId(args[0] ?? ""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();

import type { MattermostFault } from "../state/mattermost.repository.ts";

const supported = new Set<MattermostFault>([
  "NORMAL",
  "TIMEOUT_BEFORE_EFFECT",
  "TIMEOUT_AFTER_EFFECT",
  "AUTHENTICATION_401",
  "PERMISSION_403",
  "RATE_LIMIT_429",
  "SERVER_500",
  "NETWORK_LOSS",
  "LOOKUP_ZERO",
  "LOOKUP_MULTIPLE",
  "LOOKUP_UNSUPPORTED",
]);

export function parseMattermostFault(value: unknown): MattermostFault {
  if (typeof value !== "string" || !supported.has(value as MattermostFault)) {
    throw new Error("MATTERMOST_MOCK_FAULT_INVALID");
  }
  return value as MattermostFault;
}

export const mattermostScenarioCatalog = Object.freeze([...supported]);
export const mattermostIntakeScenarioCatalog = Object.freeze([
  "BOOTSTRAP_CREATE",
  "PROJECT_SELECTION_TWO_OPTIONS",
  "DRAFT_REVISION",
  "CONFIRM_ONCE",
  "CONFIRM_REPLAY",
  "CRASH_BEFORE_MARKER",
  "CRASH_AFTER_MARKER",
] as const);
export const mattermostCandidateScenarioCatalog = Object.freeze([
  "JIRA_CANDIDATE_TRIGGER",
  "JIRA_CANDIDATE_VERSION_UPDATE",
  "CANDIDATE_CREATE",
  "CANDIDATE_SNOOZE",
  "CANDIDATE_IGNORE",
] as const);
export const mattermostNotificationScenarioCatalog = Object.freeze([
  "OUTAGE_401",
  "OUTAGE_403",
  "OUTAGE_429",
  "OUTAGE_500",
  "TIMEOUT_BEFORE_EFFECT",
  "TIMEOUT_AFTER_EFFECT",
  "NETWORK_LOSS_AFTER_MARKER",
  "LOOKUP_ZERO",
  "LOOKUP_ONE",
  "LOOKUP_MULTIPLE",
  "LOOKUP_UNSUPPORTED",
  "WORKER_RESTART",
] as const);

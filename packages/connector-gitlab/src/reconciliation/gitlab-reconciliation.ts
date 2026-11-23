export interface GitLabMonotonicObservation {
  readonly observationHash: `sha256:${string}`;
  readonly providerRevisionToken: string;
  readonly providerUpdatedAt: string;
  readonly providerStatus: string;
}

export class GitLabReconciliationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabReconciliationError";
  }
}

export function reduceGitLabPipelineObservation<T extends GitLabMonotonicObservation>(
  input: Readonly<{
    current: T | undefined;
    candidate: T;
  }>,
): Readonly<{
  advanced: boolean;
  reason: "INITIAL" | "NEWER" | "DUPLICATE" | "OUT_OF_ORDER";
  effective: T;
}> {
  const candidateTime = Date.parse(input.candidate.providerUpdatedAt);
  if (!Number.isFinite(candidateTime))
    throw new GitLabReconciliationError("GITLAB_OBSERVATION_PROVIDER_TIME_INVALID");
  if (input.current === undefined)
    return Object.freeze({ advanced: true, reason: "INITIAL", effective: input.candidate });
  const currentTime = Date.parse(input.current.providerUpdatedAt);
  if (!Number.isFinite(currentTime))
    throw new GitLabReconciliationError("GITLAB_OBSERVATION_HEAD_TIME_INVALID");
  if (input.candidate.observationHash === input.current.observationHash)
    return Object.freeze({ advanced: false, reason: "DUPLICATE", effective: input.current });
  if (candidateTime < currentTime)
    return Object.freeze({ advanced: false, reason: "OUT_OF_ORDER", effective: input.current });
  if (candidateTime === currentTime)
    throw new GitLabReconciliationError("GITLAB_OBSERVATION_SAME_TIME_CONFLICT");
  return Object.freeze({ advanced: true, reason: "NEWER", effective: input.candidate });
}

export interface GitLabReconciliationReadPlanInput {
  readonly now: string;
  readonly attemptActive: boolean;
  readonly webhookHintReceivedAt?: string;
  readonly lastAuthoritativeReadAt?: string;
  readonly pollCount: number;
  readonly policy: Readonly<{
    webhookGraceSeconds: number;
    pollIntervalSeconds: number;
    freshnessTargetSeconds: number;
    maximumRepairPolls: number;
  }>;
}

export type GitLabReconciliationReadPlan =
  | Readonly<{ action: "IDLE"; webhookCanonical: false }>
  | Readonly<{ action: "WAIT"; nextEligibleAt: string; webhookCanonical: false }>
  | Readonly<{
      action: "PIPELINE_READ";
      source: "WEBHOOK_HINT" | "POLL_REPAIR";
      nextPollCount: number;
      webhookCanonical: false;
    }>
  | Readonly<{
      action: "EXHAUSTED";
      reasonCode: "REPAIR_POLL_BUDGET_EXHAUSTED";
      webhookCanonical: false;
    }>;

function instant(value: string | undefined, code: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GitLabReconciliationError(code);
  return parsed;
}

export function planGitLabReconciliationRead(
  input: GitLabReconciliationReadPlanInput,
): GitLabReconciliationReadPlan {
  const now = instant(input.now, "GITLAB_RECONCILIATION_NOW_INVALID")!;
  if (!input.attemptActive) return Object.freeze({ action: "IDLE", webhookCanonical: false });
  if (!Number.isSafeInteger(input.pollCount) || input.pollCount < 0)
    throw new GitLabReconciliationError("GITLAB_RECONCILIATION_POLL_COUNT_INVALID");
  const lastRead = instant(
    input.lastAuthoritativeReadAt,
    "GITLAB_RECONCILIATION_LAST_READ_INVALID",
  );
  const hint = instant(input.webhookHintReceivedAt, "GITLAB_RECONCILIATION_WEBHOOK_HINT_INVALID");
  if (hint !== undefined && (lastRead === undefined || hint > lastRead)) {
    return Object.freeze({
      action: "PIPELINE_READ",
      source: "WEBHOOK_HINT",
      nextPollCount: input.pollCount,
      webhookCanonical: false,
    });
  }
  const dueAt =
    (lastRead ?? now - input.policy.webhookGraceSeconds * 1_000) +
    input.policy.pollIntervalSeconds * 1_000;
  if (now < dueAt)
    return Object.freeze({
      action: "WAIT",
      nextEligibleAt: new Date(dueAt).toISOString(),
      webhookCanonical: false,
    });
  if (input.pollCount >= input.policy.maximumRepairPolls)
    return Object.freeze({
      action: "EXHAUSTED",
      reasonCode: "REPAIR_POLL_BUDGET_EXHAUSTED",
      webhookCanonical: false,
    });
  return Object.freeze({
    action: "PIPELINE_READ",
    source: "POLL_REPAIR",
    nextPollCount: input.pollCount + 1,
    webhookCanonical: false,
  });
}

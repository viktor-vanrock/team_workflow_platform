import { createHash } from "node:crypto";

export const gitLabAutomationMetricNamespace = "awp.gitlab.automation";

export const gitLabAutomationPhases = Object.freeze([
  "LAUNCH",
  "TRIGGER",
  "RESULT",
  "DEDUPE",
  "AMBIGUITY",
  "QUEUE",
  "RETRY",
  "FLAKY",
  "WEBHOOK",
  "RECONCILIATION",
  "ARTIFACT",
  "POLICY_DENIAL",
] as const);
export type GitLabAutomationPhase = (typeof gitLabAutomationPhases)[number];

export const gitLabAutomationOutcomes = Object.freeze([
  "ACCEPTED",
  "REPLAYED",
  "CONFIRMED",
  "COMPLETED",
  "DUPLICATE",
  "ZERO_FOUND",
  "MULTIPLE_FOUND",
  "ENQUEUED",
  "DEQUEUED",
  "SCHEDULED",
  "DENIED",
  "SUSPECTED",
  "VERIFIED",
  "RECONCILED",
  "AVAILABLE",
  "EXPIRED",
  "FAILED",
] as const);
export type GitLabAutomationOutcome = (typeof gitLabAutomationOutcomes)[number];

export const gitLabAutomationReasonCodes = Object.freeze([
  "NONE",
  "AUTH_REVOKED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "POLICY_DENIED",
  "SCOPE_DENIED",
  "DUPLICATE_DELIVERY",
  "LOOKUP_ZERO",
  "LOOKUP_MULTIPLE",
  "INFRA_RETRY",
  "FLAKY_SUSPECTED",
  "CHECKSUM_MISMATCH",
  "UNCLASSIFIED",
] as const);
export type GitLabAutomationReasonCode = (typeof gitLabAutomationReasonCodes)[number];

export const gitLabAutomationSloNames = Object.freeze([
  "LAUNCH_ACKNOWLEDGEMENT",
  "WEBHOOK_VISIBILITY",
  "LOST_WEBHOOK_REPAIR",
  "TERMINAL_TO_ARTIFACT",
] as const);
export type GitLabAutomationSloName = (typeof gitLabAutomationSloNames)[number];

export const gitLabAutomationSafetyCounters = Object.freeze([
  "DUPLICATE_EFFECT",
  "BLIND_RETRIGGER",
  "AUTOMATED_VERDICT",
  "PRODUCTION_CALL",
] as const);
export type GitLabAutomationSafetyCounter = (typeof gitLabAutomationSafetyCounters)[number];

export interface GitLabAutomationMetricLabels {
  readonly phase: GitLabAutomationPhase;
  readonly outcome: GitLabAutomationOutcome;
  readonly reasonCode: GitLabAutomationReasonCode;
  readonly correlationLinked: "PRESENT" | "ABSENT";
}

export interface GitLabAutomationMetricEvent {
  readonly name: `${typeof gitLabAutomationMetricNamespace}.${"events" | "duration"}`;
  readonly kind: "COUNTER" | "HISTOGRAM";
  readonly value: number;
  readonly labels: GitLabAutomationMetricLabels;
  readonly correlationRef?: `sha256:${string}`;
}

export interface GitLabAutomationTraceEvent {
  readonly name: `gitlab.automation.${Lowercase<GitLabAutomationPhase>}`;
  readonly observedAt: string;
  readonly outcome: GitLabAutomationOutcome;
  readonly reasonCode: GitLabAutomationReasonCode;
  readonly correlationRef?: `sha256:${string}`;
  readonly causationRef?: `sha256:${string}`;
}

export interface GitLabAutomationSloResult {
  readonly name: GitLabAutomationSloName;
  readonly targetMs: number;
  readonly samples: number;
  readonly p95Ms: number;
  readonly maximumPolls?: number;
  readonly observedMaximumPolls?: number;
  readonly status: "PASS" | "FAIL";
}

const reasonCodes = new Set<string>(gitLabAutomationReasonCodes);
const sloTargets: Readonly<
  Record<GitLabAutomationSloName, Readonly<{ targetMs: number; maximumPolls?: number }>>
> = Object.freeze({
  LAUNCH_ACKNOWLEDGEMENT: Object.freeze({ targetMs: 2_000 }),
  WEBHOOK_VISIBILITY: Object.freeze({ targetMs: 30_000 }),
  LOST_WEBHOOK_REPAIR: Object.freeze({ targetMs: 120_000, maximumPolls: 2 }),
  TERMINAL_TO_ARTIFACT: Object.freeze({ targetMs: 120_000 }),
});
const forbiddenTelemetry =
  /authorization|bearer\s+|cookie|password|private[_-]?token|secret(?:ref)?:|webhook[_-]?(?:body|signature)|artifact[_-]?(?:bytes|content)|request[_-]?key|commit[_-]?sha|[\r\n]/iu;

function hashLink(value: string | undefined): `sha256:${string}` | undefined {
  return value === undefined || value.length === 0
    ? undefined
    : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function reason(value: string | undefined): GitLabAutomationReasonCode {
  return value !== undefined && reasonCodes.has(value)
    ? (value as GitLabAutomationReasonCode)
    : value === undefined
      ? "NONE"
      : "UNCLASSIFIED";
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

export function redactGitLabAutomationText(value: string): string {
  return forbiddenTelemetry.test(value) ? "redacted.event" : value.slice(0, 160);
}

export class GitLabAutomationObservability {
  readonly #metrics: GitLabAutomationMetricEvent[] = [];
  readonly #traces: GitLabAutomationTraceEvent[] = [];
  readonly #sloSamples = new Map<
    GitLabAutomationSloName,
    Array<Readonly<{ durationMs: number; polls?: number }>>
  >();
  readonly #safety = new Map<GitLabAutomationSafetyCounter, number>(
    gitLabAutomationSafetyCounters.map((name) => [name, 0]),
  );

  constructor(
    private readonly clock: Readonly<{ now(): Date }> = Object.freeze({ now: () => new Date() }),
  ) {}

  now(): Date {
    return this.clock.now();
  }

  record(
    input: Readonly<{
      phase: GitLabAutomationPhase;
      outcome: GitLabAutomationOutcome;
      reasonCode?: string;
      durationMs?: number;
      correlationId?: string;
      causationId?: string;
    }>,
  ): void {
    const correlationRef = hashLink(input.correlationId);
    const causationRef = hashLink(input.causationId);
    const labels = Object.freeze({
      phase: input.phase,
      outcome: input.outcome,
      reasonCode: reason(input.reasonCode),
      correlationLinked: correlationRef === undefined ? "ABSENT" : "PRESENT",
    });
    this.#metrics.push(
      Object.freeze({
        name: `${gitLabAutomationMetricNamespace}.events`,
        kind: "COUNTER",
        value: 1,
        labels,
        ...(correlationRef === undefined ? {} : { correlationRef }),
      }),
    );
    if (input.durationMs !== undefined) {
      if (!Number.isFinite(input.durationMs) || input.durationMs < 0)
        throw new Error("GITLAB_OBSERVABILITY_DURATION_INVALID");
      this.#metrics.push(
        Object.freeze({
          name: `${gitLabAutomationMetricNamespace}.duration`,
          kind: "HISTOGRAM",
          value: input.durationMs,
          labels,
          ...(correlationRef === undefined ? {} : { correlationRef }),
        }),
      );
    }
    this.#traces.push(
      Object.freeze({
        name: `gitlab.automation.${input.phase.toLowerCase()}` as GitLabAutomationTraceEvent["name"],
        observedAt: this.clock.now().toISOString(),
        outcome: input.outcome,
        reasonCode: labels.reasonCode,
        ...(correlationRef === undefined ? {} : { correlationRef }),
        ...(causationRef === undefined ? {} : { causationRef }),
      }),
    );
  }

  observeSlo(name: GitLabAutomationSloName, durationMs: number, polls?: number): void {
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      (polls !== undefined && (!Number.isSafeInteger(polls) || polls < 0))
    )
      throw new Error("GITLAB_OBSERVABILITY_SLO_SAMPLE_INVALID");
    const samples = this.#sloSamples.get(name) ?? [];
    samples.push(Object.freeze({ durationMs, ...(polls === undefined ? {} : { polls }) }));
    this.#sloSamples.set(name, samples);
  }

  incrementSafetyViolation(name: GitLabAutomationSafetyCounter, amount = 1): void {
    if (!Number.isSafeInteger(amount) || amount < 1)
      throw new Error("GITLAB_OBSERVABILITY_SAFETY_AMOUNT_INVALID");
    this.#safety.set(name, (this.#safety.get(name) ?? 0) + amount);
  }

  snapshot(): Readonly<{
    metricNamespace: typeof gitLabAutomationMetricNamespace;
    metrics: readonly GitLabAutomationMetricEvent[];
    traces: readonly GitLabAutomationTraceEvent[];
    phaseCoverage: readonly GitLabAutomationPhase[];
    slos: readonly GitLabAutomationSloResult[];
    safetyCounters: Readonly<Record<GitLabAutomationSafetyCounter, number>>;
    status: "PASS" | "FAIL";
  }> {
    const slos = gitLabAutomationSloNames.map((name): GitLabAutomationSloResult => {
      const samples = this.#sloSamples.get(name) ?? [];
      const target = sloTargets[name];
      const p95Ms = percentile95(samples.map(({ durationMs }) => durationMs));
      const observedMaximumPolls = samples.reduce<number | undefined>(
        (maximum, sample) =>
          sample.polls === undefined ? maximum : Math.max(maximum ?? 0, sample.polls),
        undefined,
      );
      const status =
        samples.length > 0 &&
        p95Ms <= target.targetMs &&
        (target.maximumPolls === undefined || (observedMaximumPolls ?? 0) <= target.maximumPolls)
          ? "PASS"
          : "FAIL";
      return Object.freeze({
        name,
        targetMs: target.targetMs,
        samples: samples.length,
        p95Ms,
        ...(target.maximumPolls === undefined
          ? {}
          : { maximumPolls: target.maximumPolls, observedMaximumPolls: observedMaximumPolls ?? 0 }),
        status,
      });
    });
    const safetyCounters = Object.freeze(
      Object.fromEntries(
        gitLabAutomationSafetyCounters.map((name) => [name, this.#safety.get(name) ?? 0]),
      ) as unknown as Record<GitLabAutomationSafetyCounter, number>,
    );
    const phaseCoverage = Object.freeze(
      [
        ...new Set(this.#metrics.map(({ labels }) => labels.phase)),
      ].sort() as GitLabAutomationPhase[],
    );
    const serialized = JSON.stringify({ metrics: this.#metrics, traces: this.#traces });
    const safe =
      !forbiddenTelemetry.test(serialized) &&
      this.#metrics.every(({ labels }) =>
        Object.keys(labels).every((key) =>
          ["phase", "outcome", "reasonCode", "correlationLinked"].includes(key),
        ),
      );
    const status =
      safe &&
      slos.every((slo) => slo.status === "PASS") &&
      Object.values(safetyCounters).every((value) => value === 0)
        ? "PASS"
        : "FAIL";
    return Object.freeze({
      metricNamespace: gitLabAutomationMetricNamespace,
      metrics: Object.freeze([...this.#metrics]),
      traces: Object.freeze([...this.#traces]),
      phaseCoverage,
      slos: Object.freeze(slos),
      safetyCounters,
      status,
    });
  }
}

export function recordGitLabAutomationPhase(
  observability: GitLabAutomationObservability | undefined,
  input: Parameters<GitLabAutomationObservability["record"]>[0],
): void {
  observability?.record(input);
}

export function populateDeterministicGitLabObservability(
  recorder: GitLabAutomationObservability,
): void {
  const coverage: readonly Readonly<{
    phase: GitLabAutomationPhase;
    outcome: GitLabAutomationOutcome;
    reasonCode?: GitLabAutomationReasonCode;
  }>[] = [
    { phase: "LAUNCH", outcome: "ACCEPTED" },
    { phase: "TRIGGER", outcome: "CONFIRMED" },
    { phase: "RESULT", outcome: "COMPLETED" },
    { phase: "DEDUPE", outcome: "DUPLICATE", reasonCode: "DUPLICATE_DELIVERY" },
    { phase: "AMBIGUITY", outcome: "ZERO_FOUND", reasonCode: "LOOKUP_ZERO" },
    { phase: "AMBIGUITY", outcome: "MULTIPLE_FOUND", reasonCode: "LOOKUP_MULTIPLE" },
    { phase: "QUEUE", outcome: "ENQUEUED" },
    { phase: "RETRY", outcome: "SCHEDULED", reasonCode: "INFRA_RETRY" },
    { phase: "FLAKY", outcome: "SUSPECTED", reasonCode: "FLAKY_SUSPECTED" },
    { phase: "WEBHOOK", outcome: "VERIFIED" },
    { phase: "RECONCILIATION", outcome: "RECONCILED" },
    { phase: "ARTIFACT", outcome: "AVAILABLE" },
    { phase: "POLICY_DENIAL", outcome: "DENIED", reasonCode: "POLICY_DENIED" },
  ];
  for (const item of coverage)
    recorder.record({ ...item, correlationId: "correlation-005", causationId: "causation-005" });
  for (const duration of [750, 900, 1_100, 1_250, 1_500])
    recorder.observeSlo("LAUNCH_ACKNOWLEDGEMENT", duration);
  for (const duration of [4_000, 8_000, 12_000, 18_000, 25_000])
    recorder.observeSlo("WEBHOOK_VISIBILITY", duration);
  for (const duration of [30_000, 45_000, 60_000, 90_000, 110_000])
    recorder.observeSlo("LOST_WEBHOOK_REPAIR", duration, 2);
  for (const duration of [10_000, 30_000, 55_000, 80_000, 115_000])
    recorder.observeSlo("TERMINAL_TO_ARTIFACT", duration);
}

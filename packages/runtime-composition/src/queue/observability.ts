import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface QueueRoutingCandidate {
  readonly projectId: string;
  readonly workItemId: string;
  readonly requiredCapabilities: readonly string[];
  readonly available: boolean;
  readonly claimedByPrincipalId?: string;
}

export interface QueueRoutingHint extends Readonly<Record<string, JsonValue>> {
  readonly projectId: string;
  readonly workItemId: string;
  readonly capabilityMatch: "EXACT" | "NO_REQUIREMENT";
  readonly availability: "AVAILABLE";
  readonly hintHash: `sha256:${string}`;
}

/** Authorization is applied before capability and availability; claims are deliberately not authority or assignment. */
export function buildQueueRoutingHints(
  input: Readonly<{
    authorizedProjectIds: readonly string[];
    principalCapabilities: readonly string[];
    candidates: readonly QueueRoutingCandidate[];
  }>,
): readonly QueueRoutingHint[] {
  const authorized = new Set(input.authorizedProjectIds);
  const capabilities = new Set(input.principalCapabilities);
  const seen = new Set<string>();
  return Object.freeze(
    input.candidates
      .filter(({ projectId }) => authorized.has(projectId))
      .filter(({ requiredCapabilities }) =>
        requiredCapabilities.every((capability) => capabilities.has(capability)),
      )
      .filter(({ available }) => available)
      .sort((left, right) =>
        `${left.projectId}:${left.workItemId}`.localeCompare(
          `${right.projectId}:${right.workItemId}`,
        ),
      )
      .map(({ projectId, workItemId, requiredCapabilities }) => {
        const key = `${projectId}\u0000${workItemId}`;
        if (seen.has(key)) throw new Error("QUEUE_ROUTING_DUPLICATE_CANDIDATE");
        seen.add(key);
        const body = Object.freeze({
          projectId,
          workItemId,
          capabilityMatch:
            requiredCapabilities.length === 0 ? ("NO_REQUIREMENT" as const) : ("EXACT" as const),
          availability: "AVAILABLE" as const,
        });
        return Object.freeze({ ...body, hintHash: sha256(body as unknown as JsonValue) });
      }),
  );
}

type CapacityMetricLabels = Readonly<{
  policyMode: "MEASURE_ONLY" | "ENFORCED";
  activityKind: "MANUAL" | "AUTOMATED" | "EXTERNAL" | "EXPEDITE";
  outcome: "ADMITTED" | "DENIED" | "OVERRIDE" | "OVERFLOW" | "NO_CHANGE";
}>;

/** In-memory sink adapter with a fixed low-cardinality label vocabulary. */
export class BoundedCapacityTelemetry {
  readonly #counts = new Map<string, number>();
  record(labels: CapacityMetricLabels): void {
    const key = `${labels.policyMode}|${labels.activityKind}|${labels.outcome}`;
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }
  snapshot(): Readonly<Record<string, number>> {
    return Object.freeze(
      Object.fromEntries([...this.#counts].sort(([left], [right]) => left.localeCompare(right))),
    );
  }
}

export const queueTelemetryVocabulary = Object.freeze({
  names: Object.freeze([
    "queue_operation_total",
    "queue_operation_duration_ms",
    "queue_projection_lag_seconds",
  ] as const),
  subsystems: Object.freeze(["QUEUE", "CAPACITY", "SLA", "REBUILD"] as const),
  operations: Object.freeze([
    "READ",
    "PROJECT",
    "ADMIT",
    "TRANSITION",
    "NOTIFY",
    "CATCH_UP",
    "VALIDATE",
    "ACTIVATE",
  ] as const),
  outcomes: Object.freeze(["SUCCESS", "NO_CHANGE", "DENIED", "STALE", "ERROR"] as const),
});

type QueueTelemetryName = (typeof queueTelemetryVocabulary.names)[number];
type QueueTelemetrySubsystem = (typeof queueTelemetryVocabulary.subsystems)[number];
type QueueTelemetryOperation = (typeof queueTelemetryVocabulary.operations)[number];
type QueueTelemetryOutcome = (typeof queueTelemetryVocabulary.outcomes)[number];

export interface QueueTelemetryObservation {
  readonly name: QueueTelemetryName;
  readonly labels: Readonly<{
    readonly subsystem: QueueTelemetrySubsystem;
    readonly operation: QueueTelemetryOperation;
    readonly outcome: QueueTelemetryOutcome;
  }>;
  readonly value?: number;
  readonly correlationRef: string;
  readonly auditRef?: string;
}

/**
 * Queue telemetry deliberately exposes only enumerated labels. Correlation and audit
 * references are bounded exemplars, never metric labels, so subject cardinality cannot
 * leak through a monitoring backend.
 */
export class BoundedQueueTelemetry {
  readonly #series = new Map<string, { count: number; sum: number }>();
  readonly #exemplars: Array<Readonly<{ correlationRef: string; auditRef?: string }>> = [];

  record(observation: QueueTelemetryObservation): void {
    if (
      !queueTelemetryVocabulary.names.includes(observation.name) ||
      !queueTelemetryVocabulary.subsystems.includes(observation.labels.subsystem) ||
      !queueTelemetryVocabulary.operations.includes(observation.labels.operation) ||
      !queueTelemetryVocabulary.outcomes.includes(observation.labels.outcome) ||
      !observation.correlationRef ||
      (observation.value !== undefined &&
        (!Number.isFinite(observation.value) || observation.value < 0))
    ) {
      throw new Error("QUEUE_TELEMETRY_OBSERVATION_INVALID");
    }
    const key = `${observation.name}|${observation.labels.subsystem}|${observation.labels.operation}|${observation.labels.outcome}`;
    const current = this.#series.get(key) ?? { count: 0, sum: 0 };
    this.#series.set(key, {
      count: current.count + 1,
      sum: current.sum + (observation.value ?? 1),
    });
    if (this.#exemplars.length < 64)
      this.#exemplars.push(
        Object.freeze({
          correlationRef: observation.correlationRef,
          ...(observation.auditRef ? { auditRef: observation.auditRef } : {}),
        }),
      );
  }

  snapshot(): Readonly<{
    series: Readonly<Record<string, Readonly<{ count: number; sum: number }>>>;
    exemplars: readonly Readonly<{ correlationRef: string; auditRef?: string }>[];
    maximumSeries: number;
  }> {
    const maximumSeries =
      queueTelemetryVocabulary.names.length *
      queueTelemetryVocabulary.subsystems.length *
      queueTelemetryVocabulary.operations.length *
      queueTelemetryVocabulary.outcomes.length;
    return Object.freeze({
      series: Object.freeze(
        Object.fromEntries(
          [...this.#series]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, Object.freeze({ ...value })]),
        ),
      ),
      exemplars: Object.freeze([...this.#exemplars]),
      maximumSeries,
    });
  }
}

import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export const PILOT_METRIC_FACT_VERSION = "1.0.0" as const;

export const pilotMetricKeys = Object.freeze([
  "INTAKE_CONFIRMATION_MS",
  "TRIAGE_MS",
  "FIRST_SESSION_START_MS",
  "QA_REQUEST_FLOW_MS",
  "BLOCKED_SHARE",
  "REWORK_RATE",
  "AUTOMATION_SHARE",
  "ASSERTION_RATE",
  "INFRA_RATE",
  "TIMEOUT_RATE",
  "FLAKY_SUSPECTED_RATE",
  "DEFECT_COUNT",
  "FINDING_REJECTION_RATE",
  "OPERATOR_TOIL_MS",
  "MANUAL_RECONCILIATION_COUNT",
  "CONNECTOR_AVAILABILITY",
  "CONNECTOR_LATENCY_MS",
  "CORE_SLA_ATTAINMENT",
] as const);
export type PilotMetricKey = (typeof pilotMetricKeys)[number];

export interface PilotMetricSourceRef {
  readonly id: string;
  readonly version: string | number;
  readonly contentHash: Sha256Digest;
}

export interface PilotMetricFact {
  readonly schemaVersion: typeof PILOT_METRIC_FACT_VERSION;
  readonly factId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly protocolHash: Sha256Digest;
  readonly metricKey: PilotMetricKey;
  readonly owner: "CORE" | "QA" | "CONNECTOR";
  readonly sourceSemantics: "CORE_006_SLA" | "QA_OBSERVATION" | "CONNECTOR_OBSERVATION";
  readonly sampleId: string;
  readonly value: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly disposition: "INCLUDED" | "EXCLUDED" | "CENSORED";
  readonly reason: string | null;
  readonly observedAt: string;
  readonly sourceRef: PilotMetricSourceRef;
  readonly contentHash: Sha256Digest;
}

export interface PilotMetricAggregate {
  readonly metricKey: PilotMetricKey;
  readonly value: number | null;
  readonly numerator: number | null;
  readonly denominator: number;
  readonly includedCount: number;
  readonly excludedCount: number;
  readonly censoredCount: number;
  readonly missingCount: number;
  readonly sourceFactHashes: readonly Sha256Digest[];
}

function validHash(value: string): value is Sha256Digest {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function createPilotMetricFact(
  input: Omit<PilotMetricFact, "schemaVersion" | "contentHash">,
): PilotMetricFact {
  if (
    !input.factId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.sampleId ||
    !pilotMetricKeys.includes(input.metricKey) ||
    !validHash(input.protocolHash) ||
    !input.sourceRef.id ||
    !validHash(input.sourceRef.contentHash) ||
    Number.isNaN(Date.parse(input.observedAt))
  )
    throw new Error("PILOT_METRIC_FACT_INVALID");
  if (
    input.sourceSemantics === "CORE_006_SLA" &&
    (input.owner !== "CORE" || input.metricKey !== "CORE_SLA_ATTAINMENT")
  ) {
    throw new Error("PILOT_SLA_SOURCE_OWNERSHIP_INVALID");
  }
  if (input.disposition === "INCLUDED" && input.reason !== null)
    throw new Error("PILOT_METRIC_INCLUDED_REASON_INVALID");
  if (input.disposition !== "INCLUDED" && !input.reason?.trim())
    throw new Error("PILOT_METRIC_EXCLUSION_REASON_REQUIRED");
  if (input.value !== null && !Number.isFinite(input.value))
    throw new Error("PILOT_METRIC_VALUE_INVALID");
  if (
    (input.numerator === null) !== (input.denominator === null) ||
    (input.numerator !== null &&
      (!Number.isFinite(input.numerator) ||
        !Number.isFinite(input.denominator!) ||
        input.denominator! <= 0))
  ) {
    throw new Error("PILOT_METRIC_DENOMINATOR_INVALID");
  }
  const body = Object.freeze({
    ...structuredClone(input),
    schemaVersion: PILOT_METRIC_FACT_VERSION,
  });
  return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
}

export function aggregatePilotMetricFacts(
  metricKey: PilotMetricKey,
  facts: readonly PilotMetricFact[],
): PilotMetricAggregate {
  const selected = [...facts].filter((fact) => fact.metricKey === metricKey);
  if (new Set(selected.map((fact) => fact.factId)).size !== selected.length)
    throw new Error("PILOT_METRIC_FACT_DUPLICATE");
  const protocol = new Set(selected.map((fact) => fact.protocolHash));
  if (protocol.size > 1) throw new Error("PILOT_METRIC_PROTOCOL_MISMATCH");
  const included = selected.filter((fact) => fact.disposition === "INCLUDED");
  const known = included.filter((fact) => fact.value !== null);
  const ratioFacts = included.filter(
    (fact) => fact.numerator !== null && fact.denominator !== null,
  );
  if (ratioFacts.length > 0 && ratioFacts.length !== known.length)
    throw new Error("PILOT_METRIC_AGGREGATION_MIXED");
  const denominator =
    ratioFacts.length > 0
      ? ratioFacts.reduce((total, fact) => total + fact.denominator!, 0)
      : known.length;
  const numerator =
    ratioFacts.length > 0 ? ratioFacts.reduce((total, fact) => total + fact.numerator!, 0) : null;
  const value =
    denominator === 0
      ? null
      : numerator === null
        ? known.reduce((total, fact) => total + fact.value!, 0) / denominator
        : numerator / denominator;
  return Object.freeze({
    metricKey,
    value,
    numerator,
    denominator,
    includedCount: included.length,
    excludedCount: selected.filter((fact) => fact.disposition === "EXCLUDED").length,
    censoredCount: selected.filter((fact) => fact.disposition === "CENSORED").length,
    missingCount: included.filter((fact) => fact.value === null).length,
    sourceFactHashes: Object.freeze(selected.map((fact) => fact.contentHash).sort()),
  });
}

export interface QaPilotObservation {
  readonly factId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly protocolHash: Sha256Digest;
  readonly metricKey: Extract<
    PilotMetricKey,
    | "REWORK_RATE"
    | "AUTOMATION_SHARE"
    | "ASSERTION_RATE"
    | "INFRA_RATE"
    | "TIMEOUT_RATE"
    | "FLAKY_SUSPECTED_RATE"
  >;
  readonly sampleId: string;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly disposition: PilotMetricFact["disposition"];
  readonly reason: string | null;
  readonly observedAt: string;
  readonly sourceRef: PilotMetricSourceRef;
}

export const qaPilotMetricContribution = Object.freeze({
  key: "qa.pilot-metrics",
  version: PILOT_METRIC_FACT_VERSION,
  facts(observations: readonly QaPilotObservation[]): readonly PilotMetricFact[] {
    return Object.freeze(
      observations.map((observation) =>
        createPilotMetricFact({
          ...observation,
          owner: "QA",
          sourceSemantics: "QA_OBSERVATION",
          value:
            observation.numerator === null || observation.denominator === null
              ? null
              : observation.numerator / observation.denominator,
        }),
      ),
    );
  },
});

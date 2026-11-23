import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export const pilotGuardrailKeys = Object.freeze([
  "CROSS_SCOPE_DISCLOSURES",
  "UNAUTHORIZED_EXTERNAL_WRITES",
  "DUPLICATE_EXTERNAL_EFFECTS",
  "AUDITED_CORRELATED_WRITE_COVERAGE",
  "VERDICT_EVIDENCE_CHAIN_COVERAGE",
  "AGENT_WITHOUT_HUMAN_ACTIONS",
  "SECRET_CANARY_OCCURRENCES",
] as const);
export type PilotGuardrailKey = (typeof pilotGuardrailKeys)[number];

export interface PilotGuardrailObservation {
  readonly key: PilotGuardrailKey;
  readonly value: number | null;
  readonly sourceHash: Sha256Digest | null;
  readonly independentlyObserved: boolean;
  readonly observedAt: string;
}

export interface PilotGuardrailEvaluation {
  readonly state: "PASS" | "BREACH" | "UNKNOWN";
  readonly observations: readonly PilotGuardrailObservation[];
  readonly incidentRef: string | null;
  readonly contentHash: Sha256Digest;
}

export interface PilotGuardrailIncidentPort {
  suspendAndFence(
    input: Readonly<{
      incidentRef: string;
      breached: readonly PilotGuardrailKey[];
      observedAt: string;
    }>,
  ): Promise<void>;
}

function passes(observation: PilotGuardrailObservation): boolean {
  if (observation.value === null || !observation.independentlyObserved || !observation.sourceHash)
    return false;
  return observation.key === "AUDITED_CORRELATED_WRITE_COVERAGE" ||
    observation.key === "VERDICT_EVIDENCE_CHAIN_COVERAGE"
    ? observation.value === 1
    : observation.value === 0;
}

export class PilotGuardrailService {
  constructor(private readonly incidents: PilotGuardrailIncidentPort) {}

  async evaluate(
    observations: readonly PilotGuardrailObservation[],
    incidentRef: string,
    observedAt: string,
  ): Promise<PilotGuardrailEvaluation> {
    if (
      observations.length !== pilotGuardrailKeys.length ||
      new Set(observations.map((value) => value.key)).size !== pilotGuardrailKeys.length ||
      pilotGuardrailKeys.some((key) => !observations.some((value) => value.key === key)) ||
      observations.some((value) => Number.isNaN(Date.parse(value.observedAt)))
    )
      throw new Error("PILOT_GUARDRAIL_SET_INVALID");
    const unknown = observations.filter(
      (value) => value.value === null || !value.independentlyObserved || value.sourceHash === null,
    );
    const breached = observations
      .filter((value) => !unknown.includes(value) && !passes(value))
      .map((value) => value.key);
    const state =
      breached.length > 0
        ? ("BREACH" as const)
        : unknown.length > 0
          ? ("UNKNOWN" as const)
          : ("PASS" as const);
    if (state === "BREACH") {
      if (!incidentRef) throw new Error("PILOT_GUARDRAIL_INCIDENT_REQUIRED");
      await this.incidents.suspendAndFence({ incidentRef, breached, observedAt });
    }
    const body = Object.freeze({
      state,
      observations: Object.freeze(
        [...observations].sort((left, right) => left.key.localeCompare(right.key)),
      ),
      incidentRef: state === "BREACH" ? incidentRef : null,
    });
    return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
  }
}

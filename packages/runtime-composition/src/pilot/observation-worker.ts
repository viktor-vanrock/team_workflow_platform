import type { PilotMetricFact } from "@awp/competency-qa";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { PilotGuardrailObservation } from "./guardrail-service.ts";

export interface LimitedPilotObservationBatch {
  readonly batchId: string;
  readonly runId: string;
  readonly cohortHash: Sha256Digest;
  readonly protocolHash: Sha256Digest;
  readonly windowStartAt: string;
  readonly windowEndAt: string;
  readonly metricFacts: readonly PilotMetricFact[];
  readonly guardrailObservations: readonly PilotGuardrailObservation[];
  readonly sourceEvidenceHashes: readonly Sha256Digest[];
  readonly independentlyObservedExternalWrites: number;
  readonly collectedAt: string;
  readonly contentHash: Sha256Digest;
}

export interface LimitedPilotObservationSource {
  metricFacts(
    input: Readonly<{ runId: string; windowStartAt: string; windowEndAt: string }>,
  ): Promise<readonly PilotMetricFact[]>;
  guardrails(
    input: Readonly<{ runId: string; windowStartAt: string; windowEndAt: string }>,
  ): Promise<readonly PilotGuardrailObservation[]>;
  externalWriteCount(
    input: Readonly<{ runId: string; windowStartAt: string; windowEndAt: string }>,
  ): Promise<Readonly<{ count: number; sourceHash: Sha256Digest }>>;
}

export interface LimitedPilotObservationStore {
  append(
    batch: LimitedPilotObservationBatch,
  ): Promise<Readonly<{ replayed: boolean; value: LimitedPilotObservationBatch }>>;
}

/** Collects completed-window evidence only; callers cannot fast-forward pilot time. */
export class PilotObservationWorker {
  constructor(
    private readonly source: LimitedPilotObservationSource,
    private readonly store: LimitedPilotObservationStore,
  ) {}

  async collect(
    input: Readonly<{
      batchId: string;
      runId: string;
      runStage: "LIMITED" | "REVIEW" | "STOPPED";
      cohortHash: Sha256Digest;
      protocolHash: Sha256Digest;
      windowStartAt: string;
      windowEndAt: string;
      now: string;
    }>,
  ): Promise<Readonly<{ replayed: boolean; value: LimitedPilotObservationBatch }>> {
    if (
      !input.batchId ||
      !input.runId ||
      input.runStage === undefined ||
      Date.parse(input.windowEndAt) <= Date.parse(input.windowStartAt) ||
      Number.isNaN(Date.parse(input.now)) ||
      Date.parse(input.now) < Date.parse(input.windowEndAt)
    )
      throw new Error("PILOT_WINDOW_NOT_ELAPSED");
    const metricFacts = await this.source.metricFacts(input);
    const guardrailObservations = await this.source.guardrails(input);
    const writes = await this.source.externalWriteCount(input);
    if (
      !Number.isSafeInteger(writes.count) ||
      writes.count < 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(writes.sourceHash) ||
      metricFacts.length === 0 ||
      metricFacts.some(
        (fact) =>
          fact.protocolHash !== input.protocolHash ||
          Date.parse(fact.observedAt) < Date.parse(input.windowStartAt) ||
          Date.parse(fact.observedAt) > Date.parse(input.windowEndAt),
      ) ||
      guardrailObservations.length !== 7 ||
      guardrailObservations.some(
        (value) =>
          Date.parse(value.observedAt) < Date.parse(input.windowStartAt) ||
          Date.parse(value.observedAt) > Date.parse(input.windowEndAt),
      )
    ) {
      throw new Error("PILOT_OBSERVATION_SOURCE_INVALID");
    }
    const sourceEvidenceHashes = Object.freeze(
      [
        ...metricFacts.map((fact) => fact.contentHash),
        ...guardrailObservations.flatMap((value) => (value.sourceHash ? [value.sourceHash] : [])),
        writes.sourceHash,
      ].sort(),
    );
    const body = Object.freeze({
      batchId: input.batchId,
      runId: input.runId,
      cohortHash: input.cohortHash,
      protocolHash: input.protocolHash,
      windowStartAt: input.windowStartAt,
      windowEndAt: input.windowEndAt,
      metricFacts: Object.freeze(
        [...metricFacts].sort((left, right) => left.factId.localeCompare(right.factId)),
      ),
      guardrailObservations: Object.freeze(
        [...guardrailObservations].sort((left, right) => left.key.localeCompare(right.key)),
      ),
      sourceEvidenceHashes,
      independentlyObservedExternalWrites: writes.count,
      collectedAt: input.now,
    });
    return await this.store.append(
      Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) }),
    );
  }
}

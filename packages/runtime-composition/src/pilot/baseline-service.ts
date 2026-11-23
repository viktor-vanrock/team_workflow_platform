import {
  aggregatePilotMetricFacts,
  type PilotMetricAggregate,
  type PilotMetricFact,
} from "@awp/competency-qa";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { MeasurementProtocol } from "./measurement-protocol.ts";

export interface BaselineObservation {
  readonly sampleId: string;
  readonly sourceClass: "CURRENT_PROCESS" | "PLATFORM_OBSERVATION";
  readonly fact: PilotMetricFact;
}

export interface BaselineDataset {
  readonly datasetId: string;
  readonly protocolRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly sampleIds: readonly string[];
  readonly sampleSize: number;
  readonly excludedCount: number;
  readonly censoredCount: number;
  readonly sourceClasses: readonly BaselineObservation["sourceClass"][];
  readonly sourceHashes: readonly Sha256Digest[];
  readonly measuredValues: readonly PilotMetricAggregate[];
  readonly spotCheckRefs: readonly string[];
  readonly importedBy: string;
  readonly completedAt: string;
  readonly contentHash: Sha256Digest;
}

export class PilotBaselineService {
  readonly #datasets = new Map<string, BaselineDataset>();
  constructor(private readonly maxObservations = 5_000) {}

  import(
    input: Readonly<{
      datasetId: string;
      protocol: MeasurementProtocol;
      observations: readonly BaselineObservation[];
      spotCheckRefs: readonly string[];
      importedBy: string;
      completedAt: string;
    }>,
  ): BaselineDataset {
    const existing = this.#datasets.get(input.datasetId);
    if (existing) {
      const requested = sha256({
        ...input,
        protocol: input.protocol.contentHash,
      } as unknown as JsonValue);
      const prior = sha256({
        ...input,
        protocol: input.protocol.contentHash,
        completedAt: existing.completedAt,
      } as unknown as JsonValue);
      if (requested !== prior) throw new Error("PILOT_BASELINE_IMMUTABLE");
      return existing;
    }
    if (
      !input.datasetId ||
      !input.importedBy ||
      Number.isNaN(Date.parse(input.completedAt)) ||
      input.protocol.targetValues !== null ||
      input.observations.length === 0 ||
      input.observations.length > this.maxObservations ||
      input.spotCheckRefs.length === 0 ||
      new Set(input.spotCheckRefs).size !== input.spotCheckRefs.length
    )
      throw new Error("PILOT_BASELINE_IMPORT_INVALID");
    if (!input.observations.some((value) => value.sourceClass === "CURRENT_PROCESS"))
      throw new Error("PILOT_BASELINE_CURRENT_PROCESS_SOURCE_REQUIRED");
    for (const observation of input.observations) {
      if (
        observation.sampleId !== observation.fact.sampleId ||
        observation.fact.protocolHash !== input.protocol.contentHash ||
        !input.protocol.metricDefinitions.includes(observation.fact.metricKey) ||
        Date.parse(observation.fact.observedAt) <
          Date.parse(input.protocol.baselineWindow.startAt) ||
        Date.parse(observation.fact.observedAt) > Date.parse(input.protocol.baselineWindow.endAt)
      )
        throw new Error("PILOT_BASELINE_OBSERVATION_INVALID");
    }
    const sampleIds = Object.freeze(
      [...new Set(input.observations.map((value) => value.sampleId))].sort(),
    );
    const measuredValues = Object.freeze(
      input.protocol.metricDefinitions.map((key) =>
        aggregatePilotMetricFacts(
          key,
          input.observations.map((value) => value.fact),
        ),
      ),
    );
    const body = Object.freeze({
      datasetId: input.datasetId,
      protocolRef: Object.freeze({
        id: input.protocol.protocolId,
        version: input.protocol.version,
        contentHash: input.protocol.contentHash,
      }),
      sampleIds,
      sampleSize: sampleIds.length,
      excludedCount: input.observations.filter((value) => value.fact.disposition === "EXCLUDED")
        .length,
      censoredCount: input.observations.filter((value) => value.fact.disposition === "CENSORED")
        .length,
      sourceClasses: Object.freeze(
        [...new Set(input.observations.map((value) => value.sourceClass))].sort(),
      ),
      sourceHashes: Object.freeze(input.observations.map((value) => value.fact.contentHash).sort()),
      measuredValues,
      spotCheckRefs: Object.freeze([...input.spotCheckRefs].sort()),
      importedBy: input.importedBy,
      completedAt: input.completedAt,
    });
    const dataset = Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
    this.#datasets.set(input.datasetId, dataset);
    return dataset;
  }
}

import { createPilotMetricFact, type PilotMetricFact } from "@awp/competency-qa";

export interface PilotMetricSource {
  readonly owner: PilotMetricFact["owner"];
  load(): Promise<readonly PilotMetricFact[]>;
}

/** Composes source-owned facts. Core SLA values are consumed as-is and are never recalculated here. */
export async function composePilotMetricFacts(
  sources: readonly PilotMetricSource[],
): Promise<readonly PilotMetricFact[]> {
  const loaded = await Promise.all(sources.map(async (source) => await source.load()));
  for (let index = 0; index < sources.length; index += 1)
    if (loaded[index]!.some((fact) => fact.owner !== sources[index]!.owner))
      throw new Error("PILOT_METRIC_SOURCE_OWNER_MISMATCH");
  const facts = loaded.flat();
  if (new Set(facts.map((fact) => fact.factId)).size !== facts.length)
    throw new Error("PILOT_METRIC_FACT_DUPLICATE");
  for (const fact of facts) {
    createPilotMetricFact({
      factId: fact.factId,
      workspaceId: fact.workspaceId,
      projectId: fact.projectId,
      protocolHash: fact.protocolHash,
      metricKey: fact.metricKey,
      owner: fact.owner,
      sourceSemantics: fact.sourceSemantics,
      sampleId: fact.sampleId,
      value: fact.value,
      numerator: fact.numerator,
      denominator: fact.denominator,
      disposition: fact.disposition,
      reason: fact.reason,
      observedAt: fact.observedAt,
      sourceRef: fact.sourceRef,
    });
  }
  return Object.freeze([...facts].sort((left, right) => left.factId.localeCompare(right.factId)));
}

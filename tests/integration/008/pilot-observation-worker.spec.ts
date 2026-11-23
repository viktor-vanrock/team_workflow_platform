import { describe, expect, it, vi } from "vitest";

import { createPilotMetricFact } from "../../../packages/competency-qa/src/application/pilot-metrics.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { pilotGuardrailKeys } from "../../../packages/runtime-composition/src/pilot/guardrail-service.ts";
import { PilotObservationWorker } from "../../../packages/runtime-composition/src/pilot/observation-worker.ts";

const hash = (value: unknown) => sha256(value as JsonValue),
  protocolHash = hash("protocol"),
  observedAt = "2026-09-05T11:00:00.000Z";
const metric = createPilotMetricFact({
  factId: "metric-1",
  workspaceId: "workspace",
  projectId: "project",
  protocolHash,
  metricKey: "REWORK_RATE",
  owner: "QA",
  sourceSemantics: "QA_OBSERVATION",
  sampleId: "sample-1",
  value: 0,
  numerator: 0,
  denominator: 1,
  disposition: "INCLUDED",
  reason: null,
  observedAt,
  sourceRef: { id: "qa-session", version: 1, contentHash: hash("source") },
});
const observations = pilotGuardrailKeys.map((key) => ({
  key,
  value: key.endsWith("COVERAGE") ? 1 : 0,
  sourceHash: hash(key),
  independentlyObserved: true,
  observedAt,
}));

describe("Feature 008 actual-window observation worker", () => {
  it("cannot simulate elapsed time and appends source-bound evidence after the real window", async () => {
    const append = vi.fn(async (value) => ({ replayed: false, value }));
    const worker = new PilotObservationWorker(
      {
        metricFacts: async () => [metric],
        guardrails: async () => observations,
        externalWriteCount: async () => ({ count: 2, sourceHash: hash("provider-observation") }),
      },
      { append },
    );
    const input = {
      batchId: "batch-1",
      runId: "run-1",
      runStage: "LIMITED" as const,
      cohortHash: hash("cohort"),
      protocolHash,
      windowStartAt: "2026-09-05T10:00:00.000Z",
      windowEndAt: "2026-09-05T12:00:00.000Z",
    };
    await expect(worker.collect({ ...input, now: "2026-09-05T11:59:59.999Z" })).rejects.toThrow(
      "PILOT_WINDOW_NOT_ELAPSED",
    );
    const result = await worker.collect({ ...input, now: "2026-09-05T12:00:00.000Z" });
    expect(result.value).toMatchObject({
      independentlyObservedExternalWrites: 2,
      metricFacts: [{ factId: "metric-1" }],
    });
    expect(result.value.sourceEvidenceHashes).toContain(hash("provider-observation"));
    expect(append).toHaveBeenCalledTimes(1);
  });
});

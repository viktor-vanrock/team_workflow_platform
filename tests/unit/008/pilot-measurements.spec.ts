import { describe, expect, it } from "vitest";

import {
  aggregatePilotMetricFacts,
  createPilotMetricFact,
} from "../../../packages/competency-qa/src/application/pilot-metrics.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { PilotBaselineService } from "../../../packages/runtime-composition/src/pilot/baseline-service.ts";
import {
  createMeasurementProtocol,
  type MeasurementProtocol,
  measurementProtocolSubjectHash,
} from "../../../packages/runtime-composition/src/pilot/measurement-protocol.ts";
import { composePilotMetricFacts } from "../../../packages/runtime-composition/src/pilot/metric-sources.ts";

const hash = (value: unknown) => sha256(value as JsonValue);
const observedAt = "2026-08-15T12:00:00.000Z";

function baselineProtocol(): MeasurementProtocol {
  const unsigned = {
    protocolId: "protocol-baseline",
    version: 1,
    metricDefinitions: ["REWORK_RATE", "CORE_SLA_ATTAINMENT"] as const,
    sourceMappings: { REWORK_RATE: "QA", CORE_SLA_ATTAINMENT: "CORE" } as const,
    inclusionRules: ["approved sample"],
    exclusionRules: ["invalid intake"],
    timezone: "UTC",
    baselineWindow: { startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-09-01T00:00:00.000Z" },
    comparisonWindow: null,
    minimumSample: null,
    targetValues: null,
    baselineRef: null,
    missingDataPolicy: "REPORT_UNKNOWN_AND_INSUFFICIENT" as const,
    createdAt: "2026-09-02T00:00:00.000Z",
  };
  const subjectHash = measurementProtocolSubjectHash(unsigned);
  return createMeasurementProtocol({
    ...unsigned,
    attestations: [
      {
        kind: "HUMAN",
        role: "QA_LEAD",
        principalId: "qa-lead",
        subjectHash,
        authorizationRef: "auth:qa",
        signedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        kind: "HUMAN",
        role: "SPONSOR",
        principalId: "sponsor",
        subjectHash,
        authorizationRef: "auth:sponsor",
        signedAt: "2026-09-01T11:00:00.000Z",
      },
    ],
  });
}

function fact(
  input: Partial<Parameters<typeof createPilotMetricFact>[0]> &
    Pick<Parameters<typeof createPilotMetricFact>[0], "factId" | "sampleId">,
) {
  const protocol = baselineProtocol();
  return createPilotMetricFact({
    workspaceId: "workspace",
    projectId: "project",
    protocolHash: protocol.contentHash,
    metricKey: "REWORK_RATE",
    owner: "QA",
    sourceSemantics: "QA_OBSERVATION",
    value: 0.5,
    numerator: 1,
    denominator: 2,
    disposition: "INCLUDED",
    reason: null,
    observedAt,
    sourceRef: { id: `source:${input.factId}`, version: 1, contentHash: hash(input.factId) },
    ...input,
  });
}

describe("Feature 008 pilot measurements", () => {
  it("preserves source provenance and reports exact denominators, exclusions and censoring", () => {
    const facts = [
      fact({ factId: "f1", sampleId: "s1", numerator: 1, denominator: 2, value: 0.5 }),
      fact({ factId: "f2", sampleId: "s2", numerator: 2, denominator: 2, value: 1 }),
      fact({ factId: "f3", sampleId: "s3", disposition: "EXCLUDED", reason: "invalid intake" }),
      fact({ factId: "f4", sampleId: "s4", disposition: "CENSORED", reason: "window ended" }),
    ];
    expect(aggregatePilotMetricFacts("REWORK_RATE", facts)).toMatchObject({
      value: 0.75,
      numerator: 3,
      denominator: 4,
      includedCount: 2,
      excludedCount: 1,
      censoredCount: 1,
      missingCount: 0,
    });
    expect(
      aggregatePilotMetricFacts("REWORK_RATE", [
        ...facts,
        fact({ factId: "f5", sampleId: "s5", value: null, numerator: null, denominator: null }),
      ]),
    ).toMatchObject({ missingCount: 1 });
    expect(() =>
      aggregatePilotMetricFacts("REWORK_RATE", [
        facts[0]!,
        { ...facts[1]!, protocolHash: hash("other") },
      ]),
    ).toThrow("PILOT_METRIC_PROTOCOL_MISMATCH");
  });

  it("consumes the existing Core 006 SLA value without calculating a competing clock", async () => {
    const protocol = baselineProtocol();
    const core = createPilotMetricFact({
      factId: "sla-1",
      workspaceId: "workspace",
      projectId: "project",
      protocolHash: protocol.contentHash,
      metricKey: "CORE_SLA_ATTAINMENT",
      owner: "CORE",
      sourceSemantics: "CORE_006_SLA",
      sampleId: "s1",
      value: 0.25,
      numerator: 1,
      denominator: 4,
      disposition: "INCLUDED",
      reason: null,
      observedAt,
      sourceRef: { id: "core-sla-clock", version: 6, contentHash: hash("core-sla") },
    });
    const composed = await composePilotMetricFacts([{ owner: "CORE", load: async () => [core] }]);
    expect(composed[0]).toMatchObject({
      value: 0.25,
      sourceSemantics: "CORE_006_SLA",
      sourceRef: { version: 6 },
    });
    expect(() =>
      createPilotMetricFact({
        factId: "bad",
        workspaceId: core.workspaceId,
        projectId: core.projectId,
        protocolHash: core.protocolHash,
        metricKey: core.metricKey,
        owner: "QA",
        sourceSemantics: core.sourceSemantics,
        sampleId: core.sampleId,
        value: core.value,
        numerator: core.numerator,
        denominator: core.denominator,
        disposition: core.disposition,
        reason: core.reason,
        observedAt: core.observedAt,
        sourceRef: core.sourceRef,
      }),
    ).toThrow("PILOT_SLA_SOURCE_OWNERSHIP_INVALID");
  });

  it("imports a bounded current-process baseline before numeric targets", () => {
    const protocol = baselineProtocol();
    const baseline = new PilotBaselineService(3).import({
      datasetId: "baseline-1",
      protocol,
      observations: [
        {
          sampleId: "s1",
          sourceClass: "CURRENT_PROCESS",
          fact: fact({ factId: "b1", sampleId: "s1" }),
        },
        {
          sampleId: "s2",
          sourceClass: "PLATFORM_OBSERVATION",
          fact: fact({
            factId: "b2",
            sampleId: "s2",
            disposition: "CENSORED",
            reason: "window ended",
          }),
        },
      ],
      spotCheckRefs: ["spot-check:1"],
      importedBy: "qa-lead",
      completedAt: "2026-09-02T01:00:00.000Z",
    });
    expect(baseline).toMatchObject({
      sampleSize: 2,
      censoredCount: 1,
      sourceClasses: ["CURRENT_PROCESS", "PLATFORM_OBSERVATION"],
    });
    expect(() =>
      new PilotBaselineService(1).import({
        datasetId: "too-large",
        protocol,
        observations: [
          {
            sampleId: "s1",
            sourceClass: "CURRENT_PROCESS",
            fact: fact({ factId: "x1", sampleId: "s1" }),
          },
          {
            sampleId: "s2",
            sourceClass: "CURRENT_PROCESS",
            fact: fact({ factId: "x2", sampleId: "s2" }),
          },
        ],
        spotCheckRefs: ["spot"],
        importedBy: "qa",
        completedAt: "2026-09-02T01:00:00.000Z",
      }),
    ).toThrow("PILOT_BASELINE_IMPORT_INVALID");
  });

  it("allows numeric targets only in an attested comparison protocol after baseline", () => {
    const baseline = baselineProtocol();
    const unsigned = {
      protocolId: "protocol-comparison",
      version: 2,
      metricDefinitions: baseline.metricDefinitions,
      sourceMappings: baseline.sourceMappings,
      inclusionRules: baseline.inclusionRules,
      exclusionRules: baseline.exclusionRules,
      timezone: "UTC",
      baselineWindow: baseline.baselineWindow,
      comparisonWindow: { startAt: "2026-09-03T00:00:00.000Z", endAt: "2026-09-10T00:00:00.000Z" },
      minimumSample: 10,
      targetValues: { REWORK_RATE: 0.2 },
      baselineRef: {
        id: "baseline-1",
        contentHash: hash("baseline-1"),
        completedAt: "2026-09-02T01:00:00.000Z",
      },
      missingDataPolicy: "REPORT_UNKNOWN_AND_INSUFFICIENT" as const,
      createdAt: "2026-09-02T12:00:00.000Z",
    };
    const subjectHash = measurementProtocolSubjectHash(unsigned);
    const attestations = [
      {
        kind: "HUMAN" as const,
        role: "QA_LEAD" as const,
        principalId: "qa-lead",
        subjectHash,
        authorizationRef: "auth:qa",
        signedAt: "2026-09-02T10:00:00.000Z",
      },
      {
        kind: "HUMAN" as const,
        role: "SPONSOR" as const,
        principalId: "sponsor",
        subjectHash,
        authorizationRef: "auth:sponsor",
        signedAt: "2026-09-02T11:00:00.000Z",
      },
    ];
    expect(createMeasurementProtocol({ ...unsigned, attestations })).toMatchObject({
      version: 2,
      minimumSample: 10,
      targetValues: { REWORK_RATE: 0.2 },
    });
    const noBaseline = { ...unsigned, baselineRef: null };
    const noBaselineHash = measurementProtocolSubjectHash(noBaseline);
    expect(() =>
      createMeasurementProtocol({
        ...noBaseline,
        attestations: attestations.map((value) => ({ ...value, subjectHash: noBaselineHash })),
      }),
    ).toThrow("PILOT_COMPARISON_PROTOCOL_ORDER_INVALID");
  });
});

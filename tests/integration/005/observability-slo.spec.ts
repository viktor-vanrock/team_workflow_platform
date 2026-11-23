import { describe, expect, it } from "vitest";

import {
  gitLabAutomationMetricNamespace,
  GitLabAutomationObservability,
  gitLabAutomationOutcomes,
  gitLabAutomationPhases,
  gitLabAutomationReasonCodes,
  gitLabAutomationSafetyCounters,
  populateDeterministicGitLabObservability,
  redactGitLabAutomationText,
} from "../../../packages/runtime-composition/src/gitlab/observability.ts";

describe("Feature 005 bounded GitLab automation observability", () => {
  it("covers every closed phase and passes the virtual-clock SLO envelope", () => {
    let now = new Date("2026-09-01T12:00:00.000Z");
    const recorder = new GitLabAutomationObservability({ now: () => now });
    populateDeterministicGitLabObservability(recorder);
    now = new Date("2026-09-01T12:02:00.000Z");

    const snapshot = recorder.snapshot();
    expect(snapshot.metricNamespace).toBe(gitLabAutomationMetricNamespace);
    expect(snapshot.phaseCoverage).toEqual([...gitLabAutomationPhases].sort());
    expect(snapshot.slos).toEqual([
      expect.objectContaining({
        name: "LAUNCH_ACKNOWLEDGEMENT",
        targetMs: 2_000,
        p95Ms: 1_500,
        status: "PASS",
      }),
      expect.objectContaining({
        name: "WEBHOOK_VISIBILITY",
        targetMs: 30_000,
        p95Ms: 25_000,
        status: "PASS",
      }),
      expect.objectContaining({
        name: "LOST_WEBHOOK_REPAIR",
        targetMs: 120_000,
        p95Ms: 110_000,
        maximumPolls: 2,
        observedMaximumPolls: 2,
        status: "PASS",
      }),
      expect.objectContaining({
        name: "TERMINAL_TO_ARTIFACT",
        targetMs: 120_000,
        p95Ms: 115_000,
        status: "PASS",
      }),
    ]);
    expect(snapshot.safetyCounters).toEqual(
      Object.fromEntries(gitLabAutomationSafetyCounters.map((name) => [name, 0])),
    );
    expect(snapshot.status).toBe("PASS");
  });

  it("keeps metric labels bounded and hashes correlation rather than exposing identifiers", () => {
    const recorder = new GitLabAutomationObservability({
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });
    populateDeterministicGitLabObservability(recorder);
    recorder.record({
      phase: "RESULT",
      outcome: "FAILED",
      reasonCode: "provider said secretref://vault/gitlab and request-key=raw",
      correlationId: "correlation-private-value",
      causationId: "causation-private-value",
      durationMs: 27,
    });
    const snapshot = recorder.snapshot();
    for (const metric of snapshot.metrics) {
      expect(Object.keys(metric.labels).sort()).toEqual([
        "correlationLinked",
        "outcome",
        "phase",
        "reasonCode",
      ]);
      expect(gitLabAutomationPhases).toContain(metric.labels.phase);
      expect(gitLabAutomationOutcomes).toContain(metric.labels.outcome);
      expect(gitLabAutomationReasonCodes).toContain(metric.labels.reasonCode);
      expect(["PRESENT", "ABSENT"]).toContain(metric.labels.correlationLinked);
    }
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("correlation-private-value");
    expect(serialized).not.toContain("causation-private-value");
    expect(serialized).not.toContain("secretref://");
    expect(serialized).not.toContain("request-key=raw");
    expect(snapshot.traces.at(-1)).toMatchObject({ reasonCode: "UNCLASSIFIED" });
  });

  it("redacts secret, raw-body, artifact and untrusted multiline text and fails closed on safety violations", () => {
    for (const value of [
      "Authorization: Bearer token",
      "private-token=gitlab-token",
      "secretref://vault/gitlab",
      "webhook_body={raw}",
      "artifact_content=binary",
      "untrusted\nprovider text",
    ])
      expect(redactGitLabAutomationText(value)).toBe("redacted.event");
    expect(redactGitLabAutomationText("closed-enum-safe-event")).toBe("closed-enum-safe-event");

    const recorder = new GitLabAutomationObservability();
    populateDeterministicGitLabObservability(recorder);
    recorder.incrementSafetyViolation("BLIND_RETRIGGER");
    expect(recorder.snapshot()).toMatchObject({
      status: "FAIL",
      safetyCounters: { BLIND_RETRIGGER: 1 },
    });
  });
});

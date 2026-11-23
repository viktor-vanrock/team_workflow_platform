import { describe, expect, it } from "vitest";

import {
  type AuditCoverageObservation008,
  evaluateAuditCoverage008,
} from "../../../tools/verification/008-audit-coverage.mts";

const key = "effect-1",
  workspaceId = "workspace-1",
  projectId = "project-1",
  correlationId = "correlation-1",
  causationId = "causation-1";
const fixture = (): AuditCoverageObservation008 => ({
  expectedEffectKeys: [key],
  approvalRequiredEffectKeys: [key],
  providerEffects: [{ effectKey: key, effectCount: 1, recordedAt: "2026-09-05T00:00:00.000Z" }],
  commands: [
    {
      id: "command-1",
      workspaceId,
      projectId,
      effectKey: key,
      state: "CONFIRMED",
      correlationId,
      causationId,
    },
  ],
  events: ["sample.record.intent", "sample.record.approve", "sample.record.result"].map(
    (action) => ({
      action,
      outcome: action === "sample.record.result" ? "SUCCEEDED" : "ACCEPTED",
      workspaceId,
      projectId,
      correlationId,
      causationId,
      values: { commandId: "command-1", effectIdempotencyKey: key },
    }),
  ),
});

describe("008 independent effect-to-audit coverage", () => {
  it("requires one provider effect, exact durable command, intent, approval and result correlation", () => {
    expect(evaluateAuditCoverage008(fixture())).toMatchObject({
      status: "PASS",
      measurements: {
        observedEffects: 1,
        expectedEffects: 1,
        coveredEffects: 1,
        duplicateEffects: 0,
      },
    });
  });
  it.each([
    "provider",
    "command",
    "intent",
    "result",
    "approval",
    "scope",
    "correlation",
    "duplicate",
  ])("fails when %s evidence is invalid", (fault) => {
    let value = fixture();
    if (fault === "provider") value = { ...value, providerEffects: [] };
    if (fault === "command") value = { ...value, commands: [] };
    if (["intent", "result", "approval"].includes(fault))
      value = {
        ...value,
        events: value.events!.filter(
          (event) => event.action !== `sample.record.${fault === "approval" ? "approve" : fault}`,
        ),
      };
    if (fault === "scope")
      value = {
        ...value,
        events: value.events!.map((event, index) =>
          index === 0 ? { ...event, projectId: "foreign-project" } : event,
        ),
      };
    if (fault === "correlation")
      value = {
        ...value,
        events: value.events!.map((event, index) =>
          index === 0 ? { ...event, correlationId: "foreign-correlation" } : event,
        ),
      };
    if (fault === "duplicate")
      value = {
        ...value,
        providerEffects: value.providerEffects!.map((effect, index) =>
          index === 0 ? { ...effect, effectCount: 2 } : effect,
        ),
      };
    expect(evaluateAuditCoverage008(value).status).toBe("FAIL");
  });
  it.each(["providerEffects", "commands", "events"] as const)(
    "treats unobserved %s as unknown rather than zero",
    (field) => {
      const result = evaluateAuditCoverage008({ ...fixture(), [field]: null });
      expect(result).toMatchObject({
        status: "FAIL",
        measurements: { observedEffects: null, coveredEffects: null },
        reasonCodes: ["AUDIT_COVERAGE_UNOBSERVED"],
      });
    },
  );
});

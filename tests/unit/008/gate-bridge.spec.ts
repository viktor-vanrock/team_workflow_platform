import { describe, expect, it } from "vitest";

import {
  bridgePilotGate,
  gateRequirements,
} from "../../../packages/platform-core/src/pilot/gate-policy.ts";
import type {
  PilotGateExecution,
  PilotGateKind,
} from "../../../packages/platform-core/src/pilot/model.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const subject = { id: "deployment", version: 1, contentHash: hash };
const now = Date.parse("2026-09-03T08:00:00Z");
const scope = { workspaceId: "w1", projectId: "p1" };
const execution = (key: string): PilotGateExecution => ({
  ...scope,
  id: key,
  version: 1,
  key,
  subjectRef: subject,
  reportRef: { id: key, version: 1, contentHash: hash },
  status: "PASS",
  assessment: "CURRENT",
  evaluatedAt: "2026-09-03T07:00:00Z",
  validUntil: "2026-09-03T09:00:00Z",
  checks: [{ id: "real-check", status: "PASS" }],
});
const bridge = (kind: PilotGateKind, runs: PilotGateExecution[], verified = true) =>
  bridgePilotGate(
    {
      ...scope,
      id: "result",
      kind,
      subjectRef: subject,
      evaluatedAt: new Date(now).toISOString(),
      evaluatorId: "trusted-executor",
      executions: runs,
    },
    { verify: async () => verified },
  );

describe("008 authoritative gate bridge", () => {
  it.each(["L0", "C1", "N2", "P3"] as const)("requires exact evidence for %s", async (kind) => {
    expect((await bridge(kind, gateRequirements[kind].map(execution))).outcome).toBe("PASS");
    expect((await bridge(kind, [])).outcome).toBe("BLOCKED_INPUT");
  });
  it("cannot promote copied PASS, a skipped child, future, expired or revoked evidence", async () => {
    const runs = gateRequirements.C1.map(execution);
    expect((await bridge("C1", runs, false)).outcome).toBe("FAIL");
    for (const patch of [
      { status: "SKIPPED_GATED" as const },
      { assessment: "STALE" as const },
      { assessment: "REVOKED" as const },
      { validUntil: new Date(now).toISOString() },
      { evaluatedAt: "2099-01-01T00:00:00Z" },
      { checks: [{ id: "hidden", status: "SKIPPED_GATED" as const }] },
      { checks: [] },
    ])
      expect((await bridge("C1", [{ ...runs[0]!, ...patch }])).outcome).toBe("BLOCKED_INPUT");
  });
  it("rejects scope/config drift, duplicate and unexpected executions", async () => {
    const run = execution("inputs");
    for (const patch of [
      { workspaceId: "w2" },
      { projectId: "p2" },
      { subjectRef: { ...subject, version: 2 } },
    ]) {
      expect((await bridge("C1", [{ ...run, ...patch }])).outcome).toBe("FAIL");
    }
    expect((await bridge("C1", [run, run])).outcome).toBe("FAIL");
    expect((await bridge("C1", [run, execution("untrusted")])).outcome).toBe("FAIL");
  });
  it("propagates an actual failed check even if run status claims PASS", async () => {
    expect(
      (await bridge("C1", [{ ...execution("inputs"), checks: [{ id: "failed", status: "FAIL" }] }]))
        .outcome,
    ).toBe("FAIL");
  });
  it("first P3 admission requires pre-activation proof, never observed limited-pilot results", async () => {
    expect(gateRequirements.P3).toEqual([
      "N2",
      "security",
      "recovery",
      "shadow",
      "cohort",
      "baseline-protocol",
    ]);
    const result = await bridge("P3", gateRequirements.P3.map(execution));
    expect(result.outcome).toBe("PASS");
    expect(result.validUntil).toBe("2026-09-03T09:00:00.000Z");
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

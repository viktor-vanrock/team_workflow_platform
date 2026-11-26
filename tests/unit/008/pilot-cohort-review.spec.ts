import { describe, expect, it } from "vitest";

import {
  matchesCurrentPilotGates,
  matchesReviewedCohort,
} from "../../../apps/api/src/extensions/pilot/pilot-fence-publication.ts";
import { pilotCohortScopeHash } from "../../../packages/runtime-composition/src/pilot/cohort-service.ts";

describe("reviewed pilot cohort", () => {
  const cohort = {
    contentHash: `sha256:${"a".repeat(64)}`,
    userIds: ["alice", "bob"],
    sponsorRef: "sponsor",
    qaLeadRef: "lead",
  };
  const metadata = {
    cohortRef: pilotCohortScopeHash(cohort as never),
    humanRefs: ["bob", "alice"],
    sponsorRef: "sponsor",
    qaLeadRef: "lead",
  };
  it("accepts the exact reviewed people independently of order", () => {
    expect(matchesReviewedCohort(metadata, cohort as never)).toBe(true);
  });
  it("rejects changes to the hash, membership, sponsor or lead", () => {
    for (const change of [
      { cohortRef: `sha256:${"b".repeat(64)}` },
      { humanRefs: ["alice", "other"] },
      { humanRefs: ["alice", "alice"] },
      { sponsorRef: "other" },
      { qaLeadRef: "other" },
    ])
      expect(matchesReviewedCohort({ ...metadata, ...change }, cohort as never)).toBe(false);
  });
});

describe("exact pilot gate evidence", () => {
  it("requires all four current passing results with matching IDs and hashes", () => {
    const hash = `sha256:${"a".repeat(64)}` as const;
    const kinds = ["L0", "C1", "N2", "P3"] as const;
    const expected = kinds.map((kind) => ({ kind, id: kind, contentHash: hash }));
    const gates = kinds.map((kind) => ({
      gate_kind: kind,
      gate_result_id: kind,
      content_hash: hash,
      outcome: "PASS",
      valid_until: new Date("2099-01-01T00:00:00Z"),
    }));
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(matchesCurrentPilotGates(gates, expected, now)).toBe(true);
    expect(matchesCurrentPilotGates(gates.slice(1), expected, now)).toBe(false);
    expect(
      matchesCurrentPilotGates(
        gates.map((gate) => (gate.gate_kind === "P3" ? { ...gate, outcome: "FAIL" } : gate)),
        expected,
        now,
      ),
    ).toBe(false);
    expect(
      matchesCurrentPilotGates(
        gates.map((gate) =>
          gate.gate_kind === "C1" ? { ...gate, content_hash: "changed" } : gate,
        ),
        expected,
        now,
      ),
    ).toBe(false);
    expect(matchesCurrentPilotGates(gates, expected, Date.parse("2100-01-01T00:00:00Z"))).toBe(
      false,
    );
  });
});

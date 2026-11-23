import { describe, expect, it } from "vitest";

import { QaTriageAssessmentAggregate } from "../../../packages/competency-qa/src/index.ts";
import { enforceProposalFreshness } from "../../../packages/runtime-composition/src/index.ts";

describe("US3 triage revision staleness", () => {
  it("marks the exact current pointer stale before display and supersedes only a current revision", async () => {
    const calls: unknown[][] = [];
    const result = await enforceProposalFreshness({
      workspaceId: "w",
      projectId: "p",
      id: "triage",
      contentHash: "sha256:proposal",
      sourceFactSetHash: "sha256:old",
      currentFactSetHash: "sha256:new",
      state: "CURRENT",
      expiresAt: new Date("2026-09-03"),
      now: new Date("2026-09-01"),
      repository: {
        markStale: async (...args) => {
          calls.push(args);
        },
      },
    });
    expect(result).toEqual({ state: "STALE", reasonCode: "SOURCE_CHANGED" });
    expect(calls).toEqual([["w", "p", "triage", "sha256:proposal", "SOURCE_CHANGED"]]);
    const aggregate = QaTriageAssessmentAggregate.create({
      id: "triage",
      workspaceId: "w",
      projectId: "p",
      subject: { kind: "DRAFT", id: "d", version: 2, contentHash: "sha256:d" },
      revision: 2,
      content: {
        facts: [
          {
            sourceRef: "draft:d",
            sourceVersion: "2",
            contentHash: "sha256:d",
            polarity: "UNKNOWN",
          },
        ],
        recommendations: {},
      },
      expiresAt: new Date("2026-09-02"),
    });
    expect(aggregate.supersede().state).toBe("SUPERSEDED");
  });
});

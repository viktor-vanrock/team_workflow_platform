import { describe, expect, it, vi } from "vitest";

import { runQaTriageV11 } from "../../../packages/competency-qa/src/index.ts";
import { triageFixture } from "../../helpers/006/triage-fixture.ts";

const input = () => {
  const value = triageFixture();
  return {
    assessmentId: value.assessmentId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    subject: value.subject,
    revision: value.revision,
    facts: value.facts,
    inputFingerprintComponents: value.inputFingerprintComponents,
    agentRunId: value.agentRunRef,
    now: new Date(value.createdAt),
    expiresAt: new Date(value.expiresAt),
  };
};

describe("US3 model trust boundary", () => {
  it("uses the same deterministic manual-triage fallback on outage", async () => {
    const model = { propose: vi.fn().mockRejectedValue(new Error("MODEL_DOWN")) };
    const result = await runQaTriageV11(input(), model);
    expect(result).toMatchObject({
      executionMode: "DETERMINISTIC_FALLBACK",
      assessment: { confidence: 0 },
    });
    expect(result.assessment.recommendations.priority.value).toBe("UNKNOWN");
  });

  it("rejects model attempts to authorize, assign, set due/Jira priority, or accepted rank", async () => {
    const unsafe = {
      ...triageFixture(),
      authorization: "ALLOW",
      acceptedRank: 1,
      jiraPriority: "Highest",
      due: "2026-09-04",
      assignment: "lead",
    };
    const result = await runQaTriageV11(input(), { propose: vi.fn().mockResolvedValue(unsafe) });
    expect(result.executionMode).toBe("DETERMINISTIC_FALLBACK");
    expect(JSON.stringify(result.assessment)).not.toMatch(
      /authorization|acceptedRank|jiraPriority|assignment/u,
    );
  });
});

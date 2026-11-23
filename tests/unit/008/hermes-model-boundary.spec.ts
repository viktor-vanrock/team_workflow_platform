import { describe, expect, it } from "vitest";

import {
  qaTriageModelPolicy,
  runQaTriageV11,
} from "../../../packages/competency-qa/src/skills/qa-triage.ts";
import { triageFixture } from "../../helpers/006/triage-fixture.ts";

function fixture() {
  const output = triageFixture();
  const input = {
    assessmentId: output.assessmentId,
    workspaceId: output.workspaceId,
    projectId: output.projectId,
    subject: output.subject,
    revision: output.revision,
    facts: output.facts,
    inputFingerprintComponents: output.inputFingerprintComponents,
    agentRunId: output.agentRunRef,
    now: new Date(output.createdAt),
    expiresAt: new Date(output.expiresAt),
  };
  return { input, output: { ...output, confidence: 0.9 } };
}
describe("008 exact triage model boundary", () => {
  it.each(["workspace", "subject", "facts", "policy", "schema", "expiry", "confidence"])(
    "falls back when model changes %s",
    async (change) => {
      const f = fixture();
      const output: Record<string, unknown> = structuredClone(f.output);
      if (change === "workspace") output.workspaceId = "foreign-workspace";
      if (change === "subject") output.subject = { ...f.output.subject, kind: "CANDIDATE" };
      if (change === "facts")
        output.facts = f.output.facts.map((fact) => ({ ...fact, sourceRef: "foreign-evidence" }));
      if (change === "policy")
        output.policyRef = {
          key: "changed-policy",
          version: "1.0.0",
          hash: f.output.policyRef.hash,
        };
      if (change === "schema") output.schemaVersion = "triage-assessment@0.0.0";
      if (change === "expiry") output.expiresAt = "2099-01-01T00:00:00.000Z";
      if (change === "confidence") output.confidence = 0.1;
      const result = await runQaTriageV11(f.input, { propose: async () => output });
      expect(result.executionMode).toBe("DETERMINISTIC_FALLBACK");
      expect(result.assessment.workspaceId).toBe(f.input.workspaceId);
      expect(result.assessment.facts).toEqual(f.input.facts);
    },
  );
  it("accepts a grounded recommendation for the original exact inputs", async () => {
    const f = fixture();
    expect((await runQaTriageV11(f.input, { propose: async () => f.output })).executionMode).toBe(
      "MODEL",
    );
  });
  it("bounds a hanging provider and aborts its signal before returning the original fallback", async () => {
    const f = fixture();
    let signal: AbortSignal | undefined;
    const result = await runQaTriageV11(
      f.input,
      {
        propose: async (request) => {
          signal = request.signal;
          return new Promise<never>(() => {});
        },
      },
      { ...qaTriageModelPolicy, deadlineMs: 5 },
    );
    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({
      executionMode: "DETERMINISTIC_FALLBACK",
      fallbackReason: "MODEL_UNAVAILABLE",
    });
    expect(result.assessment.facts).toEqual(f.input.facts);
  });
  it("keeps a detached immutable input snapshot even if a provider mutates its caller", async () => {
    const f = fixture(),
      originalFacts = structuredClone(f.input.facts);
    const result = await runQaTriageV11(f.input, {
      propose: async (request) => {
        f.input.projectId = "changed-during-request";
        expect(Object.isFrozen(request.facts)).toBe(true);
        expect(Object.isFrozen(request.recommendationTemplate.inputFingerprintComponents)).toBe(
          true,
        );
        return { ...request.recommendationTemplate, confidence: 0.9 };
      },
    });
    expect(result).toMatchObject({
      executionMode: "MODEL",
      assessment: { projectId: "project-1", facts: originalFacts },
    });
    expect(Object.isFrozen(result.assessment)).toBe(true);
  });
});

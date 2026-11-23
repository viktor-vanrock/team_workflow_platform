import { describe, expect, it } from "vitest";

import {
  confirmQaReadiness,
  projectReadinessSync,
} from "../../packages/competency-qa/src/application/confirm-readiness.ts";
import { evaluateQaReadiness } from "../../packages/competency-qa/src/application/readiness-evaluator.ts";
import { makeCompleteReadinessInput } from "../support/002-readiness-fixture.ts";

describe("readiness staleness and dispatch freeze", () => {
  it("rejects a stale assessment and freezes input only after confirmation", async () => {
    const input = makeCompleteReadinessInput();
    const assessment = await evaluateQaReadiness(input);
    expect(() =>
      confirmQaReadiness({
        assessment,
        currentInputRef: { ...assessment.requestInputRevisionRef, version: 2 },
        actor: input.evaluatedBy,
        confirmedAt: input.evaluatedAt,
      }),
    ).toThrow("QA_READINESS_STALE_INPUT");
    const candidate = confirmQaReadiness({
      assessment,
      currentInputRef: assessment.requestInputRevisionRef,
      actor: input.evaluatedBy,
      confirmedAt: input.evaluatedAt,
    });
    expect(projectReadinessSync(candidate, { state: "PENDING" }).state).toBe("READY_PENDING_SYNC");
    expect(
      projectReadinessSync(candidate, {
        state: "CONFIRMED",
        externalVersion: "2",
        normalizedStatus: "READY",
        confirmedAt: input.evaluatedAt,
      }),
    ).toMatchObject({ state: "READY", inputFrozen: true });
  });
});

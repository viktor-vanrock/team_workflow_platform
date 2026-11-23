import { describe, expect, it, vi } from "vitest";

import { buildDeterministicDefectDraft } from "../../packages/competency-qa/src/application/defect-draft-template.ts";
import { createFrozenFinding } from "../support/002-us4-fixtures.ts";

describe("non-PRODUCT and explicit rejection zero-effect matrix", () => {
  it.each([
    ["INFRA", "NOT_A_BUG"],
    ["INCONCLUSIVE", "DEFERRED"],
    ["DUPLICATE", "DUPLICATE"],
    ["ACCEPTED_RISK", "ACCEPTED_RISK"],
  ] as const)("blocks %s/%s before defect.create", (classification, disposition) => {
    const invoke = vi.fn();
    const finding = createFrozenFinding({ classification, disposition });
    expect(() =>
      buildDeterministicDefectDraft({
        finding,
        createdBy: finding.createdBy,
        at: "2026-08-30T12:00:00.000Z",
      }),
    ).toThrow("QA_DEFECT_DRAFT_PRODUCT_CREATE_DEFECT_REQUIRED");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("makes human draft rejection final with zero approval/command/connector calls", () => {
    const calls = { approval: vi.fn(), command: vi.fn(), connector: vi.fn() };
    const finding = createFrozenFinding({
      classification: "PRODUCT",
      disposition: "CREATE_DEFECT",
    });
    const draft = buildDeterministicDefectDraft({
      finding,
      createdBy: finding.createdBy,
      at: "2026-08-30T12:00:00.000Z",
    });
    draft.reject({
      actor: finding.createdBy,
      reason: "Human chose not to publish",
      at: "2026-08-30T12:01:00.000Z",
    });
    expect(draft.state).toBe("REJECTED");
    expect(Object.values(calls).every((call) => call.mock.calls.length === 0)).toBe(true);
  });
});

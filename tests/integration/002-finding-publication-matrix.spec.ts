import { describe, expect, it, vi } from "vitest";

import { buildDeterministicDefectDraft } from "../../packages/competency-qa/src/application/defect-draft-template.ts";
import { createFrozenFinding } from "../support/002-us4-fixtures.ts";

describe("US4 defect zero-call matrix", () => {
  it.each([
    ["INFRA", "NOT_A_BUG"],
    ["INCONCLUSIVE", "DEFERRED"],
    ["DUPLICATE", "DUPLICATE"],
    ["ACCEPTED_RISK", "ACCEPTED_RISK"],
  ] as const)("rejects %s/%s before any connector call", (classification, disposition) => {
    const connector = vi.fn();
    const finding = createFrozenFinding({ classification, disposition });
    expect(() =>
      buildDeterministicDefectDraft({
        finding,
        createdBy: finding.createdBy,
        at: "2026-08-30T11:00:00.000Z",
      }),
    ).toThrow("QA_DEFECT_DRAFT_PRODUCT_CREATE_DEFECT_REQUIRED");
    expect(connector).not.toHaveBeenCalled();
  });

  it("requires DUPLICATE to carry the inseparable exact ref and human reason", () => {
    const finding = createFrozenFinding({ classification: "DUPLICATE", freeze: false });
    expect(() =>
      finding.dispose({
        decision: "DUPLICATE",
        reason: "",
        actor: finding.createdBy,
        at: "2026-08-30T10:02:00.000Z",
      }),
    ).toThrow("QA_FINDING_DUPLICATE_REF_REQUIRED");
    expect(() =>
      finding.dispose({
        decision: "DUPLICATE",
        reason: "Same root cause",
        actor: finding.createdBy,
        at: "2026-08-30T10:02:00.000Z",
      }),
    ).toThrow("QA_FINDING_DUPLICATE_REF_REQUIRED");
    finding.dispose({
      decision: "DUPLICATE",
      reason: "Same root cause",
      duplicateDefectRef: {
        kind: "DEFECT",
        id: "BUG-41",
        version: "7",
        contentHash: `sha256:${"d".repeat(64)}`,
      },
      actor: finding.createdBy,
      at: "2026-08-30T10:02:00.000Z",
    });
    expect(finding.state).toBe("DISPOSED");
  });

  it("rejecting a human draft is final and has zero external effects", () => {
    const connector = vi.fn();
    const draft = buildDeterministicDefectDraft({
      finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
      createdBy: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" })
        .createdBy,
      at: "2026-08-30T11:00:00.000Z",
    });
    draft.reject({
      actor: draft.createdBy,
      reason: "Not worth external publication",
      at: "2026-08-30T11:01:00.000Z",
    });
    expect(draft.state).toBe("REJECTED");
    expect(() =>
      draft.dispatch({
        commandId: "command-1",
        effectKeyHash: `sha256:${"e".repeat(64)}`,
        at: "2026-08-30T11:02:00.000Z",
      }),
    ).toThrow();
    expect(connector).not.toHaveBeenCalled();
  });
});

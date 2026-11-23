import { describe, expect, it } from "vitest";

import {
  FakeQaDraftAssistant,
  requestQaDefectDraftWordingProposal,
} from "../../packages/competency-qa/src/application/qa-draft-assistant.ts";
import { createFrozenFinding } from "../support/002-us4-fixtures.ts";

const modelRef = Object.freeze({
  kind: "MODEL",
  id: "fake-model",
  version: "1",
  contentHash: `sha256:${"a".repeat(64)}`,
});
const now = () => "2026-08-30T12:00:00.000Z";

describe("US4 optional defect wording assistant", () => {
  it.each([
    [undefined, undefined, "INTERNAL", "MODEL_UNSET"],
    [new FakeQaDraftAssistant("INVALID"), modelRef, "INTERNAL", "MODEL_OUTPUT_INVALID"],
    [new FakeQaDraftAssistant("ERROR"), modelRef, "INTERNAL", "MODEL_UNAVAILABLE"],
    [new FakeQaDraftAssistant("TIMEOUT"), modelRef, "INTERNAL", "MODEL_TIMEOUT"],
  ] as const)(
    "falls back deterministically: %s",
    async (assistant, ref, classification, reason) => {
      const proposal = await requestQaDefectDraftWordingProposal({
        finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
        ...(assistant ? { assistant } : {}),
        ...(ref ? { modelRef: ref } : {}),
        dataClassificationKey: classification,
        now,
        timeoutMs: 1,
      });
      expect(proposal.source).toBe("DETERMINISTIC_FALLBACK");
      expect(proposal.fallbackReasonCode).toBe(reason);
      expect(proposal.title).toContain("Observed failure");
    },
  );

  it("never sends restricted input to the provider", async () => {
    const assistant = new FakeQaDraftAssistant();
    const proposal = await requestQaDefectDraftWordingProposal({
      finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
      assistant,
      modelRef,
      dataClassificationKey: "RESTRICTED",
      now,
    });
    expect(proposal.source).toBe("DETERMINISTIC_FALLBACK");
    expect(assistant.calls).toHaveLength(0);
  });
});

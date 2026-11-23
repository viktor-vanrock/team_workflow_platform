import { describe, expect, it } from "vitest";

import { buildDeterministicDefectDraft } from "../../../packages/competency-qa/src/application/defect-draft-template.ts";
import {
  FakeQaDraftAssistant,
  requestQaDefectDraftWordingProposal,
} from "../../../packages/competency-qa/src/application/qa-draft-assistant.ts";
import { createFakeQaDraftAssistant } from "../../../packages/runtime-composition/src/qa/fake-qa-draft-assistant.ts";
import { createFrozenFinding } from "../../support/002-us4-fixtures.ts";

const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "executor.alpha",
  issuer: "fake-idp",
  subject: "executor.alpha",
});
const modelRef = Object.freeze({
  kind: "MODEL",
  id: "fake-model",
  version: "1",
  contentHash: `sha256:${"a".repeat(64)}`,
});
const at = "2026-08-31T12:00:00.000Z";

describe("AT-013 model degraded mode", () => {
  it.each([
    ["unset", undefined, undefined, "MODEL_UNSET"],
    ["invalid", new FakeQaDraftAssistant("INVALID"), modelRef, "MODEL_OUTPUT_INVALID"],
    ["timeout", new FakeQaDraftAssistant("TIMEOUT"), modelRef, "MODEL_TIMEOUT"],
    ["error", new FakeQaDraftAssistant("ERROR"), modelRef, "MODEL_UNAVAILABLE"],
  ] as const)(
    "uses a deterministic, human-usable fallback when provider is %s",
    async (_name, assistant, ref, reason) => {
      const finding = createFrozenFinding({
        classification: "PRODUCT",
        disposition: "CREATE_DEFECT",
      });
      const proposal = await requestQaDefectDraftWordingProposal({
        finding,
        ...(assistant ? { assistant } : {}),
        ...(ref ? { modelRef: ref } : {}),
        dataClassificationKey: "INTERNAL",
        now: () => at,
        timeoutMs: 1,
      });
      expect(proposal).toMatchObject({
        source: "DETERMINISTIC_FALLBACK",
        fallbackReasonCode: reason,
      });
      const draft = buildDeterministicDefectDraft({
        finding,
        createdBy: actor,
        at,
        wording: proposal,
        provenance: "DETERMINISTIC_FALLBACK_ACCEPTED",
      });
      draft.accept({ actor, at: "2026-08-31T12:01:00.000Z" });
      expect(draft).toMatchObject({
        state: "READY_FOR_APPROVAL",
        provenance: { source: "DETERMINISTIC_FALLBACK_ACCEPTED" },
      });
    },
  );

  it("rejects restricted evidence before provider invocation with an explicit policy reason", async () => {
    const assistant = new FakeQaDraftAssistant();
    const proposal = await requestQaDefectDraftWordingProposal({
      finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
      assistant,
      modelRef,
      dataClassificationKey: "RESTRICTED",
      now: () => at,
    });
    expect(proposal).toMatchObject({
      source: "DETERMINISTIC_FALLBACK",
      fallbackReasonCode: "MODEL_INPUT_DENIED",
    });
    expect(assistant.calls).toHaveLength(0);
  });

  it("keeps invalid local provider configuration deterministic and provider-free", () => {
    expect(createFakeQaDraftAssistant({ AWP_QA_DRAFT_ASSISTANT: "unknown-provider" })).toEqual({
      mode: "unset",
      provenance: "deterministic-fallback:MODEL_CONFIGURATION_INVALID",
    });
  });
});

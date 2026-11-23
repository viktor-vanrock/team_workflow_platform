import { buildDeterministicDefectDraft } from "../application/deterministic-defect-template.ts";

export const qaDefectDraftSkill = Object.freeze({
  key: "qa-defect-draft",
  version: "1.0.0",
  subject: "WORK_ITEM",
  effect: "PROPOSAL",
  execute: buildDeterministicDefectDraft,
});

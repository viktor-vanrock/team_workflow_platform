import { evaluateQaDod } from "../application/dod-evaluator.ts";

export const qaDodCheckSkill = Object.freeze({
  key: "qa-dod-check",
  version: "1.0.0",
  subject: "WORK_ITEM",
  effect: "READ_ONLY",
  execute: evaluateQaDod,
});

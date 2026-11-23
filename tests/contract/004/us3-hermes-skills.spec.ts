import { describe, expect, it } from "vitest";

import { qaSkillCatalog } from "../../../packages/competency-qa/src/index.ts";
import {
  createHermesSkillRegistry,
  qaProposalSkillContribution,
} from "../../../packages/runtime-composition/src/index.ts";

describe("US3 Hermes skill contracts", () => {
  it("declares all nine immutable catalog entries and the six proposal skills", () => {
    expect(qaSkillCatalog).toHaveLength(9);
    expect(new Set(qaSkillCatalog.map(({ key }) => key)).size).toBe(9);
    expect(qaProposalSkillContribution.definitions.map(({ key }) => key)).toEqual([
      "qa-work-item-readiness",
      "qa-triage",
      "qa-session-plan",
      "qa-result-review-prep",
      "qa-defect-draft",
      "qa-dod-check",
    ]);
    expect(createHermesSkillRegistry().list()).toHaveLength(9);
  });

  it("keeps one output schema, closed actions, subjects and deterministic fallback per US3 skill", () => {
    for (const definition of qaProposalSkillContribution.definitions) {
      const catalog = qaSkillCatalog.find(({ key }) => key === definition.key)!;
      expect(definition.outputSchemaRef.id).toBe(catalog.outputSchemaId);
      expect(definition.allowedSubjects).toEqual(catalog.subjects);
      expect(definition.actionAllowlist.map(({ action }) => action)).toEqual(catalog.actions);
      expect(catalog.fallback).toBe("DETERMINISTIC");
    }
  });
});

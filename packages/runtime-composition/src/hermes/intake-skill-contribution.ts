import { qaIntakeAssistSkill, qaIntakeReadinessSkill } from "@awp/competency-qa";
import type { SkillDefinition } from "@awp/platform-core";

function definition(
  source: typeof qaIntakeAssistSkill | typeof qaIntakeReadinessSkill,
): SkillDefinition {
  return Object.freeze({
    key: source.key,
    version: source.version,
    hash: source.outputSchemaRef.digest,
    allowedSubjects: Object.freeze(["DRAFT" as const]),
    outputSchemaRef: source.outputSchemaRef,
    actionAllowlist: Object.freeze(
      source.actionAllowlist.map((action) => Object.freeze({ ...action })),
    ),
    maxClassification: source.maxClassification,
  });
}

export const qaIntakeSkillContribution = Object.freeze({
  key: "competency-qa.intake-skills",
  definitions: Object.freeze([definition(qaIntakeAssistSkill), definition(qaIntakeReadinessSkill)]),
});

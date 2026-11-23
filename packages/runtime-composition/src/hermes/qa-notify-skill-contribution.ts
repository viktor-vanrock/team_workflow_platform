import { qaSkillCatalog } from "@awp/competency-qa";

import { qaSkillDefinitionSkeletons } from "./skill-registry.ts";

export const qaNotifySkillContribution = Object.freeze({
  key: "competency-qa.notification-intent-skill",
  catalog: Object.freeze(qaSkillCatalog.filter(({ key }) => key === "qa-notify")),
  definitions: Object.freeze(qaSkillDefinitionSkeletons().filter(({ key }) => key === "qa-notify")),
  fallback: "DENY" as const,
});

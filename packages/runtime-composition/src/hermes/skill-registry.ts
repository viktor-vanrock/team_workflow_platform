import { qaSkillCatalog } from "@awp/competency-qa";
import { sha256 } from "@awp/platform-contracts";
import {
  type AgentEffectClass,
  type AgentSubjectKind,
  type SkillDefinition,
  SkillDefinitionRegistry,
} from "@awp/platform-core";

const effectByAction = (action: string): AgentEffectClass =>
  action === "notification.intent.create"
    ? "NOTIFICATION_INTENT"
    : action.includes("propose")
      ? "PROPOSAL"
      : action === "draft.propose-patch"
        ? "DRAFT_MUTATION"
        : "READ_ONLY";

export function qaSkillDefinitionSkeletons(): readonly SkillDefinition[] {
  return Object.freeze(
    qaSkillCatalog.map((skill) => {
      const identity = {
        key: skill.key,
        version: skill.version,
        subjects: [...skill.subjects],
        outputSchemaId: skill.outputSchemaId,
        actions: [...skill.actions],
      };
      return Object.freeze({
        key: skill.key,
        version: skill.version,
        hash: sha256(identity),
        allowedSubjects: Object.freeze([...skill.subjects] as AgentSubjectKind[]),
        outputSchemaRef: Object.freeze({
          id: skill.outputSchemaId,
          version: 1,
          digest: sha256({ schema: skill.outputSchemaId }),
        }),
        actionAllowlist: Object.freeze(
          skill.actions.map((action) =>
            Object.freeze({ action, effectClass: effectByAction(action) }),
          ),
        ),
        maxClassification: "INTERNAL",
      });
    }),
  );
}

export function createHermesSkillRegistry(
  definitions: readonly SkillDefinition[] = qaSkillDefinitionSkeletons(),
): SkillDefinitionRegistry {
  const registry = new SkillDefinitionRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}

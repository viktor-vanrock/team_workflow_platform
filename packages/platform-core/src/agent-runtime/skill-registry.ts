export type AgentSubjectKind = "DRAFT" | "CANDIDATE" | "WORK_ITEM";
export type AgentEffectClass =
  "READ_ONLY" | "PROPOSAL" | "DRAFT_MUTATION" | "NOTIFICATION_INTENT" | "APPROVAL_REQUIRED";
export interface SkillDefinition {
  readonly key: string;
  readonly version: string;
  readonly hash: string;
  readonly allowedSubjects: readonly AgentSubjectKind[];
  readonly outputSchemaRef: Readonly<{ id: string; version: number; digest: string }>;
  readonly actionAllowlist: readonly Readonly<{ action: string; effectClass: AgentEffectClass }>[];
  readonly maxClassification: string;
}
export class SkillDefinitionRegistry {
  readonly #values = new Map<string, SkillDefinition>();
  register(value: SkillDefinition): void {
    const key = `${value.key}@${value.version}`;
    const existing = this.#values.get(key);
    if (existing && existing.hash !== value.hash) throw new Error("SKILL_DEFINITION_COLLISION");
    this.#values.set(key, Object.freeze(structuredClone(value)));
  }
  resolve(key: string, version: string): SkillDefinition {
    const value = this.#values.get(`${key}@${version}`);
    if (!value) throw new Error("SKILL_DEFINITION_NOT_FOUND");
    return value;
  }
  list(): readonly SkillDefinition[] {
    return Object.freeze([...this.#values.values()]);
  }
}

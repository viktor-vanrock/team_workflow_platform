export interface AgentDefinition {
  readonly key: string;
  readonly version: string;
  readonly servicePrincipalId: string;
  readonly skillRefs: readonly Readonly<{ key: string; version: string; hash: string }>[];
  readonly classificationCeiling: string;
}

export class AgentDefinitionRegistry {
  readonly #values = new Map<string, AgentDefinition>();
  register(definition: AgentDefinition): void {
    const key = `${definition.key}@${definition.version}`;
    const existing = this.#values.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition))
      throw new Error("AGENT_DEFINITION_COLLISION");
    this.#values.set(key, Object.freeze(structuredClone(definition)));
  }
  resolve(key: string, version: string): AgentDefinition {
    const value = this.#values.get(`${key}@${version}`);
    if (!value) throw new Error("AGENT_DEFINITION_NOT_FOUND");
    return value;
  }
  list(): readonly AgentDefinition[] {
    return Object.freeze([...this.#values.values()]);
  }
}

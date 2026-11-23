interface StoredIntent {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorPrincipalId: string;
  readonly expiresAt: Date;
  readonly resultRef?: string;
}
export class InMemoryInteractionIntentRepository {
  readonly #values = new Map<string, StoredIntent>();
  async issue(value: StoredIntent): Promise<void> {
    if (this.#values.has(value.id)) throw new Error("INTERACTION_INTENT_COLLISION");
    this.#values.set(value.id, structuredClone(value));
  }
  async consume(
    workspaceId: string,
    projectId: string,
    id: string,
    actorPrincipalId: string,
    resultRef: string,
    now: Date,
  ): Promise<Readonly<{ replayed: boolean; resultRef: string }>> {
    const value = this.#values.get(id);
    if (!value || value.workspaceId !== workspaceId || value.projectId !== projectId)
      throw new Error("INTERACTION_INTENT_NOT_FOUND");
    if (value.actorPrincipalId !== actorPrincipalId) throw new Error("INTERACTION_ACTOR_MISMATCH");
    if (now >= value.expiresAt) throw new Error("INTERACTION_EXPIRED");
    if (value.resultRef) {
      if (value.resultRef !== resultRef) throw new Error("INTERACTION_RESULT_CONFLICT");
      return Object.freeze({ replayed: true, resultRef });
    }
    this.#values.set(id, { ...value, resultRef });
    return Object.freeze({ replayed: false, resultRef });
  }
}

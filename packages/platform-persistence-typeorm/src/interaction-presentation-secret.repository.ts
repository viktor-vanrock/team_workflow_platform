export interface SealedPresentationSecret {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly intentId: string;
  readonly ciphertext: Uint8Array;
  readonly retainUntil: Date;
  readonly erasedAt?: Date;
}
export class InMemoryInteractionPresentationSecretRepository {
  readonly #values = new Map<string, SealedPresentationSecret>();
  store(value: SealedPresentationSecret): void {
    if (this.#values.has(value.intentId)) throw new Error("PRESENTATION_SECRET_COLLISION");
    this.#values.set(value.intentId, structuredClone(value));
  }
  load(
    workspaceId: string,
    projectId: string,
    intentId: string,
    now: Date,
  ): SealedPresentationSecret {
    const value = this.#values.get(intentId);
    if (
      !value ||
      value.workspaceId !== workspaceId ||
      value.projectId !== projectId ||
      value.erasedAt
    )
      throw new Error("PRESENTATION_SECRET_NOT_FOUND");
    if (now >= value.retainUntil) throw new Error("PRESENTATION_SECRET_EXPIRED");
    return structuredClone(value);
  }
  erase(intentId: string, at: Date): void {
    const value = this.#values.get(intentId);
    if (value) this.#values.set(intentId, { ...value, ciphertext: new Uint8Array(), erasedAt: at });
  }
}

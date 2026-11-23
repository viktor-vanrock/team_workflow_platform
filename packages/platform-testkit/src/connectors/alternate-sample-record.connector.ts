import type {
  SampleRecordConformanceConnector,
  SampleRecordInvocation,
} from "./conformance-kit.ts";

export class AlternateSampleRecordConnector implements SampleRecordConformanceConnector {
  readonly #effects = new Map<
    string,
    Readonly<{ externalRecordId: string; status: "PUBLISHED" }>
  >();
  async publish(
    input: SampleRecordInvocation,
  ): Promise<Readonly<{ externalRecordId: string; status: "PUBLISHED" }>> {
    const existing = this.#effects.get(input.effectIdempotencyKey);
    if (existing) return existing;
    const result = Object.freeze({
      externalRecordId: `alternate:${input.target.id}`,
      status: "PUBLISHED" as const,
    });
    this.#effects.set(input.effectIdempotencyKey, result);
    return result;
  }
  async effectCount(effectIdempotencyKey: string): Promise<number> {
    return this.#effects.has(effectIdempotencyKey) ? 1 : 0;
  }
}

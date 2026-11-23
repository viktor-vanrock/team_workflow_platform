import { defaultClassificationReferences } from "@awp/platform-contracts";

import type { ClassificationReference } from "../shared/primitives.ts";

export interface ClassificationCatalogEntry extends ClassificationReference {
  readonly retiredAt?: Date;
}

export interface ClassificationDecision {
  readonly ceiling: ClassificationReference;
  readonly resource: ClassificationReference;
  readonly allowed: boolean;
}

export class ClassificationCatalog {
  readonly #entries = new Map<string, ClassificationCatalogEntry>();

  constructor(entries: readonly ClassificationCatalogEntry[]) {
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.rank) || entry.rank < 0)
        throw new Error(`Invalid classification rank for ${entry.key}`);
      const current = this.#entries.get(entry.key);
      if (current !== undefined && current.rank !== entry.rank)
        throw new Error(`Classification key ${entry.key} is immutable`);
      if (
        [...this.#entries.values()].some(
          (value) => value.rank === entry.rank && value.key !== entry.key,
        )
      )
        throw new Error(`Classification rank ${entry.rank} is already assigned`);
      if (current !== undefined && current.retiredAt?.getTime() !== entry.retiredAt?.getTime())
        throw new Error(`Classification retirement for ${entry.key} is immutable`);
      this.#entries.set(
        entry.key,
        Object.freeze({
          key: entry.key,
          rank: entry.rank,
          ...(entry.retiredAt ? { retiredAt: new Date(entry.retiredAt) } : {}),
        }),
      );
    }
  }

  reference(key: string): ClassificationReference {
    const entry = this.#entries.get(key);
    if (entry === undefined) throw new Error(`Unknown classification ${key}`);
    return Object.freeze({ key: entry.key, rank: entry.rank });
  }

  assignableReference(key: string, at: Date): ClassificationReference {
    const entry = this.#entries.get(key);
    if (entry === undefined) throw new Error(`Unknown classification ${key}`);
    if (entry.retiredAt !== undefined && entry.retiredAt <= at)
      throw new Error("CLASSIFICATION_RETIRED");
    return this.reference(key);
  }

  evaluate(
    ceiling: ClassificationReference,
    resource: ClassificationReference,
  ): ClassificationDecision {
    const interpretedCeiling = this.#interpret(ceiling);
    const interpretedResource = this.#interpret(resource);
    return Object.freeze({
      ceiling: interpretedCeiling,
      resource: interpretedResource,
      allowed: interpretedResource.rank <= interpretedCeiling.rank,
    });
  }

  replay(decision: ClassificationDecision): ClassificationDecision {
    this.#interpret(decision.ceiling);
    this.#interpret(decision.resource);
    return Object.freeze({
      ceiling: Object.freeze({ ...decision.ceiling }),
      resource: Object.freeze({ ...decision.resource }),
      allowed: decision.allowed,
    });
  }

  retire(key: string, retiredAt: Date): ClassificationCatalog {
    const entry = this.#entries.get(key);
    if (entry === undefined) throw new Error(`Unknown classification ${key}`);
    if (entry.retiredAt !== undefined && entry.retiredAt.getTime() !== retiredAt.getTime())
      throw new Error(`Classification retirement for ${key} is immutable`);
    return new ClassificationCatalog(
      this.#snapshot().map((value) => (value.key === key ? { ...value, retiredAt } : value)),
    );
  }

  extend(entry: ClassificationCatalogEntry): ClassificationCatalog {
    const current = this.#entries.get(entry.key);
    if (current !== undefined && current.rank !== entry.rank)
      throw new Error(`Classification key ${entry.key} is immutable`);
    if (current !== undefined && current.retiredAt?.getTime() !== entry.retiredAt?.getTime())
      throw new Error(`Classification retirement for ${entry.key} is immutable`);
    return new ClassificationCatalog([...this.#snapshot(), entry]);
  }

  permits(ceiling: ClassificationReference, resource: ClassificationReference): boolean {
    return this.evaluate(ceiling, resource).allowed;
  }

  #interpret(reference: ClassificationReference): ClassificationReference {
    const canonical = this.reference(reference.key);
    if (canonical.rank !== reference.rank)
      throw new Error(`Classification key ${reference.key} has immutable rank ${canonical.rank}`);
    return canonical;
  }

  #snapshot(): readonly ClassificationCatalogEntry[] {
    return [...this.#entries.values()].map((entry) =>
      Object.freeze({
        key: entry.key,
        rank: entry.rank,
        ...(entry.retiredAt ? { retiredAt: new Date(entry.retiredAt) } : {}),
      }),
    );
  }
}

export const defaultClassificationCatalog = new ClassificationCatalog(
  defaultClassificationReferences,
);

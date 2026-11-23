import type { QaExternalImmutableRef } from "../domain/qa-project-context.ts";
import { makeScopeSnapshot, type QaScopeSnapshot } from "../domain/snapshots.ts";

export function buildScopeSnapshot(
  input: Readonly<{
    purpose: string;
    agreedScope: string;
    acceptanceOutcome: string;
    inclusions: readonly string[];
    exclusions: readonly string[];
    checklistDefinition: QaExternalImmutableRef;
  }>,
): QaScopeSnapshot {
  return makeScopeSnapshot(input);
}

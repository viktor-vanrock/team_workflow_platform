import type {
  ExternalCommandLifecycleContribution,
  ExternalCommandLifecyclePhase,
  ExternalCommandLifecycleTransaction,
  PackLifecycleDelta,
  ScopedExternalCommandContext,
} from "@awp/competency-sdk";

import { QaDomainError } from "../domain/primitives.ts";

export interface QaReadinessCommandLifecycleStore {
  apply(
    transaction: ExternalCommandLifecycleTransaction,
    input: Readonly<{
      phase: ExternalCommandLifecyclePhase;
      command: ScopedExternalCommandContext;
    }>,
  ): Promise<
    Readonly<{ replayed: boolean; currentInputExact: boolean; currentAssessmentExact: boolean }>
  >;
}

export function createQaReadinessCommandLifecycleContribution(
  store: QaReadinessCommandLifecycleStore,
): ExternalCommandLifecycleContribution {
  return Object.freeze({
    key: "qa.readiness.request-transition-lifecycle",
    order: 2200,
    matches: (input: ScopedExternalCommandContext) =>
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "request.transition" &&
      input.source.sourceWorkItemId !== undefined,
    apply: async (
      phase: ExternalCommandLifecyclePhase,
      command: ScopedExternalCommandContext,
      transaction: ExternalCommandLifecycleTransaction,
    ): Promise<PackLifecycleDelta> => {
      const result = await store.apply(transaction, { phase, command });
      if (
        phase === "APPROVAL_RELEASED" &&
        (!result.currentInputExact || !result.currentAssessmentExact)
      )
        throw new QaDomainError("QA_READINESS_COMMAND_STALE");
      return Object.freeze({
        idempotencyKey: `${command.commandId}:${phase}`,
        replayed: result.replayed,
        events: Object.freeze([]),
        audit: Object.freeze([]),
      });
    },
  });
}

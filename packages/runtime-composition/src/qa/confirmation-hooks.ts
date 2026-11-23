import {
  createQaRequestConfirmationHook,
  createQaTypeOrmCompletionConfirmationHook,
  createQaTypeOrmDefectConfirmationHook,
  type QaConfirmationIds,
  type QaIntakeConfirmationWriter,
  type QaRequestConfirmationMaterialPort,
} from "@awp/competency-qa/node";

import type { GenericHandlerContributions } from "../extensions/generic-handlers.ts";

/** QA-owned facts that may stop a Core SLA goal after their local transaction commits. */
export const qaUs5SlaLifecycleEventTypes = Object.freeze([
  "qa.test-session.state-changed",
  "qa.verdict.signed",
] as const);

export function qaUs1ConfirmationHookContributions(
  input: Readonly<{
    materials: QaRequestConfirmationMaterialPort;
    writer: QaIntakeConfirmationWriter;
    ids: QaConfirmationIds;
    now: () => string;
  }>,
): GenericHandlerContributions["confirmationHooks"] {
  return Object.freeze([createQaRequestConfirmationHook(input)]);
}

export function qaUs4ConfirmationHookContributions(
  input: Parameters<typeof qaUs1ConfirmationHookContributions>[0],
): GenericHandlerContributions["confirmationHooks"] {
  return Object.freeze([
    ...(qaUs1ConfirmationHookContributions(input) ?? []),
    createQaTypeOrmDefectConfirmationHook(),
  ]);
}

export function qaUs5ConfirmationHookContributions(
  input: Parameters<typeof qaUs1ConfirmationHookContributions>[0],
): GenericHandlerContributions["confirmationHooks"] {
  return Object.freeze([
    ...(qaUs4ConfirmationHookContributions(input) ?? []),
    createQaTypeOrmCompletionConfirmationHook(),
  ]);
}

import {
  createQaCompletionCommandLifecycleContribution,
  createQaDefectCommandLifecycleContribution,
  TypeOrmQaCompletionCommandLifecycleStore,
  TypeOrmQaDefectCommandLifecycleStore,
} from "@awp/competency-qa/node";

import type { GenericHandlerContributions } from "../extensions/generic-handlers.ts";

/**
 * Ordered QA callbacks installed in the generic external-command UoW.
 * Pack state is projected before the Core outbox can become dispatchable.
 */
export function qaUs5ExternalCommandLifecycleContributions(): GenericHandlerContributions["externalCommandLifecycle"] {
  return Object.freeze([
    createQaDefectCommandLifecycleContribution(new TypeOrmQaDefectCommandLifecycleStore()),
    createQaCompletionCommandLifecycleContribution(new TypeOrmQaCompletionCommandLifecycleStore()),
  ]);
}

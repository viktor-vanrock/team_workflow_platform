import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type {
  QaAuthorizationBasis,
  QaHumanActor,
  QaVerdictAggregate,
} from "@awp/competency-qa/node";

import { createDurableQaCompletionInvalidator } from "./completion-invalidation.ts";

/** Called under the request lock in the same transaction that replaces a verdict. */
export async function invalidateQaCompletionForVerdict(
  manager: EntityManager,
  verdict: QaVerdictAggregate,
  authorization: { actor: QaHumanActor; basis: QaAuthorizationBasis },
) {
  await createDurableQaCompletionInvalidator(manager).invalidatePending(
    {
      actor: authorization.actor,
      authorizationBasis: authorization.basis,
      scope: { kind: "PROJECT", workspaceId: verdict.workspaceId, projectId: verdict.projectId },
      correlationId: randomUUID(),
      causationId: randomUUID(),
    },
    verdict.workItemId,
    "QA_VERDICT_CHANGED",
  );
}

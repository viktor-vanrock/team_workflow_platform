import type { QaPlanItem } from "../domain/plan-item.ts";
import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import { prepareTestSession, type QaTestSession } from "../domain/test-session.ts";

export function prepareManualSession(
  input: Readonly<{
    session: QaTestSession;
    planItems: readonly QaPlanItem[];
    actor: QaHumanActor;
    at: string;
    expectedResourceVersion: number;
  }>,
): QaTestSession {
  if (
    input.planItems.length === 0 ||
    input.planItems.some((item) => item.sessionId !== input.session.id || item.state !== "PLANNED")
  )
    throw new QaDomainError("QA_SESSION_PLAN_INCOMPLETE");
  if (
    input.session.requiredCapabilities.length === 0 ||
    !input.session.targetSnapshot.contentHash ||
    !input.session.scopeSnapshot.contentHash
  )
    throw new QaDomainError("QA_SESSION_SNAPSHOT_INCOMPLETE");
  return prepareTestSession(input.session, input);
}

import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import {
  blockTestSession,
  cancelTestSession,
  type QaSessionMilestone,
  type QaTestSession,
  requestTestSessionReview,
  resumeBlockedTestSession,
} from "../domain/test-session.ts";

export function transitionExecutionSession(
  input: Readonly<{
    session: QaTestSession;
    requestedState: "REVIEW_REQUIRED" | "BLOCKED" | "CANCELLED" | QaSessionMilestone;
    actor: QaHumanActor;
    at: string;
    reason?: string;
    expectedResourceVersion: number;
    executionFacts: Readonly<{
      attempts: number;
      observations: number;
      results: number;
      terminalPlanItems: number;
      totalPlanItems: number;
    }>;
    revalidateResumeGuard?: (target: QaSessionMilestone) => boolean;
  }>,
): QaTestSession {
  if (input.actor.kind !== "HUMAN") throw new QaDomainError("QA_SESSION_HUMAN_TRANSITION_REQUIRED");
  if (
    input.session.state === "BLOCKED" &&
    ["PLANNED", "READY", "RUNNING", "REVIEW_REQUIRED"].includes(input.requestedState)
  ) {
    const target = input.requestedState as QaSessionMilestone;
    if (input.revalidateResumeGuard?.(target) === false)
      throw new QaDomainError("QA_SESSION_RESUME_GUARD_FAILED");
    return resumeBlockedTestSession(input.session, {
      actor: input.actor,
      at: input.at,
      target,
      expectedResourceVersion: input.expectedResourceVersion,
    });
  }
  if (input.requestedState === "BLOCKED")
    return blockTestSession(input.session, {
      actor: input.actor,
      at: input.at,
      reason: input.reason ?? "Session blocked by executor",
      expectedResourceVersion: input.expectedResourceVersion,
    });
  if (input.requestedState === "CANCELLED")
    return cancelTestSession(input.session, {
      actor: input.actor,
      at: input.at,
      reason: input.reason ?? "Session cancelled by executor",
      expectedResourceVersion: input.expectedResourceVersion,
      executionFacts: input.executionFacts,
    });
  if (input.requestedState === "REVIEW_REQUIRED")
    return requestTestSessionReview(input.session, {
      actor: input.actor,
      at: input.at,
      expectedResourceVersion: input.expectedResourceVersion,
      terminalPlanItems: input.executionFacts.terminalPlanItems,
      totalPlanItems: input.executionFacts.totalPlanItems,
    });
  throw new QaDomainError("QA_SESSION_EXECUTION_TRANSITION_INVALID");
}

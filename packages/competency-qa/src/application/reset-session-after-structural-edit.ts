import type { QaHumanActor } from "../domain/primitives.ts";
import type { QaScopeSnapshot, QaTargetSnapshot } from "../domain/snapshots.ts";
import { editPlannedSessionStructure, type QaTestSession } from "../domain/test-session.ts";

export function resetSessionAfterStructuralEdit(
  input: Readonly<{
    session: QaTestSession;
    actor: QaHumanActor;
    at: string;
    reason: string;
    expectedResourceVersion: number;
    ownerId?: string;
    requiredCapabilities?: readonly string[];
    targetSnapshot?: QaTargetSnapshot;
    scopeSnapshot?: QaScopeSnapshot;
  }>,
): QaTestSession {
  return editPlannedSessionStructure(input.session, input);
}

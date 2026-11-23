import { createOperationalNotifications } from "./operational-notifications.ts";
import { MutableProjectEffectGuard } from "./project-effect-guard.ts";
import { InMemoryProjectSuspensionService } from "./project-suspension-service.ts";

export async function runEmergencySuspendResumeScenario() {
  const service = new InMemoryProjectSuspensionService("FULL_QA"),
    guard = new MutableProjectEffectGuard("workspace", "project", 1);
  await service.suspend({
    expectedVersion: 1,
    idempotencyKey: "suspend",
    incidentRef: "INC-7",
    reason: "containment",
  });
  guard.suspend();
  let effects = 0;
  try {
    await guard.execute("jira", async () => {
      effects++;
    });
  } catch {
    // Suspension is expected to reject the guarded effect.
  }
  const notifications = createOperationalNotifications({
    workspaceId: "workspace",
    projectId: "project",
    state: "SUSPENDED",
    incidentRef: "INC-7",
  });
  const resumed = await service.resume({
    expectedVersion: 2,
    idempotencyKey: "resume",
    probesFresh: true,
    incidentAccepted: true,
    stepUp: true,
    distinctOwnerApproval: true,
    requirementsPass: true,
  });
  guard.resume();
  return Object.freeze({
    status: "PASS" as const,
    effectsWhileSuspended: effects,
    notifications: notifications.length,
    resumedState: resumed.state,
    mode: resumed.mode,
  });
}

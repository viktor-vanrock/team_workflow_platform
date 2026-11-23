import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../packages/platform-core/src/index.ts";
import {
  CandidateNotificationProjector,
  classifyMattermostConnectionHealth,
  createHermesSkillRegistry,
  MattermostIntakeNotificationProjector,
} from "../../packages/runtime-composition/src/index.ts";

describe("Feature 004 integrated local journey", () => {
  it("connects confirmed intake, candidate, Hermes and durable notification without authority shortcuts", () => {
    const intake = new MattermostIntakeNotificationProjector().confirmed({
      workspaceId: "w",
      projectId: "p",
      draftId: "d",
      confirmationVersion: 1,
      principalId: "human",
      workItemId: "wi",
      commandId: "command-intake",
      expiresAt: new Date("2026-09-03"),
      allowed: true,
    });
    expect(intake.intent?.state).toBe("QUEUED");
    const candidate = IntakeCandidateAggregate.discover({
      id: "c",
      workspaceId: "w",
      projectId: "p",
      deduplicationKey: "jira:1",
      currentSourceFingerprint: "sha256:1",
      expiresAt: new Date("2026-09-03"),
    });
    expect(
      candidate.decide("HUMAN", "CREATE", new Date("2026-09-01"), 1, {
        expectedSourceObservationVersion: 1,
        convertedDraftId: "d2",
      }),
    ).not.toHaveProperty("workItemId");
    expect(
      new CandidateNotificationProjector().project({
        workspaceId: "w",
        projectId: "p",
        candidateId: "c",
        candidateVersion: 2,
        sourceObservationVersion: 1,
        principalId: "human",
        commandId: "command-candidate",
        actionIntentIds: ["create", "snooze", "ignore"],
        expiresAt: new Date("2026-09-03"),
        allowed: true,
        event: "DISCOVERED",
      }).actionIntentIds,
    ).toEqual(["create", "snooze", "ignore"]);
    expect(createHermesSkillRegistry().list()).toHaveLength(9);
    expect(classifyMattermostConnectionHealth("OK").state).toBe("HEALTHY");
    expect(JSON.stringify({ intake })).not.toMatch(/token|secret|response_url/iu);
  });
});

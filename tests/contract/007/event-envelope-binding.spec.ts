import { describe, expect, it } from "vitest";

import {
  createProjectEventEnvelope,
  ProjectEventInbox,
} from "../../../packages/platform-core/src/project-onboarding/primitives.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 event envelope binding", () => {
  it("pins Project scope, immutable subject refs and Project partition keys", () => {
    const event = createProjectEventEnvelope({
      eventId: "event-1",
      eventType: "PROJECT_ONBOARDING_CHANGED",
      scope: projectScope(),
      subjectRef: exactRef("onboarding"),
      reasonCode: "MODE_CHANGED",
      relatedRefs: [exactRef("probe")],
      actor: humanActor(),
      occurredAt: onboardingFixture.now,
      correlationId: onboardingFixture.correlationId,
      causationId: "cause-1",
    });
    expect(event.partitionKey).toBe(
      `${onboardingFixture.workspaceId}:${onboardingFixture.projectA}`,
    );
    expect(event.payload.subjectRef.contentHash).toMatch(/^sha256:/u);
    expect(() =>
      createProjectEventEnvelope({
        ...event.payload,
        eventId: "event-2",
        scope: projectScope(onboardingFixture.projectB),
        subjectRef: { ...exactRef("onboarding"), projectId: onboardingFixture.projectA } as never,
      }),
    ).toThrow("EVENT_SCOPE_MISMATCH");
  });

  it("deduplicates at-least-once replay and quarantines mismatched duplicate content", () => {
    const inbox = new ProjectEventInbox();
    const input = {
      eventId: "event-1",
      eventType: "PROJECT_REGISTERED" as const,
      scope: projectScope(),
      subjectRef: exactRef("project"),
      reasonCode: "REGISTERED",
      relatedRefs: [],
      actor: humanActor(),
      occurredAt: onboardingFixture.now,
      correlationId: onboardingFixture.correlationId,
      causationId: "cause-1",
    };
    const event = createProjectEventEnvelope(input);
    expect(inbox.accept(event)).toBe("ACCEPTED");
    expect(inbox.accept(event)).toBe("DUPLICATE");
    expect(inbox.accept(createProjectEventEnvelope({ ...input, reasonCode: "DIFFERENT" }))).toBe(
      "QUARANTINED_MISMATCH",
    );
  });
});

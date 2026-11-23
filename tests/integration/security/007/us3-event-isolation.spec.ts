import { describe, expect, it } from "vitest";

import { InMemoryEventInbox } from "../../../../packages/platform-core/src/events/event-processing.ts";
import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import {
  filterAuthorizedProjectEvents,
  processAuthorizedProjectEvent,
} from "../../../../packages/runtime-composition/src/onboarding/event-subscriptions.ts";
import { createOnboardingEvent } from "../../../../packages/runtime-composition/src/onboarding/events.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../../support/007-onboarding-fixture.ts";

const token = () =>
  AuthorizedProjectQueryToken.issue({
    workspaceId: onboardingFixture.workspaceId,
    principalId: onboardingFixture.qaLeadId,
    permission: "events.read",
    projects: [
      {
        projectId: onboardingFixture.projectA,
        classificationCeilingRank: 20,
        operationalState: "ACTIVE",
        entitlementRef: { id: "a", version: 1 },
      },
    ],
    issuedAt: onboardingFixture.now,
  });
const event = (projectId: string, id: string) =>
  createOnboardingEvent({
    eventId: id,
    kind: "PROJECT_GATE_EVALUATED",
    ...projectScope(projectId),
    subjectRef: exactRef(`gate-${id}`),
    reasonCode: "PASS",
    actor: humanActor(),
    occurredAt: onboardingFixture.now,
    correlationId: onboardingFixture.correlationId,
    causationId: "cause",
  });

describe("Feature 007 US3 event isolation", () => {
  it("filters partitions and reauthorizes replay without hidden metadata", async () => {
    const visible = event(onboardingFixture.projectA, "visible");
    const hidden = event(onboardingFixture.forbiddenProjectC, "hidden");
    expect(filterAuthorizedProjectEvents(token(), [visible, hidden])).toEqual([visible]);
    const inbox = new InMemoryEventInbox();
    await expect(
      processAuthorizedProjectEvent(inbox, "consumer", visible, async () => token()),
    ).resolves.toMatchObject({ status: "PROCESSED" });
    await expect(
      processAuthorizedProjectEvent(inbox, "consumer", visible, async () =>
        AuthorizedProjectQueryToken.issue({
          workspaceId: onboardingFixture.workspaceId,
          principalId: onboardingFixture.qaLeadId,
          permission: "events.read",
          projects: [],
          issuedAt: onboardingFixture.now,
        }),
      ),
    ).rejects.toThrow("PROJECT_EVENT_NOT_AUTHORIZED");
    await expect(
      processAuthorizedProjectEvent(inbox, "consumer", hidden, async () => token()),
    ).rejects.toThrow("PROJECT_EVENT_NOT_AUTHORIZED");
    expect(JSON.stringify(inbox.quarantine)).not.toContain("Secret C");
  });
});

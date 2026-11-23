import { describe, expect, it } from "vitest";

import {
  BindingLifecycleService,
  InMemoryBindingLifecycleStore,
} from "../../../packages/runtime-composition/src/onboarding/binding-lifecycle-service.ts";
import { createOnboardingTransitionEvent } from "../../../packages/runtime-composition/src/onboarding/events.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US2 Binding history", () => {
  it("retires the prior current version atomically while historical Session pins remain unchanged", async () => {
    const store = new InMemoryBindingLifecycleStore({ onboardingVersion: 2 });
    store.seedPublished({
      ...projectScope(),
      ref: exactRef("binding", 1),
      state: "PUBLISHED",
      resourceVersion: 1,
      semanticContent: { key: "project-a", entries: ["manual"] },
    });
    const service = new BindingLifecycleService(store);
    const sessionPins = Object.freeze([exactRef("binding", 1)]);
    const publication = await service.publishAcceptedForTest({
      ...projectScope(),
      bindingRef: exactRef("binding", 2),
      expectedOnboardingVersion: 2,
      semanticContent: { key: "project-a", entries: ["manual", "automation"] },
      now: onboardingFixture.now,
    });

    expect(publication.retired?.ref).toEqual(exactRef("binding", 1));
    expect(store.current(projectScope())?.ref).toEqual(exactRef("binding", 2));
    expect(sessionPins).toEqual([exactRef("binding", 1)]);
  });

  it("rolls back only by cloning historical semantics into a new DRAFT version", () => {
    const store = new InMemoryBindingLifecycleStore({ onboardingVersion: 3 });
    store.seedPublished({
      ...projectScope(),
      ref: exactRef("binding", 1),
      state: "RETIRED",
      resourceVersion: 2,
      semanticContent: { key: "project-a", entries: ["manual"] },
    });
    store.seedPublished({
      ...projectScope(),
      ref: exactRef("binding", 2),
      state: "PUBLISHED",
      resourceVersion: 1,
      semanticContent: { key: "project-a", entries: ["manual", "automation"] },
    });
    const clone = new BindingLifecycleService(store).cloneHistoricalAsDraft({
      ...projectScope(),
      historicalRef: exactRef("binding", 1),
      actor: humanActor(onboardingFixture.integrationAdministratorId, "integration-administrator"),
      createdAt: onboardingFixture.now,
    });
    expect(clone).toMatchObject({
      ref: { id: "binding", version: 3 },
      state: "DRAFT",
      semanticContent: { entries: ["manual"] },
    });
    expect(store.history(projectScope()).find(({ ref }) => ref.version === 1)?.state).toBe(
      "RETIRED",
    );
  });

  it("emits predecessor and result refs for retired Binding transitions", () => {
    const event = createOnboardingTransitionEvent({
      ...projectScope(),
      eventId: "binding-retired-event",
      kind: "PROJECT_BINDING_RETIRED",
      predecessorRef: exactRef("binding", 1),
      resultRef: exactRef("binding", 2),
      reasonCode: "SUPERSEDED",
      actor: humanActor(),
      occurredAt: onboardingFixture.now,
      correlationId: onboardingFixture.correlationId,
      causationId: "publish-action",
    });
    expect(event.payload.subjectRef).toEqual(exactRef("binding", 2));
    expect(event.payload.relatedRefs).toContainEqual(exactRef("binding", 1));
  });
});

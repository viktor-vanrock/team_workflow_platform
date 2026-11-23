import { describe, expect, it } from "vitest";

import { acceptBindingFunctionally } from "../../../packages/runtime-composition/src/onboarding/binding-acceptance-service.ts";
import {
  BindingLifecycleService,
  InMemoryBindingLifecycleStore,
} from "../../../packages/runtime-composition/src/onboarding/binding-lifecycle-service.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

function approval(
  action: Awaited<ReturnType<BindingLifecycleService["requestPublication"]>>,
  suffix: string,
) {
  return {
    approvalId: `approval-${suffix}`,
    subjectKind: "PLATFORM_ACTION" as const,
    actionKind: action.kind,
    actionId: action.actionId,
    targetHash: action.contentHash,
    initiatorPrincipalId: action.initiator.principalId,
    approver: humanActor(`${onboardingFixture.workspaceOwnerId}-${suffix}`, "workspace-owner"),
    stepUpAt: onboardingFixture.now,
    approvedAt: onboardingFixture.now,
    expiresAt: onboardingFixture.later,
  };
}

describe("Feature 007 US2 Binding concurrency", () => {
  it("allows one serializable winner and deterministic stale conflicts", async () => {
    const store = new InMemoryBindingLifecycleStore({ onboardingVersion: 2 });
    store.seedPublished({
      ...projectScope(),
      ref: exactRef("binding", 0 + 1),
      state: "PUBLISHED",
      resourceVersion: 1,
      semanticContent: { entries: ["manual"] },
    });
    const service = new BindingLifecycleService(store);
    const validationReportRef = exactRef("validation");
    const request = async (version: number) => {
      const bindingRef = exactRef("binding", version);
      const acceptance = acceptBindingFunctionally({
        ...projectScope(),
        acceptanceId: `acceptance-${version}`,
        bindingRef,
        validationReportRef,
        qaProjectContextRef: exactRef("context"),
        acceptedResourceRefs: [exactRef("suite")],
        checklistRef: exactRef("checklist"),
        acceptedBy: humanActor(),
        acceptedAt: onboardingFixture.now,
      });
      return service.requestPublication({
        ...projectScope(),
        actionId: `action-${version}`,
        bindingRef,
        validationReportRef,
        acceptance,
        expectedOnboardingVersion: 2,
        initiator: humanActor(
          onboardingFixture.integrationAdministratorId,
          "integration-administrator",
        ),
        reason: "Competing publication",
        createdAt: onboardingFixture.now,
        expiresAt: onboardingFixture.later,
      });
    };
    const a = await request(2);
    const b = await service.requestRetirement({
      ...projectScope(),
      actionId: "action-retire",
      bindingRef: exactRef("binding", 1),
      expectedOnboardingVersion: 2,
      initiator: humanActor(
        onboardingFixture.integrationAdministratorId,
        "integration-administrator",
      ),
      reason: "Competing retirement",
      createdAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    });
    const results = await Promise.allSettled([
      service.publish({
        actionId: a.actionId,
        approval: approval(a, "a"),
        approverCurrentlyAuthorized: true,
        now: onboardingFixture.now,
      }),
      service.retire({
        actionId: b.actionId,
        approval: approval(b, "b"),
        approverCurrentlyAuthorized: true,
        now: onboardingFixture.now,
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      String((results.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason),
    ).toContain("ONBOARDING_VERSION_CONFLICT");
    expect(store.history(projectScope()).filter(({ state }) => state === "PUBLISHED")).toHaveLength(
      1,
    );

    const rollbacks = await Promise.allSettled([
      Promise.resolve().then(() =>
        service.cloneHistoricalAsDraft({
          ...projectScope(),
          historicalRef: exactRef("binding", 1),
          expectedNextVersion: 3,
          actor: humanActor(
            onboardingFixture.integrationAdministratorId,
            "integration-administrator",
          ),
          createdAt: onboardingFixture.now,
        }),
      ),
      Promise.resolve().then(() =>
        service.cloneHistoricalAsDraft({
          ...projectScope(),
          historicalRef: exactRef("binding", 1),
          expectedNextVersion: 3,
          actor: humanActor(
            onboardingFixture.integrationAdministratorId,
            "integration-administrator",
          ),
          createdAt: onboardingFixture.now,
        }),
      ),
    ]);
    expect(rollbacks.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(
      String(
        (rollbacks.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason,
      ),
    ).toContain("BINDING_ROLLBACK_VERSION_CONFLICT");
  });
});

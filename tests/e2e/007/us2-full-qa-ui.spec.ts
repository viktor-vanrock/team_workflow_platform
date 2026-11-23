import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectOnboardingWorkspace } from "../../../packages/competency-qa/src/ui/project-onboarding.tsx";
import { exactRef, onboardingFixture, projectScope } from "../../support/007-onboarding-fixture.ts";

const render = renderToStaticMarkup as (
  node: ReturnType<typeof ProjectOnboardingWorkspace>,
) => string;

describe("Feature 007 US2 full-QA workspace", () => {
  it("shows GitLab suite acceptance, transition history, rollback lineage and messaging fallback", () => {
    const binding = exactRef("binding", 2);
    const markup = render(
      ProjectOnboardingWorkspace({
        view: {
          project: {
            id: projectScope().projectId,
            key: "A",
            name: "Project A",
            owners: ["owner", "qa-lead"],
            classificationKey: "INTERNAL",
          },
          stage: "SHADOW",
          capabilityMode: "FULL_QA",
          operationalState: "ACTIVE",
          bindingRef: binding,
          qaProjectContextRef: exactRef("context"),
          gates: [
            { key: "C1", outcome: "PASS", safeIssueCodes: [] },
            { key: "N2", outcome: "PASS", safeIssueCodes: [] },
            { key: "P3", outcome: "PASS", safeIssueCodes: [] },
          ],
          probes: [
            {
              logicalRole: "TEST_EXECUTION",
              status: "AVAILABLE",
              validUntil: onboardingFixture.later,
            },
          ],
          approval: { state: "CONSUMED", approverRole: "workspace-owner" },
          reasonCodes: [],
          canEvaluate: true,
          canRequestPublication: false,
          automationSuite: {
            suiteRef: exactRef("suite"),
            acceptance: "ACCEPTED",
            pipelineContractHash: exactRef("pipeline").contentHash,
            environmentRef: exactRef("environment"),
          },
          bindingHistory: [
            { ref: exactRef("binding", 1), state: "RETIRED" },
            { ref: binding, state: "PUBLISHED", clonedFromRef: exactRef("binding", 1) },
          ],
          modeTransitions: [
            {
              from: "MANUAL_ONLY",
              to: "FULL_QA",
              reasonCode: "PROJECT_CAPABILITY_MODE_CHANGED",
              occurredAt: onboardingFixture.now,
            },
          ],
          messagingFallback: "WEB_AND_OUTBOX",
        },
        onEvaluate: () => undefined,
        onRequestPublication: () => undefined,
      }),
    );
    expect(markup).toContain("Приёмка набора автоматизации");
    expect(markup).toContain("Полный QA");
    expect(markup).toContain("Только ручная проверка → Полный QA");
    expect(markup).toContain("клонировано из binding@1");
    expect(markup).toContain("Веб-интерфейс и устойчивая очередь уведомлений доступны");
  });
});

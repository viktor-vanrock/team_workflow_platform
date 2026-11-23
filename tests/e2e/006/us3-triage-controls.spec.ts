import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QaQueueItem } from "../../../packages/competency-qa/src/ui/queue-item.tsx";
import { triageFixture } from "../../helpers/006/triage-fixture.ts";

const render = renderToStaticMarkup as (node: ReturnType<typeof QaQueueItem>) => string;

describe("US3 factorized triage and accepted-control journey", () => {
  it("renders bounded factors, evidence, missing information, staleness and audited before/after", () => {
    const assessment = triageFixture();
    const markup = render(
      QaQueueItem({
        entry: {
          queueEntryId: "q1",
          revision: 2,
          semanticHash: assessment.inputFingerprint,
          inputFingerprint: assessment.inputFingerprint,
          stage: "READY",
          stageDetails: ["ready"],
          stageReasonCodes: ["READY_FACTS_CONFIRMED"],
          subject: { kind: "WORK_ITEM", id: "work-item-1" },
          operational: { state: "KNOWN", rawStatus: { name: "Ready" }, normalizedStatus: "READY" },
          control: { state: "KNOWN", resourceVersion: 2, serviceClass: "STANDARD" },
          freshness: { state: "CURRENT", evaluatedAt: assessment.createdAt },
          consistencyWarnings: [],
        },
        assessment: {
          assessmentId: assessment.assessmentId,
          revision: assessment.revision,
          state: "CURRENT",
          dimensions: assessment.dimensions,
          dimensionDetails: assessment.dimensionDetails,
          missingInformation: assessment.missingInformation,
          inputFingerprint: assessment.inputFingerprint,
          ruleVersion: assessment.ruleVersion,
          skillVersion: assessment.skillVersion,
        },
        acceptedControl: {
          revision: 2,
          recordedAt: assessment.createdAt,
          recordedBy: "lead",
          serviceClass: "STANDARD",
          before: { risk: "UNKNOWN" },
          after: { risk: "HIGH" },
          reason: "Human accepted selected value",
        },
        onAcceptPlanningValues: () => undefined,
        onSetFixedDate: () => undefined,
        onClearServiceClass: () => undefined,
      }),
    );
    expect(markup).toContain("Факторизованное предложение по сортировке");
    expect(markup).toContain("BUSINESS_IMPACT_MISSING");
    expect(markup).toContain("уверенность");
    expect(markup).toContain("Принятое управление, редакция 2");
    expect(markup).toContain("до");
    expect(markup).toContain("после");
    expect(markup).toContain("подтверждённому сроку Jira");
    expect(markup).not.toContain("totalScore");
  });

  it("disables acceptance for a stale assessment", () => {
    const assessment = triageFixture();
    const markup = render(
      QaQueueItem({
        entry: {
          queueEntryId: "q1",
          revision: 2,
          semanticHash: assessment.inputFingerprint,
          inputFingerprint: assessment.inputFingerprint,
          stage: "READY",
          stageDetails: [],
          stageReasonCodes: [],
          subject: { kind: "WORK_ITEM", id: "work-item-1" },
          operational: { state: "KNOWN" },
          control: { state: "KNOWN" },
          freshness: { state: "STALE", evaluatedAt: assessment.createdAt },
          consistencyWarnings: [],
        },
        assessment: {
          assessmentId: assessment.assessmentId,
          revision: 1,
          state: "STALE",
          dimensions: assessment.dimensions,
          dimensionDetails: assessment.dimensionDetails,
          missingInformation: assessment.missingInformation,
          inputFingerprint: assessment.inputFingerprint,
        },
        onAcceptPlanningValues: () => undefined,
      }),
    );
    expect(markup).toContain("не может быть принято");
    expect(markup).toContain("disabled");
  });
});

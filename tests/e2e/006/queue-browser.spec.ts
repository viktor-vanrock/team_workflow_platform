import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QaQueueItem } from "../../../packages/competency-qa/src/ui/queue-item.tsx";
import { QaQueueWorkspace } from "../../../packages/competency-qa/src/ui/queue-workspace.tsx";

const render = renderToStaticMarkup as (node: ReturnType<typeof QaQueueWorkspace>) => string;

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

describe("US2 entitlement-safe queue browser", () => {
  it("shows authorized counts, partitions, explanations, stale recovery and exact order controls", () => {
    const markup = render(
      QaQueueWorkspace({
        page: {
          workspaceId: "w1",
          scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: hash("1") },
          freshness: "STALE",
          comparatorRef: "queue-order@1.0.0",
          orderState: { resourceVersion: 4, queueEpoch: 2, baseVisibleSetHash: hash("2") },
          visibleCounts: {
            total: 2,
            byStage: { CANDIDATE: 0, BACKLOG: 1, READY: 1, ACTIVE: 0, COMPLETED: 0 },
          },
          items: [
            {
              ordinal: 1,
              entry: {
                queueEntryId: "q-a",
                projectId: "A",
                stage: "BACKLOG",
                subject: { kind: "WORK_ITEM", id: "a" },
                ordering: { components: { serviceClassBand: "STANDARD", slaState: "NOT_STARTED" } },
                operational: { state: "KNOWN", displayStatus: "Open" },
                freshness: { state: "STALE" },
              },
            },
            {
              ordinal: 2,
              entry: {
                queueEntryId: "q-b",
                projectId: "B",
                stage: "READY",
                subject: { kind: "WORK_ITEM", id: "b" },
                ordering: { components: { serviceClassBand: "FIXED_DATE", slaState: "AT_RISK" } },
                operational: { state: "KNOWN", displayStatus: "Ready" },
                freshness: { state: "CURRENT" },
              },
            },
          ],
          nextCursor: "q1.recover",
        },
        onReload: () => undefined,
        onLoadMore: () => undefined,
        onMove: () => undefined,
      }),
    );

    expect(markup).toContain("Разрешённый портфель");
    expect(markup).toContain("Видно: 2");
    expect(markup).toContain("Бэклог: 1");
    expect(markup).toContain("Готово: 1");
    expect(markup).toContain("queue-order@1.0.0");
    expect(markup).toContain("Устарело");
    expect(markup).toContain("Обновить текущую проекцию");
    expect(markup).toContain("Загрузить ещё");
    expect(markup).toContain("Переместить в начало");
    expect(markup).not.toContain("c-secret");
  });

  it("renders an independently inspectable US1-US5 item journey with exact accepted provenance", () => {
    const markup = render(
      QaQueueItem({
        entry: {
          queueEntryId: "queue-a-ready",
          revision: 7,
          semanticHash: hash("a"),
          inputFingerprint: hash("b"),
          stage: "READY",
          stageDetails: ["QA_READY", "JIRA_READY_CONFIRMED"],
          stageReasonCodes: ["READY_CONFIRMED"],
          subject: { kind: "WORK_ITEM", id: "A-17" },
          operational: {
            state: "CONFIRMED",
            rawStatus: { id: "10017", name: "Ready for QA" },
            normalizedStatus: "READY",
            externalDisplayKey: "A-17",
          },
          control: { state: "ACCEPTED", resourceVersion: 3, serviceClass: "EXPEDITE" },
          freshness: { state: "CURRENT", evaluatedAt: "2026-09-03T10:00:00.000Z" },
          consistencyWarnings: [],
        },
        assessment: {
          assessmentId: "assessment-a-17",
          revision: 2,
          state: "CURRENT",
          dimensions: {
            risk: "HIGH",
            businessImpact: "CUSTOMER_VISIBLE",
            dependencyReadiness: "READY",
          },
          dimensionDetails: {
            risk: {
              confidence: 0.9,
              explanation: "Accepted evidence-backed risk",
              factRefs: [0, 1],
            },
          },
          inputFingerprint: hash("c"),
          ruleVersion: "queue-triage@1.1.0",
          skillVersion: "qa-triage@1.1.0",
        },
        acceptedControl: {
          revision: 3,
          recordedAt: "2026-09-03T09:30:00.000Z",
          recordedBy: "lead.alpha",
          serviceClass: "EXPEDITE",
          before: { serviceClass: "STANDARD" },
          after: { serviceClass: "EXPEDITE" },
          assessmentRef: { sourceId: "assessment-a-17", sourceVersion: 2, semanticHash: hash("c") },
          reason: "Customer-visible blocker",
        },
        capacity: {
          occupancy: "OCCUPIED",
          policyMode: "ENFORCED",
          projectWarning: "ABOVE_SOFT_LIMIT",
          claimRef: { sourceId: "claim-a-17", sourceVersion: 1, semanticHash: hash("d") },
          override: {
            actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
            approvalId: "approval-a-17",
            approvedBy: "lead.beta",
            expiresAt: "2026-09-04T09:30:00.000Z",
          },
        },
        sla: {
          policyMode: "ENFORCED",
          goals: [
            {
              goal: "READY_TO_FIRST_QA_START",
              clockState: "RUNNING",
              targetState: "AT_RISK",
              targetConfiguration: {
                state: "CONFIGURED",
                targetBusinessSeconds: 28_800,
                remainingBusinessSeconds: 3_600,
                computedTargetAt: "2026-09-03T18:00:00.000Z",
              },
              elapsedBusinessSeconds: 25_200,
              startedAt: "2026-09-03T09:00:00.000Z",
              pause: { state: "NOT_PAUSED" },
              clockCycle: 1,
              clockRevisionRef: { id: "clock-a-17", version: 2, semanticHash: hash("e") },
              policyFacetRef: { id: "policy-a", version: 1, semanticHash: hash("f") },
              calendarRef: { id: "calendar-a", version: 1, semanticHash: hash("1") },
              startSourceRef: {
                sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
                sourceId: "jira-a-17",
                sourceVersion: 4,
                semanticHash: hash("2"),
                confirmedAt: "2026-09-03T09:00:00.000Z",
              },
              freshness: "CURRENT",
              asOf: "2026-09-03T16:00:00.000Z",
              evaluationHash: hash("3"),
            },
          ],
        },
        onAcceptPlanningValues: () => undefined,
        onRequestWipOverride: () => undefined,
        onRequestExpedite: () => undefined,
      }),
    );

    expect(markup).toContain("Этап платформы · Готово");
    expect(markup).toContain("Подтверждённое состояние Jira:");
    expect(markup).toContain("Факторизованное предложение по сортировке");
    expect(markup).toContain("Принятое управление, редакция 3");
    expect(markup).toContain("Загрузка · Занято");
    expect(markup).toContain("Исключение для срочной ёмкости");
    expect(markup).toContain("согласовано пользователем lead.beta");
    expect(markup).toContain("Прозрачность SLA");
    expect(markup).toContain("Источник начала Редакция рабочей проекции Jira");
    expect(markup).not.toContain("C-secret");
  });
});

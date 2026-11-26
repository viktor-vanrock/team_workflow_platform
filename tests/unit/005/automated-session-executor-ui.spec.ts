import { describe, expect, it } from "vitest";

import { QaAutomatedSessionExecutor } from "../../../packages/competency-qa/src/ui/automated-session-executor.tsx";

function visibleStrings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(visibleStrings);
  if (value === null || typeof value !== "object") return [];
  if ("props" in value) return visibleStrings((value as Readonly<{ props: unknown }>).props);
  return Object.values(value as Readonly<Record<string, unknown>>).flatMap(visibleStrings);
}

describe("Automated Session HUMAN review UI", () => {
  it.each([
    ["SCHEMA_VALIDATED", "Проверка сообщила о неполном результате; файл результата проверен."],
    ["SYNTHETIC_INCOMPLETE", "Не удалось получить или проверить полный результат проверки."],
  ] as const)("explains %s for an incomplete result", (normalizationKind, expected) => {
    const id = "attempt-1";
    const view = QaAutomatedSessionExecutor({
      attempts: [
        {
          automationAttemptId: id,
          testSessionId: "session",
          planItemId: "plan",
          attemptNo: 1,
          reason: "INITIAL",
          rootAttemptId: id,
          currentStatus: "TERMINAL",
          currentStatusRevisionNo: 1,
          resourceVersion: 1,
          createdAt: "2026-01-01T00:00:00Z",
          execution: { state: "CONFIRMED" },
        },
      ],
      statusByAttempt: {},
      resultByAttempt: {
        [id]: {
          outcome: "INCOMPLETE",
          normalizationKind,
          resultHash: "hash",
          artifactSyncState: "UNAVAILABLE",
          terminalAt: "2026-01-01T00:00:00Z",
        },
      },
      notice: "",
      manualHref: "/",
      onLaunch: () => undefined,
      onReload: () => undefined,
    });
    expect(visibleStrings(view).join(" ")).toContain(expected);
  });
  it("renders the complete Attempt timeline, artifacts, quarantine, flaky disposition, and blockers", () => {
    const attemptId = "attempt-000000000000000000000001";
    const view = QaAutomatedSessionExecutor({
      attempts: [
        {
          automationAttemptId: attemptId,
          testSessionId: "session-1",
          planItemId: "plan-item-1",
          attemptNo: 1,
          reason: "INITIAL",
          rootAttemptId: attemptId,
          currentStatus: "TERMINAL",
          currentStatusRevisionNo: 2,
          resourceVersion: 2,
          createdAt: "2026-09-02T09:00:00.000Z",
          execution: { state: "CONFIRMED" },
        },
      ],
      statusByAttempt: {
        [attemptId]: [
          {
            revisionNo: 2,
            status: "TERMINAL",
            providerStatus: "FAILED",
            source: "RECONCILIATION_READ",
            observedAt: "2026-09-02T09:05:00.000Z",
            recordedAt: "2026-09-02T09:05:01.000Z",
          },
        ],
      },
      resultByAttempt: {
        [attemptId]: {
          outcome: "ASSERTION_FAILED",
          normalizationKind: "SCHEMA_VALIDATED",
          resultHash: `sha256:${"a".repeat(64)}`,
          artifactSyncState: "PARTIAL",
          terminalAt: "2026-09-02T09:05:00.000Z",
        },
      },
      retryDecisionByAttempt: {
        [attemptId]: {
          decision: "NOT_APPLICABLE",
          reasonCode: "ASSERTION_FAILURE_NOT_RETRYABLE",
          contentHash: `sha256:${"b".repeat(64)}`,
        },
      },
      artifactsByAttempt: {
        [attemptId]: [
          {
            artifactReferenceId: "artifact-reference-1",
            automationAttemptId: attemptId,
            artifactKind: "REPORT",
            mediaType: "application/json",
            byteSize: 1024,
            classification: "INTERNAL",
            availability: "CHECKSUM_MISMATCH",
          },
        ],
      },
      quarantineWarnings: [
        {
          quarantineId: "quarantine-1",
          subject: { kind: "INFRASTRUCTURE_CODE", infrastructureCode: "RUNNER_LOST" },
          currentRevisionNo: 4,
          currentRevisionHash: `sha256:${"c".repeat(64)}`,
          effectiveState: "ACTIVE",
        },
      ],
      humanReview: {
        attemptSetHash: `sha256:${"d".repeat(64)}`,
        reviewable: false,
        reviewFlags: ["FLAKY_SUSPECTED"],
        blockers: [{ code: "QA_FINDING_DISPOSITION_REQUIRED", subjectId: "finding-1" }],
        flakyDisposition: { state: "REQUIRED", findingId: "finding-1" },
      },
      operationalHealth: {
        connectionHealth: "AUTH_DEGRADED",
        freshness: "ERROR",
        executionActivity: "RECONCILING",
        reasonCodes: ["AUTH_REVOKED", "RECONCILIATION_STALE"],
        lastAuthoritativeReadAt: "2026-09-02T09:04:00.000Z",
      },
      notice: "Review required.",
      manualHref: "/qa/manual",
      onLaunch: () => undefined,
      onReload: () => undefined,
    });
    const text = visibleStrings(view).join(" ");

    expect(text).toContain("История состояний");
    expect(text).toContain("Проверка не пройдена");
    expect(text).toContain("Ошибка проверки не допускает автоматический повтор");
    expect(text).toContain("Доступность артефактов");
    expect(text).toContain("Контрольная сумма не совпадает");
    expect(text).toContain("Предупреждение о карантине");
    expect(text).toContain("Исполнитель потерян");
    expect(text).toContain("Подозрение на нестабильность");
    expect(text).toContain("Требуется решение по результату QA");
    expect(text).toContain("Только уполномоченный специалист");
    expect(text).toContain("Подключение: Проблемы с авторизацией");
    expect(text).toContain("Актуальность: Ошибка");
    expect(text).toContain("Активность: Выполняется сверка");
    expect(text).toContain("Авторизация отозвана");
    expect(text).toContain("Достоверное состояние GitLab недоступно");
    expect(text).toContain("Ручная проверка QA доступна");
    expect(text).toContain("Открыть ручное выполнение сеанса");
  });
});

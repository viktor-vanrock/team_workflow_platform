import { useCallback, useEffect, useState } from "react";

import {
  QaAutomatedSession,
  QaAutomatedSessionExecutor,
  type QaAutomatedSessionSelection,
  type QaAutomatedSessionView,
  type QaAutomationAttemptView,
  type QaAutomationAvailabilityView,
  type QaAutomationLaunchConfirmationView,
  type QaAutomationOperationalHealthView,
  type QaAutomationStatusRevisionView,
  type QaAutomationSuiteChoice,
  type QaAutomationTargetChoice,
} from "@awp/competency-qa/ui";
import { Alert, Stack, Typography } from "@awp/platform-ui";

interface AutomatedSessionRouteProps {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly permissions?: readonly string[];
}

interface SuiteListGroup {
  readonly header: Readonly<{ id: string; suiteKey: string }>;
  readonly versions: readonly Readonly<{
    version: number;
    state: string;
    contentHash: string;
    content: Readonly<{
      allowedTargetTypes: readonly ("MERGE_REQUEST" | "COMMIT" | "BUILD")[];
      allowedEnvironmentRefs: readonly string[];
    }>;
  }>[];
}

interface CreatedSessionResponse {
  readonly session: Readonly<{
    id: string;
    state: string;
    targetSnapshotHash: string;
    scopeSnapshotHash: string;
    configurationPinSetHash: string;
  }>;
  readonly targetSnapshot: Readonly<{
    configurationPins: QaAutomatedSessionView["configurationPins"];
  }>;
}

const currentCommitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const boundedTargets: readonly QaAutomationTargetChoice[] = Object.freeze([
  Object.freeze({
    key: "current-reviewed-change",
    label: "Текущий проверенный запрос на слияние · !17",
    type: "MERGE_REQUEST",
    mergeRequestRef: "!17",
    commitSha: currentCommitSha,
  }),
  Object.freeze({
    key: "current-commit",
    label: "Текущий неизменяемый коммит",
    type: "COMMIT",
    commitSha: currentCommitSha,
  }),
  Object.freeze({
    key: "current-build",
    label: "Текущая завершённая сборка · 101",
    type: "BUILD",
    buildRef: "pipeline:101",
    commitSha: currentCommitSha,
  }),
]);

const parameterPresets = Object.freeze([
  Object.freeze({ key: "default", label: "Параметры по умолчанию", value: Object.freeze({}) }),
  Object.freeze({
    key: "single-shard",
    label: "Один сегмент · en-US",
    value: Object.freeze({ shard: 1, locale: "en-US" }),
  }),
  Object.freeze({
    key: "split-shard",
    label: "Два сегмента · en-US",
    value: Object.freeze({ shard: 2, locale: "en-US" }),
  }),
]);

function operationalHealth(
  response: Response,
  fallbackActivity: QaAutomationOperationalHealthView["executionActivity"],
): QaAutomationOperationalHealthView | undefined {
  const connectionHealth = response.headers.get("x-awp-gitlab-connection-health");
  const freshness = response.headers.get("x-awp-gitlab-freshness");
  const activity = response.headers.get("x-awp-automation-execution-activity") ?? fallbackActivity;
  if (
    !new Set(["AVAILABLE", "BACKOFF", "AUTH_DEGRADED", "UNAVAILABLE"]).has(
      connectionHealth ?? "",
    ) ||
    !new Set(["CURRENT", "PENDING", "STALE", "ERROR"]).has(freshness ?? "") ||
    !new Set([
      "IDLE",
      "TRIGGER_PENDING",
      "RUNNING",
      "RETRY_PENDING",
      "RECONCILING",
      "TERMINAL",
    ]).has(activity)
  )
    return undefined;
  const lastAuthoritativeReadAt =
    response.headers.get("x-awp-gitlab-last-authoritative-read") ?? undefined;
  const nextEligibleAt = response.headers.get("x-awp-gitlab-next-eligible-at") ?? undefined;
  return Object.freeze({
    connectionHealth: connectionHealth as QaAutomationOperationalHealthView["connectionHealth"],
    freshness: freshness as QaAutomationOperationalHealthView["freshness"],
    executionActivity: activity as QaAutomationOperationalHealthView["executionActivity"],
    reasonCodes: Object.freeze(
      (response.headers.get("x-awp-gitlab-reason-codes") ?? "").split(",").filter(Boolean),
    ),
    ...(lastAuthoritativeReadAt === undefined ? {} : { lastAuthoritativeReadAt }),
    ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }),
  });
}

export function QaAutomatedSessionRoute(props: Readonly<AutomatedSessionRouteProps>) {
  const [availability, setAvailability] = useState<QaAutomationAvailabilityView>();
  const [suites, setSuites] = useState<readonly QaAutomationSuiteChoice[]>([]);
  const [workItemId, setWorkItemId] = useState<string>();
  const [choices, setChoices] = useState<
    readonly {
      requestExtension: { workItemId: string };
      currentRequestInputRevision: { title: string };
    }[]
  >([]);
  const [session, setSession] = useState<QaAutomatedSessionView>();
  const [confirmation, setConfirmation] = useState<QaAutomationLaunchConfirmationView>();
  const [sessionEtag, setSessionEtag] = useState<string>();
  const [attempts, setAttempts] = useState<readonly QaAutomationAttemptView[]>([]);
  const [statusByAttempt, setStatusByAttempt] = useState<
    Readonly<Record<string, readonly QaAutomationStatusRevisionView[]>>
  >({});
  const [executorOperationalHealth, setExecutorOperationalHealth] =
    useState<QaAutomationOperationalHealthView>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Загрузка подтверждённых параметров автоматизации.");
  const base = `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}`;

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${props.accessToken}`);
      headers.set("content-type", "application/json");
      return await fetch(`${props.apiUrl}${path}`, { ...init, headers });
    },
    [props.accessToken, props.apiUrl],
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [availabilityResponse, suiteResponse, backlogResponse] = await Promise.all([
        request(`${base}/qa/automation/availability`),
        request(`${base}/qa/automation/suite-bindings`),
        request(`${base}/qa/backlog`),
      ]);
      if (availabilityResponse.status === 503) {
        const body = (await availabilityResponse.json().catch(() => undefined)) as
          { message?: unknown } | undefined;
        if (body?.message === "Недоступно: нет подтверждений runner, network и no-deploy") {
          setAvailability(undefined);
          setSuites([]);
          setNotice(
            "Автоматизация недоступна: нет подтверждений готовности runner, сети и отсутствия deploy.",
          );
          return;
        }
      }
      if (!availabilityResponse.ok)
        throw new Error(
          `Не удалось проверить доступность автоматизации: ${availabilityResponse.status}`,
        );
      if (!suiteResponse.ok)
        throw new Error(`Не удалось загрузить список наборов: ${suiteResponse.status}`);
      if (!backlogResponse.ok)
        throw new Error(`Не удалось загрузить бэклог QA: ${backlogResponse.status}`);
      const availabilityBody = (await availabilityResponse.json()) as QaAutomationAvailabilityView;
      setExecutorOperationalHealth(operationalHealth(availabilityResponse, "IDLE"));
      const groups = (await suiteResponse.json()) as readonly SuiteListGroup[];
      const backlog = (await backlogResponse.json()) as Readonly<{
        items: readonly {
          requestExtension: { workItemId: string };
          currentRequestInputRevision: { title: string };
        }[];
      }>;
      setAvailability(availabilityBody);
      setChoices(backlog.items);
      setSuites(
        Object.freeze(
          groups.flatMap(({ header, versions }) =>
            versions
              .filter(({ state }) => state === "PUBLISHED")
              .map((version) =>
                Object.freeze({
                  id: header.id,
                  suiteKey: header.suiteKey,
                  version: version.version,
                  state: "PUBLISHED" as const,
                  contentHash: version.contentHash,
                  allowedTargetTypes: Object.freeze([...version.content.allowedTargetTypes]),
                  allowedEnvironmentRefs: Object.freeze([
                    ...version.content.allowedEnvironmentRefs,
                  ]),
                }),
              ),
          ),
        ),
      );
      setNotice(
        availabilityBody.launchPermitted
          ? "Автоматизация доступна. Проверьте ограниченный набор вариантов перед созданием сеанса."
          : "Автоматизация недоступна для текущего проекта; используйте сохранённый ручной сценарий.",
      );
    } catch (error) {
      setNotice(`Не удалось загрузить автоматизацию: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [base, request]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load();
    });
    return () => {
      current = false;
    };
  }, [load]);

  const loadExecutor = useCallback(
    async (sessionId: string) => {
      const sessionPath = `${base}/qa/automated-sessions/${sessionId}`;
      const [confirmationResponse, attemptsResponse] = await Promise.all([
        request(`${sessionPath}/launch-confirmation`),
        request(`${sessionPath}/attempts`),
      ]);
      if (!attemptsResponse.ok)
        throw new Error(`Не удалось загрузить список попыток: ${attemptsResponse.status}`);
      const loadedAttempts = (await attemptsResponse.json()) as readonly QaAutomationAttemptView[];
      setExecutorOperationalHealth(
        operationalHealth(attemptsResponse, loadedAttempts.length === 0 ? "IDLE" : "RUNNING"),
      );
      if (confirmationResponse.ok) {
        setConfirmation((await confirmationResponse.json()) as QaAutomationLaunchConfirmationView);
        setSessionEtag(confirmationResponse.headers.get("etag") ?? undefined);
      } else if (confirmationResponse.status === 409) {
        setConfirmation(undefined);
      } else {
        throw new Error(
          `Не удалось загрузить подтверждение запуска: ${confirmationResponse.status}`,
        );
      }
      const histories = await Promise.all(
        loadedAttempts.map(async (attempt) => {
          const response = await request(
            `${sessionPath}/attempts/${attempt.automationAttemptId}/status-revisions`,
          );
          if (!response.ok)
            throw new Error(`Не удалось загрузить состояние попытки: ${response.status}`);
          return Object.freeze([
            attempt.automationAttemptId,
            (await response.json()) as readonly QaAutomationStatusRevisionView[],
          ] as const);
        }),
      );
      setAttempts(Object.freeze([...loadedAttempts]));
      setStatusByAttempt(Object.freeze(Object.fromEntries(histories)));
    },
    [base, request],
  );

  const create = useCallback(
    async (selection: QaAutomatedSessionSelection) => {
      setBusy(true);
      try {
        const response = await request(`${base}/qa/automated-sessions`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(selection),
        });
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        const created = (await response.json()) as CreatedSessionResponse;
        setSession(
          Object.freeze({
            id: created.session.id,
            state: created.session.state,
            targetSnapshotHash: created.session.targetSnapshotHash,
            scopeSnapshotHash: created.session.scopeSnapshotHash,
            configurationPinSetHash: created.session.configurationPinSetHash,
            configurationPins: Object.freeze([...created.targetSnapshot.configurationPins]),
          }),
        );
        await loadExecutor(created.session.id);
        setNotice(
          "Готовый сеанс создан с одним неизменяемым снимком цели и тремя точными фиксациями конфигурации. Конвейер не запускался.",
        );
      } catch (error) {
        setNotice(`Не удалось создать автоматизированный сеанс: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [base, loadExecutor, request],
  );

  const launch = useCallback(
    async (serverConfirmation: QaAutomationLaunchConfirmationView, etag: string) => {
      if (!session) return;
      setBusy(true);
      try {
        const response = await request(`${base}/qa/automated-sessions/${session.id}/attempts`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID(), "if-match": etag },
          body: JSON.stringify({ confirmation: serverConfirmation }),
        });
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        const currentEtag = response.headers.get("etag");
        if (currentEtag) setSessionEtag(currentEtag);
        setConfirmation(undefined);
        await loadExecutor(session.id);
        setNotice(
          response.status === 201
            ? "Попытка и сохраняемая команда созданы. Выполнение у поставщика продолжается асинхронно."
            : "Существующая попытка воспроизведена; дублирующая команда не создана.",
        );
      } catch (error) {
        setNotice(`Не удалось запустить автоматизацию: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [base, loadExecutor, request, session],
  );

  return (
    <>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography component="label" htmlFor="automation-request">
          Запрос для автоматической проверки
        </Typography>
        <select
          id="automation-request"
          value={workItemId ?? ""}
          onChange={(event) => {
            setWorkItemId(event.target.value || undefined);
            setSession(undefined);
            setConfirmation(undefined);
            setAttempts([]);
            setStatusByAttempt({});
          }}
        >
          <option value="">Выберите запрос</option>
          {choices.map((item) => (
            <option key={item.requestExtension.workItemId} value={item.requestExtension.workItemId}>
              {item.currentRequestInputRevision.title}
            </option>
          ))}
        </select>
        {!props.permissions?.includes("qa.automation.session.plan") && (
          <Alert severity="info">
            Доступен просмотр. Подготовка автоматических проверок требует права планирования QA.
          </Alert>
        )}
      </Stack>
      <QaAutomatedSession
        {...(workItemId === undefined ? {} : { workItemId })}
        {...(availability === undefined ? {} : { availability })}
        {...(session === undefined ? {} : { session })}
        suites={suites}
        targets={boundedTargets}
        parameterPresets={parameterPresets}
        busy={busy}
        notice={notice}
        manualHref="/qa/requests"
        onReload={() => void load()}
        canPlan={!!props.permissions?.includes("qa.automation.session.plan")}
        onCreate={(selection) => void create(selection)}
      />
      {session && (
        <QaAutomatedSessionExecutor
          {...(confirmation === undefined ? {} : { confirmation })}
          {...(sessionEtag === undefined ? {} : { etag: sessionEtag })}
          attempts={attempts}
          statusByAttempt={statusByAttempt}
          {...(executorOperationalHealth === undefined
            ? {}
            : { operationalHealth: executorOperationalHealth })}
          busy={busy}
          notice={notice}
          manualHref="/qa/requests"
          canLaunch={!!props.permissions?.includes("qa.automation.session.plan")}
          onLaunch={(value, etag) => void launch(value, etag)}
          onReload={() =>
            void loadExecutor(session.id).catch((error: unknown) =>
              setNotice(`Не удалось обновить выполнение: ${String(error)}`),
            )
          }
        />
      )}
    </>
  );
}

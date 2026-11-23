import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  formatRuDateTime,
  formatRuUiValue,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import type { QaRequestKind } from "../manifest.ts";

export interface QaBrowserApiContext {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface DraftState {
  readonly draftId: string;
  readonly state: string;
  readonly resourceVersion: number;
}

export interface QaGuidedRevision {
  readonly revision: number;
  readonly contentHash: string;
  readonly sourceKind: string;
  readonly createdAt: string;
}
export function QaGuidedRevisionHistory({
  items,
}: Readonly<{ items: readonly QaGuidedRevision[] }>) {
  return (
    <Stack spacing={1}>
      <Typography variant="h6">История редакций</Typography>
      {items.map((item) => (
        <Typography key={`${item.revision}:${item.contentHash}`} variant="body2">
          редакция {item.revision} · {formatRuUiValue(item.sourceKind)} ·{" "}
          {item.contentHash.slice(0, 18)}… · {formatRuDateTime(item.createdAt)}
        </Typography>
      ))}
    </Stack>
  );
}
export function QaImmutableConfirmationSummary({
  projectLabel,
  revision,
  contentHash,
}: Readonly<{ projectLabel: string; revision: number; contentHash: string }>) {
  return (
    <Alert severity="warning">
      Подтверждается неизменяемый снимок: {projectLabel} · редакция {revision} · {contentHash}
    </Alert>
  );
}

async function qaFetch(
  context: QaBrowserApiContext,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${context.accessToken}`);
  headers.set("content-type", "application/json");
  return await fetch(`${context.apiUrl}${path}`, { ...init, headers });
}

const requestDescriptions: Readonly<Record<QaRequestKind, string>> = {
  "feature-validation":
    "Проверьте новую или изменённую функцию: опишите поведение, которое должно работать.",
  smoke: "Быстро убедитесь, что основные функции работают после обновления.",
  regression: "Убедитесь, что изменения не сломали ранее работавшие функции.",
  retest: "Повторите проверку после исправления. Нужна точная ссылка на предыдущий сеанс.",
  investigation: "Исследуйте проблему, когда её причина или точные условия ещё неизвестны.",
};
type IntakePhase = "editing" | "review" | "processing" | "confirmed";
interface RequestSnapshot {
  readonly title: string;
  readonly requestKind: QaRequestKind;
  readonly goal: string;
  readonly scope: string;
  readonly acceptanceOutcome: string;
  readonly businessImpact: string;
  readonly blockersDeclared: boolean;
  readonly dependenciesDeclared: boolean;
  readonly historicalSessionId: string;
  readonly historicalVersion: string;
  readonly historicalHash: string;
}
export function QaRequesterIntake({
  context,
  onChanged,
  onConfirmed,
  projectLabel,
}: Readonly<{
  context: QaBrowserApiContext;
  onChanged?: () => void;
  onConfirmed?: (workItemId: string) => void;
  projectLabel?: string;
}>) {
  const [title, setTitle] = useState("");
  const [requestKind, setRequestKind] = useState<QaRequestKind>("feature-validation");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("");
  const [acceptanceOutcome, setAcceptanceOutcome] = useState("");
  const [businessImpact, setBusinessImpact] = useState("");
  const [blockersDeclared, setBlockersDeclared] = useState(false);
  const [dependenciesDeclared, setDependenciesDeclared] = useState(false);
  const [historicalSessionId, setHistoricalSessionId] = useState("");
  const [historicalVersion, setHistoricalVersion] = useState("");
  const [historicalHash, setHistoricalHash] = useState("");
  const [draft, setDraft] = useState<DraftState>();
  const [snapshot, setSnapshot] = useState<RequestSnapshot>();
  const [phase, setPhase] = useState<IntakePhase>("editing");
  const [status, setStatus] = useState<Record<string, unknown>>();
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const inFlight = useRef(false);
  const live = useRef(true);
  const confirmedId = useRef<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const changeCallback = useRef(onChanged);
  useEffect(() => {
    changeCallback.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (phase !== "editing") heading.current?.focus();
  }, [phase]);
  const base = useMemo(
    () => `/api/v1/workspaces/${context.workspaceId}/projects/${context.projectId}`,
    [context.projectId, context.workspaceId],
  );
  const acceptStatus = useCallback((current: Record<string, unknown>) => {
    if (!live.current) return;
    setStatus(current);
    if (
      (current.command_state === "CONFIRMED" || current.state === "CONFIRMED") &&
      current.work_item_id
    ) {
      const id = String(current.work_item_id);
      setPhase("confirmed");
      setPolling(false);
      setIsError(false);
      setNotice(
        "Запрос появился в проекте. Откройте его, чтобы следить за проверками и результатом.",
      );
      if (confirmedId.current !== id) {
        confirmedId.current = id;
        changeCallback.current?.();
      }
    } else if (
      ["FAILED", "REJECTED", "CANCELLED", "EXPIRED", "AMBIGUOUS", "DEAD_LETTER"].includes(
        String(current.command_state),
      )
    ) {
      setPolling(false);
      setIsError(true);
      setNotice(
        "Система не подтвердила создание запроса. Данные черновика сохранены. Проверьте состояние или передайте сведения из раздела «Технические детали» администратору.",
      );
    }
  }, []);
  const refreshStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!draft) return;
      const response = await qaFetch(context, `${base}/intake-drafts/${draft.draftId}/qa-status`, {
        signal: signal ?? null,
      });
      if (!response.ok) throw new Error("status");
      const current = (await response.json()) as Record<string, unknown>;
      if (!signal?.aborted) acceptStatus(current);
    },
    [acceptStatus, base, context, draft],
  );
  useEffect(() => {
    if (phase !== "processing" || !polling || !draft) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const tick = async () => {
      try {
        await refreshStatus(controller.signal);
      } catch {
        if (!controller.signal.aborted && live.current) {
          setPolling(false);
          setIsError(true);
          setNotice(
            "Не удалось узнать результат отправки. Запрос мог быть обработан. Нажмите «Проверить состояние» — повторно заполнять форму не нужно.",
          );
        }
        return;
      }
      if (controller.signal.aborted) return;
      if (++attempts < 60) timer = setTimeout(() => void tick(), 1000);
      else {
        setPolling(false);
        setNotice(
          "Обработка занимает больше времени, чем обычно. Итог пока неизвестен. Можно проверить состояние этого же запроса вручную.",
        );
      }
    };
    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [draft, phase, polling, refreshStatus]);
  async function createDraft() {
    if (inFlight.current || !title.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setIsError(false);
    setNotice("");
    const saved = {
      title: title.trim(),
      requestKind,
      goal: goal.trim(),
      scope: scope.trim(),
      acceptanceOutcome: acceptanceOutcome.trim(),
      businessImpact: businessImpact.trim(),
      blockersDeclared,
      dependenciesDeclared,
      historicalSessionId: historicalSessionId.trim(),
      historicalVersion: historicalVersion.trim(),
      historicalHash: historicalHash.trim(),
    };
    try {
      const payload = {
        schemaVersion: 1,
        title: saved.title,
        requestKind,
        requestedClassificationKey: "INTERNAL",
        ...(saved.goal ? { goal: saved.goal } : {}),
        ...(saved.scope ? { scope: saved.scope } : {}),
        ...(saved.acceptanceOutcome ? { acceptanceOutcome: saved.acceptanceOutcome } : {}),
        ...(saved.businessImpact ? { businessImpact: saved.businessImpact } : {}),
        ...(blockersDeclared ? { blockers: [] } : {}),
        ...(dependenciesDeclared ? { dependencies: [] } : {}),
        ...(requestKind === "retest"
          ? {
              previousSessionRef: {
                kind: "EXTERNAL_HISTORICAL",
                historicalSessionRef: {
                  kind: "historical-session",
                  id: historicalSessionId.trim(),
                  version: historicalVersion.trim(),
                  contentHash: historicalHash.trim(),
                },
              },
            }
          : {}),
      };
      const response = await qaFetch(context, `${base}/qa/intake`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(String(response.status));
      const created = (await response.json()) as DraftState;
      if (!live.current) return;
      setDraft(created);
      setSnapshot(saved);
      setStatus(undefined);
      setPhase("review");
    } catch {
      if (live.current) {
        setIsError(true);
        setNotice(
          "Не удалось сохранить черновик. Ваш текст остался в форме. Проверьте соединение и попробуйте ещё раз.",
        );
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function confirmDraft() {
    if (!draft || inFlight.current || phase !== "review") return;
    inFlight.current = true;
    setBusy(true);
    setIsError(false);
    setNotice("");
    setPhase("processing");
    try {
      const response = await qaFetch(
        context,
        `${base}/intake-drafts/${draft.draftId}/qa-confirmation`,
        { method: "POST", headers: { "idempotency-key": `qa-ui:${draft.draftId}` }, body: "{}" },
      );
      if (!response.ok) throw new Error(String(response.status));
      const result = (await response.json()) as Record<string, unknown>;
      if (!live.current) return;
      if (result.state === "CONFIRMED" && result.workItemId)
        acceptStatus({
          state: result.state,
          command_state: result.state,
          work_item_id: result.workItemId,
        });
      else {
        setNotice(
          "Запрос обрабатывается. Статус обновляется автоматически; отправлять его повторно не нужно.",
        );
        setPolling(true);
      }
    } catch {
      if (live.current) {
        setIsError(true);
        setNotice(
          "Не удалось получить подтверждение отправки. Проверьте состояние сохранённого черновика: результат пока неизвестен.",
        );
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  const titleForPhase = {
    editing: "Создание QA-запроса",
    review: "Проверьте запрос перед отправкой",
    processing: "Запрос отправляется",
    confirmed: "Запрос создан",
  }[phase];
  return (
    <Card>
      <CardContent>
        <Stack spacing={3}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: "wrap", gap: 1 }}
            aria-label="Этапы создания запроса"
          >
            {["Описание", "Проверка", "Результат"].map((label, index) => (
              <Chip
                key={label}
                size="small"
                variant={
                  index === (phase === "editing" ? 0 : phase === "review" ? 1 : 2)
                    ? "filled"
                    : "outlined"
                }
                color={
                  index === (phase === "editing" ? 0 : phase === "review" ? 1 : 2)
                    ? "primary"
                    : "default"
                }
                label={`${index + 1}. ${label}`}
              />
            ))}
          </Stack>
          <Box>
            <Typography component="h2" variant="h4" ref={heading} tabIndex={-1}>
              {titleForPhase}
            </Typography>
            {projectLabel && <Typography color="text.secondary">Проект {projectLabel}</Typography>}
          </Box>
          {phase === "editing" && (
            <Box
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                void createDraft();
              }}
            >
              <Stack spacing={2.5}>
                <Typography color="text.secondary">
                  Назовите запрос и выберите тип проверки. Остальные сведения помогут команде начать
                  быстрее — заполните то, что известно.
                </Typography>
                <TextField
                  label="Название"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Например: проверить оплату банковской картой"
                  helperText="Обязательное поле. Коротко опишите задачу."
                  disabled={busy}
                />
                <label htmlFor="qa-request-kind">Вид запроса</label>
                <select
                  id="qa-request-kind"
                  value={requestKind}
                  disabled={busy}
                  onChange={(event) => setRequestKind(event.target.value as QaRequestKind)}
                >
                  {(
                    [
                      "feature-validation",
                      "smoke",
                      "regression",
                      "retest",
                      "investigation",
                    ] as const
                  ).map((kind) => (
                    <option key={kind} value={kind}>
                      {formatRuUiValue(kind)}
                    </option>
                  ))}
                </select>
                <Typography variant="body2" color="text.secondary">
                  {requestDescriptions[requestKind]}
                </Typography>
                <TextField
                  label="Цель (необязательно)"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Что хотите узнать по итогам проверки?"
                  disabled={busy}
                />
                <TextField
                  label="Область проверки (необязательно)"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  placeholder="Какие функции, страницы или сценарии проверить?"
                  multiline
                  minRows={2}
                  disabled={busy}
                />
                <TextField
                  label="Ожидаемый результат приёмки (необязательно)"
                  value={acceptanceOutcome}
                  onChange={(event) => setAcceptanceOutcome(event.target.value)}
                  placeholder="Например: после оплаты заказ появляется в личном кабинете"
                  multiline
                  minRows={2}
                  disabled={busy}
                />
                <Box component="details">
                  <summary>Дополнительные сведения</summary>
                  <Stack spacing={2}>
                    <TextField
                      label="Влияние на бизнес (необязательно)"
                      value={businessImpact}
                      onChange={(event) => setBusinessImpact(event.target.value)}
                      disabled={busy}
                    />
                    <Typography variant="body2" color="text.secondary">
                      Отметьте только то, что знаете точно. Если не уверены, оставьте отметки
                      пустыми.
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={blockersDeclared}
                          onChange={(event) => setBlockersDeclared(event.target.checked)}
                          disabled={busy}
                        />
                      }
                      label="Блокирующих факторов нет"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={dependenciesDeclared}
                          onChange={(event) => setDependenciesDeclared(event.target.checked)}
                          disabled={busy}
                        />
                      }
                      label="Зависимостей нет"
                    />
                  </Stack>
                </Box>
                {requestKind === "retest" && (
                  <Stack spacing={2}>
                    <Alert severity="info">
                      Используйте точную ссылку из истории предыдущей проверки. Если этих сведений
                      нет, уточните их у исполнителя QA.
                    </Alert>
                    <TextField
                      label="ID предыдущего внешнего сеанса"
                      value={historicalSessionId}
                      onChange={(event) => setHistoricalSessionId(event.target.value)}
                    />
                    <TextField
                      label="Версия предыдущего сеанса"
                      value={historicalVersion}
                      onChange={(event) => setHistoricalVersion(event.target.value)}
                    />
                    <TextField
                      label="Хэш предыдущего сеанса"
                      value={historicalHash}
                      onChange={(event) => setHistoricalHash(event.target.value)}
                      placeholder="sha256:…"
                    />
                  </Stack>
                )}
                <Box>
                  <Button
                    variant="contained"
                    type="submit"
                    disabled={
                      busy ||
                      !title.trim() ||
                      (requestKind === "retest" &&
                        (!historicalSessionId.trim() ||
                          !historicalVersion.trim() ||
                          !/^sha256:[a-f0-9]{64}$/u.test(historicalHash.trim())))
                    }
                  >
                    {busy ? "Сохраняем…" : "Проверить запрос"}
                  </Button>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1 }}
                  >
                    На следующем шаге вы проверите содержание. В работу запрос уйдёт после
                    отдельного подтверждения.
                  </Typography>
                </Box>
              </Stack>
            </Box>
          )}
          {snapshot && phase !== "editing" && (
            <Box
              sx={{
                bgcolor: "background.default",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                p: 2.5,
              }}
            >
              <Typography variant="h6">{snapshot.title}</Typography>
              <Typography color="text.secondary">
                {formatRuUiValue(snapshot.requestKind)}
              </Typography>
              <Box
                component="dl"
                sx={{
                  mb: 0,
                  "& dt": { fontWeight: 600, mt: 1.5 },
                  "& dd": { m: 0, whiteSpace: "pre-wrap" },
                }}
              >
                {(
                  [
                    ["Цель", snapshot.goal],
                    ["Область проверки", snapshot.scope],
                    ["Ожидаемый результат", snapshot.acceptanceOutcome],
                    ["Влияние на бизнес", snapshot.businessImpact],
                  ] as const
                ).map(([label, value]) => (
                  <Box key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Не указано"}</dd>
                  </Box>
                ))}
                {snapshot.requestKind === "retest" && (
                  <>
                    <dt>Предыдущий сеанс</dt>
                    <dd>
                      {snapshot.historicalSessionId} · версия {snapshot.historicalVersion} ·{" "}
                      {snapshot.historicalHash}
                    </dd>
                  </>
                )}
                <dt>Блокирующие факторы и зависимости</dt>
                <dd>
                  {snapshot.blockersDeclared
                    ? "Блокирующих факторов нет"
                    : "Блокирующие факторы не уточнены"}
                  . {snapshot.dependenciesDeclared ? "Зависимостей нет" : "Зависимости не уточнены"}
                  .
                </dd>
              </Box>
            </Box>
          )}
          {phase === "review" && (
            <>
              <Alert severity="info">
                Сохранённый черновик ещё не отправлен. Подтверждение создаст запрос в Jira и
                передаст его команде QA.
              </Alert>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="contained" onClick={() => void confirmDraft()} disabled={busy}>
                  Отправить запрос
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(undefined);
                    setSnapshot(undefined);
                    setNotice("");
                    setPhase("editing");
                  }}
                >
                  Изменить
                </Button>
              </Stack>
            </>
          )}
          {notice && (
            <Alert
              role={isError ? "alert" : "status"}
              severity={isError ? "error" : phase === "confirmed" ? "success" : "info"}
            >
              {notice}
            </Alert>
          )}
          {phase === "processing" && (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                {polling && <CircularProgress size={20} />}
                <Typography>Сохранённый запрос ожидает подтверждённого результата.</Typography>
              </Stack>
              <Box>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void refreshStatus().catch(() => {
                      setIsError(true);
                      setNotice(
                        "Статус пока недоступен. Повторите проверку позже; сохранённый запрос не потерян.",
                      );
                    })
                  }
                >
                  Проверить состояние
                </Button>
              </Box>
            </Stack>
          )}
          {phase === "confirmed" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              {onConfirmed && (
                <Button
                  variant="contained"
                  onClick={() => {
                    const id = status?.work_item_id;
                    if (id) onConfirmed(String(id));
                  }}
                >
                  Открыть запрос
                </Button>
              )}
              <Button
                onClick={() => {
                  setPhase("editing");
                  setDraft(undefined);
                  setSnapshot(undefined);
                  setTitle("");
                  setRequestKind("feature-validation");
                  setHistoricalSessionId("");
                  setHistoricalVersion("");
                  setHistoricalHash("");
                  setGoal("");
                  setScope("");
                  setAcceptanceOutcome("");
                  setBusinessImpact("");
                  setBlockersDeclared(false);
                  setDependenciesDeclared(false);
                  setStatus(undefined);
                  setNotice("");
                }}
              >
                Создать ещё запрос
              </Button>
            </Stack>
          )}
          {draft && (
            <Box component="details">
              <summary>Технические детали</summary>
              <Typography variant="body2">Черновик: {draft.draftId}</Typography>
              <Typography variant="body2">
                Состояние: {formatRuUiValue(status?.command_state ?? draft.state)}
              </Typography>
              {status?.work_item_id ? (
                <Typography variant="body2">Запрос: {String(status.work_item_id)}</Typography>
              ) : null}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

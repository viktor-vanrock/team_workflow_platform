import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import {
  PilotBrowserClient,
  PilotClientError,
  type PilotHealthView,
  type PilotReadinessView,
  type PilotSelection,
  type PilotSession,
  validPilotSelection,
} from "./pilot-client.ts";

const defaultClient = new PilotBrowserClient();
const emptySelection: PilotSelection = { workspaceId: "", projectId: "", deploymentId: "" };
const inputLabels = [
  ["Эталонный проект и область тестирования", "QA-лид и владельцы систем"],
  ["Версии и возможности поставщиков", "Владельцы интеграций"],
  ["Корпоративная идентификация", "Владелец IAM"],
  ["Секреты и подпись", "Владелец безопасности"],
  ["Сеть и обратные вызовы", "Владельцы сети и интеграций"],
  ["Телеметрия и дежурство", "Оператор платформы"],
  ["Хранение и срок жизни подтверждающих материалов", "Владельцы QA и хранилища"],
  ["Резервное копирование и восстановление", "Владелец платформы и базы данных"],
  ["Сканеры безопасности", "Владелец безопасности"],
  ["Участники и период пилота", "Спонсор и QA-лид"],
  ["Базовые показатели и измерения", "QA-лид и спонсор"],
  ["Процедуры инцидента и отката", "Платформа, безопасность и спонсор"],
] as const;
const gateLabels = {
  L0: "Инженерные проверки",
  C1: "Проверенные входные данные",
  N2: "Соответствие тестового контура",
  P3: "Условия пилота",
};
const reasons: Readonly<Record<string, string>> = {
  CAPABILITY_CONFIGURATION_UNAVAILABLE:
    "Попросите владельца интеграции опубликовать необходимую привязку и профиль.",
  CAPABILITY_PROBE_MISSING: "Попросите владельца интеграции выполнить эту проверку возможности.",
  CAPABILITY_PROBE_EXPIRED:
    "Попросите владельца интеграции обновить просроченную проверку возможности.",
  CAPABILITY_PROBE_UNVERIFIED:
    "Попросите владельца интеграции подтвердить текущие результаты проверки возможности.",
  GATE_EVIDENCE_MISSING: "Выполните этот контрольный этап для текущей ревизии развёртывания.",
  GATE_EVIDENCE_EXPIRED: "Выполните этот контрольный этап повторно: срок результатов истёк.",
  GATE_EVIDENCE_UNVERIFIED:
    "Попросите владельца контрольного этапа проверить отчёт и текущую политику подписания.",
  INPUT_PACKAGE_UNAVAILABLE:
    "Попросите владельца пилота опубликовать проверенный пакет входных данных.",
  INPUT_PACKAGE_EXPIRED: "Попросите владельца входных данных проверить и обновить эти материалы.",
};
const issueText = (codes: readonly string[]) =>
  [
    ...new Set(
      codes.map((code) => reasons[code] ?? "Разберите эту проверку с ответственным владельцем."),
    ),
  ].join(" ");
const fresh = (value: string | undefined, now: number) =>
  value !== undefined && Date.parse(value) > now;
const time = (value?: string) => formatRuDateTime(value);
const message = (error: unknown) =>
  error instanceof PilotClientError
    ? {
        PILOT_LOGIN_REQUIRED: "Срок действия сеанса истёк. Войдите снова.",
        PILOT_ACCESS_DENIED:
          "Доступ к проекту отсутствует. Попросите владельца проекта проверить ваши права.",
        PILOT_RESOURCE_MISSING:
          "Это развёртывание недоступно. Проверьте выбранный проект и развёртывание.",
        PILOT_SCOPE_INVALID: "Введите корректные ID рабочей области, проекта и развёртывания.",
        PILOT_RESPONSE_INVALID:
          "Не удалось проверить готовность. Попросите оператора платформы проверить сервис.",
        PILOT_UNAVAILABLE:
          "Сервис недоступен. Повторите проверку или обратитесь к оператору платформы.",
      }[error.code]
    : "Сервис недоступен. Повторите проверку или обратитесь к оператору платформы.";

export interface PilotReadinessRouteProps {
  readonly initialSelection?: PilotSelection;
  readonly returnPath?: string;
  readonly client?: PilotBrowserClient;
  readonly navigate?: (url: string) => void;
}
export function PilotReadinessRoute({
  initialSelection = emptySelection,
  returnPath = "/pilot/readiness",
  client = defaultClient,
  navigate = (url) => window.location.assign(url),
}: PilotReadinessRouteProps) {
  const [selection, setSelection] = useState(initialSelection);
  const [session, setSession] = useState<PilotSession>();
  const [result, setResult] = useState<{
    health: PilotHealthView;
    readiness: PilotReadinessView;
  }>();
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const pending = useRef<AbortController | undefined>(undefined);
  const clear = useCallback(() => {
    pending.current?.abort();
    pending.current = undefined;
    setResult(undefined);
  }, []);
  const start = useCallback(() => {
    clear();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice(undefined);
    return controller;
  }, [clear]);

  useEffect(() => {
    let current = true;
    let controller: AbortController | undefined;
    queueMicrotask(() => {
      if (!current) return;
      controller = start();
      void client
        .session(controller.signal)
        .then((value) => {
          if (!controller?.signal.aborted) setSession(value);
        })
        .catch((error: unknown) => {
          if (!controller?.signal.aborted) setNotice(message(error));
        })
        .finally(() => {
          if (!controller?.signal.aborted) setBusy(false);
        });
    });
    return () => {
      current = false;
      controller?.abort();
    };
  }, [client, start]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current && session && Date.parse(session.expiresAt) <= now) {
        clear();
        setSession(undefined);
        setBusy(false);
        setNotice("Срок действия сеанса истёк. Войдите снова.");
      }
    });
    return () => {
      current = false;
    };
  }, [clear, now, session]);
  useEffect(() => () => pending.current?.abort(), []);

  const refresh = useCallback(async () => {
    if (!validPilotSelection(selection)) {
      clear();
      setNotice("Введите корректные ID рабочей области, проекта и развёртывания.");
      return;
    }
    const controller = start();
    try {
      const current = await client.session(controller.signal);
      if (controller.signal.aborted) return;
      setSession(current);
      if (!current) throw new PilotClientError("PILOT_LOGIN_REQUIRED");
      const [health, readiness] = await Promise.all([
        client.health(selection, controller.signal),
        client.readiness(selection, controller.signal),
      ]);
      if (!controller.signal.aborted) {
        setNow(Date.now());
        setResult({ health, readiness });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(message(error));
        if (error instanceof PilotClientError && error.code === "PILOT_LOGIN_REQUIRED")
          setSession(undefined);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [selection, client, clear, start]);
  useEffect(() => {
    if (!result) return;
    const recheck = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(recheck, 30_000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [result, refresh]);

  async function login(stepUp = false) {
    const controller = start();
    try {
      const url = await client.beginLogin(
        returnPath,
        stepUp ? session?.csrfToken : undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) navigate(url);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(message(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function logout() {
    if (!session) return;
    const controller = start();
    try {
      await client.logout(session.csrfToken, controller.signal);
      if (!controller.signal.aborted) {
        setSession(undefined);
        setNotice("Вы вышли из системы.");
      }
    } catch {
      if (!controller.signal.aborted)
        setNotice("Не удалось подтвердить выход. Попробуйте выйти ещё раз.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const readiness = result?.readiness;
  const requiredKinds =
    readiness?.deploymentProfile === "local"
      ? ["L0"]
      : readiness?.deploymentProfile === "integration"
        ? ["L0", "C1", "N2"]
        : ["L0", "C1", "N2", "P3"];
  const inputsReady =
    readiness?.inputs.entries.length === 12 &&
    fresh(readiness.inputs.validUntil, now) &&
    readiness.inputs.entries.every((value) => value.status === "PASS");
  const gateReady =
    readiness?.gateReady &&
    readiness.gates
      .filter((gate) => requiredKinds.includes(gate.kind))
      .every((gate) => gate.status === "PASS" && fresh(gate.validUntil, now)) &&
    (readiness.deploymentProfile === "local" || inputsReady);

  return (
    <Box
      component="main"
      sx={{ minHeight: "100vh", bgcolor: "background.default", p: { xs: 2, md: 4 } }}
    >
      <Stack spacing={3} sx={{ maxWidth: 1180, mx: "auto" }}>
        <Box>
          <Typography variant="h3" component="h1">
            Готовность пилота
          </Typography>
          <Typography color="text.secondary">
            Проверка результатов контрольных этапов и состояния подключений для одного проекта.
          </Typography>
        </Box>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5" component="h2">
                Корпоративный сеанс
              </Typography>
              {session ? (
                <>
                  <Typography>
                    Выполнен вход: {session.subject} · срок действия до {time(session.expiresAt)}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button onClick={() => void login(true)} disabled={busy}>
                      Повторно подтвердить личность
                    </Button>
                    <Button onClick={() => void logout()} disabled={busy}>
                      Выйти
                    </Button>
                  </Stack>
                </>
              ) : (
                <>
                  <Typography>
                    Войдите с корпоративной учётной записью, чтобы увидеть состояние пилота в
                    доступной области.
                  </Typography>
                  <Button variant="contained" onClick={() => void login()} disabled={busy}>
                    Войти
                  </Button>
                </>
              )}
              {busy && (
                <Stack role="status" direction="row" spacing={1}>
                  <CircularProgress size={20} />
                  <Typography>Проверка текущего состояния…</Typography>
                </Stack>
              )}
              {notice && <Alert severity="info">{notice}</Alert>}
            </Stack>
          </CardContent>
        </Card>
        {session && (
          <Card>
            <CardContent>
              <Stack
                component="form"
                spacing={2}
                onSubmit={(event) => {
                  event.preventDefault();
                  void refresh();
                }}
              >
                <Typography variant="h5" component="h2">
                  Область проекта
                </Typography>
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  {(["workspaceId", "projectId", "deploymentId"] as const).map((key, i) => (
                    <TextField
                      key={key}
                      fullWidth
                      required
                      label={["ID рабочей области", "ID проекта", "ID развёртывания"][i]}
                      value={selection[key]}
                      onChange={(event) => {
                        clear();
                        setBusy(false);
                        setNotice(undefined);
                        setSelection({ ...selection, [key]: event.target.value.trim() });
                      }}
                    />
                  ))}
                </Stack>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={busy || !validPilotSelection(selection)}
                >
                  Проверить готовность
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
        {readiness && (
          <>
            <Alert severity={gateReady ? "success" : "warning"}>
              <strong>
                Результаты контрольных этапов: {gateReady ? "готово" : "требуется действие"}
              </strong>{" "}
              · {formatRuUiValue(readiness.deploymentProfile)} · ревизия развёртывания{" "}
              {readiness.deploymentRef.version}
              <Typography variant="body2">
                Проверено: {time(readiness.evaluatedAt)}. Для активации пилота требуется
                согласованное действие подключения.
              </Typography>
            </Alert>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" component="h2">
                    Результаты контрольных этапов
                  </Typography>
                  {readiness.gates.map((gate) => {
                    const expired = gate.validUntil !== undefined && !fresh(gate.validUntil, now);
                    const status = expired ? "BLOCKED_INPUT" : gate.status;
                    return (
                      <Box key={gate.kind}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "center", flexWrap: "wrap" }}
                        >
                          <Typography component="h3">
                            {gate.kind} · {gateLabels[gate.kind]}
                          </Typography>
                          <Chip
                            label={
                              status === "PASS"
                                ? "Пройдено"
                                : status === "FAIL"
                                  ? "Не пройдено"
                                  : "Требуются материалы"
                            }
                            color={status === "PASS" ? "success" : "warning"}
                          />
                        </Stack>
                        <Typography variant="body2">
                          Действительно до {time(gate.validUntil)}
                        </Typography>
                        {status !== "PASS" && (
                          <Typography>
                            {issueText(
                              expired
                                ? ["GATE_EVIDENCE_EXPIRED"]
                                : gate.reasonCodes.length
                                  ? gate.reasonCodes
                                  : ["GATE_EVIDENCE_MISSING"],
                            )}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" component="h2">
                    Обязательные входные данные и владельцы
                  </Typography>
                  {readiness.inputs.reasonCodes?.length ? (
                    <Alert severity="warning">{issueText(readiness.inputs.reasonCodes)}</Alert>
                  ) : null}
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                      gap: 2,
                    }}
                  >
                    {inputLabels.map(([label, defaultOwner], index) => {
                      const id = `IN-${String(index + 1).padStart(2, "0")}`;
                      const input = readiness.inputs.entries.find((value) => value.id === id);
                      const passed =
                        input?.status === "PASS" && fresh(readiness.inputs.validUntil, now);
                      return (
                        <Box key={id}>
                          <Typography component="h3">
                            {id} · {label}
                          </Typography>
                          <Typography variant="body2">
                            Владелец:{" "}
                            {input?.ownerRole ? formatRuUiValue(input.ownerRole) : defaultOwner}
                          </Typography>
                          <Typography color={passed ? "success.main" : "warning.main"}>
                            {passed
                              ? "Проверено"
                              : input?.status === "FAIL"
                                ? "Проверка не пройдена"
                                : "Требуются материалы"}
                          </Typography>
                          {!passed && (
                            <Typography variant="body2">
                              {issueText(
                                input
                                  ? !fresh(readiness.inputs.validUntil, now)
                                    ? ["INPUT_PACKAGE_EXPIRED"]
                                    : input.reasonCodes.length
                                      ? input.reasonCodes
                                      : ["INPUT_PACKAGE_UNAVAILABLE"]
                                  : ["INPUT_PACKAGE_UNAVAILABLE"],
                              )}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}
        {result?.health && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h5" component="h2">
                  Состояние подключений
                </Typography>
                <Typography>
                  Проект: {formatRuUiValue(result.health.projectState)} · подключение:{" "}
                  {formatRuUiValue(result.health.onboardingState)} · этап:{" "}
                  {formatRuUiValue(result.health.stage)} · режим:{" "}
                  {formatRuUiValue(result.health.capabilityMode)}
                </Typography>
                <Typography variant="body2">
                  Проверено: {time(result.health.evaluatedAt)}
                </Typography>
                {result.health.reasonCodes.length > 0 && (
                  <Alert severity="warning">{issueText(result.health.reasonCodes)}</Alert>
                )}
                {result.health.capabilities.map((capability, index) => {
                  const expired =
                    capability.validUntil !== undefined && !fresh(capability.validUntil, now);
                  const status = expired || !capability.validUntil ? "UNKNOWN" : capability.status;
                  return (
                    <Box key={`${capability.bindingRef.id}:${capability.operation}:${index}`}>
                      <Typography component="h3">
                        {formatRuUiValue(capability.logicalRole)} ·{" "}
                        {formatRuUiValue(capability.operation)}
                      </Typography>
                      <Chip
                        label={formatRuUiValue(status)}
                        color={status === "AVAILABLE" ? "success" : "warning"}
                      />
                      <Typography variant="body2">
                        Проверено: {time(capability.observedAt)} · действительно до{" "}
                        {time(capability.validUntil)}
                      </Typography>
                      {status !== "AVAILABLE" && (
                        <Typography>
                          {issueText(
                            expired
                              ? ["CAPABILITY_PROBE_EXPIRED"]
                              : capability.reasonCodes.length
                                ? capability.reasonCodes
                                : ["CAPABILITY_PROBE_MISSING"],
                          )}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}

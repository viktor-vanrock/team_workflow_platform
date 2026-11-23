import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import {
  DeadLetterBrowserClient,
  type DeadLetterItem,
  type DeadLetterScope,
  type ReplayRequest,
  validDeadLetterScope,
} from "./dead-letter-client.ts";
import { PilotClientError, type PilotSession } from "./pilot-client.ts";

const client = new DeadLetterBrowserClient();
export function PilotDeadLettersRoute({
  initialScope = { workspaceId: "", projectId: "" },
}: {
  readonly initialScope?: DeadLetterScope;
}) {
  const [scope, setScope] = useState(initialScope),
    [session, setSession] = useState<PilotSession>(),
    [items, setItems] = useState<readonly DeadLetterItem[]>(),
    [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("Войдите и выберите проект, чтобы изучить команды с ошибками."),
    [now, setNow] = useState(0);
  const [reason, setReason] = useState<ReplayRequest["reason"]>("DEPENDENCY_REPAIRED");
  const [pendingReplayCount, setPendingReplayCount] = useState(0);
  const principal = useRef<string | undefined>(undefined);
  const generation = useRef(0),
    active = useRef<AbortController | undefined>(undefined),
    requests = useRef(new Map<string, ReplayRequest>());
  const abortPending = useCallback(() => {
    generation.current++;
    active.current?.abort();
    requests.current.clear();
  }, []);
  const clear = useCallback(() => {
    abortPending();
    setPendingReplayCount(0);
    setItems(undefined);
    setNext(undefined);
    setBusy(false);
  }, [abortPending]);
  const acceptSession = useCallback(
    (value: PilotSession | undefined) => {
      if (principal.current !== undefined && principal.current !== value?.principalId) clear();
      principal.current = value?.principalId;
      setSession(value);
    },
    [clear],
  );
  function failure(error: unknown) {
    const denied =
      error instanceof PilotClientError &&
      ["PILOT_LOGIN_REQUIRED", "PILOT_ACCESS_DENIED", "PILOT_RESOURCE_MISSING"].includes(
        error.code,
      );
    if (denied) {
      clear();
      setSession(undefined);
    }
    setNotice(
      denied
        ? "Доступ отсутствует. Войдите снова или попросите владельца проекта проверить ваши права."
        : "Не удалось подтвердить действие. Повторите его с тем же решением или обновите диагностику.",
    );
  }
  useEffect(() => {
    let mounted = true;
    const refreshSession = async () => {
      try {
        const value = await client.session();
        if (mounted) {
          acceptSession(value);
          if (!value) {
            clear();
            setNotice("Войдите, чтобы изучить команды с ошибками.");
          }
        }
      } catch {
        if (mounted) {
          clear();
          setSession(undefined);
        }
      }
    };
    const onFocus = () => {
      void refreshSession();
    };
    void refreshSession();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted = false;
      abortPending();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [abortPending, acceptSession, clear]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current && session && Date.parse(session.expiresAt) <= now) {
        clear();
        setSession(undefined);
        setNotice("Срок действия сеанса истёк. Войдите снова.");
      }
    });
    return () => {
      current = false;
    };
  }, [clear, now, session]);
  async function run(action: (signal: AbortSignal, current: PilotSession) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const revision = ++generation.current;
    setBusy(true);
    try {
      const current = await client.session(controller.signal);
      if (revision !== generation.current) return;
      if (!current) throw new PilotClientError("PILOT_LOGIN_REQUIRED");
      acceptSession(current);
      if (revision !== generation.current) return;
      await action(controller.signal, current);
    } catch (error) {
      if (revision === generation.current) failure(error);
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  }
  async function load(signal: AbortSignal, after?: string) {
    const value = await client.list(scope, after, signal);
    if (!signal.aborted) {
      setItems(value.items);
      setNext(value.nextCursor);
      setNotice(
        value.items.length
          ? "Изучите диагностику перед запросом повторной попытки."
          : "На этой странице нет команд с ошибками.",
      );
    }
  }
  function change(key: keyof DeadLetterScope, value: string) {
    clear();
    setScope((current) => ({ ...current, [key]: value }));
    setNotice("Проект изменён. Загрузите его диагностику.");
  }
  const signedIn = !!session && Date.parse(session.expiresAt) > now;
  return (
    <Box component="main" sx={{ maxWidth: 1000, mx: "auto", p: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Команды с ошибками</Typography>
        <Typography>
          Изучите сбои и запросите повтор исходной команды. Команды с неопределённым внешним
          результатом требуют сверки.
        </Typography>
        <Stack direction="row" spacing={2}>
          {signedIn ? (
            <Button
              disabled={busy}
              onClick={() => {
                void run(async (signal, current) => {
                  await client.logout(current.csrfToken, signal);
                  if (!signal.aborted) {
                    clear();
                    setSession(undefined);
                    setNotice("Вы вышли из системы.");
                  }
                });
              }}
            >
              Выйти
            </Button>
          ) : (
            <Button
              onClick={() => {
                void client
                  .beginLogin(window.location.pathname)
                  .then((url) => {
                    window.location.assign(url);
                  })
                  .catch(failure);
              }}
            >
              Войти
            </Button>
          )}
          <Button href="/pilot/readiness">Готовность пилота</Button>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            label="ID рабочей области"
            value={scope.workspaceId}
            onChange={(e) => change("workspaceId", e.target.value)}
            fullWidth
          />
          <TextField
            label="ID проекта"
            value={scope.projectId}
            onChange={(e) => change("projectId", e.target.value)}
            fullWidth
          />
        </Stack>
        <Button
          disabled={!signedIn || busy || !validDeadLetterScope(scope)}
          onClick={() => {
            void run((signal) => load(signal));
          }}
        >
          Загрузить диагностику
        </Button>
        <Alert severity="info" role="status">
          {notice}
        </Alert>
        {items && (
          <label>
            Причина повтора{" "}
            <select
              aria-label="Причина повтора"
              value={reason}
              disabled={busy || pendingReplayCount > 0}
              onChange={(e) => setReason(e.target.value as ReplayRequest["reason"])}
            >
              <option value="DEPENDENCY_REPAIRED">Зависимость восстановлена</option>
              <option value="ACCESS_RESTORED">Доступ восстановлен</option>
            </select>
          </label>
        )}
        {items?.map((item) => (
          <Card key={item.commandId}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="h6">Команда {item.commandId}</Typography>
                <Typography>Ответственный: {item.ownerRef}</Typography>
                <Typography>
                  Возраст: {Math.floor(item.commandAgeMs / 1000)} сек. · Попыток:{" "}
                  {item.attemptCount} · Повторов: {item.replayCount}
                </Typography>
                <Typography>
                  Первый сбой: {formatRuDateTime(item.firstFailureAt)} · Последний сбой:{" "}
                  {formatRuDateTime(item.lastFailureAt)}
                </Typography>
                <Typography>Истекает: {formatRuDateTime(item.expiresAt)}</Typography>
                <Typography>
                  {formatRuUiValue(item.reasonCode)} · {formatRuUiValue(item.certainty)}
                </Typography>
                <Typography>
                  {formatRuUiValue(
                    Date.parse(item.expiresAt) <= now ? "EXPIRED" : item.eligibility,
                  )}
                </Typography>
                {!item.recordRef && (
                  <Button
                    disabled={busy || !signedIn}
                    onClick={() => {
                      void run(async (signal, current) => {
                        await client.capture(scope, item.commandId, current.csrfToken, signal);
                        if (!signal.aborted) await load(signal);
                      });
                    }}
                  >
                    Сохранить диагностику
                  </Button>
                )}
                {item.recordRef && (
                  <Button
                    disabled={
                      busy ||
                      !signedIn ||
                      item.eligibility !== "ELIGIBLE" ||
                      Date.parse(item.expiresAt) <= now
                    }
                    onClick={() => {
                      const input = requests.current.get(item.commandId) ?? {
                        commandId: item.commandId,
                        recordRef: item.recordRef!,
                        expectedRowVersion: item.rowVersion,
                        requestKey: crypto.randomUUID(),
                        reason,
                      };
                      requests.current.set(item.commandId, input);
                      setPendingReplayCount(requests.current.size);
                      void run(async (signal, current) => {
                        const decision = await client.replay(
                          scope,
                          input,
                          current.csrfToken,
                          signal,
                        );
                        if (!signal.aborted) {
                          requests.current.delete(item.commandId);
                          setPendingReplayCount(requests.current.size);
                          setItems((values) =>
                            values?.filter((value) => value.commandId !== item.commandId),
                          );
                          setNotice(
                            `Исходная команда возвращена в очередь. Решение: ${formatRuUiValue(decision)}`,
                          );
                        }
                      });
                    }}
                  >
                    Повторить исходную команду
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {next && (
          <Button
            disabled={busy || !signedIn}
            onClick={() => {
              void run((signal) => load(signal, next));
            }}
          >
            Следующая страница
          </Button>
        )}
      </Stack>
    </Box>
  );
}

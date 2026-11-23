import { useEffect, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Divider,
  formatRuUiValue,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import type { LocalSession } from "./navigation.ts";

interface Overview {
  readonly model: Readonly<{ provider: string; reasonCode: string }>;
  readonly workItems: readonly Record<string, unknown>[];
  readonly commands: readonly Record<string, unknown>[];
  readonly approvals: readonly Record<string, unknown>[];
  readonly artifacts: readonly Record<string, unknown>[];
}
export function DeveloperTools({
  session,
  apiUrl,
}: Readonly<{ session: LocalSession; apiUrl: string }>) {
  const [overview, setOverview] = useState<Overview>();
  const [sampleName, setSampleName] = useState("Локальный запрос");
  const [message, setMessage] = useState("Проверить ядро расширений");
  const [recordKey, setRecordKey] = useState("local-ui-record");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(
    "Здесь можно проверить тестовые операции и просмотреть их результаты.",
  );
  async function authorized(path: string, init: RequestInit = {}): Promise<Response> {
    if (!session) throw new Error("Сначала выберите персону");
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${session.accessToken}`);
    return await fetch(`${apiUrl}${path}`, { ...init, headers });
  }

  async function refresh(activeSession = session): Promise<void> {
    if (!activeSession) return;
    const response = await fetch(`${apiUrl}/local/walking-skeleton`, {
      headers: { authorization: `Bearer ${activeSession.accessToken}` },
    });
    if (!response.ok) throw new Error(`Не удалось загрузить обзор: ${response.status}`);
    setOverview((await response.json()) as Overview);
  }

  async function submitDummy(): Promise<void> {
    setBusy(true);
    try {
      const response = await authorized("/local/walking-skeleton/dummy", {
        method: "POST",
        body: JSON.stringify({ sampleName, message }),
      });
      if (!response.ok)
        throw new Error(`Не удалось создать тестовую рабочую задачу: ${response.status}`);
      const result = (await response.json()) as { id: string };
      await refresh();
      setNotice(`Тестовая рабочая задача ${result.id} создана.`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    setBusy(true);
    try {
      const response = await authorized("/local/walking-skeleton/commands", {
        method: "POST",
        body: JSON.stringify({
          recordKey,
          message,
          clientRequestKey: `${recordKey}-request`,
          approvalRequired,
        }),
      });
      if (!response.ok) throw new Error(`Команда завершилась ошибкой: ${response.status}`);
      const result = (await response.json()) as { state: string; effectCount: number };
      await refresh();
      setNotice(
        `Команда: ${formatRuUiValue(result.state)}; количество эффектов: ${result.effectCount}.`,
      );
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string): Promise<void> {
    setBusy(true);
    try {
      const response = await authorized(`/local/walking-skeleton/approvals/${id}/approve`, {
        method: "POST",
        body: "{}",
      });
      if (!response.ok) throw new Error(`Согласование завершилось ошибкой: ${response.status}`);
      await refresh();
      setNotice(`Согласование ${id} использовано ровно один раз.`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/local/walking-skeleton`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Не удалось загрузить инструменты");
        const data = (await r.json()) as Overview;
        if (active) setOverview(data);
      })
      .catch(() => {
        if (active)
          setNotice("Не удалось загрузить инструменты. Повторите вход или обновите страницу.");
      });
    return () => {
      active = false;
    };
  }, [apiUrl, session.accessToken]);
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Инструменты разработки
      </Typography>
      <Alert severity="info">
        Тестовые операции для проверки платформы. Для обычной QA-работы откройте раздел «Запросы».
      </Alert>
      <Alert severity="info">{notice}</Alert>
      <Stack direction={{ xs: "column", lg: "row" }} spacing={3}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5">Приём тестового запроса</Typography>
              <TextField
                label="Название примера"
                value={sampleName}
                onChange={(event) => setSampleName(event.target.value)}
              />
              <TextField
                multiline
                minRows={3}
                label="Сообщение"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <Button
                variant="contained"
                onClick={() => void submitDummy()}
                disabled={!session || busy}
              >
                Создать рабочую задачу
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5">Внешняя команда</Typography>
              <TextField
                label="Ключ записи"
                value={recordKey}
                onChange={(event) => setRecordKey(event.target.value)}
              />
              <TextField
                label="Сообщение команды"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={approvalRequired}
                    onChange={(event) => setApprovalRequired(event.target.checked)}
                  />
                }
                label="Требовать точное согласование"
              />
              <Button
                variant="contained"
                color="secondary"
                onClick={() => void publish()}
                disabled={!session || busy}
              >
                Опубликовать через Mock Hub
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5">Сохранённое состояние</Typography>
            <Typography>
              Модель: {overview?.model.provider ?? "—"} · {overview?.model.reasonCode ?? "—"}
            </Typography>
            <Divider />
            <Typography variant="h6">Рабочие задачи ({overview?.workItems.length ?? 0})</Typography>
            {overview?.workItems.map((item) => (
              <Typography key={String(item.id)}>
                {String(item.sample_name ?? item.id)} · {formatRuUiValue(item.state)} ·{" "}
                {formatRuUiValue(item.classification_key)}
              </Typography>
            ))}
            <Divider />
            <Typography variant="h6">Команды ({overview?.commands.length ?? 0})</Typography>
            {overview?.commands.map((command) => (
              <Typography key={String(command.id)}>
                {String(command.id)} · {formatRuUiValue(command.state)} · корреляция{" "}
                {String(command.correlation_id)}
              </Typography>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Stack direction={{ xs: "column", lg: "row" }} spacing={3}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h5">Согласования</Typography>
              {overview?.approvals.map((approval) => (
                <Stack
                  key={String(approval.id)}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <Typography sx={{ flex: 1 }}>
                    {formatRuUiValue(approval.decision_state)} · {String(approval.id)}
                  </Typography>
                  {approval.decision_state === "PENDING" && (
                    <Button size="small" onClick={() => void approve(String(approval.id))}>
                      Согласовать
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h5">Внешние CI-артефакты</Typography>
              {overview?.artifacts.length ? (
                overview.artifacts.map((artifact) => (
                  <Typography key={String(artifact.id)}>
                    {String(artifact.file_name)} · {formatRuUiValue(artifact.classification_key)} ·{" "}
                    {formatRuUiValue(artifact.availability)}
                  </Typography>
                ))
              ) : (
                <Typography color="text.secondary">Нет доступных GitLab артефактов</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}

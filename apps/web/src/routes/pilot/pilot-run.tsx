import { useState } from "react";

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

import { PilotBrowserClient, PilotClientError, type PilotRunView } from "./pilot-client.ts";

const client = new PilotBrowserClient();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const display = (value: number | null) =>
  value === null ? "неизвестно" : Number.isInteger(value) ? String(value) : value.toFixed(3);

export function PilotRunRoute({
  initialScope = { workspaceId: "", projectId: "", runId: "" },
}: {
  readonly initialScope?: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly runId: string;
  };
}) {
  const [scope, setScope] = useState(initialScope);
  const [view, setView] = useState<PilotRunView>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  const valid =
    uuid.test(scope.workspaceId) &&
    uuid.test(scope.projectId) &&
    scope.runId.length > 0 &&
    scope.runId.length <= 255;
  async function load() {
    if (!valid) {
      setView(undefined);
      setNotice("Введите корректные ID рабочей области, проекта и запуска пилота.");
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      if (!(await client.session())) throw new PilotClientError("PILOT_LOGIN_REQUIRED");
      setView(await client.pilotRun(scope));
    } catch (error) {
      setView(undefined);
      setNotice(
        error instanceof PilotClientError && error.code === "PILOT_LOGIN_REQUIRED"
          ? "Войдите на странице готовности пилота и повторите попытку."
          : "Отчёт пилота для выбранной области недоступен.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box
      component="main"
      sx={{ minHeight: "100vh", bgcolor: "background.default", p: { xs: 2, md: 4 } }}
    >
      <Stack spacing={3} sx={{ maxWidth: 1100, mx: "auto" }}>
        <Box>
          <Typography variant="h3">Работа пилота</Typography>
          <Typography color="text.secondary">
            Группа участников, базовые показатели, метрики, ограничения и формальная проверка одного
            проекта.
          </Typography>
        </Box>
        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                {(["workspaceId", "projectId", "runId"] as const).map((key, index) => (
                  <TextField
                    key={key}
                    fullWidth
                    label={["ID рабочей области", "ID проекта", "ID запуска пилота"][index]}
                    value={scope[key]}
                    onChange={(event) => {
                      setScope({ ...scope, [key]: event.target.value.trim() });
                      setView(undefined);
                    }}
                  />
                ))}
              </Stack>
              <Button type="submit" variant="contained" disabled={busy || !valid}>
                Загрузить текущий отчёт
              </Button>
              {busy && <CircularProgress size={20} />}{" "}
              {notice && <Alert severity="warning">{notice}</Alert>}
            </Stack>
          </CardContent>
        </Card>
        {view && (
          <>
            <Alert
              severity={
                view.stage === "STOPPED" ||
                view.guardrails.some((value) => value.state === "BREACH")
                  ? "error"
                  : view.baseline.status === "MISSING" ||
                      view.guardrails.some((value) => value.state === "UNKNOWN")
                    ? "warning"
                    : "success"
              }
            >
              Этап: {formatRuUiValue(view.stage)} · ревизия группы: {view.cohort.version} ·
              проверено: {formatRuDateTime(view.evaluatedAt)}
            </Alert>
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h5">Группа и период</Typography>
                  <Typography>
                    Проектов: {view.cohort.projectIds.length} · участников: {view.cohort.userCount}{" "}
                    · каналов: {view.cohort.channelCount}
                  </Typography>
                  <Typography>
                    {formatRuDateTime(view.cohort.startAt)} – {formatRuDateTime(view.cohort.endAt)}{" "}
                    · {formatRuUiValue(view.cohort.state)}
                  </Typography>
                  <Button href={`/projects/${scope.projectId}/onboarding`}>
                    Открыть управление активацией и приостановкой
                  </Button>
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h5">Базовые показатели</Typography>
                  <Chip
                    label={formatRuUiValue(view.baseline.status)}
                    color={view.baseline.status === "CURRENT" ? "success" : "warning"}
                  />
                  <Typography>Разрешённая выборка: {view.baseline.sampleSize}</Typography>
                  {view.baseline.status === "MISSING" && (
                    <Alert severity="warning">
                      Импортируйте и выборочно проверьте базовые показатели текущего процесса до
                      установки целей.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5">Панель измерений</Typography>
                  {view.metrics.map((metric) => (
                    <Box key={metric.key}>
                      <Typography>
                        {formatRuUiValue(metric.key)}: {display(metric.value)}
                      </Typography>
                      <Typography variant="body2">
                        Объём: {metric.denominator}; пропущено: {metric.missingCount}; исключено:{" "}
                        {metric.excludedCount}; ограничено периодом: {metric.censoredCount}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h5">Независимо наблюдаемые внешние эффекты</Typography>
                  <Typography>
                    Записей: {display(view.externalEffects.writes)} · дублей:{" "}
                    {display(view.externalEffects.duplicates)} · источник:{" "}
                    {formatRuUiValue(view.externalEffects.source)}
                  </Typography>
                  {view.externalEffects.source === "UNAVAILABLE" && (
                    <Alert severity="warning">
                      Количество эффектов неизвестно и не может подтвердить полноту проверки.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h5">Обязательные ограничения</Typography>
                  {view.guardrails.map((guardrail) => (
                    <Stack key={guardrail.key} direction="row" spacing={1}>
                      <Typography sx={{ flex: 1 }}>{formatRuUiValue(guardrail.key)}</Typography>
                      <Chip
                        label={formatRuUiValue(guardrail.state)}
                        color={
                          guardrail.state === "PASS"
                            ? "success"
                            : guardrail.state === "BREACH"
                              ? "error"
                              : "warning"
                        }
                      />
                    </Stack>
                  ))}
                  {view.incidents.length > 0 && (
                    <Alert severity="error">
                      Требуется разбор инцидентов: {view.incidents.join(", ")}
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h5">Формальная проверка</Typography>
                  <Typography>
                    {view.review
                      ? formatRuUiValue(view.review.recommendation)
                      : "Решение не зафиксировано"}
                  </Typography>
                  {!view.review && (
                    <Alert severity="info">
                      QA-лид и спонсор должны проверить полноту, инциденты, нагрузку на оператора,
                      ограничения и остаточные риски.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </>
        )}
      </Stack>
    </Box>
  );
}

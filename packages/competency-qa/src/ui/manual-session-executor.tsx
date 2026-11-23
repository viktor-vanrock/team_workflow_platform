import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface ManualExecutorSession {
  readonly sessionId: string;
  readonly state: string;
  readonly resourceVersion: number;
}
export interface ManualExecutorPlanItem {
  readonly planItemId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly state: string;
}
export interface ManualExecutorAttempt {
  readonly attemptId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly state: string;
  readonly result?: string;
}
export interface ManualExecutorObservation {
  readonly observationId: string;
  readonly planItemId: string;
  readonly attemptId: string;
  readonly kind: string;
}
export interface ManualExecutorResult {
  readonly resultRevisionId: string;
  readonly planItemId: string;
  readonly version: number;
  readonly result: string;
}

export function QaManualSessionExecutor(
  props: Readonly<{
    session?: ManualExecutorSession;
    planItems: readonly ManualExecutorPlanItem[];
    attempts: readonly ManualExecutorAttempt[];
    observations: readonly ManualExecutorObservation[];
    results: readonly ManualExecutorResult[];
    busy?: boolean;
    notice?: string;
    onStartAttempt(planItemId: string): void;
    onCompleteAttempt(attemptId: string): void;
    onRecordObservation(attemptId: string, planItemId: string): void;
    onRecordResult(planItemId: string): void;
    onTransitionReview(): void;
    onReload(): void;
  }>,
) {
  if (!props.session) return <Alert severity="info">Ручной сеанс пока недоступен.</Alert>;
  const allTerminal =
    props.planItems.length > 0 &&
    props.planItems.every(({ state }) => state === "TERMINAL" || state === "WAIVED");
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="h5">Ручное выполнение</Typography>
            <Chip label={formatRuUiValue(props.session.state)} />
            <Chip variant="outlined" label={`ETag ${props.session.resourceVersion}`} />
            <Button size="small" onClick={props.onReload}>
              Обновить
            </Button>
          </Stack>
          {props.notice && (
            <Alert
              severity={/(?:failed|error|не удалось|ошиб)/iu.test(props.notice) ? "error" : "info"}
            >
              {props.notice}
            </Alert>
          )}
          {props.planItems.map((item) => {
            const attempts = props.attempts.filter(
              ({ planItemId }) => planItemId === item.planItemId,
            );
            const running = attempts.find(({ state }) => state === "RUNNING");
            const completed = attempts.filter(({ state }) => state === "COMPLETED").at(-1);
            const observed =
              completed &&
              props.observations.some(({ attemptId }) => attemptId === completed.attemptId);
            const result = props.results
              .filter(({ planItemId }) => planItemId === item.planItemId)
              .at(-1);
            return (
              <Stack
                key={item.planItemId}
                spacing={1}
                sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ flex: 1 }}>{item.title}</Typography>
                  <Chip size="small" label={formatRuUiValue(item.state)} />
                </Stack>
                <Typography variant="body2">
                  Попыток: {attempts.length} · Наблюдений:{" "}
                  {
                    props.observations.filter(({ planItemId }) => planItemId === item.planItemId)
                      .length
                  }{" "}
                  · Результат: {result ? formatRuUiValue(result.result) : "—"}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={
                      props.busy ||
                      props.session?.state !== "RUNNING" ||
                      Boolean(running) ||
                      Boolean(result)
                    }
                    onClick={() => props.onStartAttempt(item.planItemId)}
                  >
                    Начать попытку
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={props.busy || !running}
                    onClick={() => running && props.onCompleteAttempt(running.attemptId)}
                  >
                    Завершить успешно
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={props.busy || !completed || Boolean(observed) || Boolean(result)}
                    onClick={() =>
                      completed && props.onRecordObservation(completed.attemptId, item.planItemId)
                    }
                  >
                    Зафиксировать положительное наблюдение
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={props.busy || !completed || !observed || Boolean(result)}
                    onClick={() => props.onRecordResult(item.planItemId)}
                  >
                    Зафиксировать успешный результат
                  </Button>
                </Stack>
              </Stack>
            );
          })}
          <Button
            variant="contained"
            color="secondary"
            disabled={props.busy || props.session.state !== "RUNNING" || !allTerminal}
            onClick={props.onTransitionReview}
          >
            Передать на проверку
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

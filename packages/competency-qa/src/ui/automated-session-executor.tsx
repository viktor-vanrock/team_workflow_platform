import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaAutomationLaunchConfirmationView {
  readonly reason: "INITIAL" | "HUMAN_RERUN";
  readonly targetSnapshotHash: string;
  readonly suiteBindingHash: string;
  readonly configurationPinSetHash: string;
  readonly sessionResourceVersion: number;
  readonly actionHash: string;
  readonly confirmationHash: string;
}

export interface QaAutomationAttemptExecutionView {
  readonly state: "QUEUED" | "DISPATCHED" | "CONFIRMED" | "AMBIGUOUS" | "FAILED";
  readonly reasonCode?: string;
}

export interface QaAutomationAttemptView {
  readonly automationAttemptId: string;
  readonly testSessionId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly reason: "INITIAL" | "AUTO_INFRA_RETRY" | "HUMAN_RERUN";
  readonly rootAttemptId: string;
  readonly predecessorAttemptId?: string;
  readonly currentStatus: "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL";
  readonly currentStatusRevisionNo: number;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly execution: QaAutomationAttemptExecutionView;
}

export interface QaAutomationStatusRevisionView {
  readonly revisionNo: number;
  readonly status: QaAutomationAttemptView["currentStatus"];
  readonly providerStatus: string;
  readonly providerUpdatedAt?: string;
  readonly source: string;
  readonly observedAt: string;
  readonly recordedAt: string;
}

export interface QaAutomationAttemptResultView {
  readonly outcome:
    "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
  readonly normalizationKind: "SCHEMA_VALIDATED" | "SYNTHETIC_INCOMPLETE";
  readonly resultHash: string;
  readonly artifactSyncState: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "EXPIRED";
  readonly terminalAt: string;
}

export interface QaAutomationRetryDecisionView {
  readonly decision: "NOT_APPLICABLE" | "DENIED" | "SCHEDULED";
  readonly reasonCode: string;
  readonly successorAttemptId?: string;
  readonly contentHash: string;
}

export interface QaAutomationArtifactAvailabilityView {
  readonly artifactReferenceId: string;
  readonly automationAttemptId: string;
  readonly artifactKind: "RESULT" | "REPORT" | "LOG" | "SCREENSHOT" | "TRACE" | "OTHER";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly availability: "AVAILABLE" | "MISSING" | "EXPIRED" | "CHECKSUM_MISMATCH";
  readonly expiresAt?: string;
}

export interface QaAutomationQuarantineWarningView {
  readonly quarantineId: string;
  readonly subject:
    | Readonly<{
        kind: "SUITE_BINDING_VERSION";
        suiteBindingRef: Readonly<{ id: string; version: number; contentHash: string }>;
      }>
    | Readonly<{ kind: "INFRASTRUCTURE_CODE"; infrastructureCode: string }>;
  readonly currentRevisionNo: number;
  readonly currentRevisionHash: string;
  readonly effectiveState: "ACTIVE" | "EXPIRED";
}

export interface QaAutomationHumanReviewView {
  readonly attemptSetHash: string;
  readonly reviewable: boolean;
  readonly reviewFlags: readonly "FLAKY_SUSPECTED"[];
  readonly blockers: readonly Readonly<{ code: string; subjectId?: string }>[];
  readonly flakyDisposition?: Readonly<{
    state: "NOT_REQUIRED" | "REQUIRED" | "RESOLVED";
    findingId?: string;
    basisHash?: string;
  }>;
}

export interface QaAutomationOperationalHealthView {
  readonly connectionHealth: "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE";
  readonly freshness: "CURRENT" | "PENDING" | "STALE" | "ERROR";
  readonly executionActivity:
    "IDLE" | "TRIGGER_PENDING" | "RUNNING" | "RETRY_PENDING" | "RECONCILING" | "TERMINAL";
  readonly reasonCodes: readonly string[];
  readonly lastAuthoritativeReadAt?: string;
  readonly nextEligibleAt?: string;
}

export interface QaAutomatedSessionExecutorProps {
  readonly confirmation?: QaAutomationLaunchConfirmationView;
  readonly etag?: string;
  readonly attempts: readonly QaAutomationAttemptView[];
  readonly statusByAttempt: Readonly<Record<string, readonly QaAutomationStatusRevisionView[]>>;
  readonly resultByAttempt?: Readonly<Record<string, QaAutomationAttemptResultView | undefined>>;
  readonly retryDecisionByAttempt?: Readonly<
    Record<string, QaAutomationRetryDecisionView | undefined>
  >;
  readonly artifactsByAttempt?: Readonly<
    Record<string, readonly QaAutomationArtifactAvailabilityView[]>
  >;
  readonly quarantineWarnings?: readonly QaAutomationQuarantineWarningView[];
  readonly humanReview?: QaAutomationHumanReviewView;
  readonly operationalHealth?: QaAutomationOperationalHealthView;
  readonly busy?: boolean;
  readonly notice: string;
  readonly manualHref: string;
  readonly canLaunch?: boolean;
  readonly onLaunch: (confirmation: QaAutomationLaunchConfirmationView, etag: string) => void;
  readonly onReload: () => void;
}

const shortHash = (value: string) =>
  value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-10)}` : value;
const shortId = (value: string) =>
  value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;

function executionColor(
  state: QaAutomationAttemptExecutionView["state"],
): "default" | "success" | "warning" | "error" {
  if (state === "CONFIRMED") return "success";
  if (state === "AMBIGUOUS") return "error";
  if (state === "FAILED") return "warning";
  return "default";
}

function artifactColor(
  availability: QaAutomationArtifactAvailabilityView["availability"],
): "success" | "warning" | "error" {
  if (availability === "AVAILABLE") return "success";
  if (availability === "CHECKSUM_MISMATCH") return "error";
  return "warning";
}

function quarantineSubject(subject: QaAutomationQuarantineWarningView["subject"]): string {
  return subject.kind === "INFRASTRUCTURE_CODE"
    ? `Инфраструктура ${formatRuUiValue(subject.infrastructureCode)}`
    : `Набор проверок ${shortId(subject.suiteBindingRef.id)}, версия ${subject.suiteBindingRef.version}`;
}

function healthColor(
  health: QaAutomationOperationalHealthView["connectionHealth"],
): "success" | "warning" | "error" {
  if (health === "AVAILABLE") return "success";
  if (health === "BACKOFF") return "warning";
  return "error";
}

function freshnessColor(
  freshness: QaAutomationOperationalHealthView["freshness"],
): "success" | "warning" | "error" {
  if (freshness === "CURRENT") return "success";
  if (freshness === "ERROR") return "error";
  return "warning";
}

export function QaAutomatedSessionExecutor(props: Readonly<QaAutomatedSessionExecutorProps>) {
  const launch = () => {
    if (props.confirmation && props.etag) props.onLaunch(props.confirmation, props.etag);
  };
  const ambiguous = props.attempts.filter(({ execution }) => execution.state === "AMBIGUOUS");

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ alignItems: { md: "center" } }}
            >
              <Typography variant="h5" sx={{ flex: 1 }}>
                Выполнение автоматизированного сеанса
              </Typography>
              <Chip
                label={props.etag === undefined ? "ETag недоступен" : `ETag ${props.etag}`}
                color={props.etag === undefined ? "warning" : "success"}
              />
            </Stack>
            <Alert
              severity={/(?:не удалось|ошиб|failed|error)/iu.test(props.notice) ? "error" : "info"}
            >
              {props.notice}
            </Alert>
            {props.operationalHealth && (
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={1}
                      sx={{ alignItems: { md: "center" }, flexWrap: "wrap" }}
                    >
                      <Typography variant="subtitle1" sx={{ flex: 1 }}>
                        Рабочее состояние GitLab
                      </Typography>
                      <Chip
                        label={`Подключение: ${formatRuUiValue(props.operationalHealth.connectionHealth)}`}
                        color={healthColor(props.operationalHealth.connectionHealth)}
                      />
                      <Chip
                        label={`Актуальность: ${formatRuUiValue(props.operationalHealth.freshness)}`}
                        color={freshnessColor(props.operationalHealth.freshness)}
                      />
                      <Chip
                        label={`Активность: ${formatRuUiValue(props.operationalHealth.executionActivity)}`}
                      />
                    </Stack>
                    {props.operationalHealth.freshness !== "CURRENT" && (
                      <Alert
                        severity={
                          props.operationalHealth.freshness === "ERROR" ? "error" : "warning"
                        }
                      >
                        {props.operationalHealth.freshness === "ERROR"
                          ? "Достоверное состояние GitLab недоступно. Технические подтверждения остаются видимыми, а для восстановления нужна сверка или действие оператора."
                          : "Достоверное состояние GitLab ожидается или устарело. Показанное состояние попытки может измениться после сверки."}
                      </Alert>
                    )}
                    {props.operationalHealth.reasonCodes.length > 0 && (
                      <Typography variant="body2">
                        Причины:{" "}
                        {props.operationalHealth.reasonCodes.map(formatRuUiValue).join(" · ")}
                      </Typography>
                    )}
                    {props.operationalHealth.lastAuthoritativeReadAt && (
                      <Typography variant="caption" color="text.secondary">
                        Последнее достоверное чтение:{" "}
                        {formatRuDateTime(props.operationalHealth.lastAuthoritativeReadAt)}
                      </Typography>
                    )}
                    {props.operationalHealth.nextEligibleAt && (
                      <Typography variant="caption" color="text.secondary">
                        Следующая доступная сверка:{" "}
                        {formatRuDateTime(props.operationalHealth.nextEligibleAt)}
                      </Typography>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
            {ambiguous.map((attempt) => (
              <Alert key={attempt.automationAttemptId} severity="error">
                Результат попытки №{attempt.attemptNo} у поставщика неоднозначен
                {attempt.execution.reasonCode
                  ? `: ${formatRuUiValue(attempt.execution.reasonCode)}`
                  : ""}
                . Повторный автоматический запуск запрещён; нужна сверка или проверка специалистом.
              </Alert>
            ))}
            {(props.quarantineWarnings ?? []).map((warning) => (
              <Alert
                key={`${warning.quarantineId}:${warning.currentRevisionNo}`}
                severity="warning"
              >
                Предупреждение о карантине: {quarantineSubject(warning.subject)} ·{" "}
                {formatRuUiValue(warning.effectiveState)} · точная редакция{" "}
                {warning.currentRevisionNo} ({shortHash(warning.currentRevisionHash)}). Исходная
                ошибка остаётся видимой и требует решения специалиста.
              </Alert>
            ))}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button
                variant="contained"
                onClick={launch}
                disabled={
                  props.canLaunch === false || props.busy || !props.confirmation || !props.etag
                }
              >
                {props.confirmation?.reason === "HUMAN_RERUN"
                  ? "Запустить подтверждённый повтор"
                  : "Запустить подтверждённую попытку"}
              </Button>
              <Button variant="outlined" onClick={props.onReload} disabled={props.busy}>
                Обновить состояние выполнения
              </Button>
              <Button component="a" href={props.manualHref} variant="outlined">
                Открыть ручное выполнение сеанса
              </Button>
            </Stack>
            <Alert severity="info">
              Ручная проверка QA доступна, пока автоматизированное выполнение ожидается, устарело,
              ограничено по частоте или недоступно. Восстановление GitLab не закрывает задачи Jira и
              не подписывает заключение QA.
            </Alert>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">Выданное сервером подтверждение запуска</Typography>
            {props.confirmation === undefined ? (
              <Typography color="text.secondary">Сервер сейчас не разрешает запуск.</Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Chip label={formatRuUiValue(props.confirmation.reason)} />
                  <Chip label={`Версия сеанса: ${props.confirmation.sessionResourceVersion}`} />
                </Stack>
                <Typography>
                  Снимок цели: {shortHash(props.confirmation.targetSnapshotHash)}
                </Typography>
                <Typography>
                  Привязка набора проверок: {shortHash(props.confirmation.suiteBindingHash)}
                </Typography>
                <Typography>
                  Набор закреплённых настроек:{" "}
                  {shortHash(props.confirmation.configurationPinSetHash)}
                </Typography>
                <Typography>Действие: {shortHash(props.confirmation.actionHash)}</Typography>
                <Typography>
                  Подтверждение: {shortHash(props.confirmation.confirmationHash)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  При запуске этот точный ответ сервера отправляется с показанным ETag.
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Цепочка и состояние попыток</Typography>
            {props.attempts.length === 0 && (
              <Typography color="text.secondary">Попытки ещё не создавались.</Typography>
            )}
            {props.attempts.map((attempt) => (
              <Card key={attempt.automationAttemptId} variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Typography variant="subtitle1" sx={{ flex: 1 }}>
                        Попытка №{attempt.attemptNo} · {formatRuUiValue(attempt.reason)}
                      </Typography>
                      <Chip label={formatRuUiValue(attempt.currentStatus)} />
                      <Chip
                        label={formatRuUiValue(attempt.execution.state)}
                        color={executionColor(attempt.execution.state)}
                      />
                    </Stack>
                    <Typography variant="body2">
                      Попытка: {shortId(attempt.automationAttemptId)}
                    </Typography>
                    <Typography variant="body2">
                      Корневая попытка: {shortId(attempt.rootAttemptId)}
                    </Typography>
                    {attempt.predecessorAttemptId && (
                      <Typography variant="body2">
                        Предыдущая попытка: {shortId(attempt.predecessorAttemptId)}
                      </Typography>
                    )}
                    <Typography variant="body2">
                      Редакция состояния: {attempt.currentStatusRevisionNo} · версия ресурса:{" "}
                      {attempt.resourceVersion}
                    </Typography>
                    {attempt.execution.reasonCode && (
                      <Typography variant="body2">
                        Причина: {formatRuUiValue(attempt.execution.reasonCode)}
                      </Typography>
                    )}
                    <Divider />
                    <Typography variant="subtitle2">История состояний</Typography>
                    {(props.statusByAttempt[attempt.automationAttemptId] ?? []).map((revision) => (
                      <Stack
                        key={revision.revisionNo}
                        direction={{ xs: "column", md: "row" }}
                        spacing={1}
                        sx={{ alignItems: { md: "center" } }}
                      >
                        <Chip size="small" label={`r${revision.revisionNo}`} />
                        <Typography variant="body2">
                          {formatRuUiValue(revision.status)} ·{" "}
                          {formatRuUiValue(revision.providerStatus)} ·{" "}
                          {formatRuUiValue(revision.source)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Зафиксировано: {formatRuDateTime(revision.observedAt)}
                        </Typography>
                      </Stack>
                    ))}
                    {(props.statusByAttempt[attempt.automationAttemptId] ?? []).length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        Редакции состояния ещё не зафиксированы.
                      </Typography>
                    )}
                    {props.resultByAttempt?.[attempt.automationAttemptId] && (
                      <>
                        <Divider />
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={1}
                          sx={{ alignItems: { md: "center" }, flexWrap: "wrap" }}
                        >
                          <Typography variant="subtitle2" sx={{ flex: 1 }}>
                            Технический результат
                          </Typography>
                          <Chip
                            size="small"
                            label={formatRuUiValue(
                              props.resultByAttempt[attempt.automationAttemptId]!.outcome,
                            )}
                            color={
                              props.resultByAttempt[attempt.automationAttemptId]!.outcome === "PASS"
                                ? "success"
                                : "warning"
                            }
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={formatRuUiValue(
                              props.resultByAttempt[attempt.automationAttemptId]!.artifactSyncState,
                            )}
                          />
                        </Stack>
                        <Typography variant="body2">
                          Результат:{" "}
                          {shortHash(
                            props.resultByAttempt[attempt.automationAttemptId]!.resultHash,
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Завершено:{" "}
                          {formatRuDateTime(
                            props.resultByAttempt[attempt.automationAttemptId]!.terminalAt,
                          )}{" "}
                          ·{" "}
                          {formatRuUiValue(
                            props.resultByAttempt[attempt.automationAttemptId]!.normalizationKind,
                          )}
                        </Typography>
                      </>
                    )}
                    {props.retryDecisionByAttempt?.[attempt.automationAttemptId] && (
                      <>
                        <Divider />
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={1}
                          sx={{ alignItems: { md: "center" }, flexWrap: "wrap" }}
                        >
                          <Typography variant="subtitle2" sx={{ flex: 1 }}>
                            Решение о повторе
                          </Typography>
                          <Chip
                            size="small"
                            label={formatRuUiValue(
                              props.retryDecisionByAttempt[attempt.automationAttemptId]!.decision,
                            )}
                          />
                          <Typography variant="body2">
                            {formatRuUiValue(
                              props.retryDecisionByAttempt[attempt.automationAttemptId]!.reasonCode,
                            )}
                          </Typography>
                        </Stack>
                        {props.retryDecisionByAttempt[attempt.automationAttemptId]!
                          .successorAttemptId && (
                          <Typography variant="body2">
                            Следующая попытка:{" "}
                            {shortId(
                              props.retryDecisionByAttempt[attempt.automationAttemptId]!
                                .successorAttemptId!,
                            )}
                          </Typography>
                        )}
                      </>
                    )}
                    {(props.artifactsByAttempt?.[attempt.automationAttemptId] ?? []).length > 0 && (
                      <>
                        <Divider />
                        <Typography variant="subtitle2">Доступность артефактов</Typography>
                        {(props.artifactsByAttempt?.[attempt.automationAttemptId] ?? []).map(
                          (artifact) => (
                            <Stack
                              key={artifact.artifactReferenceId}
                              direction={{ xs: "column", md: "row" }}
                              spacing={1}
                              sx={{ alignItems: { md: "center" } }}
                            >
                              <Typography variant="body2" sx={{ flex: 1 }}>
                                {formatRuUiValue(artifact.artifactKind)} ·{" "}
                                {shortId(artifact.artifactReferenceId)} · {artifact.mediaType} ·{" "}
                                {artifact.byteSize} Б
                              </Typography>
                              <Chip
                                size="small"
                                variant="outlined"
                                label={formatRuUiValue(artifact.classification)}
                              />
                              <Chip
                                size="small"
                                label={formatRuUiValue(artifact.availability)}
                                color={artifactColor(artifact.availability)}
                              />
                            </Stack>
                          ),
                        )}
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {props.humanReview && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                sx={{ alignItems: { md: "center" } }}
              >
                <Typography variant="h6" sx={{ flex: 1 }}>
                  Готовность к проверке специалистом
                </Typography>
                <Chip
                  label={props.humanReview.reviewable ? "Можно проверять" : "Заблокировано"}
                  color={props.humanReview.reviewable ? "success" : "warning"}
                />
              </Stack>
              <Typography variant="body2">
                Набор попыток: {shortHash(props.humanReview.attemptSetHash)}
              </Typography>
              <Alert severity="info">
                Технические результаты не подписывают итог сеанса или заключение QA. Только
                уполномоченный специалист может обработать результаты, нестабильность,
                предупреждения о карантине и завершить проверку.
              </Alert>
              {props.humanReview.reviewFlags.includes("FLAKY_SUSPECTED") && (
                <Alert
                  severity={
                    props.humanReview.flakyDisposition?.state === "RESOLVED" ? "success" : "warning"
                  }
                >
                  Подозрение на нестабильность · решение:{" "}
                  {formatRuUiValue(props.humanReview.flakyDisposition?.state ?? "REQUIRED")}
                  {props.humanReview.flakyDisposition?.findingId
                    ? ` · результат ${shortId(props.humanReview.flakyDisposition.findingId)}`
                    : ""}
                </Alert>
              )}
              {props.humanReview.blockers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Сейчас нет препятствий для проверки специалистом.
                </Typography>
              ) : (
                props.humanReview.blockers.map((blocker, index) => (
                  <Alert key={`${blocker.code}:${blocker.subjectId ?? index}`} severity="warning">
                    {formatRuUiValue(blocker.code)}
                    {blocker.subjectId ? ` · ${shortId(blocker.subjectId)}` : ""}
                  </Alert>
                ))
              )}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

export const qaAutomatedSessionExecutorUiContribution = Object.freeze({
  key: "competency-qa.automated-session-executor",
  componentRef: "qa.ui.automated-session-executor",
  Component: QaAutomatedSessionExecutor,
});

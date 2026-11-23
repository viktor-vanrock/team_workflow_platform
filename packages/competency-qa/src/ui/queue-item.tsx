import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaTriageAssessmentView {
  readonly assessmentId: string;
  readonly revision: number;
  readonly state: "CURRENT" | "STALE" | "SUPERSEDED";
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly dimensionDetails?: Readonly<
    Record<
      string,
      Readonly<{ confidence: number; explanation: string; factRefs: readonly number[] }>
    >
  >;
  readonly missingInformation?: readonly Readonly<{ key: string; explanation: string }>[];
  readonly inputFingerprint: string;
  readonly ruleVersion?: string;
  readonly skillVersion?: string;
}

export interface QaAcceptedControlView {
  readonly revision: number;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly serviceClass: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
  readonly assessmentRef?: Readonly<{
    sourceId: string;
    sourceVersion: number;
    semanticHash: string;
  }>;
  readonly reason: string;
}

export interface QaQueueEntryView {
  readonly queueEntryId: string;
  readonly revision: number;
  readonly semanticHash: string;
  readonly inputFingerprint: string;
  readonly stage: "CANDIDATE" | "BACKLOG" | "READY" | "ACTIVE" | "COMPLETED";
  readonly stageDetails: readonly string[];
  readonly stageReasonCodes: readonly string[];
  readonly subject: Readonly<{ kind: string; id: string }>;
  readonly operational: Readonly<{
    state: string;
    rawStatus?: Readonly<{ id?: string; name?: string }>;
    normalizedStatus?: string;
    externalDisplayKey?: string;
  }>;
  readonly control: Readonly<{ state: string; resourceVersion?: number; serviceClass?: string }>;
  readonly freshness: Readonly<{
    state: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
    evaluatedAt: string;
  }>;
  readonly consistencyWarnings: readonly string[];
}

export interface QaCapacityView {
  readonly occupancy: "NOT_CONSUMING" | "OCCUPIED" | "RESERVED_REVIEW";
  readonly policyMode: "MEASURE_ONLY" | "ENFORCED";
  readonly projectWarning:
    "NOT_CONFIGURED" | "WITHIN_SOFT_LIMIT" | "ABOVE_SOFT_LIMIT" | "RESERVATION_PRESSURE";
  readonly denial?: Readonly<{ reasonCode: "HARD_WIP" | "EXPEDITE_SINGLETON"; decisionId: string }>;
  readonly override?: Readonly<{
    actionKind: "WIP_ADMISSION_OVERRIDE" | "EXPEDITE_CAPACITY_OVERRIDE";
    approvalId: string;
    approvedBy: string;
    expiresAt: string;
  }>;
  readonly reservationRef?: Readonly<{
    sourceId: string;
    sourceVersion: number;
    semanticHash: string;
  }>;
  readonly claimRef?: Readonly<{ sourceId: string; sourceVersion: number; semanticHash: string }>;
}

export interface QaSlaGoalView {
  readonly goal: "READY_TO_FIRST_QA_START" | "READY_TO_SIGNED_VERDICT";
  readonly clockState: "NOT_STARTED" | "RUNNING" | "PAUSED" | "STOPPED";
  readonly targetState:
    "NOT_STARTED" | "NOT_CONFIGURED" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED";
  readonly targetConfiguration: Readonly<{
    state: "NOT_CONFIGURED" | "CONFIGURED";
    targetBusinessSeconds?: number;
    remainingBusinessSeconds?: number;
    computedTargetAt?: string;
  }>;
  readonly elapsedBusinessSeconds: number;
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly pause: Readonly<{
    state: "NOT_PAUSED" | "PAUSED";
    mappedReasonCode?: string;
    pausedAt?: string;
    sourceRef?: Readonly<{
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      semanticHash: string;
    }>;
  }>;
  readonly clockCycle?: number;
  readonly clockRevisionRef?: Readonly<{ id: string; version: number; semanticHash: string }>;
  readonly policyFacetRef?: Readonly<{ id: string; version: number; semanticHash: string }>;
  readonly calendarRef?: Readonly<{ id: string; version: number; semanticHash: string }>;
  readonly startSourceRef?: Readonly<{
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    semanticHash: string;
    confirmedAt?: string;
  }>;
  readonly freshness: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
  readonly asOf: string;
  readonly evaluationHash: string;
}

export interface QaSlaView {
  readonly policyMode: "MEASURE_ONLY" | "ENFORCED";
  readonly goals: readonly QaSlaGoalView[];
}

const stageColor: Readonly<
  Record<QaQueueEntryView["stage"], "default" | "info" | "warning" | "success" | "secondary">
> = Object.freeze({
  CANDIDATE: "default",
  BACKLOG: "info",
  READY: "success",
  ACTIVE: "warning",
  COMPLETED: "secondary",
});

function freshnessColor(
  value: QaQueueEntryView["freshness"]["state"],
): "success" | "warning" | "error" {
  if (value === "CURRENT") return "success";
  if (value === "ERROR") return "error";
  return "warning";
}

function slaTargetColor(
  value: QaSlaGoalView["targetState"],
): "default" | "success" | "warning" | "error" | "info" {
  if (value === "BREACHED") return "error";
  if (value === "AT_RISK") return "warning";
  if (value === "ON_TRACK" || value === "COMPLETED") return "success";
  if (value === "NOT_CONFIGURED") return "info";
  return "default";
}

function provenanceRef(
  label: string,
  ref: Readonly<{ id: string; version: number; semanticHash: string }> | undefined,
) {
  if (!ref) return null;
  return (
    <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
      {label} {ref.id}, редакция {ref.version} · {ref.semanticHash}
    </Typography>
  );
}

export interface QaQueueItemProps {
  readonly entry: QaQueueEntryView;
  readonly assessment?: QaTriageAssessmentView;
  readonly acceptedControl?: QaAcceptedControlView;
  readonly capacity?: QaCapacityView;
  readonly sla?: QaSlaView;
  readonly onAcceptPlanningValues?: () => void;
  readonly onSetFixedDate?: () => void;
  readonly onClearServiceClass?: () => void;
  readonly onRequestWipOverride?: () => void;
  readonly onRequestExpedite?: () => void;
}

export function QaQueueItem({
  entry,
  assessment,
  acceptedControl,
  capacity,
  sla,
  onAcceptPlanningValues,
  onSetFixedDate,
  onClearServiceClass,
  onRequestWipOverride,
  onRequestExpedite,
}: Readonly<QaQueueItemProps>) {
  const rawJira = entry.operational.rawStatus?.name ?? "не подтверждено";
  const normalizedJira = entry.operational.normalizedStatus ?? "NOT_APPLICABLE";
  const controlVersion = entry.control.resourceVersion ?? 0;
  return (
    <Card variant="outlined" data-testid={`queue-item-${entry.queueEntryId}`}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" } }}
          >
            <Chip
              color={stageColor[entry.stage]}
              label={`Этап платформы · ${formatRuUiValue(entry.stage)}`}
            />
            <Chip
              color={freshnessColor(entry.freshness.state)}
              variant="outlined"
              label={`Актуальность · ${formatRuUiValue(entry.freshness.state)}`}
            />
            <Chip
              variant="outlined"
              label={formatRuUiValue(entry.control.serviceClass ?? "STANDARD")}
            />
            <Typography variant="body2" sx={{ ml: { sm: "auto" } }}>
              {entry.operational.externalDisplayKey ??
                `${formatRuUiValue(entry.subject.kind)} ${entry.subject.id}`}
            </Typography>
          </Stack>
          <Typography variant="body2">
            <strong>Подтверждённое состояние Jira:</strong> исходное «{rawJira}» · нормализованное{" "}
            {formatRuUiValue(normalizedJira)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Этап очереди — проекция ядра платформы. Он не изменяет состояние Jira и не выдаёт себя
            за него.
          </Typography>
          <Typography variant="body2">
            Причины: {entry.stageReasonCodes.map(formatRuUiValue).join(", ") || "нет"} · сведения:{" "}
            {entry.stageDetails.map(formatRuUiValue).join(", ") || "нет"}
          </Typography>
          {entry.consistencyWarnings.length > 0 && (
            <Alert severity="warning">
              {entry.consistencyWarnings.map(formatRuUiValue).join(", ")}
            </Alert>
          )}
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            Запись очереди {entry.queueEntryId}, редакция {entry.revision} · управление CAS{" "}
            {controlVersion} · входные данные {entry.inputFingerprint} · семантика{" "}
            {entry.semanticHash}
          </Typography>
          {assessment && (
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="h6">Факторизованное предложение по сортировке</Typography>
                    <Chip
                      color={assessment.state === "CURRENT" ? "success" : "warning"}
                      label={formatRuUiValue(assessment.state)}
                    />
                    <Chip
                      variant="outlined"
                      label={`правила: ${assessment.ruleVersion ?? "прежняя версия"}`}
                    />
                    <Chip
                      variant="outlined"
                      label={`навык: ${assessment.skillVersion ?? "прежняя версия"}`}
                    />
                  </Stack>
                  {Object.entries(assessment.dimensions).map(([key, value]) => {
                    const evidence = assessment.dimensionDetails?.[key];
                    return (
                      <Stack key={key} spacing={0.25}>
                        <Typography variant="body2">
                          <strong>{formatRuUiValue(key)}</strong>:{" "}
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : formatRuUiValue(value)}
                          {evidence ? ` · уверенность ${evidence.confidence}` : ""}
                        </Typography>
                        {evidence && (
                          <Typography variant="caption">
                            {evidence.explanation} · факты [{evidence.factRefs.join(", ")}]
                          </Typography>
                        )}
                      </Stack>
                    );
                  })}
                  {(assessment.missingInformation?.length ?? 0) > 0 && (
                    <Alert severity="warning">
                      Недостающие сведения:{" "}
                      {assessment
                        .missingInformation!.map(
                          ({ key, explanation }) => `${formatRuUiValue(key)} — ${explanation}`,
                        )
                        .join("; ")}
                    </Alert>
                  )}
                  <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                    Оценка {assessment.assessmentId}, редакция {assessment.revision} · отпечаток{" "}
                    {assessment.inputFingerprint}
                  </Typography>
                  {assessment.state !== "CURRENT" && (
                    <Alert severity="warning">
                      Предложение устарело и не может быть принято. Сначала обновите исходные
                      сведения.
                    </Alert>
                  )}
                  {onAcceptPlanningValues && (
                    <Button
                      disabled={assessment.state !== "CURRENT"}
                      onClick={onAcceptPlanningValues}
                    >
                      Принять выбранные плановые значения
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
          {acceptedControl && (
            <Alert severity="info">
              Принятое управление, редакция {acceptedControl.revision} · класс обслуживания{" "}
              {formatRuUiValue(acceptedControl.serviceClass)} · до{" "}
              {JSON.stringify(acceptedControl.before ?? {})} · после{" "}
              {JSON.stringify(acceptedControl.after)} · автор {acceptedControl.recordedBy} ·{" "}
              {formatRuDateTime(acceptedControl.recordedAt)} · {acceptedControl.reason}
            </Alert>
          )}
          {capacity && (
            <Card variant="outlined" data-testid="capacity-state">
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Chip
                      label={`Загрузка · ${formatRuUiValue(capacity.occupancy)}`}
                      color={
                        capacity.occupancy === "OCCUPIED"
                          ? "warning"
                          : capacity.occupancy === "RESERVED_REVIEW"
                            ? "info"
                            : "default"
                      }
                    />
                    <Chip
                      variant="outlined"
                      label={`Политика · ${formatRuUiValue(capacity.policyMode)}`}
                    />
                    <Chip
                      variant="outlined"
                      label={`Сигнал проекта · ${formatRuUiValue(capacity.projectWarning)}`}
                    />
                  </Stack>
                  {capacity.reservationRef && (
                    <Typography variant="caption">
                      Резерв на проверку {capacity.reservationRef.sourceId}, редакция{" "}
                      {capacity.reservationRef.sourceVersion} ·{" "}
                      {capacity.reservationRef.semanticHash}
                    </Typography>
                  )}
                  {capacity.claimRef && (
                    <Typography variant="caption">
                      Заявка WIP {capacity.claimRef.sourceId}, редакция{" "}
                      {capacity.claimRef.sourceVersion} · {capacity.claimRef.semanticHash}
                    </Typography>
                  )}
                  {capacity.denial && (
                    <Alert severity="error">
                      Допуск отклонён: {formatRuUiValue(capacity.denial.reasonCode)} · устойчивое
                      решение {capacity.denial.decisionId}
                    </Alert>
                  )}
                  {capacity.override && (
                    <Alert severity="warning">
                      Точное действие {formatRuUiValue(capacity.override.actionKind)} согласовано
                      пользователем {capacity.override.approvedBy} в рамках согласования{" "}
                      {capacity.override.approvalId}; действует до{" "}
                      {formatRuDateTime(capacity.override.expiresAt)}
                    </Alert>
                  )}
                  {(onRequestWipOverride || onRequestExpedite) && (
                    <Stack direction="row" spacing={1}>
                      {onRequestWipOverride && (
                        <Button onClick={onRequestWipOverride}>
                          Запросить точное исключение WIP
                        </Button>
                      )}
                      {onRequestExpedite && (
                        <Button onClick={onRequestExpedite}>Запросить срочный приоритет</Button>
                      )}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
          {sla && (
            <Card variant="outlined" data-testid="sla-state">
              <CardContent>
                <Stack spacing={1.25}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="h6">Прозрачность SLA</Typography>
                    <Chip
                      variant="outlined"
                      label={`Политика · ${formatRuUiValue(sla.policyMode)}`}
                    />
                  </Stack>
                  {sla.goals.map((goal) => (
                    <Card key={goal.goal} variant="outlined" data-testid={`sla-goal-${goal.goal}`}>
                      <CardContent>
                        <Stack spacing={0.75}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: "center", flexWrap: "wrap" }}
                          >
                            <Typography variant="body2">
                              <strong>{formatRuUiValue(goal.goal)}</strong>
                            </Typography>
                            <Chip
                              variant="outlined"
                              label={`Таймер · ${formatRuUiValue(goal.clockState)}`}
                            />
                            <Chip
                              color={slaTargetColor(goal.targetState)}
                              label={`Риск · ${formatRuUiValue(goal.targetState)}`}
                            />
                            <Chip
                              color={freshnessColor(goal.freshness)}
                              variant="outlined"
                              label={`Актуальность · ${formatRuUiValue(goal.freshness)}`}
                            />
                          </Stack>
                          <Typography variant="body2">
                            Начало:{" "}
                            {goal.startedAt ? formatRuDateTime(goal.startedAt) : "не подтверждено"}{" "}
                            · прошло рабочего времени: {goal.elapsedBusinessSeconds} с
                            {goal.targetConfiguration.targetBusinessSeconds !== undefined
                              ? ` / ${goal.targetConfiguration.targetBusinessSeconds} с`
                              : " · целевое время не настроено"}
                            {goal.targetConfiguration.remainingBusinessSeconds !== undefined
                              ? ` · осталось ${goal.targetConfiguration.remainingBusinessSeconds} с`
                              : ""}
                          </Typography>
                          {goal.targetConfiguration.computedTargetAt && (
                            <Typography variant="body2">
                              Расчётный срок:{" "}
                              {formatRuDateTime(goal.targetConfiguration.computedTargetAt)}
                            </Typography>
                          )}
                          {goal.pause.state === "PAUSED" && (
                            <Alert severity="warning">
                              Приостановлено: {formatRuDateTime(goal.pause.pausedAt)} · причина:{" "}
                              {formatRuUiValue(goal.pause.mappedReasonCode)} · подтверждённый
                              источник {goal.pause.sourceRef?.sourceId}, редакция{" "}
                              {goal.pause.sourceRef?.sourceVersion}
                            </Alert>
                          )}
                          {goal.stoppedAt && (
                            <Alert severity="success">
                              Отсчёт цели остановлен: {formatRuDateTime(goal.stoppedAt)}
                            </Alert>
                          )}
                          {goal.startSourceRef && (
                            <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                              Источник начала {formatRuUiValue(goal.startSourceRef.sourceType)} ·{" "}
                              {goal.startSourceRef.sourceId}, редакция{" "}
                              {goal.startSourceRef.sourceVersion} · подтверждено{" "}
                              {formatRuDateTime(goal.startSourceRef.confirmedAt ?? goal.startedAt)}{" "}
                              · {goal.startSourceRef.semanticHash}
                            </Typography>
                          )}
                          {provenanceRef("Таймер", goal.clockRevisionRef)}
                          {provenanceRef("Аспект политики", goal.policyFacetRef)}
                          {provenanceRef("Календарь", goal.calendarRef)}
                          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                            Цикл {goal.clockCycle ?? 0} · оценено {formatRuDateTime(goal.asOf)} ·{" "}
                            {goal.evaluationHash}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
          {(onSetFixedDate || onClearServiceClass) && (
            <Stack direction="row" spacing={1}>
              {onSetFixedDate && (
                <Button onClick={onSetFixedDate}>
                  Задать фиксированную дату по подтверждённому сроку Jira
                </Button>
              )}
              {onClearServiceClass && (
                <Button onClick={onClearServiceClass}>
                  Сбросить класс обслуживания с фиксированной датой
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export const qaQueueItemUiContribution = Object.freeze({
  key: "competency-qa.queue-item",
  componentRef: "qa.ui.queue-item",
  Component: QaQueueItem,
});

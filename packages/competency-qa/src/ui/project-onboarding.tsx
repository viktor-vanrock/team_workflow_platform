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

export interface ProjectOnboardingView {
  readonly project: Readonly<{
    id: string;
    key: string;
    name: string;
    owners: readonly string[];
    classificationKey: string;
  }>;
  readonly stage: "DRAFT" | "VALIDATING" | "NEEDS_FIX" | "SHADOW" | "PILOT_ACTIVE";
  readonly capabilityMode: "MANUAL_ONLY" | "FULL_QA";
  readonly operationalState: "ACTIVE" | "SUSPENDED";
  readonly bindingRef?: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly qaProjectContextRef?: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly gates: readonly Readonly<{
    key: string;
    outcome: "PASS" | "FAIL" | "BLOCKED_INPUT";
    safeIssueCodes: readonly string[];
  }>[];
  readonly probes: readonly Readonly<{
    logicalRole: string;
    status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
    validUntil: string;
  }>[];
  readonly approval?: Readonly<{ state: string; approverRole: string }>;
  readonly reasonCodes: readonly string[];
  readonly canEvaluate: boolean;
  readonly canRequestPublication: boolean;
  readonly automationSuite?: Readonly<{
    suiteRef: Readonly<{ id: string; version: number; contentHash: string }>;
    acceptance: "ACCEPTED" | "REJECTED";
    pipelineContractHash: string;
    environmentRef: Readonly<{ id: string; version: number; contentHash: string }>;
  }>;
  readonly bindingHistory?: readonly Readonly<{
    ref: Readonly<{ id: string; version: number; contentHash: string }>;
    state: "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
    clonedFromRef?: Readonly<{ id: string; version: number; contentHash: string }>;
  }>[];
  readonly modeTransitions?: readonly Readonly<{
    from: "MANUAL_ONLY" | "FULL_QA";
    to: "MANUAL_ONLY" | "FULL_QA";
    reasonCode: string;
    occurredAt: string;
  }>[];
  readonly messagingFallback?: "NONE" | "WEB_AND_OUTBOX";
}

export interface ProjectOnboardingWorkspaceProps {
  readonly view: ProjectOnboardingView;
  readonly busy?: boolean;
  readonly onEvaluate: () => void;
  readonly onRequestPublication: () => void;
  readonly onEmergencySuspend?: () => void;
  readonly onResume?: () => void;
}

const exactLabel = (ref: NonNullable<ProjectOnboardingView["bindingRef"]>) =>
  `${ref.id}@${ref.version} · ${ref.contentHash}`;

export function ProjectOnboardingWorkspace({
  view,
  busy = false,
  onEvaluate,
  onRequestPublication,
  onEmergencySuspend,
  onResume,
}: ProjectOnboardingWorkspaceProps) {
  return (
    <Stack spacing={2} aria-label="Рабочая область подключения проекта">
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" } }}
            >
              <Typography variant="h4" sx={{ flex: 1 }}>
                Подключение проекта · {view.project.name}
              </Typography>
              <Chip label={formatRuUiValue(view.stage)} />
              <Chip
                color={view.capabilityMode === "FULL_QA" ? "success" : "warning"}
                label={formatRuUiValue(view.capabilityMode)}
              />
              <Chip
                color={view.operationalState === "ACTIVE" ? "success" : "error"}
                label={formatRuUiValue(view.operationalState)}
              />
            </Stack>
            <Typography>Постоянный ID проекта: {view.project.id}</Typography>
            <Typography>
              Владельцы: {view.project.owners.join(", ")} · классификация:{" "}
              {formatRuUiValue(view.project.classificationKey)}
            </Typography>
            {view.capabilityMode === "MANUAL_ONLY" && (
              <Alert severity="info">
                Ручное выполнение сеансов доступно. Автоматизированные сеансы заблокированы до
                принятия точных требований GitLab.
              </Alert>
            )}
            {view.reasonCodes.length > 0 && (
              <Alert severity="warning">
                Причины режима: {view.reasonCodes.map(formatRuUiValue).join(", ")}
              </Alert>
            )}
            {view.operationalState === "SUSPENDED" && (
              <Alert severity="error">
                Изменения проекта и новые сеансы приостановлены. Разрешённый аудит и исследование
                подтверждающих материалов остаются доступны.
              </Alert>
            )}
            <Stack direction="row" spacing={1}>
              <Button disabled={busy || !view.canEvaluate} onClick={onEvaluate}>
                Проверить условия подключения
              </Button>
              <Button disabled={busy || !view.canRequestPublication} onClick={onRequestPublication}>
                Запросить публикацию привязки
              </Button>
              {view.operationalState === "ACTIVE" ? (
                <Button
                  color="error"
                  disabled={busy || !onEmergencySuspend}
                  onClick={onEmergencySuspend}
                >
                  Экстренно приостановить
                </Button>
              ) : (
                <Button color="success" disabled={busy || !onResume} onClick={onResume}>
                  Возобновить проект
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h5">Точная конфигурация</Typography>
            <Typography>
              Привязка: {view.bindingRef ? exactLabel(view.bindingRef) : "не опубликована"}
            </Typography>
            <Typography>
              Контекст проекта QA:{" "}
              {view.qaProjectContextRef ? exactLabel(view.qaProjectContextRef) : "не опубликован"}
            </Typography>
            {view.approval && (
              <Typography>
                Согласование: {formatRuUiValue(view.approval.state)} ·{" "}
                {formatRuUiValue(view.approval.approverRole)}
              </Typography>
            )}
            <Divider />
            <Typography variant="h6">Проверки возможностей</Typography>
            {view.probes.map((probe) => (
              <Typography key={`${probe.logicalRole}:${probe.validUntil}`}>
                {formatRuUiValue(probe.logicalRole)} · {formatRuUiValue(probe.status)} ·
                действительно до {formatRuDateTime(probe.validUntil)}
              </Typography>
            ))}
            <Typography variant="h6">Условия подключения</Typography>
            {view.gates.map((gate) => (
              <Typography key={gate.key}>
                {formatRuUiValue(gate.key)} · {formatRuUiValue(gate.outcome)}
                {gate.safeIssueCodes.length
                  ? ` · ${gate.safeIssueCodes.map(formatRuUiValue).join(", ")}`
                  : ""}
              </Typography>
            ))}
            {view.automationSuite && (
              <>
                <Divider />
                <Typography variant="h6">Приёмка набора автоматизации</Typography>
                <Typography>
                  Набор: {exactLabel(view.automationSuite.suiteRef)} ·{" "}
                  {formatRuUiValue(view.automationSuite.acceptance)}
                </Typography>
                <Typography>
                  Контракт конвейера: {view.automationSuite.pipelineContractHash}
                </Typography>
                <Typography>Среда: {exactLabel(view.automationSuite.environmentRef)}</Typography>
              </>
            )}
            {view.messagingFallback === "WEB_AND_OUTBOX" && (
              <Alert severity="warning">
                Доставка через Mattermost работает с ограничениями. Веб-интерфейс и устойчивая
                очередь уведомлений доступны; режим возможностей QA не изменён.
              </Alert>
            )}
            {view.bindingHistory && view.bindingHistory.length > 0 && (
              <>
                <Divider />
                <Typography variant="h6">История привязок и откат</Typography>
                {view.bindingHistory.map((binding) => (
                  <Typography key={`${binding.ref.id}:${binding.ref.version}`}>
                    {exactLabel(binding.ref)} · {formatRuUiValue(binding.state)}
                    {binding.clonedFromRef
                      ? ` · клонировано из ${binding.clonedFromRef.id}@${binding.clonedFromRef.version}`
                      : ""}
                  </Typography>
                ))}
              </>
            )}
            {view.modeTransitions && view.modeTransitions.length > 0 && (
              <>
                <Typography variant="h6">История режимов возможностей</Typography>
                {view.modeTransitions.map((transition) => (
                  <Typography key={`${transition.occurredAt}:${transition.reasonCode}`}>
                    {formatRuUiValue(transition.from)} → {formatRuUiValue(transition.to)} ·{" "}
                    {formatRuUiValue(transition.reasonCode)} ·{" "}
                    {formatRuDateTime(transition.occurredAt)}
                  </Typography>
                ))}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

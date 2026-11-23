import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaAutomationAvailabilityView {
  readonly capabilityMode: "FULL_QA" | "MANUAL_ONLY";
  readonly liveAvailability: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  readonly launchPermitted: boolean;
  readonly capabilityReasonCodes: readonly string[];
  readonly availabilityReasonCodes: readonly string[];
  readonly projectionHash: string;
}

export interface QaAutomationSuiteChoice {
  readonly id: string;
  readonly suiteKey: string;
  readonly version: number;
  readonly state: "PUBLISHED";
  readonly contentHash: string;
  readonly allowedTargetTypes: readonly ("MERGE_REQUEST" | "COMMIT" | "BUILD")[];
  readonly allowedEnvironmentRefs: readonly string[];
}

export type QaAutomationTargetChoice =
  | Readonly<{
      key: string;
      label: string;
      type: "MERGE_REQUEST";
      mergeRequestRef: string;
      commitSha: string;
    }>
  | Readonly<{ key: string; label: string; type: "COMMIT"; commitSha: string }>
  | Readonly<{ key: string; label: string; type: "BUILD"; buildRef: string; commitSha: string }>;

export interface QaAutomationConfigurationPinView {
  readonly logicalRole: "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE";
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly projectIntegrationBindingRef: Readonly<{
    id: string;
    version: number;
    contentHash: string;
  }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly validationReportRef: Readonly<{ id: string; version: number; contentHash: string }>;
}

export interface QaAutomatedSessionView {
  readonly id: string;
  readonly state: string;
  readonly targetSnapshotHash: string;
  readonly scopeSnapshotHash: string;
  readonly configurationPinSetHash: string;
  readonly configurationPins: readonly QaAutomationConfigurationPinView[];
}

export interface QaAutomatedSessionSelection {
  readonly workItemId: string;
  readonly suiteBindingRef: Readonly<{ id: string; version: number }>;
  readonly target: Omit<QaAutomationTargetChoice, "key" | "label">;
  readonly environmentRef: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly browser: "chromium" | "firefox" | "webkit";
}

export interface QaAutomatedSessionProps {
  readonly workItemId?: string;
  readonly availability?: QaAutomationAvailabilityView;
  readonly suites: readonly QaAutomationSuiteChoice[];
  readonly targets: readonly QaAutomationTargetChoice[];
  readonly parameterPresets: readonly Readonly<{
    key: string;
    label: string;
    value: Readonly<Record<string, unknown>>;
  }>[];
  readonly session?: QaAutomatedSessionView;
  readonly busy?: boolean;
  readonly notice: string;
  readonly manualHref: string;
  readonly onReload: () => void;
  readonly canPlan?: boolean;
  readonly onCreate: (selection: QaAutomatedSessionSelection) => void;
}

const shortHash = (value: string) =>
  value.length > 24 ? `${value.slice(0, 15)}…${value.slice(-8)}` : value;

export function QaAutomatedSession(props: Readonly<QaAutomatedSessionProps>) {
  const [suiteKey, setSuiteKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [environmentRef, setEnvironmentRef] = useState("");
  const [parameterPresetKey, setParameterPresetKey] = useState("");
  const [browser, setBrowser] = useState<"chromium" | "firefox" | "webkit">("chromium");
  const suite = useMemo(
    () =>
      props.suites.find((candidate) => `${candidate.id}@${candidate.version}` === suiteKey) ??
      props.suites[0],
    [props.suites, suiteKey],
  );
  const allowedTargets = useMemo(
    () =>
      suite ? props.targets.filter(({ type }) => suite.allowedTargetTypes.includes(type)) : [],
    [props.targets, suite],
  );
  const target = allowedTargets.find(({ key }) => key === targetKey) ?? allowedTargets[0];
  const selectedEnvironment = suite?.allowedEnvironmentRefs.includes(environmentRef)
    ? environmentRef
    : suite?.allowedEnvironmentRefs[0];
  const parameterPreset =
    props.parameterPresets.find(({ key }) => key === parameterPresetKey) ??
    props.parameterPresets[0];

  const reasons = [
    ...(props.availability?.capabilityReasonCodes ?? []),
    ...(props.availability?.availabilityReasonCodes ?? []),
  ];
  const canCreate =
    props.canPlan !== false &&
    !!props.workItemId &&
    !!suite &&
    !!target &&
    !!selectedEnvironment &&
    !!parameterPreset &&
    props.availability?.launchPermitted === true &&
    !props.busy;
  const create = () => {
    if (!props.workItemId || !suite || !target || !selectedEnvironment || !parameterPreset) return;
    const boundedTarget =
      target.type === "MERGE_REQUEST"
        ? Object.freeze({
            type: target.type,
            mergeRequestRef: target.mergeRequestRef,
            commitSha: target.commitSha,
          })
        : target.type === "BUILD"
          ? Object.freeze({
              type: target.type,
              buildRef: target.buildRef,
              commitSha: target.commitSha,
            })
          : Object.freeze({ type: target.type, commitSha: target.commitSha });
    props.onCreate(
      Object.freeze({
        workItemId: props.workItemId,
        suiteBindingRef: Object.freeze({ id: suite.id, version: suite.version }),
        target: Object.freeze(boundedTarget),
        environmentRef: selectedEnvironment,
        parameters: parameterPreset.value,
        browser,
      }),
    );
  };

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
                Сеанс автоматизированной проверки
              </Typography>
              <Chip
                color={props.availability?.capabilityMode === "FULL_QA" ? "success" : "default"}
                label={formatRuUiValue(props.availability?.capabilityMode ?? "CHECKING")}
              />
              <Chip
                color={props.availability?.liveAvailability === "AVAILABLE" ? "success" : "warning"}
                label={formatRuUiValue(props.availability?.liveAvailability ?? "UNKNOWN")}
              />
            </Stack>
            <Alert
              severity={/(?:не удалось|ошиб|failed|error)/iu.test(props.notice) ? "error" : "info"}
            >
              {props.notice}
            </Alert>
            <Alert severity="info">
              Техническая автоматизация не подписывает заключение QA: проверка уполномоченным
              специалистом остаётся обязательной. Ручное выполнение сеанса доступно всегда.
            </Alert>
            {reasons.length > 0 && (
              <Alert severity="warning">
                Автоматизация недоступна: {reasons.map(formatRuUiValue).join(" · ")}. Ручная
                проверка QA остаётся доступной.
              </Alert>
            )}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button onClick={props.onReload} disabled={props.busy}>
                Обновить доступные параметры
              </Button>
              <Button component="a" href={props.manualHref} variant="outlined">
                Открыть планировщик ручного сеанса
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Ограниченный план</Typography>
            <Typography color="text.secondary">
              Отправляются только опубликованные версии наборов проверок и варианты цели и среды,
              полученные от сервера. Настройки поставщика и ссылки на секреты здесь не
              редактируются.
            </Typography>
            <label>
              Опубликованный набор проверок{" "}
              <select
                aria-label="Опубликованный набор проверок"
                value={suite ? `${suite.id}@${suite.version}` : ""}
                onChange={(event) => setSuiteKey(event.target.value)}
                disabled={props.busy || props.suites.length === 0}
              >
                {props.suites.length === 0 && <option value="">Нет опубликованных наборов</option>}
                {props.suites.map((candidate) => (
                  <option
                    key={`${candidate.id}@${candidate.version}`}
                    value={`${candidate.id}@${candidate.version}`}
                  >
                    {candidate.suiteKey} · версия {candidate.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Неизменяемая цель{" "}
              <select
                aria-label="Неизменяемая цель"
                value={target?.key ?? ""}
                onChange={(event) => setTargetKey(event.target.value)}
                disabled={props.busy || allowedTargets.length === 0}
              >
                {allowedTargets.length === 0 && <option value="">Нет разрешённых целей</option>}
                {allowedTargets.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Непроизводственная среда{" "}
              <select
                aria-label="Непроизводственная среда"
                value={selectedEnvironment ?? ""}
                onChange={(event) => setEnvironmentRef(event.target.value)}
                disabled={props.busy || !suite}
              >
                {!suite && <option value="">Нет разрешённой среды</option>}
                {suite?.allowedEnvironmentRefs.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Набор принятых параметров{" "}
              <select
                aria-label="Набор принятых параметров"
                value={parameterPreset?.key ?? ""}
                onChange={(event) => setParameterPresetKey(event.target.value)}
                disabled={props.busy || props.parameterPresets.length === 0}
              >
                {props.parameterPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Браузер{" "}
              <select
                aria-label="Браузер"
                value={browser}
                onChange={(event) => setBrowser(event.target.value as typeof browser)}
                disabled={props.busy}
              >
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit</option>
              </select>
            </label>
            <Button variant="contained" onClick={create} disabled={!canCreate}>
              Создать неизменяемый готовый сеанс
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {props.session && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="h6" sx={{ flex: 1 }}>
                  Закреплённый сеанс
                </Typography>
                <Chip color="success" label={formatRuUiValue(props.session.state)} />
                <Chip label={props.session.id} />
              </Stack>
              <Typography>Снимок цели: {shortHash(props.session.targetSnapshotHash)}</Typography>
              <Typography>
                Снимок области проверки: {shortHash(props.session.scopeSnapshotHash)}
              </Typography>
              <Typography>
                Набор закреплённых настроек: {shortHash(props.session.configurationPinSetHash)}
              </Typography>
              <Divider />
              {props.session.configurationPins.map((pin) => (
                <Card key={pin.logicalRole} variant="outlined">
                  <CardContent>
                    <Stack spacing={0.5}>
                      <Typography variant="subtitle1">
                        {formatRuUiValue(pin.logicalRole)} · {pin.capabilityKey}@
                        {pin.exactContractVersion}
                      </Typography>
                      <Typography variant="body2">
                        Привязка {pin.projectIntegrationBindingRef.id}@
                        {pin.projectIntegrationBindingRef.version} ·{" "}
                        {shortHash(pin.projectIntegrationBindingRef.contentHash)}
                      </Typography>
                      <Typography variant="body2">
                        Профиль {pin.profileRef.id}@{pin.profileRef.version} ·{" "}
                        {shortHash(pin.profileRef.contentHash)}
                      </Typography>
                      <Typography variant="body2">
                        Подключение {pin.connectionRef.id}@{pin.connectionRef.version} ·{" "}
                        {shortHash(pin.connectionRef.contentHash)}
                      </Typography>
                      <Typography variant="body2">
                        Проверка {pin.validationReportRef.id}@{pin.validationReportRef.version} ·{" "}
                        {shortHash(pin.validationReportRef.contentHash)}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

export const qaAutomatedSessionUiContribution = Object.freeze({
  key: "competency-qa.automated-session",
  componentRef: "qa.ui.automated-session",
  Component: QaAutomatedSession,
});

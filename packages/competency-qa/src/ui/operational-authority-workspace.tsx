import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Button,
  Chip,
  formatRuDateTime,
  formatRuUiValue,
  OperationalAuthorityPanel,
  Stack,
  Typography,
} from "@awp/platform-ui";

import type { QaBrowserApiContext } from "./intake.tsx";

interface ProjectionRow {
  readonly acceptance_source?: string;
  readonly current_external_display_key?: string;
  readonly freshness_state?: string;
  readonly sync_state?: string;
  readonly last_observed_at?: string;
  readonly last_error_code?: string | null;
  readonly projection_revision?: number | string;
  readonly authority_snapshot?: Readonly<Record<string, unknown>> | string;
}

interface PreparedAction {
  readonly commandRef: Readonly<{ id: string; version: number }>;
  readonly approvalRef: Readonly<{ id: string; version: number }>;
  readonly commandState: string;
}

function object(value: ProjectionRow["authority_snapshot"]): Readonly<Record<string, unknown>> {
  if (!value) return {};
  return typeof value === "string"
    ? (JSON.parse(value) as Readonly<Record<string, unknown>>)
    : value;
}

export type QaOperationalAuthorityWorkspaceProps = QaBrowserApiContext &
  Readonly<{ workItemId: string; permissions?: readonly string[] }>;

export function QaOperationalAuthorityWorkspace(
  props: Readonly<QaOperationalAuthorityWorkspaceProps>,
) {
  const [projection, setProjection] = useState<ProjectionRow>();
  const [action, setAction] = useState<PreparedAction>();
  const [notice, setNotice] = useState("Изменение статуса из платформы требует согласования.");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const base = useMemo(
    () =>
      `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/operational-authority`,
    [props.projectId, props.workspaceId],
  );
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${props.accessToken}`);
      headers.set("content-type", "application/json");
      return await fetch(`${props.apiUrl}${path}`, { ...init, headers });
    },
    [props.accessToken, props.apiUrl],
  );

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const response = await request(
        `${base}/work-items/${props.workItemId}/projection`,
        signal ? { signal } : {},
      );
      if (!response.ok)
        throw new Error(`Не удалось загрузить рабочую проекцию: ${response.status}`);
      const next = (await response.json()) as ProjectionRow | null;
      if (!next) throw new Error("Рабочая проекция ещё не подтверждена");
      if (signal?.aborted) return;
      setProjection(next);
      setLoadError(undefined);
    },
    [base, props.workItemId, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await load(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(String(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5_000);
      }
    };
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setProjection(undefined);
        setAction(undefined);
        void poll();
      }
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);

  async function prepareTransition(): Promise<void> {
    if (!projection) return;
    setBusy(true);
    try {
      const response = await request(
        `${base}/work-items/${props.workItemId}/actions/request.transition`,
        {
          method: "POST",
          headers: {
            "if-match": `W/"${Number(projection.projection_revision)}"`,
            "idempotency-key": `qa-ui-transition:${props.workItemId}:${Number(projection.projection_revision)}`,
          },
          body: JSON.stringify({ transition: { toStatusKey: "DONE" } }),
        },
      );
      if (!response.ok)
        throw new Error(`Не удалось подготовить рабочее действие: ${response.status}`);
      const prepared = (await response.json()) as PreparedAction;
      setAction(prepared);
      setNotice(`Действие ${prepared.commandRef.id} · ${formatRuUiValue(prepared.commandState)}`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    if (!action) return;
    setBusy(true);
    try {
      const response = await request(`${base}/approvals/${action.approvalRef.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVE" }),
      });
      if (!response.ok)
        throw new Error(`Не удалось согласовать рабочее действие: ${response.status}`);
      const decided = (await response.json()) as Readonly<{
        commandState: string;
        decision: string;
      }>;
      setNotice(
        `Согласование: ${formatRuUiValue(decided.decision)}; команда: ${formatRuUiValue(decided.commandState)}.`,
      );
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  const snapshot = object(projection?.authority_snapshot);
  const rawStatus = snapshot.rawStatus as Readonly<{ name?: string }> | undefined;
  const syncError =
    projection?.sync_state && !["SYNCED", "CONFLICT"].includes(projection.sync_state);
  const origin =
    projection?.acceptance_source === "VERIFIED_IMPORT" ? "OPERATIONAL_IMPORT" : "PLATFORM_DRAFT";
  return (
    <Stack data-testid="operational-authority-workspace" spacing={2}>
      <OperationalAuthorityPanel
        state={
          loadError || syncError
            ? "ERROR"
            : projection?.sync_state === "CONFLICT"
              ? "CONFLICT"
              : projection
                ? "CONFIRMED"
                : "PENDING"
        }
        origin={origin}
        freshness={
          projection?.freshness_state === "CURRENT" || projection?.freshness_state === "STALE"
            ? projection.freshness_state
            : "UNKNOWN"
        }
        {...(projection?.current_external_display_key
          ? { externalDisplayKey: projection.current_external_display_key }
          : {})}
      />
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Chip label={formatRuUiValue(projection?.acceptance_source ?? "UNCONFIRMED")} />
        <Chip label={`редакция ${Number(projection?.projection_revision ?? 0)}`} />
        <Chip label={`Статус Jira: ${rawStatus?.name ?? "Неизвестен"}`} />
        <Chip
          label={`Статус запроса: ${formatRuUiValue(snapshot.normalizedStatus ?? "UNKNOWN")}`}
        />
      </Stack>
      <Typography variant="body2">
        Изменения статуса приходят из Jira. Фоновая проверка подхватывает пропущенные изменения;
        этот экран обновляется автоматически каждые 5 секунд.
      </Typography>
      <Typography variant="body2">
        Последняя проверка Jira:{" "}
        {projection?.last_observed_at
          ? formatRuDateTime(projection.last_observed_at)
          : "Ещё не выполнена"}
      </Typography>
      {loadError && <Alert severity="error">{loadError}</Alert>}
      {syncError && (
        <Alert severity="warning">
          {projection.sync_state === "MAPPING_REQUIRED"
            ? "В Jira появился неизвестный статус. Администратору нужно настроить соответствие статусов. Показано последнее подтверждённое состояние."
            : "Не удалось проверить Jira. Показано последнее подтверждённое состояние; система повторит проверку автоматически."}
        </Alert>
      )}
      {projection?.sync_state === "CONFLICT" && (
        <Alert severity="warning">
          Состояние Jira изменилось после подготовки действия. Перечитайте данные и подготовьте
          новое действие.
        </Alert>
      )}
      <Alert severity={/(?:не удалось|ошиб|failed|error)/iu.test(notice) ? "error" : "info"}>
        {notice}
      </Alert>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          disabled={busy}
          onClick={() => void load().catch((error: unknown) => setLoadError(String(error)))}
        >
          Обновить данные на экране
        </Button>
        <Button
          variant="contained"
          disabled={
            (!!props.permissions &&
              (!props.permissions.includes("command.execute") ||
                !props.permissions.includes("integration.use"))) ||
            busy ||
            !!loadError ||
            !!syncError ||
            projection?.freshness_state !== "CURRENT" ||
            !projection ||
            snapshot.normalizedStatus === "DONE"
          }
          onClick={() => void prepareTransition()}
        >
          Перевести в состояние «Выполнено»
        </Button>
        {action && (
          <Button
            color="secondary"
            variant="contained"
            disabled={
              (!!props.permissions && !props.permissions.includes("approval.decide")) || busy
            }
            onClick={() => void approve()}
          >
            Согласовать точное действие
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

export const qaOperationalAuthorityUiContribution = Object.freeze({
  key: "competency-qa.operational-authority",
  componentRef: "qa.ui.operational-authority",
  Component: QaOperationalAuthorityWorkspace,
});

import {
  Alert,
  Box,
  Button,
  Chip,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

const stages = ["CANDIDATE", "BACKLOG", "READY", "ACTIVE", "COMPLETED"] as const;

export interface QaQueueWorkspaceEntry {
  readonly queueEntryId: string;
  readonly projectId: string;
  readonly stage: string;
  readonly subject: Readonly<{ kind: string; id: string }>;
  readonly ordering?: Readonly<{ components?: Readonly<Record<string, unknown>> }>;
  readonly operational?: Readonly<{
    state?: string;
    displayStatus?: string;
    normalizedStatus?: string;
  }>;
  readonly freshness?: Readonly<{ state?: string }>;
}

export interface QaQueueWorkspacePage {
  readonly workspaceId: string;
  readonly scope: Readonly<{
    kind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
    projectId?: string;
    authorizedProjectSetHash: string;
  }>;
  readonly freshness: string;
  readonly comparatorRef: string | Readonly<Record<string, unknown>>;
  readonly orderState: Readonly<{
    resourceVersion: number;
    queueEpoch: number;
    baseVisibleSetHash: string;
  }>;
  readonly visibleCounts: Readonly<{ total: number; byStage: Readonly<Record<string, number>> }>;
  readonly items: readonly Readonly<{
    ordinal: number;
    entry: QaQueueWorkspaceEntry;
    appliedOrderOverride?: Readonly<{
      applicationState: string;
      placement: string;
      reason: string;
      expiresAt?: string;
    }>;
  }>[];
  readonly nextCursor: string | null;
}

export interface QaQueueWorkspaceProps {
  readonly page: QaQueueWorkspacePage;
  readonly busy?: boolean;
  readonly pendingCount?: number;
  readonly pendingItems?: readonly Readonly<{
    id: string;
    projectId: string;
    label: string;
    status: string;
    href: string;
  }>[];
  readonly onReload: () => void;
  readonly onLoadMore: () => void;
  readonly labelFor?: (entry: QaQueueWorkspaceEntry) => string;
  readonly hrefFor?: (entry: QaQueueWorkspaceEntry) => string;
  readonly onMove?: (entry: QaQueueWorkspaceEntry, placement: "FIRST" | "LAST") => void;
}

function comparatorLabel(value: QaQueueWorkspacePage["comparatorRef"]): string {
  if (typeof value === "string") return value;
  return `${String(value.key ?? "queue-order")}@${String(value.version ?? "1.0.0")}`;
}

/** Pure response renderer: it never receives hidden Projects, provider clients or global counts. */
export function QaQueueWorkspace({
  page,
  busy = false,
  pendingCount = 0,
  pendingItems = [],
  onReload,
  onLoadMore,
  onMove,
  labelFor,
  hrefFor,
}: Readonly<QaQueueWorkspaceProps>) {
  const scopeLabel = page.scope.kind === "AUTHORIZED_PORTFOLIO" ? "Все проекты" : "Текущий проект";
  const rows = [
    ...page.items.map((item) => ({
      key: item.entry.queueEntryId,
      label: labelFor?.(item.entry) ?? `${item.entry.projectId} · ${item.entry.subject.id}`,
      href: hrefFor?.(item.entry),
      status: formatRuUiValue(item.entry.stage),
      item,
    })),
    ...pendingItems.map((pending) => ({
      key: `${pending.projectId}:${pending.id}`,
      label: pending.label,
      href: pending.href,
      status: "Без приоритета",
      pending,
    })),
  ];
  return (
    <Stack spacing={2} aria-label="Разрешённая очередь QA">
      <Box
        component="section"
        aria-label="Сводка очереди"
        sx={{ pb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" } }}
          >
            <Typography component="h2" variant="h5" sx={{ flex: 1 }}>
              Очередь QA · {scopeLabel}
            </Typography>
            <Button disabled={busy} onClick={onReload}>
              Обновить очередь
            </Button>
          </Stack>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            <Chip size="small" label={`Всего: ${page.visibleCounts.total + pendingCount}`} />
            {pendingCount > 0 && (
              <Chip size="small" variant="outlined" label={`Без приоритета: ${pendingCount}`} />
            )}
            {stages
              .filter((stage) => (page.visibleCounts.byStage[stage] ?? 0) > 0)
              .map((stage) => (
                <Chip
                  key={stage}
                  size="small"
                  variant="outlined"
                  label={`${formatRuUiValue(stage)}: ${page.visibleCounts.byStage[stage]}`}
                />
              ))}
            <Chip
              size="small"
              color={page.freshness === "CURRENT" ? "success" : "warning"}
              label={formatRuUiValue(page.freshness)}
            />
          </Stack>
          {page.freshness !== "CURRENT" && (
            <Alert severity="warning">
              Данные очереди могли измениться. Обновите их перед изменением порядка.
            </Alert>
          )}
          <Box
            component="details"
            sx={{ fontSize: "0.8rem", color: "text.secondary", "& summary": { padding: "4px 0" } }}
          >
            <summary>Технические детали очереди</summary>
            <Typography variant="caption">
              Правило сравнения {comparatorLabel(page.comparatorRef)} · версия порядка{" "}
              {page.orderState.resourceVersion} · эпоха {page.orderState.queueEpoch}
            </Typography>
          </Box>
        </Stack>
      </Box>
      {rows.length > 0 && (
        <Box role="list" aria-label="Задачи очереди" sx={{ borderTop: 1, borderColor: "divider" }}>
          {rows.map((row) => {
            const item = "item" in row ? row.item : undefined;
            const components = item?.entry.ordering?.components ?? {};
            return (
              <Box
                role="listitem"
                key={row.key}
                data-testid={
                  item
                    ? `queue-workspace-item-${item.entry.queueEntryId}`
                    : `queue-pending-${row.key}`
                }
                sx={{
                  px: { xs: 1, sm: 2 },
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: "divider",
                  minWidth: 0,
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "center" } }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      component="h3"
                      variant="body1"
                      sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    >
                      {row.label}
                    </Typography>
                    <Stack
                      direction="row"
                      sx={{ mt: 0.75, flexWrap: "wrap", alignItems: "center", gap: 1 }}
                    >
                      <Chip size="small" variant="outlined" label={row.status} />
                      {item && (
                        <Typography variant="caption" color="text.secondary">
                          Позиция {item.ordinal}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                  {row.href && (
                    <Button
                      size="small"
                      href={row.href}
                      sx={{ alignSelf: { xs: "flex-start", sm: "center" }, flexShrink: 0 }}
                    >
                      Открыть задачу
                    </Button>
                  )}
                </Stack>
                <Box
                  component="details"
                  sx={{
                    mt: 0.5,
                    fontSize: "0.8rem",
                    color: "text.secondary",
                    "& summary": { padding: "4px 0" },
                  }}
                >
                  <summary>Подробнее</summary>
                  <Stack spacing={1} sx={{ pt: 1 }}>
                    {item ? (
                      <>
                        <Typography variant="body2">
                          Класс обслуживания:{" "}
                          {formatRuUiValue(components.serviceClassBand ?? "UNKNOWN")}. SLA:{" "}
                          {formatRuUiValue(components.slaState ?? "UNKNOWN")}.
                        </Typography>
                        <Typography variant="body2">
                          Подтверждённое состояние Jira:{" "}
                          {item.entry.operational?.displayStatus ??
                            formatRuUiValue(
                              item.entry.operational?.normalizedStatus ?? "UNCONFIRMED",
                            )}
                          . Этап очереди платформы учитывается отдельно.
                        </Typography>
                        <Typography variant="body2">
                          Актуальность: {formatRuUiValue(item.entry.freshness?.state ?? "UNKNOWN")}
                        </Typography>
                        {item.appliedOrderOverride && (
                          <Typography variant="body2">
                            Изменение порядка руководителем:{" "}
                            {formatRuUiValue(item.appliedOrderOverride.placement)} ·{" "}
                            {formatRuUiValue(item.appliedOrderOverride.applicationState)} ·{" "}
                            {item.appliedOrderOverride.reason}
                            {item.appliedOrderOverride.expiresAt
                              ? ` · до ${formatRuDateTime(item.appliedOrderOverride.expiresAt)}`
                              : ""}
                          </Typography>
                        )}
                        {onMove && (
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() => onMove(item.entry, "FIRST")}
                            >
                              Переместить в начало
                            </Button>
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() => onMove(item.entry, "LAST")}
                            >
                              Переместить в конец
                            </Button>
                          </Stack>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2">
                        Задача доступна команде. Приоритет и сроки появятся после подготовки очереди
                        проекта. Состояние запроса:{" "}
                        {formatRuUiValue("pending" in row ? row.pending.status : "UNKNOWN")}.
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      {page.nextCursor && (
        <Button disabled={busy} onClick={onLoadMore}>
          Загрузить ещё
        </Button>
      )}
      {page.items.length === 0 && pendingCount === 0 && (
        <Alert severity="info">
          Очередь пока пуста. Здесь появятся запросы всех доступных проектов по мере их приёма и
          подготовки к проверкам. Посмотреть отправленные запросы можно в разделе «Запросы».
        </Alert>
      )}
    </Stack>
  );
}

export const qaQueueWorkspaceUiContribution = Object.freeze({
  key: "competency-qa.queue-workspace",
  componentRef: "qa.ui.queue-workspace",
  Component: QaQueueWorkspace,
});

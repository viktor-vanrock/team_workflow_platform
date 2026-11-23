import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

import type { QaBrowserApiContext } from "./intake.tsx";

interface QaBacklogItem {
  readonly requestExtension: Readonly<{ workItemId: string; resourceVersion: number }>;
  readonly currentRequestInputRevision: Readonly<{
    version: number;
    title: string;
    requestKind: string;
    contentHash: string;
    responseChannelResolution: Readonly<{ state: string }>;
  }>;
  readonly operationalReadiness: Readonly<{ assessmentState: string; normalizedStatus: string }>;
}
export function QaConfirmedBacklog({
  context,
  refreshToken = 0,
  onOpen,
  onCreate,
}: Readonly<{
  context: QaBrowserApiContext;
  refreshToken?: number;
  onOpen?: (id: string) => void;
  onCreate?: () => void;
}>) {
  const [items, setItems] = useState<readonly QaBacklogItem[]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const cancelPendingLoads = useCallback(() => {
    sequence.current += 1;
  }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    setItems(undefined);
    try {
      const response = await fetch(
        `${context.apiUrl}/api/v1/workspaces/${context.workspaceId}/projects/${context.projectId}/qa/backlog`,
        { headers: { authorization: `Bearer ${context.accessToken}` } },
      );
      if (!response.ok) throw new Error(response.status === 403 ? "access" : "load");
      const result = (await response.json()) as Readonly<{ items: readonly QaBacklogItem[] }>;
      if (current === sequence.current) setItems(result.items);
    } catch (cause) {
      if (current === sequence.current)
        setError(
          cause instanceof Error && cause.message === "access"
            ? "Нет доступа к запросам этого проекта. Смените роль или обратитесь к владельцу проекта."
            : "Не удалось загрузить запросы. Проверьте соединение и повторите попытку.",
        );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [context.apiUrl, context.accessToken, context.workspaceId, context.projectId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) void load();
    });
    return () => {
      live = false;
      cancelPendingLoads();
    };
  }, [load, refreshToken, cancelPendingLoads]);
  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <Typography color="text.secondary">
          {items ? `Запросов в проекте: ${items.length}` : "Запросы текущего проекта"}
        </Typography>
        <Button onClick={() => void load()} disabled={loading}>
          Обновить
        </Button>
      </Stack>
      {loading && (
        <Box role="status">
          <CircularProgress size={20} /> Загружаем запросы…
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {items?.length === 0 && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5" component="h2">
                Пока нет запросов
              </Typography>
              <Typography color="text.secondary">
                Здесь появятся запросы после подтверждённой отправки. Черновики ещё не переданы
                команде в работу.
              </Typography>
              {onCreate ? (
                <Box>
                  <Button variant="contained" onClick={onCreate}>
                    Создать первый запрос
                  </Button>
                </Box>
              ) : (
                <Typography color="text.secondary">
                  Попросите заказчика отправить запрос или выберите роль заказчика, чтобы пройти
                  этот сценарий.
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}
      {items?.map((item) => (
        <Card key={item.requestExtension.workItemId}>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Chip
                  size="small"
                  label={formatRuUiValue(item.currentRequestInputRevision.requestKind)}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Jira: ${formatRuUiValue(item.operationalReadiness.normalizedStatus)}`}
                />
              </Stack>
              <Typography variant="h5" component="h2">
                {item.currentRequestInputRevision.title}
              </Typography>
              <Typography color="text.secondary">
                Готовность QA: {formatRuUiValue(item.operationalReadiness.assessmentState)}
              </Typography>
              {onOpen && (
                <Box>
                  <Button
                    onClick={() => onOpen(item.requestExtension.workItemId)}
                    aria-label={`Открыть: ${item.currentRequestInputRevision.title}`}
                  >
                    Открыть запрос →
                  </Button>
                </Box>
              )}
              <Box component="details">
                <summary>Технические детали</summary>
                <Typography variant="body2">Запрос: {item.requestExtension.workItemId}</Typography>
                <Typography variant="body2">
                  Редакция {item.currentRequestInputRevision.version} ·{" "}
                  {item.currentRequestInputRevision.contentHash}
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

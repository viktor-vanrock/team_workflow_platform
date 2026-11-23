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

import { projectSessionHeaders } from "./project-session.ts";

export interface AuthorizedProjectCatalogItem {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly stage: string;
  readonly capabilityMode: string;
}
export interface ProjectCatalogRouteProps {
  readonly apiUrl: string;
  readonly accessToken?: string;
  csrfToken?: string;
  onboardingAvailable?: boolean;
  readonly workspaceId: string;
  readonly canCreate?: boolean;
  readonly canEdit?: boolean;
  readonly editableProjectIds?: readonly string[];
}
function stageHelp(project: AuthorizedProjectCatalogItem) {
  if (project.stage === "SUSPENDED")
    return "Работа приостановлена. Администратор должен проверить причины и условия возобновления.";
  if (project.stage === "DRAFT")
    return "Проект ещё настраивается. Администратор проверит подключения и условия начала работы.";
  if (project.capabilityMode === "MANUAL_ONLY")
    return "Выбран режим ручных проверок. Автоматизация потребует отдельной настройки и проверки готовности.";
  return "Откройте подключение, чтобы увидеть актуальную готовность, ограничения и необходимые действия.";
}
export function ProjectCatalogRoute(props: ProjectCatalogRouteProps) {
  const [items, setItems] = useState<readonly AuthorizedProjectCatalogItem[]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const cancelPendingLoads = useCallback(() => {
    sequence.current += 1;
  }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setItems(undefined);
    setLoading(true);
    setError("");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const items: AuthorizedProjectCatalogItem[] = [];
        for (;;) {
          const query = new URLSearchParams({ limit: "100" });
          if (cursor) query.set("cursor", cursor);
          const response = await fetch(
            `${props.apiUrl}/v1/workspaces/${props.workspaceId}/projects?${query}`,
            {
              credentials: "include",
              headers: projectSessionHeaders(props.accessToken, props.csrfToken),
            },
          );
          if (current !== sequence.current) return;
          if (response.status === 409 && cursor) break;
          if (!response.ok) throw new Error("catalog");
          const body = (await response.json()) as {
            items: AuthorizedProjectCatalogItem[];
            nextCursor?: string;
          };
          items.push(...body.items);
          if (!body.nextCursor) {
            if (current === sequence.current)
              setItems([...new Map(items.map((item) => [item.id, item])).values()]);
            return;
          }
          if (seen.has(body.nextCursor)) throw new Error("catalog cursor cycle");
          seen.add(body.nextCursor);
          cursor = body.nextCursor;
        }
      }
      throw new Error("catalog changed");
    } catch {
      if (current === sequence.current)
        setError(
          "Каталог проектов недоступен. Проверьте доступ текущей роли и повторите загрузку.",
        );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [props.accessToken, props.csrfToken, props.apiUrl, props.workspaceId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) void load();
    });
    const refresh = () => void load();
    window.addEventListener("project-authorization-changed", refresh);
    return () => {
      live = false;
      cancelPendingLoads();
      window.removeEventListener("project-authorization-changed", refresh);
    };
  }, [load, cancelPendingLoads]);
  return (
    <Stack spacing={2} aria-label="Доступные проекты">
      <Typography color="text.secondary">
        Здесь собраны доступные вам проекты. Подключение и готовность проверяются отдельно для
        каждого проекта. Откройте карточку нужного проекта из каталога.
      </Typography>
      <Box>
        {props.canCreate && (
          <Button variant="contained" href="/projects/new" sx={{ mr: 1 }}>
            Новый проект
          </Button>
        )}
        <Button onClick={() => void load()} disabled={loading}>
          Обновить проекты
        </Button>
      </Box>
      {loading && (
        <Box role="status">
          <CircularProgress size={20} /> Загружаем проекты…
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {items?.length === 0 && (
        <Alert severity="info">
          Сейчас нет доступных проектов. Обратитесь к владельцу рабочей области или выберите другую
          роль.
        </Alert>
      )}
      {items?.map((project) => (
        <Card key={project.id}>
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Typography variant="h5" component="h2" sx={{ flex: 1 }}>
                  {project.name}
                </Typography>
                <Chip label={project.key} />
                <Chip variant="outlined" label={formatRuUiValue(project.stage)} />
              </Stack>
              <Typography color="text.secondary">{stageHelp(project)}</Typography>
              <Box>
                {props.onboardingAvailable !== false && (
                  <Button href={`/projects/${project.id}/onboarding`}>Открыть подключение</Button>
                )}
                {(props.canEdit || props.editableProjectIds?.includes(project.id)) && (
                  <Button href={`/projects/${project.id}/edit`}>Редактировать проект</Button>
                )}
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

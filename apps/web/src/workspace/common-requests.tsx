import { QaWorkItemDetail } from "@awp/competency-qa/ui";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@awp/platform-ui";

import type { WorkspaceProject } from "./navigation.ts";
import { requestHref, useWorkspaceSubjects } from "./subjects.ts";

export function CommonRequests(props: {
  apiUrl: string;
  accessToken: string;
  workspaceId: string;
  projects: readonly WorkspaceProject[];
  requestId?: string;
  projectId?: string;
  navigate: (url: string) => void;
}) {
  const { items, error, loading, reload } = useWorkspaceSubjects(props);
  if (loading) return <CircularProgress aria-label="Загрузка запросов всех проектов" />;
  if (error)
    return (
      <Alert severity="error">
        {error}
        <Button onClick={reload}>Обновить</Button>
      </Alert>
    );
  const selected = items.find(
    (item) =>
      item.kind === "WORK_ITEM" &&
      item.id === props.requestId &&
      (!props.projectId || item.projectId === props.projectId),
  );
  if (props.requestId) {
    if (!selected)
      return (
        <Alert severity="warning">
          Запрос недоступен. <Button href="/qa/requests">Все запросы</Button>
        </Alert>
      );
    const project = props.projects.find((p) => p.projectId === selected.projectId)!;
    return (
      <QaWorkItemDetail
        {...props}
        projectId={selected.projectId}
        workItemId={selected.id}
        view="requests"
        permissions={project.permissions ?? []}
        projectLabel={selected.projectKey}
        onOpenRequest={(id) =>
          props.navigate(id ? requestHref(selected.projectId, id) : "/qa/requests")
        }
        onCreateRequest={() => props.navigate(`/qa/new?project=${selected.projectId}`)}
      />
    );
  }
  const requests = items.filter((item) => item.kind === "WORK_ITEM");
  return (
    <Stack spacing={2} aria-label="Запросы всех проектов">
      <Typography variant="h5" component="h2">
        Запросы всех проектов · {requests.length}
      </Typography>
      <Button onClick={reload}>Обновить</Button>
      {!requests.length && (
        <Alert severity="info">
          Пока нет запросов
          {props.projects.some((project) => project.permissions?.includes("qa.request.create")) && (
            <Button onClick={() => props.navigate("/qa/new")}>Создать первый запрос</Button>
          )}
        </Alert>
      )}
      {requests.map((item) => (
        <Card key={item.id}>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ alignItems: "center" }}
            >
              <Chip label={item.projectKey} />
              <Typography sx={{ flex: 1 }}>{item.title}</Typography>
              <Button
                aria-label={`Открыть: ${item.title}`}
                href={requestHref(item.projectId, item.id)}
              >
                Открыть запрос
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

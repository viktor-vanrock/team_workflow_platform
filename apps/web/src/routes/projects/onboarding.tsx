import { useCallback, useEffect, useState } from "react";

import { type ProjectOnboardingView, ProjectOnboardingWorkspace } from "@awp/competency-qa/ui";
import { Alert, Button, CircularProgress, Stack, TextField } from "@awp/platform-ui";

export interface ProjectOnboardingRouteProps {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly permissions?: readonly string[];
  readonly onUnavailable?: () => void;
}

export function ProjectOnboardingRoute(props: ProjectOnboardingRouteProps) {
  const [view, setView] = useState<ProjectOnboardingView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { accessToken, onUnavailable } = props;
  const [incidentRef, setIncidentRef] = useState("");
  const [reason, setReason] = useState("");
  const endpoint = `${props.apiUrl}/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/onboarding`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 404) {
      onUnavailable?.();
      window.dispatchEvent(new Event("project-authorization-changed"));
      window.history.replaceState({}, "", "/projects");
      throw new Error("Ресурс проекта недоступен");
    }
    if (!response.ok)
      throw new Error(`Не удалось загрузить подключение проекта: ${response.status}`);
    setView((await response.json()) as ProjectOnboardingView);
    setError(undefined);
  }, [accessToken, endpoint, onUnavailable]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load().catch((cause: unknown) => setError(String(cause)));
    });
    return () => {
      current = false;
    };
  }, [load]);
  const command = async (path: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${props.accessToken}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "if-match": "1",
        },
        body: "{}",
      });
      if (!response.ok)
        throw new Error(`Команда подключения проекта завершилась ошибкой: ${response.status}`);
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const suspend = async () => {
    if (!incidentRef.trim() || !reason.trim()) {
      setError("Укажите инцидент и причину приостановки.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const base = `${props.apiUrl}/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/operations`;
      const headers = { authorization: `Bearer ${props.accessToken}` };
      const read = await fetch(base, { headers });
      if (!read.ok) throw new Error("Не удалось проверить текущую версию проекта.");
      const current = (await read.json()) as { version: number };
      const response = await fetch(`${base}/suspend`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "if-match": String(current.version),
        },
        body: JSON.stringify({ incidentRef: incidentRef.trim(), reason: reason.trim() }),
      });
      if (!response.ok) throw new Error(`Не удалось приостановить проект: ${response.status}`);
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!view)
    return error ? (
      <Alert severity="error">
        {error}
        <Button onClick={() => void load().catch((cause: unknown) => setError(String(cause)))}>
          Повторить загрузку
        </Button>
      </Alert>
    ) : (
      <CircularProgress aria-label="Загрузка подключения проекта" />
    );
  return (
    <Stack spacing={2}>
      {props.permissions?.includes("project.metadata.update") && (
        <Button href={`/projects/${props.projectId}/edit`} sx={{ alignSelf: "flex-start" }}>
          Редактировать проект
        </Button>
      )}
      {props.permissions?.includes("project.suspend") && view.operationalState === "ACTIVE" && (
        <Stack spacing={1}>
          <TextField
            label="Ссылка или номер инцидента"
            value={incidentRef}
            onChange={(event) => setIncidentRef(event.target.value)}
          />
          <TextField
            label="Причина приостановки"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Stack>
      )}
      {view.operationalState === "SUSPENDED" && props.permissions?.includes("project.resume") && (
        <Alert severity="info">
          Возобновление требует принятого решения по инциденту, свежих проверок и независимого
          согласования другого администратора. Оформите эти основания в процессе подключения
          проекта.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <ProjectOnboardingWorkspace
        view={{
          ...view,
          canEvaluate:
            view.canEvaluate && !!props.permissions?.includes("project.onboarding.evaluate"),
          canRequestPublication:
            view.canRequestPublication &&
            !!props.permissions?.includes("integration.binding.request-publication"),
        }}
        busy={busy}
        onEvaluate={() => void command("/evaluations")}
        onRequestPublication={() => void command("/binding-publication-requests")}
        {...(props.permissions?.includes("project.suspend")
          ? { onEmergencySuspend: () => void suspend() }
          : {})}
      />
    </Stack>
  );
}

import { lazy, type MouseEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  blackOrder,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  formatRuUiValue,
  Link,
  OrderHeading,
  OrderIcon,
  OrderOracle,
  Stack,
  Typography,
} from "@awp/platform-ui";

import { AccessAdministration } from "./access-administration.tsx";
import { breadcrumbs } from "./breadcrumbs.ts";
import { CommonRequests } from "./common-requests.tsx";
import { workspaceContribution } from "./contributions.ts";
import {
  accessSection,
  canVisit,
  extraSections,
  type LocalSession,
  personaDescriptions,
  type PersonaOption,
  type Section,
  sections,
} from "./navigation.ts";
import { requestHref } from "./subjects.ts";
import { WorkspaceHome } from "./workspace-home.tsx";

const QaWorkItemDetailRoute = lazy(async () => {
  const route = await import("../routes/qa/qa-work-item-detail.tsx");
  return { default: route.QaWorkItemDetailRoute };
});
const MattermostIntakeRoute = lazy(async () => {
  const route = await import("../routes/qa/mattermost-intake.tsx");
  return { default: route.MattermostIntakeRoute };
});
const IntakeCandidatesRoute = lazy(async () => {
  const route = await import("../routes/qa/intake-candidates.tsx");
  return { default: route.IntakeCandidatesRoute };
});
const HermesProposalsRoute = lazy(async () => {
  const route = await import("../routes/qa/hermes-proposals.tsx");
  return { default: route.HermesProposalsRoute };
});
const NotificationHealthRoute = lazy(async () => {
  const route = await import("../routes/qa/notification-health.tsx");
  return { default: route.NotificationHealthRoute };
});
const AutomatedSessionRoute = lazy(async () => {
  const route = await import("../routes/qa/automated-session.tsx");
  return { default: route.QaAutomatedSessionRoute };
});
const QueueWorkspaceRoute = lazy(async () => {
  const route = await import("../routes/qa/queue-workspace.tsx");
  return { default: route.QueueWorkspaceRoute };
});
const ProjectOnboardingRoute = lazy(async () => {
  const route = await import("../routes/projects/onboarding.tsx");
  return { default: route.ProjectOnboardingRoute };
});
const ProjectEditRoute = lazy(async () => ({
  default: (await import("../routes/projects/project-edit.tsx")).ProjectEditRoute,
}));
const ProjectDialogueRoute = lazy(async () => ({
  default: (await import("../routes/projects/project-dialogue.tsx")).ProjectDialogueRoute,
}));
const ProjectCreateRoute = lazy(async () => ({
  default: (await import("../routes/projects/project-create.tsx")).ProjectCreateRoute,
}));
const ProjectCatalogRoute = lazy(async () => {
  const route = await import("../routes/projects/project-catalog.tsx");
  return { default: route.ProjectCatalogRoute };
});
const ProjectEvidenceRoute = lazy(async () => {
  const route = await import("../routes/projects/evidence.tsx");
  return { default: route.ProjectEvidenceRoute };
});
const DeveloperTools = lazy(async () => ({
  default: (await import("./developer-tools.tsx")).DeveloperTools,
}));
const webEnvironment = import.meta.env as Readonly<Record<string, string | undefined>>;
const apiUrl = webEnvironment.VITE_AWP_API_URL ?? "http://localhost:3000";
const composition = webEnvironment.VITE_AWP_COMPOSITION ?? "foundation";
const qaEnabled = composition !== "foundation";
const locationValue = () => window.location.pathname + window.location.search;

function isEnabled(section: Section) {
  if (section.path.startsWith("/qa/") && !qaEnabled) return false;
  if (
    [
      "/qa/mattermost-intake",
      "/qa/intake-candidates",
      "/qa/hermes-proposals",
      "/qa/notification-health",
    ].includes(section.path)
  )
    return composition.includes("mattermost");
  if (section.path === "/qa/automated-session") return composition.includes("gitlab");
  return true;
}

export function LocalWorkspaceApp() {
  const [personas, setPersonas] = useState<readonly PersonaOption[]>([]);
  const [personaKey, setPersonaKey] = useState("requester.alpha");
  const [session, setSession] = useState<LocalSession>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [location, setLocation] = useState(locationValue);
  const epoch = useRef(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const path = location.split("?")[0]!;
  const params = new URLSearchParams(location.split("?")[1]);
  const navigate = useCallback((next: string) => {
    window.history.pushState(null, "", next);
    setLocation(locationValue());
  }, []);
  useEffect(() => {
    const update = () => setLocation(locationValue());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location, session?.persona.key, session?.context.projectId]);
  const loadPersonas = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/local/personas`, { signal: signal ?? null });
      if (!response.ok) throw new Error("catalog");
      const options = (await response.json()) as readonly PersonaOption[];
      if (signal?.aborted) return;
      setPersonas(options);
      setPersonaKey((current) =>
        options.some((option) => option.key === current) ? current : (options[0]?.key ?? ""),
      );
      if (!options.length)
        setError(
          "Роли для локального стенда не найдены. Проверьте запуск и начальные данные проекта.",
        );
    } catch {
      if (!signal?.aborted)
        setError(
          "Не удалось загрузить роли. Убедитесь, что локальный проект запущен, и повторите попытку.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadPersonas(controller.signal);
    });
    return () => {
      controller.abort();
    };
  }, [loadPersonas]);
  async function exchange() {
    if (busy) return;
    const requestEpoch = ++epoch.current;
    setSession(undefined);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/local/persona/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaKey }),
      });
      if (!response.ok) throw new Error("exchange");
      const next = (await response.json()) as LocalSession;
      if (requestEpoch !== epoch.current) return;
      setSession(next);
    } catch {
      if (requestEpoch === epoch.current)
        setError(
          "Не удалось войти с выбранной ролью. Проверьте доступность проекта и повторите вход.",
        );
    } finally {
      if (requestEpoch === epoch.current) setBusy(false);
    }
  }
  const refreshSession = useCallback(
    async (workspaceId?: string, destination?: string) => {
      if (!session) return;
      const requestEpoch = epoch.current;
      try {
        let response = await fetch(`${apiUrl}/local/persona/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            personaKey: session.persona.key,
            ...(workspaceId ? { workspaceId } : {}),
          }),
        });
        if (response.status === 403 && workspaceId)
          response = await fetch(`${apiUrl}/local/persona/exchange`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ personaKey: session.persona.key }),
          });
        if (!response.ok) throw new Error();
        const next = (await response.json()) as LocalSession;
        if (destination && next.context.workspaceId !== workspaceId)
          throw new Error("CREATED_PROJECT_WORKSPACE_UNAVAILABLE");
        if (epoch.current === requestEpoch) {
          setSession({ ...next, accessToken: session.accessToken });
          if (destination && next.context.workspaceId === workspaceId) navigate(destination);
          else if (next.context.workspaceId !== session.context.workspaceId) navigate("/");
        }
      } catch {
        if (epoch.current === requestEpoch)
          setError("Не удалось обновить назначения. Повторите вход.");
        if (destination) throw new Error("CREATED_PROJECT_SESSION_UNAVAILABLE");
      }
    },
    [session, navigate],
  );
  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      void refreshSession(session.context.workspaceId || undefined);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [session, refreshSession]);
  async function stepUp() {
    if (!session || busy) return;
    const requestEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/local/persona/step-up`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          ...(session.context.workspaceId
            ? { "x-awp-workspace-id": session.context.workspaceId }
            : {}),
          ...(session.context.projectId ? { "x-awp-project-id": session.context.projectId } : {}),
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("step-up");
      const next = (await response.json()) as LocalSession;
      if (requestEpoch === epoch.current) {
        setSession(next);
        setNotice("Дополнительное подтверждение входа действует пять минут.");
      }
    } catch {
      if (requestEpoch === epoch.current)
        setError(
          "Не удалось подтвердить вход. Повторите попытку перед административным действием.",
        );
    } finally {
      if (requestEpoch === epoch.current) setBusy(false);
    }
  }
  function followLink(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/pilot/") || url.hash)
      return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  }
  const switchRole = () => {
    ++epoch.current;
    setSession(undefined);
    setError("");
    setNotice("");
    navigate("/");
  };
  if (!session)
    return (
      <Box
        sx={{
          minHeight: "100vh",
          p: { xs: 2, md: 6 },
          display: "grid",
          alignContent: "center",
          background: `radial-gradient(ellipse at 80% 10%, ${blackOrder.wax}26, transparent 55%)`,
        }}
      >
        <Box
          sx={{
            maxWidth: 980,
            mx: "auto",
            width: "100%",
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: { xs: 3, md: 6 },
            alignItems: "center",
          }}
        >
          <Box>
            <Chip label="Локальный стенд · учебные данные" size="small" />
            <OrderHeading>
              <Typography component="h1" variant="h3">
                Рабочие области команд
              </Typography>
              <Typography color="text.secondary">
                Выберите свою команду и роль: проверяйте сервисы или готовьте техническую
                документацию.
              </Typography>
            </OrderHeading>
            <Stack spacing={2} sx={{ mt: 3 }}>
              {[
                "QA: запросы, проверки и результаты",
                "Писатель: задания, черновики и доработка",
                "Лид техписателей: ревью и утверждение",
              ].map((text, index) => (
                <Stack direction="row" spacing={2} key={text} sx={{ alignItems: "center" }}>
                  <Chip size="small" label={index + 1} />
                  <Typography>{text}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
          <Card
            sx={{
              borderColor: blackOrder.controlBorder,
              borderRadius: { xs: "3px", md: "80px 80px 3px 3px" },
              background: `radial-gradient(ellipse at top, ${blackOrder.wax}26, transparent 60%), ${blackOrder.surface}`,
              "& > .MuiCardContent-root": { p: { xs: 3, md: 4 }, pt: { md: 6 } },
            }}
          >
            <CardContent>
              <Stack spacing={2}>
                <Typography component="h2" variant="h5">
                  С чего хотите начать?
                </Typography>
                <Typography color="text.secondary">
                  Выберите участника и его роль. Очередь объединяет все доступные проекты. Команды
                  разделены по предметной области, а QA обслуживает все свои проекты.
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Первый вошедший пользователь получает роль «Глобальный администратор» и управляет
                  доступами во всех рабочих областях. Назначение выполняется один раз.
                </Typography>
                <label htmlFor="workspace-persona">Участник и роль</label>
                <select
                  id="workspace-persona"
                  value={personaKey}
                  onChange={(event) => setPersonaKey(event.target.value)}
                  disabled={busy || loading}
                >
                  {personas.map((persona) => (
                    <option value={persona.key} key={persona.key}>
                      {formatRuUiValue(persona.label)}
                    </option>
                  ))}
                </select>
                <Typography color="text.secondary" variant="body2">
                  {personaDescriptions[personaKey] ??
                    "Выбранная роль определяет доступные разделы и действия."}
                </Typography>
                {loading && (
                  <Box role="status">
                    <CircularProgress size={18} /> Загрузка ролей…
                  </Box>
                )}
                {error && <Alert severity="error">{error}</Alert>}
                <Button
                  variant="contained"
                  onClick={() => void exchange()}
                  disabled={busy || loading || !personas.length}
                >
                  {busy ? "Входим…" : "Начать работу"}
                </Button>
                {!loading && error && (
                  <Button onClick={() => void loadPersonas()}>Обновить список ролей</Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  Jira, GitLab и чат работают здесь как локальные эмуляторы.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Box>
    );

  const contribution = workspaceContribution(session);
  const activeSections: readonly Section[] = [
    ...(contribution
      ? session.grants.permissions.includes("docs.read")
        ? contribution.sections(session.grants.permissions)
        : [sections[0]]
      : sections),
    ...(contribution ? [sections.find((section) => section.path === "/projects")!] : []),
    accessSection,
  ];
  const activeExtras = contribution ? [] : extraSections;
  const ContributionPage = contribution?.Component;
  const editing = /^\/projects\/([^/]+)\/edit$/u.exec(path);
  const onboarding = /^\/projects\/([^/]+)\/onboarding$/u.exec(path);
  const evidence = /^\/projects\/([^/]+)\/evidence$/u.exec(path);
  const pageProjectId =
    editing?.[1] ??
    onboarding?.[1] ??
    evidence?.[1] ??
    params.get("project") ??
    (contribution && !["/admin/users", "/projects", "/projects/new"].includes(path)
      ? session.context.projectId
      : undefined);
  const pageProjectKey =
    session.projects?.find((project) => project.projectId === pageProjectId)?.projectKey ??
    (pageProjectId === session.context.projectId ? session.context.projectKey : pageProjectId);
  const active: Section | undefined =
    [...activeSections, ...activeExtras].find((section) => section.path === path) ??
    (path === "/projects/new"
      ? {
          path,
          label: "Новый проект",
          description: "Регистрация проекта для общей команды",
          permission: "project.register",
        }
      : undefined) ??
    (editing || onboarding || evidence
      ? {
          path,
          label: editing
            ? "Редактирование проекта"
            : evidence
              ? "Материалы проекта"
              : "Подключение проекта",
          description: "Настройки и состояние выбранного проекта",
          permission: editing
            ? "project.metadata.update"
            : evidence
              ? "qa.evidence.read"
              : "project.onboarding.read",
        }
      : undefined);
  const project = session.projects?.find((candidate) => candidate.projectId === pageProjectId);
  const permissions = project?.permissions ?? (contribution ? session.grants.permissions : []);
  const allowed =
    active &&
    isEnabled(active) &&
    canVisit(active, session) &&
    (!pageProjectId ||
      (!!project && (!active.permission || permissions.includes(active.permission))));
  const crumbs = breadcrumbs({
    ...(params.get("document") ? { documentId: params.get("document")! } : {}),
    path,
    label: active?.label ?? "Страница не найдена",
    ...(pageProjectId ? { projectId: pageProjectId } : {}),
    ...(pageProjectKey ? { projectKey: pageProjectKey } : {}),
    ...(params.get("request") ? { requestId: params.get("request")! } : {}),
    ...(contribution ? { rootLabel: contribution.label } : {}),
  });
  const scopeKey = `${session.persona.key}:${session.context.workspaceId}:${pageProjectId ?? "workspace"}`;
  const context = {
    apiUrl,
    accessToken: session.accessToken,
    workspaceId: session.context.workspaceId,
    projectId: pageProjectId ?? "",
  };
  const openRequest = (id: string) =>
    navigate(id ? requestHref(context.projectId, id) : "/qa/requests");
  let content;
  if (!active)
    content = (
      <Alert severity="warning">
        Такого раздела нет. <Button href="/">Вернуться на главную</Button>
      </Alert>
    );
  else if (!allowed)
    content = (
      <Card>
        <CardContent>
          <Typography component="h1" variant="h4">
            Раздел недоступен
          </Typography>
          <Typography sx={{ my: 2 }}>
            Для этого раздела нужны соответствующие права и проект. Выберите другую роль или
            вернитесь к доступным действиям.
          </Typography>
          <Button onClick={switchRole}>Сменить роль</Button>
          <Button href="/">На главную</Button>
        </CardContent>
      </Card>
    );
  else if (path === "/admin/users")
    content = (
      <AccessAdministration
        viewerKey={session.persona.key}
        apiUrl={apiUrl}
        accessToken={session.accessToken}
        onStepUp={stepUp}
        onChanged={() => refreshSession(session.context.workspaceId || undefined)}
      />
    );
  else if (path === "/projects/hermes")
    content = (
      <ProjectDialogueRoute
        key={`${session.persona.key}:${context.workspaceId}`}
        {...context}
        onStepUp={stepUp}
        onCreated={async () => {
          await refreshSession(session.context.workspaceId);
          window.dispatchEvent(new Event("project-authorization-changed"));
        }}
      />
    );
  else if (editing)
    content = (
      <ProjectEditRoute
        key={scopeKey}
        {...context}
        workspaceName={
          session.workspaces?.find((w) => w.workspaceId === context.workspaceId)?.workspaceName ??
          session.context.workspaceKey
        }
        onStepUp={stepUp}
        onSaved={async () => {
          await refreshSession(session.context.workspaceId);
          window.dispatchEvent(new Event("project-authorization-changed"));
        }}
      />
    );
  else if (path === "/projects/new")
    content = (
      <ProjectCreateRoute
        key={`${session.persona.key}:${context.workspaceId}`}
        {...context}
        onStepUp={stepUp}
        workspaces={(session.workspaces?.length
          ? session.workspaces
          : [
              {
                workspaceId: context.workspaceId,
                workspaceName: session.context.workspaceKey,
                permissions: session.workspacePermissions ?? session.grants.permissions,
              },
            ]
        ).filter((w) =>
          (
            w.permissions ??
            (w.workspaceId === context.workspaceId
              ? (session.workspacePermissions ?? session.grants.permissions)
              : [])
          ).includes("project.register"),
        )}
        onCreated={async (workspaceId, projectId) => {
          await refreshSession(
            workspaceId,
            workspaceId !== context.workspaceId ? `/projects/${projectId}/onboarding` : undefined,
          );
          window.dispatchEvent(new Event("project-authorization-changed"));
        }}
      />
    );
  else if (path === "/projects")
    content = (
      <ProjectCatalogRoute
        editableProjectIds={
          session.projects
            ?.filter((p) => p.permissions?.includes("project.metadata.update"))
            .map((p) => p.projectId) ?? []
        }
        {...context}
        canCreate={(session.workspacePermissions ?? session.grants.permissions).includes(
          "project.register",
        )}
      />
    );
  else if (path === "/projects/onboarding" || onboarding)
    content = (
      <ProjectOnboardingRoute
        {...context}
        projectId={onboarding?.[1] ?? context.projectId}
        permissions={permissions}
        onUnavailable={() => {
          setError("Проект больше недоступен. Выберите доступный проект из каталога.");
          navigate("/projects");
        }}
      />
    );
  else if (evidence) content = <ProjectEvidenceRoute {...context} projectId={evidence[1]!} />;
  else if (ContributionPage && path === "/" && !session.grants.permissions.includes("docs.read"))
    content = (
      <ProjectCatalogRoute
        editableProjectIds={
          session.projects
            ?.filter((p) => p.permissions?.includes("project.metadata.update"))
            .map((p) => p.projectId) ?? []
        }
        {...context}
        canCreate={(session.workspacePermissions ?? session.grants.permissions).includes(
          "project.register",
        )}
      />
    );
  else if (ContributionPage)
    content = (
      <ContributionPage
        {...context}
        permissions={session.grants.permissions}
        location={location}
        navigate={navigate}
      />
    );
  else if (path === "/" || path === "/help")
    content = <WorkspaceHome session={session} help={path === "/help"} />;
  else if (path === "/developer") content = <DeveloperTools session={session} apiUrl={apiUrl} />;
  else if (path === "/qa/requests")
    content = (
      <CommonRequests
        {...context}
        projects={session.projects ?? []}
        {...(params.get("request") ? { requestId: params.get("request")! } : {})}
        navigate={navigate}
      />
    );
  else if (
    !pageProjectId &&
    ["/qa/new", "/qa/mattermost-intake", "/qa/automated-session", "/projects/onboarding"].includes(
      path,
    )
  )
    content = (
      <Stack spacing={2}>
        <Alert severity="info">
          {path === "/qa/new"
            ? "Укажите проект нового запроса. Очередь команды остаётся общей."
            : "Откройте параметры нужного проекта."}
        </Alert>
        {session.projects
          ?.filter((p) => !active.permission || p.permissions?.includes(active.permission))
          .map((p) => (
            <Button
              key={p.projectId}
              href={
                path === "/projects/onboarding"
                  ? `/projects/${p.projectId}/onboarding`
                  : `${path}?project=${p.projectId}`
              }
            >
              {p.projectKey}
            </Button>
          ))}
      </Stack>
    );
  else if (path === "/qa/new")
    content = (
      <QaWorkItemDetailRoute
        {...context}
        view="create"
        {...(params.get("request") ? { workItemId: params.get("request")! } : {})}
        permissions={permissions}
        projectLabel={pageProjectKey ?? ""}
        onOpenRequest={openRequest}
        onCreateRequest={() => navigate("/qa/new")}
      />
    );
  else if (path === "/qa/queue")
    content = (
      <QueueWorkspaceRoute
        {...context}
        projects={session.projects ?? []}
        permissions={session.workspacePermissions ?? session.grants.permissions}
      />
    );
  else if (path === "/qa/mattermost-intake") content = <MattermostIntakeRoute {...context} />;
  else if (path === "/qa/intake-candidates")
    content = (
      <Stack spacing={3}>
        {session.projects
          ?.filter((p) => p.permissions?.includes("work-item.read"))
          .map((p) => (
            <Box key={p.projectId}>
              <Typography variant="h5">{p.projectKey}</Typography>
              <IntakeCandidatesRoute
                {...context}
                projectId={p.projectId}
                permissions={p.permissions ?? []}
              />
            </Box>
          ))}
      </Stack>
    );
  else if (path === "/qa/hermes-proposals") content = <HermesProposalsRoute {...context} />;
  else if (path === "/qa/notification-health")
    content = (
      <Stack spacing={3}>
        {session.projects
          ?.filter((p) => p.permissions?.includes("work-item.read"))
          .map((p) => (
            <Box key={p.projectId}>
              <Typography variant="h5">{p.projectKey}</Typography>
              <NotificationHealthRoute {...context} projectId={p.projectId} />
            </Box>
          ))}
      </Stack>
    );
  else if (path === "/qa/automated-session")
    content = <AutomatedSessionRoute {...context} permissions={permissions} />;
  const archivePage = !contribution && (path === "/" || path === "/qa/requests");
  const hermesSection = extraSections.find((section) => section.path === "/qa/hermes-proposals")!;
  const showOracle =
    archivePage && allowed && isEnabled(hermesSection) && canVisit(hermesSection, session);
  const createSection = sections.find((section) => section.path === "/qa/new")!;
  const showCreate = archivePage && isEnabled(createSection) && canVisit(createSection, session);
  return (
    <Box
      onClickCapture={followLink}
      sx={{
        minHeight: "100vh",
        border: "1px solid #51483f",
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "172px minmax(0, 1fr)" },
        gridTemplateRows: { xs: "auto auto 1fr", md: "auto 1fr" },
        gridTemplateAreas: { xs: '"header" "nav" "main"', md: '"nav header" "nav main"' },
      }}
    >
      <Box
        component="header"
        sx={{
          gridArea: "header",
          bgcolor: "#141316",
          borderBottom: "1px solid #373136",
          px: { xs: "15px", md: "26px" },
          minHeight: 49,
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: 2,
          py: { xs: 0.75, md: 0 },
        }}
      >
        <Stack
          component="nav"
          aria-label="Путь страницы"
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", fontSize: 11, color: "text.secondary", flexWrap: "wrap" }}
        >
          {crumbs.map((crumb, index) => (
            <Stack
              key={`${index}:${crumb.label}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              {index > 0 && (
                <Typography aria-hidden="true" variant="caption">
                  /
                </Typography>
              )}
              {crumb.href ? (
                <Link href={crumb.href} variant="caption" color="inherit">
                  {crumb.label}
                </Link>
              ) : (
                <Typography variant="caption" aria-current="page">
                  {crumb.label}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", flexWrap: "wrap", maxWidth: "100%" }}
        >
          <Typography
            variant="caption"
            sx={{
              letterSpacing: 1.5,
              textTransform: "uppercase",
              display: { xs: "none", lg: "block" },
            }}
          >
            Локальный стенд
          </Typography>
          <Button onClick={switchRole} disabled={busy} sx={{ fontSize: 11, px: 0 }}>
            Сменить роль
          </Button>
        </Stack>
      </Box>
      <Box
        component="nav"
        aria-label="Основная навигация"
        sx={{
          gridArea: "nav",
          p: { xs: "12px 15px", md: "28px 17px 20px" },
          background: blackOrder.navigationBackground,
          color: blackOrder.navText,
          borderRight: { md: "1px solid #48413c" },
          borderBottom: { xs: "1px solid #48413c", md: 0 },
          minWidth: 0,
          position: { md: "sticky" },
          top: 0,
          height: { md: "100vh" },
          overflowY: { md: "auto" },
          alignSelf: "start",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: blackOrder.navText }}>
          <OrderIcon size={18} />
          <Typography
            sx={{
              fontFamily: blackOrder.headingFont,
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: 0.8,
            }}
          >
            Платформа
          </Typography>
        </Stack>
        <Typography
          sx={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#b9a88b",
            mt: "5px",
            mb: "28px",
            display: { xs: "none", md: "block" },
          }}
        >
          АРХИВ ЧЁРНОГО ОРДЕНА
        </Typography>
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            textAlign: "center",
            border: "1px solid #5a5147",
            borderRadius: "50% 50% 0 0 / 64% 64% 0 0",
            p: "34px 8px 17px",
            mx: "8px",
            mb: "26px",
            background: "radial-gradient(ellipse at bottom, #372029 0%, #111014 68%)",
            boxShadow: "inset 0 0 0 5px #111014, inset 0 0 0 6px #393239",
          }}
        >
          <Box sx={{ color: "#c6b38e", mb: "12px", display: "flex", justifyContent: "center" }}>
            <OrderIcon kind="shield" size={14} />
          </Box>
          <Typography
            sx={{ fontSize: 13, fontWeight: 500, letterSpacing: 3, overflowWrap: "anywhere" }}
          >
            {contribution?.label ?? "QA КОМАНДА"}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: blackOrder.navMuted, display: "block", mt: "3px" }}
          >
            Все проекты
          </Typography>
        </Box>
        <Stack
          direction={{ xs: "row", md: "column" }}
          spacing={0}
          sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, gap: "3px", mt: { xs: 1, md: 0 } }}
        >
          {activeSections
            .filter((section) => isEnabled(section) && canVisit(section, session))
            .map((section) => {
              const selected = path === section.path;
              return (
                <Button
                  key={section.path}
                  component="a"
                  href={section.path}
                  aria-current={selected ? "page" : undefined}
                  sx={{
                    justifyContent: "flex-start",
                    textAlign: "left",
                    gap: "9px",
                    p: "10px 9px",
                    fontSize: 13,
                    fontWeight: 400,
                    "&.MuiButton-root": {
                      color: selected ? blackOrder.navText : blackOrder.navMuted,
                    },
                    background: selected
                      ? "linear-gradient(90deg, #3c232b, transparent)"
                      : "transparent",
                    borderLeft: "2px solid",
                    borderColor: selected ? "#c3ad84" : "transparent",
                  }}
                >
                  <OrderIcon
                    kind={
                      section.path === "/"
                        ? "overview"
                        : section.path === "/qa/queue"
                          ? "queue"
                          : section.path === "/projects"
                            ? "project"
                            : section.path === "/help"
                              ? "help"
                              : "request"
                    }
                    size={16}
                  />
                  {section.label}
                </Button>
              );
            })}
        </Stack>
        <Box
          component="details"
          sx={{ mt: 2, fontSize: 11, "& summary": { fontWeight: 400, color: blackOrder.navMuted } }}
        >
          <summary>Дополнительно</summary>
          <Stack spacing={0.5}>
            {activeExtras
              .filter((section) => isEnabled(section) && canVisit(section, session))
              .map((section) => (
                <Button
                  key={section.path}
                  href={section.path}
                  aria-current={path === section.path ? "page" : undefined}
                  sx={{ justifyContent: "flex-start", textAlign: "left", fontSize: 11, px: 1 }}
                >
                  {section.label}
                </Button>
              ))}
          </Stack>
        </Box>
        <Box
          sx={{
            borderTop: "1px solid #383134",
            mt: "30px",
            pt: "20px",
            display: { xs: "none", md: "block" },
          }}
        >
          <Typography sx={{ color: blackOrder.navText, fontSize: 12, fontWeight: 500 }}>
            {formatRuUiValue(session.persona.label)}
            {session.platformPermissions?.includes("platform.workspace-roles.manage") && (
              <Chip component="span" label="Глобальный администратор" size="small" sx={{ ml: 1 }} />
            )}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: blackOrder.navMuted, display: "block", overflowWrap: "anywhere", mt: 0.5 }}
          >
            Рабочая область:{" "}
            {contribution?.label ?? (session.context.workspaceKey || "Доступ не назначен")}
          </Typography>
          {session.workspaces && session.workspaces.length > 1 && (
            <Box
              component="label"
              sx={{ color: blackOrder.navMuted, fontSize: 12, display: "block", mt: 2 }}
            >
              Предметная область
              <Box
                component="select"
                value={session.context.workspaceId}
                onChange={(e) => void refreshSession(e.target.value)}
                sx={{
                  display: "block",
                  width: "100%",
                  mt: 1,
                  p: 1,
                  color: "inherit",
                  background: blackOrder.navigationBackground,
                  border: "1px solid #51464a",
                }}
              >
                {session.workspaces.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.workspaceName}
                  </option>
                ))}
              </Box>
            </Box>
          )}
          <Button
            size="small"
            onClick={() => void refreshSession(session.context.workspaceId || undefined)}
            sx={{ mt: 1 }}
          >
            Обновить права
          </Button>
          <Typography variant="caption" sx={{ display: "block", color: blackOrder.navMuted }}>
            {session.grants.roles.map(formatRuUiValue).join(", ") || "Без рабочих ролей"}
          </Typography>
        </Box>
      </Box>
      <Box
        component="main"
        ref={mainRef}
        tabIndex={-1}
        sx={{
          gridArea: "main",
          p: { xs: "18px 15px", md: "26px" },
          minWidth: 0,
          overflowWrap: "anywhere",
          background: blackOrder.contentBackground,
          "&:focus": { outline: "none" },
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {notice}
          </Alert>
        )}
        {active &&
          (archivePage || path === "/help" || !["/qa/new", "/developer"].includes(path)) && (
            <Box sx={{ mb: "24px" }}>
              <OrderHeading
                eyebrow={
                  contribution?.label ??
                  (archivePage ? "Рабочее пространство QA" : "Архив чёрного ордена")
                }
                action={
                  showCreate ? (
                    <Button variant="contained" href="/qa/new">
                      + Создать QA-запрос
                    </Button>
                  ) : undefined
                }
              >
                <Typography variant="h3" component="h1">
                  {archivePage ? "Архив ордена" : active.label}
                </Typography>
                <Typography variant="body2" sx={{ color: "#b5aa9c" }}>
                  {archivePage ? "Каждое решение оставляет след." : active.description}
                </Typography>
              </OrderHeading>
            </Box>
          )}
        {(onboarding || evidence || path === "/projects/onboarding") &&
          allowed &&
          permissions.includes("project.admin") && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Настройка предназначена для администраторов проекта. Для защищённых действий
              подтвердите вход.{" "}
              <Button disabled={busy} onClick={() => void stepUp()}>
                Подтвердить усиленную аутентификацию
              </Button>
            </Alert>
          )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: showOracle
              ? { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 207px" }
              : "minmax(0, 1fr)",
            gap: "19px",
            alignItems: "start",
          }}
        >
          <Suspense
            fallback={
              <Stack role="status" direction="row" spacing={1}>
                <CircularProgress size={22} />
                <Typography>Загрузка раздела…</Typography>
              </Stack>
            }
          >
            <Box key={`${scopeKey}:${path}`} sx={{ minWidth: 0 }}>
              {content}
            </Box>
          </Suspense>
          {showOracle && (
            <Stack component="aside" spacing={2.5}>
              <OrderOracle
                action={
                  <Button
                    href={`/qa/hermes-proposals${params.get("request") ? `?subject=${encodeURIComponent(params.get("request")!)}` : ""}`}
                  >
                    Открыть предложения
                  </Button>
                }
              >
                <Typography>
                  Предложения по запросу и их основания. Решение остаётся за вами.
                </Typography>
              </OrderOracle>
              <Box>
                <Typography
                  sx={{ fontSize: 11, letterSpacing: 1.6, color: "text.secondary", mb: 1 }}
                >
                  РАЗДЕЛЫ АРХИВА
                </Typography>
                {activeSections
                  .filter(
                    (section) =>
                      ["/qa/requests", "/qa/queue", "/help"].includes(section.path) &&
                      canVisit(section, session),
                  )
                  .map((section) => (
                    <Box
                      key={section.path}
                      sx={{ borderTop: "1px solid", borderColor: "divider", py: "11px" }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {section.description}
                      </Typography>
                      <Button
                        href={section.path}
                        sx={{
                          display: "block",
                          textAlign: "left",
                          p: 0,
                          minHeight: 30,
                          fontSize: 11,
                        }}
                      >
                        {section.label} →
                      </Button>
                    </Box>
                  ))}
              </Box>
            </Stack>
          )}
        </Box>
      </Box>
    </Box>
  );
}

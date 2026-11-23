import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

import { PilotBrowserClient, type PilotSession } from "../routes/pilot/pilot-client.ts";
import { ProjectCatalogRoute } from "../routes/projects/project-catalog.tsx";
import { ProjectCreateRoute } from "../routes/projects/project-create.tsx";
import { ProjectDialogueRoute } from "../routes/projects/project-dialogue.tsx";
import { ProjectEditRoute } from "../routes/projects/project-edit.tsx";
import { AccessAdministration } from "./access-administration.tsx";

interface OwnAccess {
  displayName: string;
  username: string;
  platformPermissions: readonly string[];
  status: string;
  memberships: readonly {
    workspaceId: string;
    workspaceName: string;
    roleKeys: readonly string[];
    state: string;
  }[];
}
const environment = import.meta.env as Readonly<Record<string, string | undefined>>;
const apiUrl = environment.VITE_AWP_API_URL ?? "";
export function CorporateAccessApp() {
  const client = useMemo(
    () =>
      new PilotBrowserClient((path, init) =>
        fetch(typeof path === "string" && path.startsWith("/") ? `${apiUrl}${path}` : path, {
          ...init,
          credentials: "include",
        }),
      ),
    [],
  );
  const [dialogueWorkspace, setDialogueWorkspace] = useState("");
  const [session, setSession] = useState<PilotSession>(),
    [access, setAccess] = useState<OwnAccess>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      const next = await client.session();
      setSession(next);
      if (next && window.location.pathname === "/projects") {
        const key = `awp:corporate-project-return:${next.principalId}`;
        try {
          const target = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
            path?: string;
            expiresAt?: number;
          } | null;
          sessionStorage.removeItem(key);
          if (
            target?.path &&
            /^\/projects\/[a-f0-9-]{36}\/edit$/iu.test(target.path) &&
            (target.expiresAt ?? 0) > Date.now()
          ) {
            window.location.replace(target.path);
            return;
          }
        } catch {
          /* Resume normal navigation if the optional draft return is unavailable. */
        }
      }
      if (!next) {
        setAccess(undefined);
        return;
      }
      const response = await fetch(`${apiUrl}/api/v1/access/me`, { credentials: "include" });
      if (!response.ok) throw new Error();
      setAccess((await response.json()) as OwnAccess);
    } catch {
      setAccess(undefined);
      setError("Не удалось загрузить доступ. Повторите вход или обновите страницу.");
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    const update = () => {
      void refresh();
    };
    queueMicrotask(update);
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [refresh]);
  const workspace = access?.memberships.find((m) => m.state === "ACTIVE" && m.roleKeys.length);
  const canRegister = !!workspace?.roleKeys.some((r) =>
    ["system-administrator", "project-registrar"].includes(r),
  );
  const path = window.location.pathname;
  const editing = /^\/projects\/([^/]+)\/edit$/u.exec(path);
  const projectsPage = path === "/projects" || path === "/projects/new" || !!editing;
  const login = async (stepUp = false) => {
    try {
      window.location.assign(
        await client.beginLogin(
          path === "/admin/users"
            ? "/admin/users"
            : projectsPage
              ? editing
                ? "/projects"
                : path
              : "/access",
          stepUp ? session?.csrfToken : undefined,
        ),
      );
    } catch {
      setError("Не удалось начать корпоративный вход. Проверьте настройку подключения к Keycloak.");
    }
  };
  const isAdmin = !!access?.platformPermissions.includes("platform.users.read");
  return (
    <Box component="main" sx={{ maxWidth: 1400, mx: "auto", p: { xs: 2, md: 4 } }}>
      <Stack spacing={3}>
        <Box component="nav" aria-label="Хлебные крошки">
          <a href="/access">Моя область</a>
          {projectsPage && (
            <>
              {" "}
              / <a href="/projects">Проекты</a>
            </>
          )}
          {window.location.pathname === "/admin/users" && " / Пользователи и доступы"}
        </Box>
        <Typography component="h1" variant="h3">
          {window.location.pathname === "/admin/users"
            ? "Пользователи и доступы"
            : projectsPage
              ? editing
                ? "Редактирование проекта"
                : "Проекты QA"
              : "Рабочая область QA"}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {loading ? (
          <Typography role="status">Проверка входа…</Typography>
        ) : !session ? (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography>
                  Войдите через корпоративный Keycloak. Первый пользователь новой платформы
                  становится администратором доступов и назначает рабочие роли остальным.
                </Typography>
                <Button variant="contained" onClick={() => void login()}>
                  Войти через Keycloak
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <>
            <Stack direction="row" sx={{ gap: 2, flexWrap: "wrap" }}>
              <Typography>{access?.displayName ?? session.subject}</Typography>
              <Button onClick={() => void refresh()}>Обновить права</Button>
              <Button
                onClick={() =>
                  void client
                    .logout(session.csrfToken)
                    .then(() => {
                      setSession(undefined);
                      setAccess(undefined);
                    })
                    .catch(() => setError("Не удалось выйти. Повторите попытку."))
                }
              >
                Выйти
              </Button>
            </Stack>
            {window.location.pathname === "/admin/users" ? (
              isAdmin ? (
                <AccessAdministration
                  viewerKey={session.principalId}
                  apiUrl={apiUrl}
                  csrfToken={session.csrfToken}
                  onStepUp={() => login(true)}
                  onChanged={refresh}
                />
              ) : (
                <Alert severity="warning">
                  Для этого раздела нужна роль «Администратор доступов».
                </Alert>
              )
            ) : projectsPage ? (
              !workspace ? (
                <Alert severity="info">Доступ к рабочей области ещё не назначен.</Alert>
              ) : path === "/projects/new" ? (
                canRegister ? (
                  <ProjectCreateRoute
                    key={`${session.principalId}:${workspace.workspaceId}`}
                    apiUrl={apiUrl}
                    csrfToken={session.csrfToken}
                    workspaceId={workspace.workspaceId}
                    workspaces={[workspace]}
                    onboardingAvailable={false}
                    draftStorageKey={`awp:corporate-project-create:${session.principalId}`}
                    onStepUp={() => login(true)}
                    onCreated={async () => {
                      await refresh();
                    }}
                  />
                ) : (
                  <Alert severity="warning">Нет права создавать проекты.</Alert>
                )
              ) : editing ? (
                canRegister ? (
                  <ProjectEditRoute
                    key={`${session.principalId}:${editing[1]}`}
                    apiUrl={apiUrl}
                    csrfToken={session.csrfToken}
                    workspaceId={workspace.workspaceId}
                    workspaceName={workspace.workspaceName}
                    projectId={editing[1]!}
                    draftStorageKey={`awp:corporate-project-edit:${session.principalId}:${editing[1]}`}
                    onStepUp={async () => {
                      sessionStorage.setItem(
                        `awp:corporate-project-return:${session.principalId}`,
                        JSON.stringify({ path, expiresAt: Date.now() + 600_000 }),
                      );
                      await login(true);
                    }}
                    onSaved={refresh}
                  />
                ) : (
                  <Alert severity="warning">Нет права изменять проекты.</Alert>
                )
              ) : (
                <ProjectCatalogRoute
                  key={`${session.principalId}:${workspace.workspaceId}`}
                  apiUrl={apiUrl}
                  csrfToken={session.csrfToken}
                  workspaceId={workspace.workspaceId}
                  canCreate={canRegister}
                  canEdit={canRegister}
                  onboardingAvailable={false}
                />
              )
            ) : (
              <>
                {isAdmin && (
                  <Button href="/admin/users" variant="contained">
                    Управлять пользователями и ролями
                  </Button>
                )}
                {access?.status === "PENDING" && (
                  <Alert severity="info">
                    Вы вошли в систему. Рабочие роли ещё не назначены. Обратитесь к администратору
                    доступов; затем нажмите «Обновить права».
                  </Alert>
                )}
                {access?.memberships
                  .filter((m) => m.state === "ACTIVE")
                  .map((m) => (
                    <Card key={m.workspaceId}>
                      <CardContent>
                        <Typography variant="h6">{m.workspaceName}</Typography>
                        <Typography>{m.roleKeys.map(formatRuUiValue).join(", ")}</Typography>
                        <Typography color="text.secondary">
                          Добавляйте проекты и назначайте участников. Подключения и готовность
                          каждого проекта настраиваются отдельно.
                        </Typography>
                        <Button href="/projects">Открыть проекты</Button>
                        {m.roleKeys.some((r) =>
                          ["system-administrator", "project-registrar"].includes(r),
                        ) && <Button href="/projects/new">Новый проект</Button>}
                        {m.roleKeys.includes("requester") && (
                          <Button onClick={() => setDialogueWorkspace(m.workspaceId)}>
                            Создать проект с Hermes
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                {dialogueWorkspace &&
                  access?.memberships.some(
                    (m) =>
                      m.workspaceId === dialogueWorkspace &&
                      m.state === "ACTIVE" &&
                      m.roleKeys.includes("requester"),
                  ) && (
                    <ProjectDialogueRoute
                      key={`${session.principalId}:${dialogueWorkspace}`}
                      apiUrl={apiUrl}
                      csrfToken={session.csrfToken}
                      workspaceId={dialogueWorkspace}
                      onStepUp={() => login(true)}
                      onCreated={async () => {
                        await refresh();
                      }}
                    />
                  )}
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

interface Role {
  key: string;
  label: string;
  description: string;
  permissions: readonly string[];
}
interface Workspace {
  id: string;
  name: string;
  key: string;
  state: string;
  roles: readonly Role[];
  projects?: readonly { id: string; key: string; name: string }[];
}
interface Membership {
  requesterProjectIds?: readonly string[];
  workspaceId: string;
  workspaceName: string;
  state: string;
  version: number;
  roleKeys: readonly string[];
  otherRoleKeys: readonly string[];
  classificationCeiling: string;
}
interface Person {
  principalId: string;
  displayName: string;
  username: string;
  status?: string;
}
interface Detail extends Person {
  memberships: readonly Membership[];
  platformRoles: readonly { roleKey: string; source: string; revokedAt: string | null }[];
  history: readonly {
    id: string;
    actorName: string;
    workspaceName: string;
    createdAt: string;
    reason: string;
    before: Membership;
    after: Membership;
  }[];
}
interface Props {
  viewerKey: string;
  apiUrl: string;
  accessToken?: string;
  csrfToken?: string;
  onStepUp: () => void | Promise<void>;
  onChanged?: () => void | Promise<void>;
}
const messages: Record<string, string> = {
  ACCESS_VERSION_CONFLICT:
    "Назначения уже изменены другим администратором. Обновите данные и повторите правку.",
  ACCESS_REQUEST_CONFLICT: "Этот запрос уже сохранён с другим содержимым. Обновите данные.",
  ACCESS_STEP_UP_REQUIRED: "Подтвердите вход перед сохранением ролей.",
  CORPORATE_STEP_UP_REQUIRED: "Подтвердите корпоративный вход перед сохранением ролей.",
  PLATFORM_ACCESS_DENIED: "У вас нет действующей роли «Администратор доступов».",
  CORPORATE_SESSION_DENIED: "Сессия завершилась. Войдите снова.",
  ACCESS_PROJECT_INVALID: "Проект недоступен для назначения в этой рабочей области.",
  ACCESS_ROLE_INVALID: "Выбранная роль не относится к этой рабочей области.",
  ACCESS_WORKSPACE_NOT_AVAILABLE: "Рабочая область недоступна для изменений.",
};
interface EditorDraft {
  requesterProjectIds?: string[];
  principalId: string;
  workspaceId: string;
  roleKeys: string[];
  classificationCeiling: string;
  reason: string;
  expectedVersion: number;
  expiresAt: number;
}
const draftKey = (viewer: string) => `awp.access-draft:${viewer}`;
function loadDraft(viewer: string): EditorDraft | undefined {
  try {
    const raw = sessionStorage.getItem(draftKey(viewer));
    if (!raw) return;
    const draft = JSON.parse(raw) as EditorDraft;
    if (
      draft.expiresAt > Date.now() &&
      typeof draft.principalId === "string" &&
      typeof draft.workspaceId === "string" &&
      (draft.requesterProjectIds === undefined ||
        (Array.isArray(draft.requesterProjectIds) &&
          draft.requesterProjectIds.every((id) => typeof id === "string"))) &&
      Array.isArray(draft.roleKeys) &&
      draft.roleKeys.every((k) => typeof k === "string") &&
      typeof draft.classificationCeiling === "string" &&
      typeof draft.reason === "string" &&
      Number.isSafeInteger(draft.expectedVersion)
    )
      return draft;
  } catch {
    /* A missing browser draft never changes authority. */
  }
  return undefined;
}
const classificationLabels = {
  PUBLIC: "Общедоступные",
  INTERNAL: "Внутренние",
  RESTRICTED: "Ограниченного доступа",
  CONFIDENTIAL: "Конфиденциальные",
};
export function AccessAdministration(props: Props) {
  const transport = useRef(props);
  useEffect(() => {
    transport.current = props;
  }, [props]);
  const [initialDraft] = useState(() => loadDraft(props.viewerKey));
  const [draft, setDraft] = useState(initialDraft);
  const [people, setPeople] = useState<readonly Person[]>([]),
    [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [query, setQuery] = useState(""),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [personId, setPersonId] = useState(""),
    [workspaceId, setWorkspaceId] = useState("");
  const [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const selection = useRef(0),
    mounted = useRef(true);
  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const current = transport.current;
    const response = await fetch(`${current.apiUrl}/api/v1/access${path}`, {
      method: body === undefined ? "GET" : "PUT",
      credentials: current.accessToken ? "omit" : "include",
      headers: {
        ...(current.accessToken ? { authorization: `Bearer ${current.accessToken}` } : {}),
        ...(current.csrfToken ? { "x-csrf-token": current.csrfToken } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { code?: string };
      throw new Error(
        messages[result.code as string] ??
          "Не удалось выполнить запрос. Проверьте соединение и повторите попытку.",
      );
    }
    return (await response.json()) as T;
  }, []);
  const search = useCallback(
    async (q: string, offset = 0) => {
      setError("");
      setLoading(true);
      try {
        const result = await request<{ items: Person[]; nextOffset: number | null }>(
          `/users?q=${encodeURIComponent(q)}&offset=${offset}`,
        );
        if (!mounted.current) return;
        setPeople(result.items);
        setNextOffset(result.nextOffset);
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [request],
  );
  const loadDetail = useCallback(
    async (id: string, selectWorkspace = false) => {
      const version = ++selection.current;
      setError("");
      try {
        const next = await request<Detail>(`/users/${id}`);
        if (mounted.current && version === selection.current) {
          setDetail(next);
          if (selectWorkspace) {
            const first = next.memberships.find((m) => m.state === "ACTIVE");
            if (first) setWorkspaceId(first.workspaceId);
          }
        }
      } catch (e) {
        if (mounted.current && version === selection.current) setError((e as Error).message);
      }
    },
    [request],
  );
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (!mounted.current) return;
      void search("");
      if (initialDraft) {
        setPersonId(initialDraft.principalId);
        void loadDetail(initialDraft.principalId);
      }
      void request<Workspace[]>("/workspaces")
        .then((rows) => {
          if (mounted.current) {
            setWorkspaces(rows);
            setWorkspaceId(
              rows.find((w) => w.id === initialDraft?.workspaceId)?.id ??
                rows.find((w) => w.state === "ACTIVE")?.id ??
                "",
            );
          }
        })
        .catch((e: unknown) => {
          if (mounted.current) setError((e as Error).message);
        });
    });
    return () => {
      mounted.current = false;
    };
  }, [request, search, loadDetail, initialDraft]);
  const workspace = workspaces.find((w) => w.id === workspaceId),
    membership = detail?.memberships.find((m) => m.workspaceId === workspaceId);
  const roleLabel = (key: string) =>
    workspaces.flatMap((w) => w.roles).find((r) => r.key === key)?.label ?? key;
  return (
    <Stack spacing={3}>
      <Typography>
        Один человек может иметь несколько ролей в каждой рабочей области. Рабочие роли команды
        действуют на все её проекты. Для заказчика выбираются конкретные проекты.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(240px,1fr) minmax(400px,2fr)" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" component="h2">
                Пользователи
              </Typography>
              <Box
                component="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search(query);
                }}
              >
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Имя или логин"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    size="small"
                    fullWidth
                  />
                  <Button type="submit" disabled={loading}>
                    Найти
                  </Button>
                </Stack>
              </Box>
              {loading && <Typography role="status">Загрузка пользователей…</Typography>}
              {!loading && !people.length && (
                <Typography>
                  Пользователи не найдены. Корпоративные пользователи появятся после первого входа.
                </Typography>
              )}
              {people.map((person) => (
                <Button
                  key={person.principalId}
                  variant={personId === person.principalId ? "contained" : "outlined"}
                  onClick={() => {
                    setPersonId(person.principalId);
                    setDetail(undefined);
                    setNotice("");
                    void loadDetail(person.principalId, true);
                  }}
                  sx={{ justifyContent: "flex-start", textAlign: "left", textTransform: "none" }}
                >
                  <Box>
                    <Typography>{person.displayName}</Typography>
                    <Typography variant="caption">
                      {person.username}
                      {person.status === "PENDING" ? " · Ожидает назначения" : ""}
                    </Typography>
                  </Box>
                </Button>
              ))}
              {nextOffset !== null && (
                <Button onClick={() => void search(query, nextOffset)}>
                  Следующие пользователи
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>
        <Stack spacing={3}>
          {!detail ? (
            <Card>
              <CardContent>
                <Typography>
                  {personId
                    ? "Загрузка назначений…"
                    : "Выберите пользователя для управления доступом."}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography component="h2" variant="h5">
                      {detail.displayName}
                    </Typography>
                    <Typography color="text.secondary">{detail.username}</Typography>
                    {detail.platformRoles.map((role) => (
                      <Alert key={role.roleKey} severity={role.revokedAt ? "warning" : "info"}>
                        Глобальный администратор ·{" "}
                        {role.revokedAt
                          ? "отозвана"
                          : role.source === "LOCAL_BOOTSTRAP"
                            ? "локальное назначение"
                            : role.source === "LOCAL_FIRST_LOGIN"
                              ? "первый локальный вход"
                              : role.source === "CORPORATE_FIRST_LOGIN"
                                ? "первый корпоративный вход"
                                : "ранее назначена через корпоративную группу"}
                        . Роль уровня платформы управляется отдельно от рабочих ролей.
                      </Alert>
                    ))}
                    <Typography variant="subtitle2">Текущие назначения</Typography>
                    {detail.memberships
                      .filter((m) => m.state === "ACTIVE")
                      .map((m) => (
                        <Box key={m.workspaceId}>
                          <Typography>{m.workspaceName}</Typography>
                          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                            {m.roleKeys.map((key) => (
                              <Chip key={key} label={roleLabel(key)} size="small" />
                            ))}
                          </Stack>
                        </Box>
                      ))}
                    {!detail.memberships.some((m) => m.state === "ACTIVE") && (
                      <Typography>Рабочие права ещё не назначены.</Typography>
                    )}
                    <Box component="label">
                      Рабочая область
                      <Box
                        component="select"
                        aria-label="Рабочая область"
                        value={workspaceId}
                        onChange={(e) => {
                          setWorkspaceId(e.target.value);
                          setNotice("");
                        }}
                        sx={{
                          display: "block",
                          width: "100%",
                          mt: 1,
                          p: 1.5,
                          font: "inherit",
                          background: "transparent",
                          color: "inherit",
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: 1,
                        }}
                      >
                        {workspaces.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.state !== "ACTIVE" ? " · приостановлена" : ""}
                          </option>
                        ))}
                      </Box>
                    </Box>
                    {workspace && (
                      <AccessEditor
                        key={`${detail.principalId}:${workspace.id}:${membership?.version ?? 0}`}
                        workspace={workspace}
                        membership={membership}
                        draft={
                          draft?.principalId === detail.principalId &&
                          draft.workspaceId === workspace.id
                            ? draft
                            : undefined
                        }
                        onStepUp={async (editor) => {
                          const saved = {
                            ...editor,
                            principalId: detail.principalId,
                            workspaceId: workspace.id,
                            expiresAt: Date.now() + 600000,
                          };
                          try {
                            sessionStorage.setItem(
                              draftKey(props.viewerKey),
                              JSON.stringify(saved),
                            );
                          } catch {
                            /* Optional draft storage; server still validates every save. */
                          }
                          await props.onStepUp();
                        }}
                        onReload={() => loadDetail(detail.principalId)}
                        onSave={async (body) => {
                          await request(
                            `/users/${detail.principalId}/workspaces/${workspace.id}`,
                            body,
                          );
                          setDraft(undefined);
                          sessionStorage.removeItem(draftKey(props.viewerKey));
                          setNotice("Назначения сохранены. Сервер уже использует новые права.");
                          await loadDetail(detail.principalId);
                          await search(query);
                          await transport.current.onChanged?.();
                        }}
                      />
                    )}
                  </Stack>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <Typography component="h2" variant="h6" sx={{ mb: 2 }}>
                    История назначений
                  </Typography>
                  <Stack spacing={2}>
                    {!detail.history.length && (
                      <Typography>Изменений через админку пока нет.</Typography>
                    )}
                    {detail.history.map((entry) => (
                      <Box
                        key={entry.id}
                        sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 2 }}
                      >
                        <Typography>
                          {entry.workspaceName} · {entry.actorName}
                        </Typography>
                        <Typography variant="caption">
                          {new Date(entry.createdAt).toLocaleString("ru-RU")}
                        </Typography>
                        <Typography>
                          {entry.before.roleKeys.map(roleLabel).join(", ") || "Без ролей"} →{" "}
                          {entry.after.roleKeys.map(roleLabel).join(", ") || "Доступ отозван"}
                        </Typography>
                        <Typography color="text.secondary">{entry.reason}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
function AccessEditor({
  workspace,
  membership,
  draft,
  onSave,
  onStepUp,
  onReload,
}: {
  workspace: Workspace;
  membership: Membership | undefined;
  onSave: (body: unknown) => Promise<void>;
  draft: EditorDraft | undefined;
  onStepUp: (
    draft: Omit<EditorDraft, "principalId" | "workspaceId" | "expiresAt">,
  ) => void | Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [roles, setRoles] = useState<readonly string[]>(
      draft?.roleKeys ?? (membership?.state === "ACTIVE" ? membership.roleKeys : []),
    ),
    [ceiling, setCeiling] = useState(
      draft?.classificationCeiling ?? membership?.classificationCeiling ?? "INTERNAL",
    ),
    [reason, setReason] = useState(draft?.reason ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [projectIds, setProjectIds] = useState<readonly string[]>(
    draft?.requesterProjectIds ?? membership?.requesterProjectIds ?? [],
  );
  const attempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const save = async () => {
    setBusy(true);
    setError("");
    const body = {
      roleKeys: [...roles].sort(),
      requesterProjectIds: roles.includes("requester") ? [...projectIds].sort() : [],
      classificationCeiling: ceiling,
      expectedVersion: draft?.expectedVersion ?? membership?.version ?? 0,
      reason: reason.trim(),
    };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await onSave({ ...body, requestKey: attempt.current!.key });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Роли в этой рабочей области</Typography>
      {workspace.roles.map((role) => (
        <Box key={role.key}>
          <FormControlLabel
            control={
              <Checkbox
                checked={roles.includes(role.key)}
                disabled={busy || workspace.state !== "ACTIVE"}
                onChange={(_, checked) =>
                  setRoles((current) =>
                    checked ? [...current, role.key] : current.filter((key) => key !== role.key),
                  )
                }
              />
            }
            label={role.label}
          />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
            {role.description}
          </Typography>
        </Box>
      ))}
      {roles.includes("requester") && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Проекты заказчика</Typography>
          <Typography variant="body2">
            Заказчик видит все задачи выбранных проектов. Новые проекты команды автоматически не
            добавляются.
          </Typography>
          {(workspace.projects ?? []).map((project) => (
            <FormControlLabel
              key={project.id}
              label={`${project.name} · ${project.key}`}
              control={
                <Checkbox
                  checked={projectIds.includes(project.id)}
                  disabled={busy}
                  onChange={(_, checked) =>
                    setProjectIds((current) =>
                      checked
                        ? [...current, project.id]
                        : current.filter((id) => id !== project.id),
                    )
                  }
                />
              }
            />
          ))}
          {!projectIds.length && (
            <Typography variant="body2">
              Пока проекты не назначены. Пользователь сможет создать свой проект через Hermes.
            </Typography>
          )}
        </Stack>
      )}
      {!!membership?.otherRoleKeys.length && (
        <Alert severity="info">
          Дополнительные назначения из других источников: {membership.otherRoleKeys.join(", ")}. Они
          сохранятся; пустой набор ролей отзовёт членство целиком.
        </Alert>
      )}
      <Box component="label">
        Доступные данные
        <Box
          component="select"
          aria-label="Доступные данные"
          value={ceiling}
          disabled={busy}
          onChange={(e) => setCeiling(e.target.value)}
          sx={{
            display: "block",
            width: "100%",
            p: 1.5,
            mt: 1,
            font: "inherit",
            background: "transparent",
            color: "inherit",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {Object.entries(classificationLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Box>
      </Box>
      {!roles.length && (
        <Alert severity="warning">
          Сохранение пустого набора отзовёт доступ к этой рабочей области.
        </Alert>
      )}
      <TextField
        label="Причина изменения"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
        disabled={busy}
      />
      {error && (
        <Alert severity="error">
          {error}
          <Button onClick={() => void onReload()}>Обновить назначения</Button>
        </Alert>
      )}
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          onClick={() =>
            void onStepUp({
              requesterProjectIds: [...projectIds],
              roleKeys: [...roles],
              classificationCeiling: ceiling,
              reason,
              expectedVersion: draft?.expectedVersion ?? membership?.version ?? 0,
            })
          }
          disabled={busy}
        >
          Подтвердить вход
        </Button>
        <Button
          variant="contained"
          disabled={busy || reason.trim().length < 3 || workspace.state !== "ACTIVE"}
          onClick={() => void save()}
        >
          {busy ? "Сохранение…" : "Сохранить роли"}
        </Button>
      </Stack>
      <Typography variant="caption">
        Для сохранения нужно дополнительное подтверждение входа, действующее пять минут.
      </Typography>
    </Stack>
  );
}

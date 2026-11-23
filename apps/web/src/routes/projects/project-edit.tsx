import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import {
  clearProjectDraft,
  projectSessionHeaders,
  readProjectDraft,
  saveProjectDraft,
} from "./project-session.ts";

interface Metadata {
  project: {
    id: string;
    workspaceId: string;
    key: string;
    name: string;
    dataClassificationKey: string;
    ownerIds: string[];
    version: number;
  };
  ownerOptions: { id: string; displayName: string }[];
  history: {
    version: number;
    name: string;
    owners: string[];
    actorName: string;
    createdAt: string;
    reason: string;
  }[];
  historyLimit: number;
  historyHasMore: boolean;
}
const errors: Record<string, string> = {
  STEP_UP_REQUIRED: "Подтвердите вход и повторите сохранение.",
  PROJECT_METADATA_VERSION_CONFLICT:
    "Проект уже изменён в другой вкладке. Ваш черновик сохранён на экране. Загрузите актуальные данные и внесите изменения заново.",
  ONBOARDING_VERSION_CONFLICT:
    "Во время сохранения проект изменился. Ваш черновик сохранён на экране. Проверьте актуальные данные.",
  IDEMPOTENCY_CONFLICT:
    "Этот запрос уже использован с другими данными. Загрузите актуальные сведения перед новым сохранением.",
  ACTIVE_WORKSPACE_MEMBER_REQUIRED:
    "Один из ответственных больше не состоит в области. Обновите список участников и выберите действующих.",
};
export function ProjectEditRoute(props: {
  apiUrl: string;
  accessToken?: string;
  csrfToken?: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  draftStorageKey?: string;
  onStepUp: () => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const endpoint = `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/metadata`;
  const { accessToken } = props;
  const [draft] = useState(() =>
    readProjectDraft<{
      name: string;
      owners: string[];
      reason: string;
      version: number;
      request?: { body: string; version: number; key: string };
    }>(props.draftStorageKey),
  );
  const [view, setView] = useState<Metadata>();
  const [name, setName] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState(false);
  const initialized = useRef(false),
    sequence = useRef(0),
    alive = useRef(true),
    inFlight = useRef(false);
  const request = useRef<{ body: string; version: number; key: string } | undefined>(undefined);
  const cancelPending = useCallback(() => {
    sequence.current += 1;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelPending();
    };
  }, [cancelPending]);
  const load = useCallback(
    async (replace = false) => {
      const serial = ++sequence.current;
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
          headers: projectSessionHeaders(accessToken, props.csrfToken),
        });
        if (!response.ok)
          throw new Error(
            response.status === 403 || response.status === 404
              ? "Нет доступа к редактированию этого проекта."
              : "Не удалось загрузить карточку проекта.",
          );
        const value = (await response.json()) as Metadata;
        if (!alive.current || serial !== sequence.current) return;
        setView(value);
        if (replace || !initialized.current) {
          const restored = !replace && !initialized.current ? draft : undefined;
          setName(restored?.name ?? value.project.name);
          setOwners(restored?.owners ?? value.project.ownerIds);
          setVersion(restored?.version ?? value.project.version);
          setReason(restored?.reason ?? "");
          setError("");
          request.current = restored?.request;
          initialized.current = true;
        }
      } catch (cause) {
        if (alive.current && serial === sequence.current)
          setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить карточку.");
      } finally {
        if (alive.current && serial === sequence.current) setLoading(false);
      }
    },
    [endpoint, accessToken, props.csrfToken, draft],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      cancelPending();
    };
  }, [load, cancelPending]);
  async function stepUp() {
    try {
      saveProjectDraft(props.draftStorageKey, {
        name,
        owners,
        reason,
        version,
        request: request.current,
      });
      await props.onStepUp();
    } catch {
      setError("Не удалось сохранить черновик перед подтверждением входа. Повторите попытку.");
    }
  }
  async function save() {
    if (inFlight.current || !view) return;
    if (
      !name.trim() ||
      !reason.trim() ||
      owners.length === 0 ||
      owners.some((id) => !view.ownerOptions.some((o) => o.id === id))
    ) {
      setError("Заполните название, причину и выберите действующих ответственных.");
      return;
    }
    const body = JSON.stringify({
      name: name.trim(),
      ownerIds: [...owners].sort(),
      reason: reason.trim(),
    });
    if (request.current?.body !== body || request.current?.version !== version)
      request.current = { body, version, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        credentials: "include",
        headers: {
          ...projectSessionHeaders(accessToken, props.csrfToken),
          "content-type": "application/json",
          "idempotency-key": request.current.key,
          "if-match": `"${version}"`,
        },
        body,
      });
      const result = (await response.json()) as { code?: string };
      if (!alive.current) return;
      if (!response.ok) {
        setError(
          errors[result.code ?? ""] ??
            (response.status === 403 || response.status === 404
              ? "Нет права изменять этот проект. Обратитесь к администратору доступов."
              : "Не удалось сохранить проект. Проверьте поля и повторите запрос."),
        );
        return;
      }
      clearProjectDraft(props.draftStorageKey);
      setSaved(true);
      await load(true);
      await props.onSaved().catch(() => {
        if (alive.current)
          setLoadError("Изменения сохранены. Обновите страницу, чтобы перечитать права и каталог.");
      });
    } catch {
      if (alive.current)
        setError(
          "Не удалось получить ответ. Повторите сохранение с теми же полями — изменение не задублируется. Перед изменением полей проверьте актуальную карточку.",
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const unavailableOwners = owners.filter((id) => !view?.ownerOptions.some((o) => o.id === id));
  return (
    <Stack spacing={3} sx={{ maxWidth: 960, minWidth: 0 }}>
      {loading && (
        <Box role="status">
          <CircularProgress size={20} /> Загружаем карточку…
        </Box>
      )}
      {loadError && <Alert severity="error">{loadError}</Alert>}
      {saved && <Alert severity="success">Изменения сохранены</Alert>}
      {view && (
        <>
          <Box
            component="form"
            aria-label="Редактирование проекта"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Stack spacing={2.5}>
              <Typography color="text.secondary">
                Рабочая область: {props.workspaceName}. Ключ: {view.project.key}. Классификация:{" "}
                {formatRuUiValue(view.project.dataClassificationKey)}.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ключ, область и классификация остаются постоянными. После изменения карточки
                проверки готовности подключения потребуется повторить.
              </Typography>
              <TextField
                label="Название проекта"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 256, "aria-label": "Название проекта" } }}
              />
              <Box
                component="fieldset"
                sx={{ m: 0, p: 2, minWidth: 0, border: "1px solid", borderColor: "divider" }}
              >
                <legend>Ответственные</legend>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Выберите одного или нескольких участников области. Этот список не назначает им
                  дополнительные права.
                </Typography>
                <Stack spacing={1}>
                  {view.ownerOptions.map((person) => (
                    <label
                      key={person.id}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        overflowWrap: "anywhere",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={owners.includes(person.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setOwners((current) =>
                            event.target.checked
                              ? [...current, person.id]
                              : current.filter((id) => id !== person.id),
                          )
                        }
                      />
                      {formatRuUiValue(person.displayName)}
                    </label>
                  ))}
                  {unavailableOwners.map((id, index) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked
                        disabled={busy}
                        onChange={() => setOwners((current) => current.filter((v) => v !== id))}
                      />{" "}
                      Бывший участник {index + 1} — снимите выбор и назначьте замену
                    </label>
                  ))}
                  {!view.ownerOptions.length && (
                    <Alert severity="warning">
                      В области нет действующих участников для назначения.
                    </Alert>
                  )}
                </Stack>
              </Box>
              <TextField
                label="Причина изменения"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                multiline
                minRows={2}
                required
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 2000, "aria-label": "Причина изменения" } }}
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexWrap: "wrap" }}>
                <Button type="submit" variant="contained" disabled={busy || loading || !!loadError}>
                  {busy ? "Сохраняем…" : "Сохранить изменения"}
                </Button>
                <Button disabled={busy} onClick={() => void stepUp()}>
                  Подтвердить вход
                </Button>
                <Button disabled={busy || loading} onClick={() => void load()}>
                  Обновить участников
                </Button>
                <Button href="/projects" disabled={busy}>
                  К проектам
                </Button>
              </Stack>
            </Stack>
          </Box>
          <Box>
            <Button disabled={busy || loading} onClick={() => void load(true)}>
              Загрузить актуальные данные
            </Button>
            <Typography variant="caption" sx={{ display: "block" }} color="text.secondary">
              Заменит введённый черновик текущей карточкой проекта.
            </Typography>
          </Box>
          <Stack spacing={2} aria-label="История проекта">
            <Typography component="h2" variant="h5">
              История изменений
            </Typography>
            {view.historyHasMore && (
              <Typography>Показаны последние {view.historyLimit} версий.</Typography>
            )}
            {view.history.map((item) => (
              <Box
                key={item.version}
                sx={{
                  borderTop: "1px solid",
                  borderColor: "divider",
                  pt: 2,
                  overflowWrap: "anywhere",
                }}
              >
                <Typography component="h3" variant="subtitle1">
                  Версия {item.version} · {item.name}
                </Typography>
                <Typography variant="body2">
                  {formatRuUiValue(item.actorName)} ·{" "}
                  {new Date(item.createdAt).toLocaleString("ru-RU")}
                </Typography>
                <Typography variant="body2">
                  Ответственные: {item.owners.map(formatRuUiValue).join(", ") || "Не назначены"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.reason}
                </Typography>
              </Box>
            ))}
          </Stack>
        </>
      )}
      {!view && !loading && <Button onClick={() => void load()}>Повторить загрузку</Button>}
    </Stack>
  );
}

import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
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

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}
interface RegistrationOptions {
  readonly workspaceName: string;
  readonly owners: readonly { id: string; displayName: string; username?: string | null }[];
  readonly criticalities: readonly Choice[];
  readonly classifications: readonly Choice[];
}
const responsibilities = [
  ["business", "Бизнес-ответственный"],
  ["technical", "Технический ответственный"],
  ["qa", "Ответственный QA"],
  ["security", "Ответственный за безопасность"],
  ["escalation", "Ответственный за эскалации"],
] as const;
const messages: Readonly<Record<string, string>> = {
  STEP_UP_REQUIRED: "Подтвердите вход и повторите создание.",
  PROJECT_KEY_CONFLICT: "Проект с таким ключом уже существует. Укажите другой ключ.",
  PROJECT_KEY_INVALID:
    "Ключ: от 2 до 32 символов, первая — латинская буква. Допустимы заглавные буквы, цифры, дефис и подчёркивание.",
  ACTIVE_WORKSPACE_MEMBER_REQUIRED:
    "Один из ответственных больше не состоит в области. Обновите список и выберите действующих участников.",
  IDEMPOTENCY_CONFLICT:
    "Данные этого запроса уже использованы. Проверьте каталог проектов перед повтором.",
  HTTP_COMMAND_SCHEMA_INVALID: "Проверьте обязательные поля и допустимую длину значений.",
};
export function ProjectCreateRoute(props: {
  apiUrl: string;
  accessToken?: string;
  csrfToken?: string;
  onboardingAvailable?: boolean;
  workspaceId: string;
  draftStorageKey?: string;
  onStepUp: () => Promise<void>;
  workspaces: readonly { workspaceId: string; workspaceName: string }[];
  onCreated: (workspaceId: string, projectId: string) => Promise<void>;
}) {
  const [draft] = useState(() =>
    readProjectDraft<{
      workspaceId: string;
      key: string;
      name: string;
      owners: Record<string, string>;
      classification: string;
      criticality: string;
      reason: string;
      request?: { body: string; key: string; workspaceId: string };
    }>(props.draftStorageKey),
  );
  const [workspaceId, setWorkspaceId] = useState(() =>
    props.workspaces.some((w) => w.workspaceId === (draft?.workspaceId ?? props.workspaceId))
      ? (draft?.workspaceId ?? props.workspaceId)
      : (props.workspaces[0]?.workspaceId ?? ""),
  );
  const destinationAllowed = props.workspaces.some((w) => w.workspaceId === workspaceId);
  const [options, setOptions] = useState<RegistrationOptions>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState(draft?.key ?? "");
  const [name, setName] = useState(draft?.name ?? "");
  const [owners, setOwners] = useState<Record<string, string>>(draft?.owners ?? {});
  const [classification, setClassification] = useState(draft?.classification ?? "INTERNAL");
  const [criticality, setCriticality] = useState(draft?.criticality ?? "STANDARD");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; key: string }>();
  const request = useRef<{ body: string; key: string; workspaceId: string } | undefined>(
    draft?.request,
  );
  const inFlight = useRef(false);
  const alive = useRef(true);
  const { apiUrl, accessToken } = props;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setLoadError("");
      }
    });
    if (!destinationAllowed) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setOptions(undefined);
          setLoading(false);
          setLoadError("Нет права создавать проекты в этой области.");
        }
      });
      return () => controller.abort();
    }
    void fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/projects/registration-options`, {
      credentials: "include",
      headers: projectSessionHeaders(accessToken, props.csrfToken),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403 || response.status === 404
              ? "Нет права создавать проекты в этой области."
              : "Не удалось загрузить участников и параметры проекта.",
          );
        return (await response.json()) as RegistrationOptions;
      })
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setOptions(undefined);
          setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить параметры.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, accessToken, props.csrfToken, workspaceId, revision, destinationAllowed]);
  async function stepUp() {
    try {
      saveProjectDraft(props.draftStorageKey, {
        workspaceId,
        key,
        name,
        owners,
        classification,
        criticality,
        reason,
        request: request.current,
      });
      await props.onStepUp();
    } catch {
      setError(
        "Не удалось сохранить черновик перед подтверждением входа. Форма остаётся открытой; повторите попытку.",
      );
    }
  }
  async function save() {
    if (inFlight.current || !options || !destinationAllowed) return;
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/u.test(key.trim())) {
      setError(messages.PROJECT_KEY_INVALID!);
      return;
    }
    if (
      !name.trim() ||
      !reason.trim() ||
      responsibilities.some(([id]) => !options.owners.some((o) => o.id === owners[id]))
    ) {
      setError("Заполните название, причину и выберите всех ответственных.");
      return;
    }
    const body = JSON.stringify({
      key: key.trim(),
      name: name.trim(),
      ownerIds: owners,
      criticalityKey: criticality,
      dataClassificationKey: classification,
      reason: reason.trim(),
    });
    if (request.current?.body !== body || request.current?.workspaceId !== workspaceId)
      request.current = { body, workspaceId, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/workspaces/${workspaceId}/projects`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...projectSessionHeaders(accessToken, props.csrfToken),
          "content-type": "application/json",
          "idempotency-key": request.current.key,
        },
        body,
      });
      const result = (await response.json()) as { projectId?: string; code?: string };
      if (!response.ok) {
        if (alive.current)
          setError(
            messages[result.code ?? ""] ??
              (response.status === 403 || response.status === 404
                ? "Нет права создавать проекты. Обновите права или обратитесь к администратору."
                : "Не удалось создать проект. Проверьте поля и повторите запрос."),
          );
        return;
      }
      if (!result.projectId) throw new Error("missing result");
      if (!alive.current) return;
      clearProjectDraft(props.draftStorageKey);
      await props.onCreated(workspaceId, result.projectId);
      if (alive.current) setCreated({ id: result.projectId, key: key.trim() });
    } catch {
      if (alive.current)
        setError(
          "Не удалось получить ответ. Повторите создание с теми же полями — второй проект не появится. Перед изменением полей проверьте каталог проектов.",
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (created)
    return (
      <Stack spacing={2} role="status">
        <Alert severity="success">Проект {created.key} создан</Alert>
        <Typography>
          Проект сохранён как черновик. Общая команда получила доступ по своим ролям и уровню
          допуска. Для начала работы настройте подключения и проверьте готовность.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {props.onboardingAvailable !== false && (
            <Button variant="contained" href={`/projects/${created.id}/onboarding`}>
              Настроить подключение
            </Button>
          )}
          <Button href="/projects">К проектам</Button>
        </Stack>
      </Stack>
    );
  return (
    <Box
      component="form"
      aria-label="Создание проекта"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      sx={{ maxWidth: 900 }}
    >
      <Stack spacing={2.5}>
        <Stack spacing={0.5}>
          <label htmlFor="project-workspace">Рабочая область проекта</label>
          <select
            id="project-workspace"
            value={workspaceId}
            disabled={busy || !props.workspaces.length}
            required
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setOptions(undefined);
              setOwners({});
              setLoading(true);
              setError("");
              setLoadError("");
            }}
          >
            {!destinationAllowed && <option value="">Нет доступной области</option>}
            {props.workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.workspaceName}
              </option>
            ))}
          </select>
          <Typography variant="body2" color="text.secondary">
            Проект и его ответственные будут относиться к выбранной рабочей области.
          </Typography>
        </Stack>
        <Typography>
          Новый проект в области «{options?.workspaceName ?? "Текущая область"}». Общая команда
          получит доступ автоматически; подключения настраиваются после создания.
        </Typography>
        {loading && (
          <Box role="status">
            <CircularProgress size={20} /> Загружаем параметры…
          </Box>
        )}
        {loadError && <Alert severity="error">{loadError}</Alert>}
        <TextField
          label="Название проекта"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: 256, "aria-label": "Название проекта" } }}
        />
        <TextField
          label="Ключ проекта"
          value={key}
          onChange={(event) => setKey(event.target.value.toUpperCase())}
          required
          disabled={busy}
          helperText="Например, PAYMENTS. 2–32 символа: латинские буквы, цифры, дефис или подчёркивание."
          slotProps={{
            htmlInput: {
              "aria-label": "Ключ проекта",
              maxLength: 32,
              pattern: "[A-Z][A-Z0-9_-]{1,31}",
            },
          }}
        />
        <Typography component="h2" variant="h6">
          Ответственные
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Выберите участников области. Один человек может отвечать за несколько направлений; в
          карточке проекта сохраняется общий список ответственных.
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
            minWidth: 0,
          }}
        >
          {responsibilities.map(([id, label]) => (
            <Stack spacing={0.5} key={id} sx={{ minWidth: 0 }}>
              <label htmlFor={`project-owner-${id}`}>{label}</label>
              <select
                id={`project-owner-${id}`}
                value={owners[id] ?? ""}
                required
                disabled={busy || loading || !options}
                onChange={(event) =>
                  setOwners((current) => ({ ...current, [id]: event.target.value }))
                }
              >
                <option value="">Выберите участника</option>
                {options?.owners.map((owner) => (
                  <option value={owner.id} key={owner.id}>
                    {owner.displayName}
                    {owner.username && owner.username !== owner.displayName
                      ? ` · ${owner.username}`
                      : ""}
                  </option>
                ))}
              </select>
            </Stack>
          ))}
        </Box>
        <Stack spacing={0.5}>
          <label htmlFor="project-criticality">Критичность</label>
          <select
            id="project-criticality"
            value={criticality}
            disabled={busy || !options}
            onChange={(event) => setCriticality(event.target.value)}
          >
            {options?.criticalities.map((choice) => (
              <option value={choice.key} key={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
          <Typography variant="body2" color="text.secondary">
            {options?.criticalities.find((c) => c.key === criticality)?.description}
          </Typography>
        </Stack>
        <Stack spacing={0.5}>
          <label htmlFor="project-classification">Классификация данных</label>
          <select
            id="project-classification"
            value={classification}
            disabled={busy || !options}
            onChange={(event) => setClassification(event.target.value)}
          >
            {options?.classifications.map((choice) => (
              <option value={choice.key} key={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
          <Typography variant="body2" color="text.secondary">
            {options?.classifications.find((c) => c.key === classification)?.description}
          </Typography>
        </Stack>
        <TextField
          label="Причина создания"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          required
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: 2000, "aria-label": "Причина создания" } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button type="submit" variant="contained" disabled={busy || loading || !options}>
            {busy ? "Создаём…" : "Создать проект"}
          </Button>
          <Button disabled={busy} onClick={() => void stepUp()}>
            Подтвердить вход
          </Button>
          <Button disabled={busy || loading} onClick={() => setRevision((value) => value + 1)}>
            Обновить участников
          </Button>
          <Button href="/projects" disabled={busy}>
            Отмена
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

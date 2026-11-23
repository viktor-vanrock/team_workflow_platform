import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectDialogueView } from "@awp/competency-ui-sdk";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

const errors: Record<string, string> = {
  CLASSIFICATION_EXCEEDED:
    "Для создания внутреннего проекта нужен соответствующий уровень допуска. Обратитесь к администратору доступов.",
  STEP_UP_REQUIRED: "Подтвердите вход и повторите создание проекта.",
  PROJECT_DIALOGUE_STALE: "Диалог изменился в другом окне. Обновите его и проверьте карточку.",
  PROJECT_KEY_CONFLICT: "Этот ключ уже занят. Напишите «Ключ: НОВЫЙ_КЛЮЧ» и повторите создание.",
  PROJECT_KEY_INVALID:
    "Ключ: 2–32 заглавные латинские буквы, цифры, дефис или подчёркивание; первый символ — буква.",
  PROJECT_DIALOGUE_MESSAGE_INVALID:
    "Название должно быть не длиннее 256 символов, сообщение — 2000.",
  PROJECT_DIALOGUE_LIMIT: "Достигнут предел сообщений. Начните новый диалог.",
};
export function ProjectDialogueRoute(props: {
  apiUrl: string;
  accessToken?: string;
  csrfToken?: string;
  workspaceId: string;
  onStepUp: () => Promise<void>;
  onCreated: (projectId: string) => Promise<void>;
}) {
  const [dialogue, setDialogue] = useState<ProjectDialogueView>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const transport = useRef(props);
  useEffect(() => {
    transport.current = props;
  }, [props]);
  const attempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const startId = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const request = useCallback(async <T,>(suffix: string, body?: unknown): Promise<T> => {
    const current = transport.current;
    const response = await fetch(
      `${current.apiUrl}/api/v1/workspaces/${current.workspaceId}/project-dialogues${suffix}`,
      {
        method: body === undefined ? "GET" : "POST",
        credentials: current.accessToken ? "omit" : "include",
        headers: {
          ...(current.accessToken ? { authorization: `Bearer ${current.accessToken}` } : {}),
          ...(current.csrfToken ? { "x-csrf-token": current.csrfToken } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ).catch(() => {
      throw new Error(
        "Не удалось связаться с сервером. Повторите действие; сохранённый проект не будет создан повторно.",
      );
    });
    const result = (await response.json()) as T & { code?: string; message?: string };
    if (!response.ok)
      throw new Error(
        errors[result.code ?? result.message ?? ""] ??
          "Не удалось выполнить действие. Обновите диалог или повторите вход.",
      );
    return result;
  }, []);
  const load = useCallback(async () => {
    const version = ++sequence.current;
    setError("");
    try {
      const result = await request<{ items: ProjectDialogueView[] }>("");
      if (sequence.current === version) setDialogue(result.items[0]);
    } catch (error) {
      if (sequence.current === version) setError((error as Error).message);
    }
  }, [request]);
  const cancelPending = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      cancelPending();
    };
  }, [load, cancelPending, props.workspaceId]);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    startId.current ??= crypto.randomUUID();
    try {
      setDialogue(await request<ProjectDialogueView>("", { id: startId.current }));
      startId.current = undefined;
      setMessage("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(confirm = false) {
    if (!dialogue || busy || (!confirm && !message.trim())) return;
    setBusy(true);
    setError("");
    const body = {
      expectedVersion: dialogue.version,
      ...(confirm ? {} : { message: message.trim() }),
    };
    const suffix = `/${dialogue.id}/${confirm ? "confirm" : "messages"}`;
    const fingerprint = JSON.stringify({ suffix, body });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const next = await request<ProjectDialogueView>(suffix, {
        ...body,
        requestKey: attempt.current.key,
      });
      setDialogue(next);
      setMessage("");
      attempt.current = undefined;
      if (next.projectId) await props.onCreated(next.projectId);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={3}>
      <Typography component="h1" variant="h4">
        Новый проект с Hermes
      </Typography>
      <Typography>
        Расскажите о проекте. Hermes уточнит недостающие сведения и подготовит карточку для вашего
        подтверждения.
      </Typography>
      {error && (
        <Alert severity="error">
          {error}{" "}
          <Button disabled={busy} onClick={() => void load()}>
            Обновить диалог
          </Button>
        </Alert>
      )}
      {!dialogue ? (
        <Button variant="contained" disabled={busy} onClick={() => void start()}>
          Начать диалог
        </Button>
      ) : (
        <>
          <Stack spacing={2} role="log" aria-label="Диалог с Hermes" aria-live="polite">
            {dialogue.messages.map((entry, index) => (
              <Card key={index}>
                <CardContent>
                  <Typography variant="subtitle2">
                    {entry.role === "assistant" ? "Hermes" : "Вы"}
                  </Typography>
                  <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {entry.text}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
          {dialogue.state !== "CREATED" && (
            <Box
              component="form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Stack spacing={2}>
                <TextField
                  label="Сообщение Hermes"
                  multiline
                  minRows={2}
                  value={message}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button type="submit" variant="outlined" disabled={busy || !message.trim()}>
                  Отправить
                </Button>
              </Stack>
            </Box>
          )}
          {dialogue.draft.name && (
            <Card>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h6">{dialogue.draft.name}</Typography>
                  <Typography>Ключ: {dialogue.draft.key}</Typography>
                  <Typography>{dialogue.draft.purpose ?? "Цель ещё не указана"}</Typography>
                  <Typography color="text.secondary">
                    Вы — заказчик и первоначальный ответственный. Классификация — внутренняя,
                    критичность — стандартная. Проект создаётся как черновик; рабочие подключения
                    настроит администратор.
                  </Typography>
                  {dialogue.state === "READY" && (
                    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void props
                            .onStepUp()
                            .catch((e: unknown) =>
                              setError(
                                e instanceof Error ? e.message : "Не удалось подтвердить вход",
                              ),
                            )
                        }
                      >
                        Подтвердить вход
                      </Button>
                      <Button variant="contained" disabled={busy} onClick={() => void send(true)}>
                        Создать проект
                      </Button>
                    </Stack>
                  )}
                  {dialogue.projectId && (
                    <Button href={`/projects/${dialogue.projectId}/onboarding`}>
                      Открыть проект
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
          <Button disabled={busy} onClick={() => void start()}>
            Начать новый диалог
          </Button>
        </>
      )}
    </Stack>
  );
}

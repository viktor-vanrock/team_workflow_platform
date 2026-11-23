import { useEffect, useRef, useState } from "react";

import type { WorkspaceContribution, WorkspaceContributionProps } from "@awp/competency-ui-sdk";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import type { DocumentAction, DocumentDetail, DocumentHistory, ServiceDocument } from "./domain.ts";

const labels = {
  DRAFT: "Черновик",
  IN_REVIEW: "На ревью",
  CHANGES_REQUESTED: "Нужна доработка",
  APPROVED: "Утверждено",
} as const;
const verbs = {
  create: "Задание создано",
  save: "Черновик сохранён",
  submit: "Отправлено на ревью",
  return: "Возвращено с замечаниями",
  approve: "Версия утверждена",
} as const;
const date = (at: string) =>
  new Date(at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const errors: Readonly<Record<string, string>> = {
  DOC_VERSION_CONFLICT: "Документ уже изменён. Обновите его и повторите действие.",
  DOC_STATE_CONFLICT: "Состояние документа изменилось. Обновите документ.",
  DOC_EMPTY: "Добавьте и сохраните текст перед отправкой на ревью.",
  DOC_BODY_INVALID: "Текст должен содержать не более 100 000 символов.",
  DOC_FEEDBACK_REQUIRED: "Напишите замечание перед возвратом.",
  IDEMPOTENCY_CONFLICT: "Этот запрос уже использован с другим содержимым. Обновите документ.",
};
class DocumentResponseError extends Error {}
async function readResponse(response: Response): Promise<unknown> {
  const value = (await response.json()) as { code?: string };
  if (!response.ok)
    throw new DocumentResponseError(
      errors[value.code ?? ""] ??
        (response.status === 403
          ? "Недостаточно прав для этого действия или проекта. Смените роль либо обновите страницу."
          : response.status === 401
            ? "Срок входа истёк. Войдите снова через выбор роли."
            : response.status === 404
              ? "Документ недоступен в этом проекте."
              : response.status === 400
                ? "Проверьте обязательные поля формы."
                : "Не удалось выполнить действие. Проверьте соединение и повторите попытку."),
    );
  return value;
}
function State({ doc }: { doc: ServiceDocument }) {
  return (
    <Chip
      size="small"
      label={labels[doc.state]}
      color={
        doc.state === "APPROVED"
          ? "success"
          : doc.state === "CHANGES_REQUESTED"
            ? "warning"
            : doc.state === "IN_REVIEW"
              ? "info"
              : "default"
      }
    />
  );
}
function History({ entries }: { entries: readonly DocumentHistory[] }) {
  return (
    <Box component="details">
      <summary>История документа · {entries.length} событий</summary>
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {[...entries].reverse().map((entry) => (
          <Box
            key={entry.document.resourceVersion}
            sx={{ borderLeft: "2px solid", borderColor: "divider", pl: 2 }}
          >
            <Typography>
              {verbs[entry.action]} · редакция {entry.document.revision}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {entry.actor.label} · {date(entry.at)}
            </Typography>
            {entry.action === "return" && <Typography>{entry.document.feedback}</Typography>}
            <Box component="details" sx={{ mt: 0.5 }}>
              <summary>Текст этой редакции</summary>
              <Typography
                component="pre"
                sx={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}
              >
                {entry.document.body || "Текст ещё не добавлен"}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
function DocumentEditor({
  detail,
  busy,
  onAction,
}: {
  detail: DocumentDetail;
  busy: boolean;
  onAction: (action: DocumentAction, body: Record<string, string>) => void;
}) {
  const doc = detail.document;
  const [body, setBody] = useState(doc.body);
  const [feedback, setFeedback] = useState("");
  const dirty = body !== doc.body;
  return (
    <Stack spacing={2.5}>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <State doc={doc} />
              <Chip size="small" label={`Редакция ${doc.revision}`} />
              <Typography variant="caption">Обновлено {date(doc.updatedAt)}</Typography>
            </Stack>
            <Typography component="h2" variant="h4">
              {doc.title}
            </Typography>
            <Typography color="text.secondary">
              Ответственный: {doc.author.label} · Сервис ALPHA
            </Typography>
            <Typography>{doc.serviceDescription}</Typography>
            <Box
              sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}
            >
              <Box>
                <Typography component="h3" variant="subtitle2">
                  Цель документа
                </Typography>
                <Typography>{doc.goal}</Typography>
              </Box>
              <Box>
                <Typography component="h3" variant="subtitle2">
                  Аудитория
                </Typography>
                <Typography>{doc.audience}</Typography>
              </Box>
            </Box>
            <Box component="details">
              <summary>Исходные материалы · {doc.sources.length}</summary>
              <Box component="ol" sx={{ pl: 2.5 }}>
                {doc.sources.map((source) => (
                  <li key={source}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {source}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      {doc.feedback && (
        <Alert severity={doc.state === "CHANGES_REQUESTED" ? "warning" : "info"}>
          <strong>
            {doc.state === "CHANGES_REQUESTED" ? "Замечания лида" : "Замечания предыдущего ревью"}
          </strong>
          <br />
          {doc.feedback}
        </Alert>
      )}
      {doc.approval && (
        <Alert severity="success">
          Редакция {doc.approval.revision} утверждена: {doc.approval.actor.label},{" "}
          {date(doc.approval.at)}. Изменение текста начнёт новый черновик.
        </Alert>
      )}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h3" variant="h5">
              {detail.actions.includes("save")
                ? "Текст документа"
                : "Сохранённая версия для просмотра"}
            </Typography>
            {detail.actions.includes("save") ? (
              <TextField
                label="Текст документа"
                multiline
                minRows={14}
                fullWidth
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                helperText={`${body.length.toLocaleString("ru-RU")} / 100 000 символов. Сначала сохраните изменения, затем отправьте на ревью.`}
              />
            ) : (
              <Typography
                component="pre"
                sx={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontFamily: "inherit",
                  lineHeight: 1.8,
                  mb: 0,
                }}
              >
                {doc.body || "Текст ещё не добавлен."}
              </Typography>
            )}
            {dirty && (
              <Alert severity="warning">
                Есть несохранённые изменения. Они будут потеряны при уходе со страницы или смене
                роли.
              </Alert>
            )}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {detail.actions.includes("save") && (
                <Button
                  variant="contained"
                  disabled={busy || !dirty || body.length > 100000}
                  onClick={() => onAction("save", { body })}
                >
                  Сохранить черновик
                </Button>
              )}
              {detail.actions.includes("submit") && (
                <Button
                  variant="outlined"
                  disabled={busy || dirty || !doc.body.trim()}
                  onClick={() => onAction("submit", {})}
                >
                  {doc.state === "CHANGES_REQUESTED"
                    ? "Отправить повторно на ревью"
                    : "Отправить на ревью"}
                </Button>
              )}
            </Stack>
            {doc.state === "IN_REVIEW" && !detail.actions.includes("approve") && (
              <Alert severity="info">
                Документ передан лиду. Редактирование откроется после возврата с замечаниями.
              </Alert>
            )}
            {detail.actions.includes("approve") && (
              <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2 }}>
                <Stack spacing={2}>
                  <Typography component="h3" variant="h5">
                    Решение по редакции {doc.revision}
                  </Typography>
                  <Typography color="text.secondary">
                    Проверьте цель, аудиторию и полноту документа. Утверждение относится к
                    показанной сохранённой версии.
                  </Typography>
                  <TextField
                    label="Замечания автору"
                    fullWidth
                    multiline
                    minRows={3}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    disabled={busy}
                    helperText="Обязательно для возврата на доработку, до 4 000 символов."
                  />
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Button
                      variant="outlined"
                      disabled={busy || !feedback.trim() || feedback.length > 4000}
                      onClick={() => onAction("return", { feedback })}
                    >
                      Вернуть на доработку
                    </Button>
                    <Button
                      variant="contained"
                      color="success"
                      disabled={busy}
                      onClick={() => onAction("approve", {})}
                    >
                      Утвердить редакцию {doc.revision}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <History entries={detail.history} />
        </CardContent>
      </Card>
    </Stack>
  );
}
function NewDocument({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: Record<string, string>) => void;
}) {
  const [title, setTitle] = useState("ALPHA: новое руководство по сервису");
  const [goal, setGoal] = useState(
    "Помочь интегратору выполнить первый запрос и обработать ошибки.",
  );
  const [audience, setAudience] = useState("Разработчики интеграций и инженеры поддержки");
  return (
    <Card>
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(e) => {
            e.preventDefault();
            onCreate({ title, goal, audience });
          }}
        >
          <Typography component="h2" variant="h5">
            Новое задание для сервиса ALPHA
          </Typography>
          <Typography color="text.secondary">
            Описание сервиса и учебные материалы уже подготовлены. Вы будете ответственным автором.
          </Typography>
          <TextField
            label="Название документа"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            label="Цель документа"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            label="Аудитория"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !title.trim() || !goal.trim() || !audience.trim()}
          >
            Создать задание
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
export function TechWritingWorkspace(props: WorkspaceContributionProps) {
  const { apiUrl, accessToken, workspaceId, projectId, permissions, location, navigate } = props;
  const path = location.split("?")[0];
  const id = new URLSearchParams(location.split("?")[1]).get("document");
  const lead = permissions.includes("docs.review");
  const base = `${apiUrl}/workspaces/${workspaceId}/projects/${projectId}/documentation`;
  const [documents, setDocuments] = useState<readonly ServiceDocument[]>([]);
  const [detail, setDetail] = useState<DocumentDetail>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const open = (document: ServiceDocument) =>
    navigate(`/docs/documents?document=${encodeURIComponent(document.id)}`);
  useEffect(
    () => () => {
      mutation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      setDetail(undefined);
      try {
        const result = await readResponse(
          await fetch(id ? `${base}/${encodeURIComponent(id)}` : base, {
            headers: { authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        if (id) setDetail(result as DocumentDetail);
        else setDocuments((result as { documents: ServiceDocument[] }).documents);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof DocumentResponseError
              ? e.message
              : "Не удалось загрузить документы. Проверьте соединение и повторите попытку.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [base, accessToken, id, reload]);
  async function write(action: "create" | DocumentAction, body: Record<string, string>) {
    if (mutation.current || (action !== "create" && !detail)) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = (await readResponse(
        await fetch(action === "create" ? base : `${base}/${detail!.document.id}/${action}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            ...(action !== "create" ? { "if-match": `"${detail!.document.resourceVersion}"` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
      )) as DocumentDetail;
      if (controller.signal.aborted) return;
      setDetail(result);
      setNotice(verbs[action]);
      if (action === "create") open(result.document);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof DocumentResponseError
            ? e.message
            : "Не удалось выполнить действие. Проверьте соединение и повторите попытку.",
        );
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (path === "/docs/help")
    return (
      <Stack spacing={2}>
        <Card>
          <CardContent>
            <Typography component="h2" variant="h5">
              От задания до утверждения
            </Typography>
            <Box component="ol" sx={{ pl: 2.5, lineHeight: 2 }}>
              <li>Писатель изучает цель, аудиторию и материалы задания.</li>
              <li>Пишет текст, сохраняет черновик и отправляет сохранённую редакцию на ревью.</li>
              <li>Лид читает документ и возвращает его с замечаниями либо утверждает.</li>
              <li>Писатель обрабатывает замечания, сохраняет изменения и отправляет повторно.</li>
              <li>
                Лид утверждает точную редакцию. Новое изменение текста снимает действующее
                утверждение.
              </li>
            </Box>
            <Typography>
              Для сравнения используйте «Сменить роль или проект». Входы: «Технический писатель» и
              «Лид технических писателей». Новый пример можно создать писателем через «Новое
              задание».
            </Typography>
          </CardContent>
        </Card>
        <Alert severity="info">
          Это локальная демонстрация. Утверждённый документ остаётся здесь для просмотра; внешняя
          публикация не выполняется.
        </Alert>
      </Stack>
    );
  const queue = documents.filter((d) => d.state === "IN_REVIEW");
  const revisions = documents.filter((d) => d.state === "CHANGES_REQUESTED");
  const drafts = documents.filter((d) => d.state === "DRAFT");
  const visible =
    path === "/docs/review" || (path === "/" && lead)
      ? queue
      : path === "/"
        ? [...revisions, ...drafts]
        : documents;
  return (
    <Stack spacing={2.5}>
      {error && (
        <Alert severity="error">
          {error}{" "}
          <Button disabled={busy} onClick={() => setReload((v) => v + 1)}>
            Обновить документ
          </Button>
        </Alert>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      {busy && (
        <Box role="status">
          <CircularProgress size={18} /> Сохраняем действие…
        </Box>
      )}
      {id ? (
        <>
          <Button
            sx={{ alignSelf: "flex-start" }}
            onClick={() => navigate(lead ? "/docs/review" : "/docs/documents")}
          >
            ← {lead ? "К очереди ревью" : "К моим документам"}
          </Button>
          {loading ? (
            <Typography role="status">Загрузка документа…</Typography>
          ) : (
            detail && (
              <DocumentEditor
                key={`${detail.document.id}:${detail.document.resourceVersion}`}
                detail={detail}
                busy={busy}
                onAction={(action, body) => void write(action, body)}
              />
            )
          )}
        </>
      ) : path === "/docs/new" ? (
        <NewDocument busy={busy} onCreate={(body) => void write("create", body)} />
      ) : (
        <>
          {path === "/" && (
            <>
              <Alert severity="info">
                {lead
                  ? "Ваша задача — проверить сохранённые редакции и принять решение. Откройте документ из очереди ниже."
                  : "Начните с замечаний лида или продолжите черновик. Сохранённый документ можно передать на ревью."}
              </Alert>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" },
                  gap: 2,
                }}
              >
                {(lead
                  ? [
                      ["На ревью", queue.length],
                      ["На доработке", revisions.length],
                      ["Утверждено", documents.filter((d) => d.state === "APPROVED").length],
                    ]
                  : [
                      ["Мои черновики", drafts.length],
                      ["Обработать замечания", revisions.length],
                      ["Ожидают лида", queue.length],
                    ]
                ).map(([label, count]) => (
                  <Card key={label}>
                    <CardContent>
                      <Typography color="text.secondary" variant="body2">
                        {label}
                      </Typography>
                      <Typography variant="h3">{count}</Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </>
          )}
          <Stack
            direction="row"
            sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
          >
            <Typography component="h2" variant="h5">
              {path === "/docs/review" || (path === "/" && lead)
                ? "Ожидают вашего решения"
                : path === "/"
                  ? "Следующие действия"
                  : lead
                    ? "Все документы сервиса"
                    : "Мои документы и задания"}
            </Typography>
            {permissions.includes("docs.create") && (
              <Button variant="contained" onClick={() => navigate("/docs/new")}>
                + Новое задание
              </Button>
            )}
          </Stack>
          {loading ? (
            <Typography role="status">Загрузка заданий…</Typography>
          ) : !visible.length ? (
            <Card>
              <CardContent>
                <Typography>
                  {lead
                    ? "Документов в этой подборке пока нет. Писатель может отправить новую редакцию на ревью."
                    : "Здесь пока нет заданий. Создайте новый пример или откройте все документы."}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            visible.map((doc) => (
              <Card key={doc.id}>
                <CardContent>
                  <Stack spacing={1.2}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", flexWrap: "wrap" }}
                    >
                      <State doc={doc} />
                      <Typography variant="caption">
                        Редакция {doc.revision} · {date(doc.updatedAt)}
                      </Typography>
                    </Stack>
                    <Typography component="h3" variant="h5">
                      {doc.title}
                    </Typography>
                    <Typography color="text.secondary">
                      {lead ? `Автор: ${doc.author.label} · ` : ""}
                      {doc.audience}
                    </Typography>
                    {doc.state === "CHANGES_REQUESTED" && (
                      <Typography color="warning.main">{doc.feedback}</Typography>
                    )}
                    <Button
                      variant="outlined"
                      sx={{ alignSelf: "flex-start" }}
                      onClick={() => open(doc)}
                    >
                      {lead && doc.state === "IN_REVIEW"
                        ? "Открыть ревью"
                        : !lead && doc.state === "CHANGES_REQUESTED"
                          ? "Обработать замечания"
                          : !lead && doc.state === "DRAFT"
                            ? "Продолжить черновик"
                            : "Открыть документ"}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </Stack>
  );
}
export const techWritingWorkspace: WorkspaceContribution = {
  key: "tech-writing",
  label: "Техническая документация",
  workspaceKey: "local-tech-writing",
  Component: TechWritingWorkspace,
  sections: (permissions) => [
    {
      path: "/",
      label: permissions.includes("docs.review") ? "Пульт лида" : "Рабочий стол писателя",
      description: permissions.includes("docs.review")
        ? "Очередь проверки и решения по документации сервиса"
        : "Ваши задания, черновики и замечания лида",
      permission: "docs.read",
      project: true,
    },
    ...(permissions.includes("docs.review")
      ? [
          {
            path: "/docs/review",
            label: "Очередь ревью",
            description: "Документы, которые ждут вашего решения",
            permission: "docs.review",
            project: true,
          },
        ]
      : []),
    {
      path: "/docs/documents",
      label: permissions.includes("docs.review") ? "Библиотека документов" : "Мои документы",
      description: "Сервис ALPHA · задания, тексты и история редакций",
      permission: "docs.read",
      project: true,
    },
    {
      path: "/docs/new",
      label: "Новое задание",
      description: "Подготовьте ещё один документ и повторите полный цикл",
      permission: "docs.create",
      project: true,
    },
    {
      path: "/docs/help",
      label: "Как подготовить документ",
      description: "Путь автора и лида от задания до утверждения",
      permission: "docs.read",
      project: true,
    },
  ],
};

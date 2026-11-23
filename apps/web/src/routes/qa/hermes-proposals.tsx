import { useEffect, useState } from "react";

import { type HermesProposalView, QaHermesProposals } from "@awp/competency-qa/ui";
import { Alert, Card, CardContent, CircularProgress, Stack, Typography } from "@awp/platform-ui";

import { subjectLabel, useWorkspaceSubjects } from "../../workspace/subjects.ts";

export function HermesProposalsRoute(
  props: Readonly<{ apiUrl: string; accessToken: string; workspaceId: string; projectId: string }>,
) {
  const subjects = useWorkspaceSubjects(props);
  const [subjectId, setSubjectId] = useState(
    () => new URLSearchParams(window.location.search).get("subject") ?? "",
  );
  const [items, setItems] = useState<readonly HermesProposalView[]>([]);
  const [notice, setNotice] = useState(
    "Выберите запрос, черновик или входящее обращение из любого доступного проекта.",
  );
  const [busy, setBusy] = useState(false);
  const selected = subjects.items.find(
    (item) => `${item.kind}:${item.id}` === subjectId || item.id === subjectId,
  );
  useEffect(() => {
    const controller = new AbortController();
    if (!selected) return () => controller.abort();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setBusy(true);
        setItems([]);
        setNotice("Загрузка сохранённых предложений…");
      }
    });
    void fetch(
      `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/projects/${selected.projectId}/qa/hermes/triage/${selected.kind}/${selected.id}`,
      { headers: { authorization: `Bearer ${props.accessToken}` }, signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as { items: readonly HermesProposalView[] };
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setItems(body.items);
          setNotice(
            body.items.length
              ? "История предложений загружена."
              : "Для этой сущности сохранённых предложений пока нет.",
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice(
            "Не удалось загрузить предложения. Доступ или состояние сущности могли измениться.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selected, props.accessToken, props.apiUrl, props.workspaceId]);
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography>
              Hermes помогает разобрать обращение и подготовить рекомендации. Здесь показана история
              уже сохранённых предложений; выбор сущности не запускает новую обработку. Решение
              принимает человек.
            </Typography>
            <Typography component="label" htmlFor="hermes-subject">
              Запрос или обращение
            </Typography>
            <select
              id="hermes-subject"
              value={selected ? `${selected.kind}:${selected.id}` : ""}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setItems([]);
                setNotice("Выберите сущность, чтобы прочитать предложения.");
              }}
            >
              <option value="">Выберите сущность</option>
              {subjects.items.map((item) => (
                <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                  {subjectLabel(item)}
                </option>
              ))}
            </select>
            {subjects.loading || busy ? (
              <CircularProgress aria-label="Загрузка предложений" />
            ) : null}
            {subjects.error ? (
              <Alert severity="error">{subjects.error}</Alert>
            ) : (
              <Alert severity="info">
                {!subjects.loading && !subjects.items.length
                  ? "Доступных запросов, черновиков и обращений пока нет."
                  : notice}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>
      <QaHermesProposals items={items} />
    </Stack>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import {
  QaQueueWorkspace,
  type QaQueueWorkspaceEntry,
  type QaQueueWorkspacePage,
} from "@awp/competency-qa/ui";
import { Alert, Button, CircularProgress, Stack } from "@awp/platform-ui";

import type { WorkspaceProject } from "../../workspace/navigation.ts";
import { requestHref, useWorkspaceSubjects } from "../../workspace/subjects.ts";

export interface QueueWorkspaceRouteProps {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projects?: readonly WorkspaceProject[];
  readonly permissions?: readonly string[];
}

type ScopeMode = "PROJECT" | "AUTHORIZED_PORTFOLIO";
type CommandEntry = QaQueueWorkspaceEntry &
  Readonly<{
    revision?: number;
    semanticHash?: string;
    inputFingerprint?: string;
    subject: Readonly<{ kind: string; id: string; version?: number; semanticHash?: string }>;
  }>;

export function QueueWorkspaceRoute(props: Readonly<QueueWorkspaceRouteProps>) {
  const mode: ScopeMode = "AUTHORIZED_PORTFOLIO";
  const subjects = useWorkspaceSubjects(props);
  const [page, setPage] = useState<QaQueueWorkspacePage>();
  const [notice, setNotice] = useState("Загружаем очередь доступных запросов…");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestSequence = useRef(0);
  const pendingRequest = useRef<AbortController | undefined>(undefined);
  const endpoint = useCallback(
    (selected: ScopeMode) =>
      selected === "PROJECT"
        ? `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/qa/queue`
        : `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/qa/queue`,
    [props.apiUrl, props.projectId, props.workspaceId],
  );

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setBusy(true);
    setPage(undefined);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const items: QaQueueWorkspacePage["items"][number][] = [];
        for (;;) {
          const query = new URLSearchParams({ pageSize: "100" });
          if (cursor) query.set("cursor", cursor);
          const response = await fetch(`${endpoint(mode)}?${query}`, {
            headers: { authorization: `Bearer ${props.accessToken}` },
            signal: controller.signal,
          });
          if (response.status === 409 && cursor) break;
          if (!response.ok)
            throw new Error(
              "Не удалось загрузить очередь. Проверьте доступ и повторите обновление.",
            );
          const next = (await response.json()) as QaQueueWorkspacePage;
          items.push(...next.items);
          if (!next.nextCursor) {
            if (sequence !== requestSequence.current) return;
            const unique = new Map(
              items.map((item) => [
                `${item.entry.projectId}:${item.entry.subject.kind}:${item.entry.subject.id}`,
                item,
              ]),
            );
            setPage({ ...next, items: [...unique.values()], nextCursor: null });
            setIsError(false);
            setNotice(
              "Задачи всех доступных проектов. Отметка «Без приоритета» означает, что расчёт очереди ещё не выполнен.",
            );
            return;
          }
          if (seen.has(next.nextCursor))
            throw new Error("Не удалось загрузить все задачи. Повторите обновление очереди.");
          seen.add(next.nextCursor);
          cursor = next.nextCursor;
        }
      }
      throw new Error("Очередь меняется во время загрузки. Повторите обновление.");
    } catch (error) {
      if (sequence === requestSequence.current && !controller.signal.aborted) {
        setIsError(true);
        setNotice(error instanceof Error ? error.message : "Не удалось загрузить очередь.");
      }
    } finally {
      if (sequence === requestSequence.current && !controller.signal.aborted) setBusy(false);
    }
  }, [endpoint, mode, props.accessToken]);

  const cancelPending = useCallback(() => {
    requestSequence.current++;
    pendingRequest.current?.abort();
  }, []);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load();
    });
    return () => {
      current = false;
      cancelPending();
    };
  }, [load, cancelPending]);

  const move = useCallback(
    async (raw: QaQueueWorkspaceEntry, placement: "FIRST" | "LAST") => {
      if (!page) return;
      const entry = raw as CommandEntry;
      if (
        !entry.revision ||
        !entry.semanticHash ||
        !entry.inputFingerprint ||
        !entry.subject.version ||
        !entry.subject.semanticHash
      ) {
        setIsError(false);
        setNotice("Для элемента нет точного токена команды. Обновите текущую проекцию.");
        return;
      }
      setBusy(true);
      try {
        const url = `${endpoint(mode)}/order-overrides`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${props.accessToken}`,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${page.orderState.resourceVersion}"`,
          },
          body: JSON.stringify({
            schemaVersion: "queue-order-command@1.0.0",
            scopeKind: mode,
            subject: {
              projectId: entry.projectId,
              workItemId: entry.subject.id,
              expectedQueueEntry: {
                queueEntryId: entry.queueEntryId,
                revision: entry.revision,
                semanticHash: entry.semanticHash,
                inputFingerprint: entry.inputFingerprint,
              },
            },
            placement,
            expectedQueueEpoch: page.orderState.queueEpoch,
            expectedBaseVisibleSetHash: page.orderState.baseVisibleSetHash,
            expectedAuthorizedProjectSetHash: page.scope.authorizedProjectSetHash,
            expectedProjectionGeneration: (
              page as unknown as Readonly<{ projectionGeneration: string }>
            ).projectionGeneration,
            expectedComparatorRef: "queue-order@1.0.0",
            reason: "QA Lead queue workspace order adjustment",
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
          }),
        });
        if (!response.ok)
          throw new Error(`Запрос изменения порядка завершился ошибкой: ${response.status}`);
        setIsError(false);
        setNotice(
          response.status === 202
            ? "Точное перемещение ожидает согласования отдельным QA-лидом."
            : "Запрос порядка обработан без раскрытия недоступной опорной точки.",
        );
        await load();
      } catch (error) {
        setIsError(true);
        setNotice(String(error));
      } finally {
        setBusy(false);
      }
    },
    [endpoint, load, mode, page, props.accessToken],
  );

  const pending =
    page && !page.nextCursor
      ? subjects.items.filter(
          (item) =>
            item.kind === "WORK_ITEM" &&
            !page.items.some(
              ({ entry }) => entry.projectId === item.projectId && entry.subject.id === item.id,
            ),
        )
      : [];
  return (
    <Stack spacing={2} data-route="qa-queue">
      {(busy || subjects.loading) && <CircularProgress size={22} />}
      <Alert severity={isError ? "error" : "info"}>{notice}</Alert>
      {subjects.error && <Alert severity="error">{subjects.error}</Alert>}
      {(isError || subjects.error) && (
        <Button
          onClick={() => {
            subjects.reload();
            void load();
          }}
        >
          Повторить загрузку
        </Button>
      )}
      {page && !subjects.loading && !subjects.error && (
        <QaQueueWorkspace
          page={page}
          pendingCount={pending.length}
          pendingItems={pending.map((item) => ({
            id: item.id,
            projectId: item.projectId,
            label: `${item.projectKey} · ${item.title}`,
            status: item.status,
            href: requestHref(item.projectId, item.id),
          }))}
          busy={busy}
          onReload={() => {
            subjects.reload();
            void load();
          }}
          onLoadMore={() => void load()}
          {...(props.permissions?.includes("queue.order.move")
            ? {
                onMove: (entry: QaQueueWorkspaceEntry, placement: "FIRST" | "LAST") =>
                  void move(entry, placement),
              }
            : {})}
          labelFor={(entry) => {
            const item = subjects.items.find(
              (item) => item.id === entry.subject.id && item.projectId === entry.projectId,
            );
            return item
              ? `${item.projectKey} · ${item.title}`
              : `${props.projects?.find((project) => project.projectId === entry.projectId)?.projectKey ?? "Проект"} · ${entry.subject.kind === "WORK_ITEM" ? "Запрос" : "Обращение"}`;
          }}
          hrefFor={(entry) =>
            entry.subject.kind === "WORK_ITEM"
              ? requestHref(entry.projectId, entry.subject.id)
              : "/qa/intake-candidates"
          }
        />
      )}
    </Stack>
  );
}

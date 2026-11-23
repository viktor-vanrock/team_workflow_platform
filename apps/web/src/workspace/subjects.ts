import { useEffect, useState } from "react";

export interface WorkspaceSubject {
  readonly id: string;
  readonly kind: "WORK_ITEM" | "DRAFT" | "CANDIDATE";
  readonly projectId: string;
  readonly projectKey: string;
  readonly title: string;
  readonly status: string;
}
export function useWorkspaceSubjects(context: {
  apiUrl: string;
  accessToken: string;
  workspaceId: string;
}) {
  const [revision, setRevision] = useState(0);
  const reload = () => setRevision((value) => value + 1);
  const [items, setItems] = useState<readonly WorkspaceSubject[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { apiUrl, accessToken, workspaceId } = context;
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setItems([]);
        setError("");
      }
    });
    void fetch(`${apiUrl}/local/workspaces/${workspaceId}/subjects`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Нет доступа к запросам."
              : "Не удалось загрузить доступные задачи.",
          );
        return (await response.json()) as { items: WorkspaceSubject[] };
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setItems(body.items);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Не удалось загрузить доступные задачи.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, accessToken, workspaceId, revision]);
  return { items, error, loading, reload };
}
export const requestHref = (projectId: string, id: string) =>
  `/qa/requests?project=${encodeURIComponent(projectId)}&request=${encodeURIComponent(id)}`;
export const subjectLabel = (item: WorkspaceSubject) =>
  `${item.projectKey} · ${item.title} · ${{ WORK_ITEM: "Запрос", DRAFT: "Черновик", CANDIDATE: "Обращение" }[item.kind]}`;

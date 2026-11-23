export type DocumentState = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
export type DocumentAction = "save" | "submit" | "return" | "approve";
export interface DocumentActor {
  readonly id: string;
  readonly label: string;
}
export interface ServiceDocument {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly serviceDescription: string;
  readonly goal: string;
  readonly audience: string;
  readonly sources: readonly string[];
  readonly author: DocumentActor;
  readonly body: string;
  readonly state: DocumentState;
  readonly revision: number;
  readonly resourceVersion: number;
  readonly contentHash: string;
  readonly feedback: string;
  readonly approval: Readonly<{
    revision: number;
    contentHash: string;
    actor: DocumentActor;
    at: string;
  }> | null;
  readonly updatedAt: string;
}
export interface DocumentHistory {
  readonly action: "create" | DocumentAction;
  readonly actor: DocumentActor;
  readonly at: string;
  readonly document: ServiceDocument;
}
export interface DocumentDetail {
  readonly document: ServiceDocument;
  readonly history: readonly DocumentHistory[];
  readonly actions: readonly DocumentAction[];
}
export class DocumentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
export const serviceBrief = Object.freeze({
  serviceDescription:
    "ALPHA — демонстрационный web/API-сервис платформы. Пользователь создаёт запрос, получает его идентификатор и отслеживает состояние. В этом задании описывается учебный контракт сервиса, а не production API.",
  sources: [
    "Карточка ALPHA: reference web/API-проект существующего локального QA-стенда. Материалы скопированы в этот проект; доступ к QA-данным не предоставляется.",
    "Учебный контракт: POST /requests принимает title и description, возвращает 201 и id; GET /requests/{id} возвращает id, title и status (new, processing, done).",
    "Ошибки учебного контракта: 400 — пустой title, 401 — нет токена, 404 — запрос не найден. Токен передаётся в Authorization: Bearer. Учебный endpoint не предназначен для реальных вызовов.",
  ],
});
export function newDocument(
  input: Readonly<{
    id: string;
    workspaceId: string;
    projectId: string;
    author: DocumentActor;
    title: string;
    goal: string;
    audience: string;
    at: string;
    hash: string;
  }>,
): ServiceDocument {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    author: input.author,
    title: input.title,
    goal: input.goal,
    audience: input.audience,
    ...serviceBrief,
    body: "",
    state: "DRAFT",
    revision: 1,
    resourceVersion: 1,
    contentHash: input.hash,
    feedback: "",
    approval: null,
    updatedAt: input.at,
  };
}
export function documentActions(
  doc: ServiceDocument,
  actorId: string,
  permissions: readonly string[],
): readonly DocumentAction[] {
  const actions: DocumentAction[] = [];
  if (doc.author.id === actorId && doc.state !== "IN_REVIEW") {
    if (permissions.includes("docs.edit")) actions.push("save");
    if (permissions.includes("docs.submit") && doc.state !== "APPROVED") actions.push("submit");
  }
  if (permissions.includes("docs.review") && doc.state === "IN_REVIEW")
    actions.push("return", "approve");
  return actions;
}
export function changeDocument(
  doc: ServiceDocument,
  input: Readonly<{
    action: DocumentAction;
    actor: DocumentActor;
    expectedVersion: number;
    at: string;
    hash: string;
    body?: string;
    feedback?: string;
  }>,
): ServiceDocument {
  if (input.expectedVersion !== doc.resourceVersion)
    throw new DocumentError("DOC_VERSION_CONFLICT");
  const next = { ...doc, resourceVersion: doc.resourceVersion + 1, updatedAt: input.at };
  switch (input.action) {
    case "save": {
      if (doc.state === "IN_REVIEW") throw new DocumentError("DOC_STATE_CONFLICT");
      if (typeof input.body !== "string" || input.body.length > 100_000)
        throw new DocumentError("DOC_BODY_INVALID", 400);
      if (input.body === doc.body) return next;
      return {
        ...next,
        body: input.body,
        revision: doc.revision + 1,
        contentHash: input.hash,
        approval: null,
        state: doc.state === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : "DRAFT",
      };
    }
    case "submit":
      if (doc.state !== "DRAFT" && doc.state !== "CHANGES_REQUESTED")
        throw new DocumentError("DOC_STATE_CONFLICT");
      if (!doc.body.trim()) throw new DocumentError("DOC_EMPTY", 400);
      return { ...next, state: "IN_REVIEW", approval: null };
    case "return":
      if (doc.state !== "IN_REVIEW") throw new DocumentError("DOC_STATE_CONFLICT");
      if (!input.feedback?.trim() || input.feedback.length > 4000)
        throw new DocumentError("DOC_FEEDBACK_REQUIRED", 400);
      return {
        ...next,
        state: "CHANGES_REQUESTED",
        feedback: input.feedback.trim(),
        approval: null,
      };
    case "approve":
      if (doc.state !== "IN_REVIEW") throw new DocumentError("DOC_STATE_CONFLICT");
      return {
        ...next,
        state: "APPROVED",
        approval: {
          revision: doc.revision,
          contentHash: doc.contentHash,
          actor: input.actor,
          at: input.at,
        },
      };
  }
}

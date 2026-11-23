import { describe, expect, it } from "vitest";

import {
  changeDocument,
  newDocument,
} from "../../../packages/competency-tech-writing/src/domain.ts";

const writer = { id: "writer", label: "Писатель" };
const lead = { id: "lead", label: "Лид" };
const draft = () =>
  newDocument({
    id: "doc",
    workspaceId: "ws",
    projectId: "p",
    author: writer,
    title: "Руководство ALPHA",
    goal: "Первый запуск",
    audience: "Интеграторы",
    at: "2026-09-09T00:00:00Z",
    hash: "sha256:empty",
  });
const run = (
  doc: ReturnType<typeof draft>,
  action: "save" | "submit" | "return" | "approve",
  body = "",
  feedback = "",
) =>
  changeDocument(doc, {
    action,
    body,
    feedback,
    actor: action === "return" || action === "approve" ? lead : writer,
    at: "2026-09-09T01:00:00Z",
    expectedVersion: doc.resourceVersion,
    hash: `sha256:${body}`,
  });

describe("редакционный цикл", () => {
  it("сохраняет доработку и утверждает точную новую редакцию", () => {
    const first = run(draft(), "save", "Текст v1");
    const review = run(first, "submit");
    const returned = run(review, "return", "", "Добавьте ошибки");
    const second = run(returned, "save", "Текст v2 с ошибками");
    const approved = run(run(second, "submit"), "approve");
    expect(approved.approval).toMatchObject({
      revision: second.revision,
      contentHash: second.contentHash,
      actor: lead,
    });
    const changed = run(approved, "save", "Новая редакция");
    expect(changed.state).toBe("DRAFT");
    expect(changed.approval).toBeNull();
    expect(approved.body).toBe("Текст v2 с ошибками");
  });
  it("отклоняет пустую отправку, возврат без замечаний, редактирование на ревью и устаревшую версию", () => {
    expect(() => run(draft(), "submit")).toThrow("DOC_EMPTY");
    const review = run(run(draft(), "save", "Текст"), "submit");
    expect(() => run(review, "return")).toThrow("DOC_FEEDBACK_REQUIRED");
    expect(() => run(review, "save", "Другой текст")).toThrow("DOC_STATE_CONFLICT");
    expect(() =>
      changeDocument(review, {
        action: "approve",
        actor: lead,
        at: "now",
        expectedVersion: 1,
        hash: "hash",
      }),
    ).toThrow("DOC_VERSION_CONFLICT");
  });
});

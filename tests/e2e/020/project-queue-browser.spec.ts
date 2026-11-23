import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";

let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    define: {
      "import.meta.env.VITE_AWP_COMPOSITION": JSON.stringify("qa-jira-gitlab-mattermost-local"),
    },
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await server?.close();
});
const subjects = [
  {
    id: "A",
    kind: "WORK_ITEM",
    title: "Проверка авторизации",
    projectId: "alpha",
    projectKey: "ALPHA",
    status: "NEW",
  },
  {
    id: "B",
    kind: "WORK_ITEM",
    title: "Проверка оплаты",
    projectId: "beta",
    projectKey: "BETA",
    status: "NEW",
  },
  {
    id: "C",
    kind: "WORK_ITEM",
    title: "Проверка общей команды",
    projectId: "alpha",
    projectKey: "ALPHA",
    status: "NEW",
  },
];
async function install(page: Page, key = "owner.local", paged = false) {
  const persona = localPersonaCatalog.resolve(key);
  const projects = ["alpha", "beta"].map((id) => ({
    projectId: id,
    projectKey: id.toUpperCase(),
    permissions: persona.permissions,
  }));
  const writes: { body: Record<string, unknown>; key: string | undefined }[] = [];
  let stepped = false,
    uncertain = true,
    subjectsReads = 0;
  const session = () => ({
    accessToken: stepped ? "stepped" : key,
    persona: { key, label: persona.label },
    context: {
      workspaceId: "workspace",
      workspaceKey: "local-functional",
      projectId: "alpha",
      projectKey: "ALPHA",
    },
    projects,
    workspacePermissions: persona.permissions,
    grants: {
      roles: persona.roles,
      permissions: persona.permissions,
      classificationCeiling: persona.classificationCeiling,
    },
  });
  await page.route("**/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/personas"))
      return route.fulfill({ json: localPersonaCatalog.publicOptions() });
    if (path.endsWith("/subjects")) {
      subjectsReads++;
      return route.fulfill({ json: { items: subjects } });
    }
    if (path.endsWith("/step-up")) stepped = true;
    return route.fulfill({ json: session() });
  });
  await page.route("**/v1/workspaces/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path.endsWith("/registration-options"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          workspaceId: "workspace",
          workspaceName: "QA",
          owners: [
            { id: "person1", displayName: "Анна Иванова", username: "anna" },
            { id: "person2", displayName: "Борис Петров", username: "boris" },
          ],
          criticalities: [{ key: "STANDARD", label: "Стандартная", description: "Обычный проект" }],
          classifications: [
            { key: "INTERNAL", label: "Внутренние", description: "Для сотрудников" },
          ],
        },
      });
    if (path.endsWith("/projects") && route.request().method() === "POST") {
      writes.push({
        body: route.request().postDataJSON() as Record<string, unknown>,
        key: route.request().headers()["idempotency-key"],
      });
      if (!stepped) return route.fulfill({ status: 403, json: { code: "STEP_UP_REQUIRED" } });
      if (uncertain) {
        uncertain = false;
        return route.abort("failed");
      }
      if (!projects.some((p) => p.projectId === "created"))
        projects.push({
          projectId: "created",
          projectKey: "NEWAPP",
          permissions: persona.permissions,
        });
      return route.fulfill({ status: 201, json: { projectId: "created", stage: "DRAFT" } });
    }
    if (path.endsWith("/projects"))
      return route.fulfill({
        json: {
          items: projects.map((p) => ({
            id: p.projectId,
            key: p.projectKey,
            name: p.projectKey,
            stage: "DRAFT",
            capabilityMode: "MANUAL_ONLY",
          })),
        },
      });
    if (path.endsWith("/qa/queue")) {
      const selected = paged
        ? url.searchParams.has("cursor")
          ? [subjects[1]!]
          : [subjects[0]!]
        : [subjects[0]!];
      return route.fulfill({
        json: {
          workspaceId: "workspace",
          scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: "hash" },
          freshness: "CURRENT",
          comparatorRef: "queue-order@1.0.0",
          orderState: { resourceVersion: 1, queueEpoch: 1, baseVisibleSetHash: "hash" },
          visibleCounts: { total: paged ? 2 : 1, byStage: { BACKLOG: paged ? 2 : 1 } },
          items: selected.map((s) => ({
            ordinal: s.id === "A" ? 1 : 2,
            entry: {
              queueEntryId: s.id,
              projectId: s.projectId,
              stage: "BACKLOG",
              subject: { kind: "WORK_ITEM", id: s.id },
            },
          })),
          nextCursor: paged && !url.searchParams.has("cursor") ? "page2" : null,
        },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  return { writes, subjectsReads: () => subjectsReads };
}
async function login(page: Page, path: string, key: string) {
  await page.goto(origin + path);
  await page.getByLabel("Участник и роль").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
}
test("named project form preserves draft through MFA and unknown response and reuses request key", async ({
  page,
}) => {
  const state = await install(page);
  await login(page, "/projects", "owner.local");
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await page.getByLabel("Ключ проекта", { exact: true }).fill("NEWAPP");
  await page.getByLabel("Название проекта", { exact: true }).fill("Новый сервис");
  for (const label of [
    "Бизнес-ответственный",
    "Технический ответственный",
    "Ответственный QA",
    "Ответственный за безопасность",
    "Ответственный за эскалации",
  ])
    await page.getByLabel(label, { exact: true }).selectOption("person1");
  await page.getByLabel("Причина создания", { exact: true }).fill("Добавляем сервис общей команды");
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(
    page.getByText("Подтвердите вход и повторите создание.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Новый сервис");
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByText(/Не удалось получить ответ/)).toBeVisible();
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByText("Проект NEWAPP создан", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Настроить подключение", exact: true }),
  ).toHaveAttribute("href", "/projects/created/onboarding");
  expect(state.writes).toHaveLength(3);
  expect(new Set(state.writes.map((w) => w.key)).size).toBe(1);
  expect(state.writes[0]!.body.ownerIds).toEqual({
    business: "person1",
    technical: "person1",
    qa: "person1",
    security: "person1",
    escalation: "person1",
  });
  await page
    .getByRole("navigation", { name: "Путь страницы" })
    .getByRole("link", { name: "Проекты", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "NEWAPP", exact: true })).toBeVisible();
});
test("executor cannot enter project creation", async ({ page }) => {
  await install(page, "executor.alpha");
  await login(page, "/projects/new", "executor.alpha");
  await expect(page.getByRole("button", { name: "Создать проект", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Начать работу", exact: true })).toHaveCount(0);
});
for (const width of [390, 1440])
  test(`unified mixed and paged queue at ${width}px refreshes both sources`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await install(page, "executor.alpha", true);
    await login(page, "/qa/queue", "executor.alpha");
    const list = page.getByRole("list", { name: "Задачи очереди" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByText("Без приоритета", { exact: true })).toHaveCount(1);
    const summary = page.getByRole("region", { name: "Сводка очереди" });
    expect((await summary.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
    await expect(summary.getByText("Всего: 3", { exact: true })).toBeVisible();
    await expect(list.getByRole("link", { name: "Открыть задачу" }).nth(1)).toHaveAttribute(
      "href",
      "/qa/requests?project=beta&request=B",
    );
    await expect(page.getByRole("button", { name: "Переместить в начало" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const reads = state.subjectsReads();
    await page.getByRole("button", { name: "Обновить очередь", exact: true }).click();
    await expect.poll(state.subjectsReads).toBeGreaterThan(reads);
    await expect(list.getByRole("listitem")).toHaveCount(3);
  });

test("empty queue and failed source offer recovery without showing stale rows", async ({
  page,
}) => {
  await install(page, "executor.alpha");
  let fail = true;
  await page.route("**/local/workspaces/workspace/subjects", (route) =>
    route.fulfill(fail ? { status: 503, json: {} } : { json: { items: [] } }),
  );
  await page.route("**/workspaces/workspace/qa/queue?**", (route) =>
    route.fulfill({
      json: {
        workspaceId: "workspace",
        scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: "hash" },
        freshness: "CURRENT",
        comparatorRef: "queue-order@1.0.0",
        orderState: { resourceVersion: 1, queueEpoch: 1, baseVisibleSetHash: "hash" },
        visibleCounts: { total: 0, byStage: {} },
        items: [],
        nextCursor: null,
      },
    }),
  );
  await login(page, "/qa/queue", "executor.alpha");
  await expect(page.getByRole("button", { name: "Повторить загрузку", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Задачи очереди" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(page.getByText(/Очередь пока пуста/)).toBeVisible();
  await expect(page.getByText("Всего: 0", { exact: true })).toBeVisible();
});
test("stale second page restarts snapshot and does not duplicate or mislabel tasks", async ({
  page,
}) => {
  await install(page, "executor.alpha");
  let stale = true,
    firstPageReads = 0;
  await page.route("**/workspaces/workspace/qa/queue?**", (route) => {
    const second = new URL(route.request().url()).searchParams.has("cursor");
    if (second && stale) {
      stale = false;
      return route.fulfill({ status: 409, json: { code: "CURSOR_STALE" } });
    }
    if (!second) firstPageReads++;
    const subject = subjects[second ? 1 : 0]!;
    return route.fulfill({
      json: {
        workspaceId: "workspace",
        scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: "hash" },
        freshness: "CURRENT",
        comparatorRef: "queue-order@1.0.0",
        orderState: { resourceVersion: 2, queueEpoch: 1, baseVisibleSetHash: "hash" },
        visibleCounts: { total: 2, byStage: { BACKLOG: 2 } },
        items: [
          {
            ordinal: second ? 2 : 1,
            entry: {
              queueEntryId: subject.id,
              projectId: subject.projectId,
              stage: "BACKLOG",
              subject: { kind: "WORK_ITEM", id: subject.id },
            },
          },
        ],
        nextCursor: second ? null : "page2",
      },
    });
  });
  await login(page, "/qa/queue", "executor.alpha");
  await expect(
    page.getByRole("list", { name: "Задачи очереди" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(page.getByText("Без приоритета", { exact: true })).toHaveCount(1);
  expect(firstPageReads).toBe(2);
});

import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, type Route, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;
const send = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const choice = (id: string) => ({
  requestExtension: { workItemId: id, resourceVersion: 1 },
  currentRequestInputRevision: {
    title: `Проверка ${id}`,
    requestKind: "feature-validation",
    version: 1,
    contentHash: "sha256:abc",
    responseChannelResolution: { state: "MISSING" },
  },
  operationalReadiness: { assessmentState: "NOT_EVALUATED", normalizedStatus: "NEW" },
});
const detail = (id: string) => ({
  workItemId: id,
  operationalReadiness: { assessmentState: "NOT_EVALUATED", normalizedStatus: "NEW" },
  readinessAssessments: [],
  requiredSessionPlanHistory: null,
  sessions: [],
  evidenceManifestHistories: [],
  findings: [],
  verdicts: [],
});
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
async function install(
  page: Page,
  options: { empty?: boolean; pending?: boolean; deny?: boolean } = {},
) {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown> | undefined;
    headers: Record<string, string>;
  }[] = [];
  let drafts = 0;
  let confirmed = false;
  await page.route("**/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/local/personas")
      return send(route, [
        { key: "requester.alpha", label: "Requester · ALPHA" },
        { key: "executor.alpha", label: "Executor · ALPHA" },
        { key: "viewer.beta", label: "Viewer · BETA" },
      ]);
    if (path.endsWith("/subjects"))
      return send(
        route,
        {
          items:
            options.empty ||
            options.deny ||
            route.request().headers().authorization?.includes("viewer.beta")
              ? []
              : ["A", "B"].map((id) => ({
                  id,
                  kind: "WORK_ITEM",
                  projectId: "alpha",
                  projectKey: "ALPHA",
                  title: `Проверка ${id}`,
                  status: "NEW",
                })),
        },
        options.deny ? 403 : 200,
      );
    if (path === "/local/persona/exchange") {
      const key = route.request().postDataJSON().personaKey as string;
      return send(route, {
        accessToken: key,
        persona: { key, label: key === "viewer.beta" ? "Viewer · BETA" : "Requester · ALPHA" },
        context: {
          workspaceId: "workspace",
          workspaceKey: "local-functional",
          projectId: key === "viewer.beta" ? "beta" : "alpha",
          projectKey: key === "viewer.beta" ? "BETA" : "ALPHA",
        },
        projects: [
          {
            projectId: key === "viewer.beta" ? "beta" : "alpha",
            projectKey: key === "viewer.beta" ? "BETA" : "ALPHA",
            permissions:
              key === "viewer.beta"
                ? ["work-item.read"]
                : ["work-item.read", "qa.request.create", "qa.request.confirm", "qa.session.plan"],
          },
        ],
        grants: {
          roles: ["requester"],
          permissions:
            key === "viewer.beta"
              ? ["work-item.read", "queue.project.read"]
              : [
                  "work-item.read",
                  "qa.request.create",
                  "qa.request.confirm",
                  "queue.project.read",
                  "qa.session.plan",
                ],
          classificationCeiling: "INTERNAL",
        },
      });
    }
    return send(route, { workItems: [], commands: [], approvals: [], artifacts: [], model: {} });
  });
  await page.route("**/api/v1/workspaces/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({
      path,
      method: req.method(),
      body: req.postData() ? req.postDataJSON() : undefined,
      headers: req.headers(),
    });
    if (options.deny) return send(route, {}, 403);
    if (path.endsWith("/qa/backlog"))
      return send(route, {
        items: options.empty || path.includes("/beta/") ? [] : [choice("A"), choice("B")],
      });
    if (path.endsWith("/qa/intake")) {
      drafts++;
      return send(route, { draftId: `draft-${drafts}`, state: "DRAFT", resourceVersion: 1 });
    }
    if (path.endsWith("/qa-confirmation")) {
      confirmed = !options.pending;
      return send(route, { state: "PENDING" }, 202);
    }
    if (path.endsWith("/qa-status"))
      return send(
        route,
        confirmed
          ? { state: "CONFIRMED", command_state: "CONFIRMED", work_item_id: "B" }
          : { state: "PENDING", command_state: "PENDING" },
      );
    if (path.endsWith("/qa/detail")) return send(route, detail(path.includes("/A/") ? "A" : "B"));
    if (path.endsWith("/qa/sessions")) return send(route, []);
    return send(route, {});
  });
  return {
    calls,
    complete: () => {
      confirmed = true;
    },
  };
}
async function login(page: Page) {
  await page.goto(origin);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
}
test("entry explains role, navigation preserves session and back works", async ({ page }) => {
  await install(page);
  await login(page);
  await expect(page.getByRole("banner")).toBeInViewport();
  await expect(page.getByText("Опубликовать через Mock Hub", { exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  await expect(page).toHaveURL(/\/qa\/requests$/);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Как работать", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Как устроена работа" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Путь страницы" })
      .getByText("Как работать", { exact: true }),
  ).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/\/qa\/requests$/);
  await expect(page.getByRole("button", { name: "Начать работу", exact: true })).toHaveCount(0);
});
test("review freezes saved content and edit requires another draft; one explicit confirmation", async ({
  page,
}) => {
  const { calls } = await install(page);
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Новый запрос", exact: true })
    .click();
  await page.getByRole("link", { name: "ALPHA", exact: true }).click();
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("Первый текст");
  await page.getByRole("button", { name: "Проверить запрос", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Проверьте запрос перед отправкой" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Название", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("Обновлённый текст");
  await page.getByRole("button", { name: "Проверить запрос", exact: true }).click();
  await page.getByRole("button", { name: "Отправить запрос", exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: "Запрос создан" })).toBeVisible();
  const sends = calls.filter((call) => call.path.endsWith("/qa-confirmation"));
  expect(sends).toHaveLength(1);
  expect(sends[0]?.path).toContain("draft-2");
  expect(sends[0]?.headers["idempotency-key"]).toBe("qa-ui:draft-2");
  const payload = calls.filter((call) => call.path.endsWith("/qa/intake")).at(-1)?.body;
  expect(payload?.title).toBe("Обновлённый текст");
  expect(payload).not.toHaveProperty("blockers");
  expect(payload).not.toHaveProperty("goal");
  await page.getByRole("button", { name: "Открыть запрос", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Проверка B", exact: true })).toBeVisible();
});
test("pending is not success and manual refresh recovers without another confirmation", async ({
  page,
}) => {
  const state = await install(page, { pending: true });
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Новый запрос", exact: true })
    .click();
  await page.getByRole("link", { name: "ALPHA", exact: true }).click();
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("Ожидающий запрос");
  await page.getByRole("button", { name: "Проверить запрос", exact: true }).click();
  await page.getByRole("button", { name: "Отправить запрос", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Запрос отправляется" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Запрос создан" })).toHaveCount(0);
  state.complete();
  await page.getByRole("button", { name: "Проверить состояние", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Запрос создан" })).toBeVisible();
  expect(state.calls.filter((call) => call.path.endsWith("/qa-confirmation"))).toHaveLength(1);
});
test("request selection is explicit and switching on sessions targets the new request", async ({
  page,
}) => {
  const { calls } = await install(page);
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  expect(calls.some((call) => call.path.endsWith("/qa/detail"))).toBe(false);
  await page.getByRole("link", { name: "Открыть: Проверка A", exact: true }).click();
  await page.getByRole("tab", { name: "Проверки", exact: true }).click();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/A/qa/sessions"))).toBe(true);
  await page.getByLabel("Выбранный запрос").selectOption("B");
  await expect(page.getByRole("heading", { name: "Проверка B", exact: true })).toBeVisible();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/B/qa/sessions"))).toBe(true);
});
test("role change clears old project data and hides unavailable create", async ({ page }) => {
  await install(page);
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  await expect(page.getByText("Проверка A", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Сменить роль", exact: true }).click();
  await page.getByLabel("Участник и роль").selectOption("viewer.beta");
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Путь страницы" })).not.toContainText("ALPHA");
  await expect(page.getByText("Проверка A", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Новый запрос", exact: true }),
  ).toHaveCount(0);
});
test("empty requests offer a first action", async ({ page }) => {
  await install(page, { empty: true });
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  await expect(page.getByText("Пока нет запросов", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать первый запрос", exact: true }),
  ).toBeVisible();
});
test("mobile entry and keyboard navigation do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.goto(origin);
  await page.getByLabel("Участник и роль").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Начать работу", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Новый запрос", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "ALPHA", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Проверить вход с телефона");
  await page.getByRole("button", { name: "Проверить запрос", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Проверьте запрос перед отправкой" }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Отправить запрос", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Запрос создан", exact: true })).toBeVisible();
});

test("late response from previous request cannot replace current detail", async ({ page }) => {
  await install(page);
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolveBlocked) => {
    release = resolveBlocked;
  });
  await page.route("**/A/qa/detail", async (route) => {
    await blocked;
    await send(route, detail("A"));
  });
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  await page.getByRole("link", { name: "Открыть: Проверка A", exact: true }).click();
  await expect(page.getByLabel("Выбранный запрос")).toContainText("Проверка B");
  await page.getByLabel("Выбранный запрос").selectOption("B");
  await expect(page.getByRole("heading", { name: "Проверка B", exact: true })).toBeVisible();
  release?.();
  await page.getByRole("tab", { name: "Готовность", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Проверка A", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Проверка B", exact: true })).toBeVisible();
});

test("denied data clears list and can recover after authorization changes", async ({ page }) => {
  const options = { deny: true };
  await install(page, options);
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Запросы", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Нет доступа");
  await expect(page.getByText("Проверка A", { exact: true })).toHaveCount(0);
  options.deny = false;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Проверка A", { exact: true })).toBeVisible();
});

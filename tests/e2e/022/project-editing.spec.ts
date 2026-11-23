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

async function install(page: Page, canEdit = true, workspaceId = "qa") {
  let stepped = false,
    version = 2,
    name = "Исходный проект";
  const writes: {
    body: Record<string, unknown>;
    key?: string | undefined;
    match?: string | undefined;
  }[] = [];
  const permissions = [
    "project.catalog.read",
    "project.onboarding.read",
    ...(canEdit ? ["project.metadata.update"] : []),
  ];
  const session = () => ({
    accessToken: stepped ? "mfa" : "token",
    persona: { key: "owner.local", label: "Администратор · 1" },
    context: {
      workspaceId,
      workspaceKey: workspaceId === "docs" ? "local-tech-writing" : "local-functional",
      workspaceName: "Рабочая область",
      projectId: "p1",
      projectKey: "ALPHA",
    },
    projects: [{ projectId: "p1", projectKey: "ALPHA", permissions }],
    grants: { roles: ["project-registrar"], permissions, classificationCeiling: "RESTRICTED" },
    workspaces: [],
    workspacePermissions: [],
  });
  await page.route("**/local/**", (route) => {
    if (route.request().url().endsWith("/personas"))
      return route.fulfill({ json: localPersonaCatalog.publicOptions() });
    if (route.request().url().endsWith("/step-up")) stepped = true;
    return route.fulfill({ json: session() });
  });
  await page.route("**/v1/workspaces/**", (route) => {
    const req = route.request();
    if (req.url().endsWith("/metadata")) {
      if (req.method() === "PUT") {
        const body = req.postDataJSON();
        writes.push({
          body,
          key: req.headers()["idempotency-key"],
          match: req.headers()["if-match"],
        });
        if (!stepped) return route.fulfill({ status: 403, json: { code: "STEP_UP_REQUIRED" } });
        if (body.name === "Конфликт")
          return route.fulfill({
            status: 409,
            json: { code: "PROJECT_METADATA_VERSION_CONFLICT" },
          });
        version++;
        name = body.name;
        return route.fulfill({ json: { status: "APPLIED", version } });
      }
      return route.fulfill({
        json: {
          project: {
            id: "p1",
            workspaceId,
            key: "ALPHA",
            name,
            dataClassificationKey: "INTERNAL",
            ownerIds: ["owner"],
            version,
          },
          ownerOptions: [
            { id: "owner", displayName: "Иван Петров" },
            { id: "qa", displayName: "Мария Смирнова" },
          ],
          history: [
            {
              version,
              name,
              owners: ["Иван Петров"],
              actorName: "Администратор · 1",
              createdAt: "2026-09-10T09:00:00Z",
              reason: "Создание проекта",
            },
          ],
          historyLimit: 50,
          historyHasMore: false,
        },
      });
    }
    return route.fulfill({
      json: {
        items: [{ id: "p1", key: "ALPHA", name, stage: "DRAFT", capabilityMode: "MANUAL_ONLY" }],
      },
    });
  });
  await page.goto(origin + "/projects/p1/edit");
  await page.getByLabel("Участник и роль").selectOption("owner.local");
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  return writes;
}
test("prefills named owners, keeps draft during MFA, saves and refreshes history", async ({
  page,
}) => {
  const writes = await install(page);
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Исходный проект");
  await page.getByLabel("Название проекта", { exact: true }).fill("Новое имя");
  await page.getByLabel("Мария Смирнова", { exact: true }).check();
  await page.getByLabel("Причина изменения", { exact: true }).fill("Новая команда");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(
    page.getByText("Подтвердите вход и повторите сохранение.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Новое имя");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]!.key).toBe(writes[1]!.key);
  expect(writes[0]!.match).toBe('"2"');
});
test("conflict keeps draft until explicit reload, docs has common editor, mobile fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, true, "docs");
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await page.getByLabel("Название проекта", { exact: true }).fill("Конфликт");
  await page.getByLabel("Причина изменения", { exact: true }).fill("Черновик");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Конфликт");
  await page.getByRole("button", { name: "Загрузить актуальные данные", exact: true }).click();
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Исходный проект");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole("navigation", { name: "Путь страницы" })
    .getByRole("link", { name: "Проекты", exact: true })
    .click();
  await expect(page.getByRole("link", { name: "Редактировать проект", exact: true })).toBeVisible();
});
test("direct editor is denied without project capability", async ({ page }) => {
  await install(page, false);
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Раздел недоступен", { exact: true })).toBeVisible();
});

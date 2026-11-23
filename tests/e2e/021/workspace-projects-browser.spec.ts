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
const permissions = ["project.register", "project.catalog.read", "project.onboarding.read"];
const workspaces = [
  {
    workspaceId: "qa",
    workspaceKey: "local-functional",
    workspaceName: "Функциональная область",
    permissions,
  },
  {
    workspaceId: "docs",
    workspaceKey: "local-tech-writing",
    workspaceName: "Техническая документация",
    permissions,
  },
  {
    workspaceId: "isolated",
    workspaceKey: "local-isolated",
    workspaceName: "Изолированная область",
    permissions,
  },
];
async function install(page: Page, key = "owner.local", initial = "qa") {
  let workspaceId = initial,
    stepped = false,
    created = false;
  const requests: {
    path: string;
    method: string;
    body: Record<string, unknown> | null;
    key?: string;
  }[] = [];
  const allowed = key === "owner.local" ? workspaces : [workspaces[0]!];
  const session = () => ({
    accessToken: stepped ? "mfa" : "token",
    persona: { key, label: localPersonaCatalog.resolve(key).label },
    context: {
      ...workspaces.find((w) => w.workspaceId === workspaceId)!,
      projectId: workspaceId + "project",
      projectKey: workspaceId.toUpperCase(),
    },
    projects: [
      { projectId: workspaceId + "project", projectKey: workspaceId.toUpperCase(), permissions },
      ...(created && workspaceId === "docs"
        ? [{ projectId: "created", projectKey: "NEWAPP", permissions }]
        : []),
    ],
    workspaces: allowed,
    workspacePermissions: permissions,
    platformPermissions: ["platform.users.read", "platform.workspace-roles.manage"],
    grants: { roles: ["project-registrar"], permissions, classificationCeiling: "RESTRICTED" },
  });
  await page.route("**/local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/personas"))
      return route.fulfill({ json: localPersonaCatalog.publicOptions() });
    if (path.endsWith("/exchange"))
      workspaceId =
        (route.request().postDataJSON() as { workspaceId?: string }).workspaceId ?? workspaceId;
    if (path.endsWith("/step-up")) stepped = true;
    requests.push({ path, method: route.request().method(), body: null });
    return route.fulfill({ json: session() });
  });
  await page.route("**/v1/workspaces/**", (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method(),
      target = path.split("/workspaces/")[1]!.split("/")[0]!;
    requests.push({
      path,
      method,
      body: method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) : null,
      ...(route.request().headers()["idempotency-key"]
        ? { key: route.request().headers()["idempotency-key"] }
        : {}),
    });
    if (path.endsWith("/registration-options"))
      return route.fulfill({
        json: {
          workspaceName: workspaces.find((w) => w.workspaceId === target)!.workspaceName,
          owners: [
            {
              id: target + "owner",
              displayName: target === "docs" ? "Писатель документов" : "Участник QA",
            },
          ],
          criticalities: [{ key: "STANDARD", label: "Стандартная", description: "" }],
          classifications: [{ key: "INTERNAL", label: "Внутренние", description: "" }],
        },
      });
    if (path.endsWith("/projects") && method === "POST") {
      if (!stepped) return route.fulfill({ status: 403, json: { code: "STEP_UP_REQUIRED" } });
      created = true;
      return route.fulfill({ status: 201, json: { projectId: "created" } });
    }
    if (path.endsWith("/onboarding"))
      return route.fulfill({
        json: {
          project: {
            id: "created",
            key: "NEWAPP",
            name: "Новый сервис",
            owners: [],
            classificationKey: "INTERNAL",
          },
          stage: "DRAFT",
          capabilityMode: "MANUAL_ONLY",
          operationalState: "ACTIVE",
          version: 1,
          gates: [],
          probes: [],
          reasonCodes: [],
        },
      });
    return route.fulfill({
      json: {
        items: [
          {
            id: target + "project",
            key: target.toUpperCase(),
            name: "Проект области",
            stage: "DRAFT",
            capabilityMode: "MANUAL_ONLY",
          },
        ],
      },
    });
  });
  await page.goto(origin + "/projects/new");
  await page.getByLabel("Участник и роль").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  return requests;
}
const ownerLabels = [
  "Бизнес-ответственный",
  "Технический ответственный",
  "Ответственный QA",
  "Ответственный за безопасность",
  "Ответственный за эскалации",
];
test("destination controls owners, MFA retry and post-create domain navigation", async ({
  page,
}) => {
  const requests = await install(page);
  const target = page.getByLabel("Рабочая область проекта", { exact: true });
  await expect(target.locator("option")).toHaveCount(3);
  await page.getByLabel("Название проекта", { exact: true }).fill("Новый сервис");
  await page.getByLabel("Ключ проекта", { exact: true }).fill("NEWAPP");
  await page.getByLabel("Причина создания", { exact: true }).fill("Добавление сервиса");
  for (const label of ownerLabels)
    await page.getByLabel(label, { exact: true }).selectOption("qaowner");
  await target.selectOption("docs");
  for (const label of ownerLabels) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    await page.getByLabel(label, { exact: true }).selectOption("docsowner");
  }
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(
    page.getByText("Подтвердите вход и повторите создание.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(target).toHaveValue("docs");
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Новый сервис");
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/created\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Подключение проекта", exact: true }),
  ).toBeVisible();
  const writes = requests.filter((r) => r.method === "POST" && r.path.endsWith("/projects"));
  expect(writes).toHaveLength(2);
  expect(writes.every((r) => r.path.includes("/workspaces/docs/projects"))).toBe(true);
  expect(new Set(writes.map((r) => r.key)).size).toBe(1);
  expect(requests.some((r) => r.path.includes("/docs/") && !r.path.includes("/projects"))).toBe(
    false,
  );
  await page
    .getByRole("navigation", { name: "Путь страницы" })
    .getByRole("link", { name: "Проекты", exact: true })
    .click();
  await expect(page.getByRole("link", { name: "Новый проект", exact: true })).toBeVisible();
});
test("second administrator sees only their own destination", async ({ page }) => {
  await install(page, "integration-admin.alpha");
  await expect(
    page.getByLabel("Рабочая область проекта", { exact: true }).locator("option"),
  ).toHaveCount(1);
});
test("documentation registrar opens common project pages and home without document reads", async ({
  page,
}) => {
  const requests = await install(page, "owner.local", "docs");
  await expect(page.getByLabel("Рабочая область проекта", { exact: true })).toHaveValue("docs");
  await page.getByRole("navigation", { name: "Путь страницы" }).getByRole("link").first().click();
  await expect(page.getByRole("link", { name: "Новый проект", exact: true })).toBeVisible();
  expect(requests.some((r) => r.path.includes("/documents"))).toBe(false);
});

test("lost target membership after save keeps the form instead of linking in the wrong workspace", async ({
  page,
}) => {
  await install(page);
  await page.getByLabel("Рабочая область проекта", { exact: true }).selectOption("docs");
  await page.getByLabel("Название проекта", { exact: true }).fill("Новый сервис");
  await page.getByLabel("Ключ проекта", { exact: true }).fill("NEWAPP");
  await page.getByLabel("Причина создания", { exact: true }).fill("Добавление сервиса");
  for (const label of ownerLabels)
    await page.getByLabel(label, { exact: true }).selectOption("docsowner");
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page.getByText(/Дополнительное подтверждение входа действует/)).toBeVisible();
  await page.route("**/local/persona/exchange", (route) => {
    if ((route.request().postDataJSON() as { workspaceId?: string }).workspaceId === "docs")
      return route.fulfill({ status: 403, json: {} });
    return route.fallback();
  });
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByText(/Не удалось получить ответ/)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByRole("link", { name: "Настроить подключение", exact: true })).toHaveCount(
    0,
  );
});

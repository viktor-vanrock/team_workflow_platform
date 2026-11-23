import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";
import { workspaceRoleCatalog } from "../../../packages/runtime-composition/src/security/workspace-role-catalog.ts";

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
async function install(page: Page, admin = true) {
  let version = 0,
    roles: string[] = ["reader"],
    conflict = false;
  const writes: Record<string, unknown>[] = [];
  const key = admin ? "owner.local" : "integration-admin.alpha",
    persona = localPersonaCatalog.resolve(key);
  await page.route("**/local/**", (route) =>
    new URL(route.request().url()).pathname.endsWith("/personas")
      ? route.fulfill({ json: localPersonaCatalog.publicOptions() })
      : route.fulfill({
          json: {
            accessToken: key,
            persona: { key, label: persona.label },
            context: {
              workspaceId: "functional",
              workspaceKey: "local-functional",
              projectId: "alpha",
              projectKey: "ALPHA",
            },
            projects: [
              { projectId: "alpha", projectKey: "ALPHA", permissions: persona.permissions },
            ],
            workspacePermissions: persona.permissions,
            platformPermissions: admin
              ? ["platform.users.read", "platform.workspace-roles.manage"]
              : [],
            grants: {
              roles: persona.roles,
              permissions: persona.permissions,
              classificationCeiling: "RESTRICTED",
            },
          },
        }),
  );
  await page.route("**/api/v1/access/**", async (route) => {
    const url = new URL(route.request().url());
    if (!admin) return route.fulfill({ status: 403, json: { code: "PLATFORM_ACCESS_DENIED" } });
    if (url.pathname.endsWith("/workspaces"))
      return route.fulfill({
        json: [
          {
            id: "functional",
            name: "Функциональное тестирование",
            key: "local-functional",
            state: "ACTIVE",
            roles: workspaceRoleCatalog.filter((r) => r.domain !== "DOCS"),
          },
          {
            id: "docs",
            name: "Документация",
            key: "local-tech-writing",
            state: "ACTIVE",
            roles: workspaceRoleCatalog.filter((r) => r.domain === "DOCS"),
          },
        ],
      });
    if (url.pathname.endsWith("/users"))
      return route.fulfill({
        json: {
          items: [
            {
              principalId: "person",
              displayName: "Алексей Тестовый",
              username: "alexey",
              status: "ACTIVE",
            },
          ],
          nextOffset: null,
        },
      });
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (conflict)
        return route.fulfill({ status: 409, json: { code: "ACCESS_VERSION_CONFLICT" } });
      roles = body.roleKeys as string[];
      version++;
      return route.fulfill({ json: { version, roleKeys: roles } });
    }
    return route.fulfill({
      json: {
        principalId: "person",
        displayName: "Алексей Тестовый",
        username: "alexey",
        memberships: [
          {
            workspaceId: "functional",
            workspaceName: "Функциональное тестирование",
            state: "ACTIVE",
            version,
            roleKeys: roles,
            otherRoleKeys: [],
            classificationCeiling: "RESTRICTED",
          },
        ],
        platformRoles: admin
          ? [{ roleKey: "access-administrator", source: "LOCAL_FIRST_LOGIN", revokedAt: null }]
          : [],
        history: [],
      },
    });
  });
  await page.goto(`${origin}/admin/users`);
  await expect(page.getByText(/Первый вошедший пользователь/)).toBeVisible();
  await page.getByRole("combobox").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  return {
    writes,
    conflict: () => {
      conflict = true;
    },
  };
}
test("named multi-role editor sends an exact set and keeps draft through local step-up", async ({
  page,
}) => {
  const state = await install(page);
  await expect(page.getByText("Глобальный администратор", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Алексей Тестовый alexey" }).click();
  await expect(page.getByText(/первый локальный вход/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Читатель", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Заказчик", exact: true }).check();
  await page.getByRole("checkbox", { name: "Исполнитель QA", exact: true }).check();
  await page.getByLabel("Причина изменения").fill("Совместная работа на всех проектах");
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Исполнитель QA", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Сохранить роли", exact: true }).click();
  await expect(
    page.getByText("Назначения сохранены. Сервер уже использует новые права."),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    roleKeys: ["qa-executor", "requester"],
    expectedVersion: 0,
    classificationCeiling: "RESTRICTED",
  });
  expect(state.writes[0]!.requestKey).toMatch(/^[a-f0-9-]{36}$/);
  await page.getByLabel("Рабочая область", { exact: true }).selectOption("docs");
  await expect(
    page.getByRole("checkbox", { name: "Технический писатель", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Исполнитель QA", exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Путь страницы" })
    .getByRole("link", { name: "Архив ордена" })
    .click();
  await expect(page).toHaveURL(`${origin}/`);
});
test("conflict preserves unsaved selection and offers explicit refresh", async ({ page }) => {
  const state = await install(page);
  await page.getByRole("button", { name: "Алексей Тестовый alexey" }).click();
  state.conflict();
  await page.getByRole("checkbox", { name: "Заказчик", exact: true }).check();
  await page.getByLabel("Причина изменения").fill("Новая роль");
  await page.getByRole("button", { name: "Сохранить роли", exact: true }).click();
  await expect(page.getByText(/Назначения уже изменены другим администратором/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Заказчик", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Обновить назначения" })).toBeVisible();
});
test("workspace administrator cannot open the global screen or see its navigation", async ({
  page,
}) => {
  await install(page, false);
  await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Пользователи и доступы" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Алексей Тестовый alexey" })).toHaveCount(0);
});

test.describe("corporate first-login administration", () => {
  let corporateServer: ViteDevServer, corporateOrigin: string;
  test.beforeAll(async () => {
    corporateServer = await createServer({
      configFile: resolve("apps/web/vite.config.ts"),
      define: {
        "import.meta.env.VITE_AWP_AUTH_MODE": JSON.stringify("corporate"),
        "import.meta.env.VITE_AWP_API_URL": JSON.stringify(""),
      },
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
    await corporateServer.listen();
    corporateOrigin = `http://127.0.0.1:${(corporateServer.httpServer!.address() as AddressInfo).port}`;
  });
  test.afterAll(async () => {
    await corporateServer?.close();
  });
  async function corporateAccess(page: Page, administrator: boolean) {
    await page.route("**/api/v1/auth/session", (route) =>
      route.fulfill({
        json: {
          principalId: "first",
          subject: "first",
          csrfToken: "c".repeat(43),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      }),
    );
    await page.route("**/api/v1/access/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/me"))
        return route.fulfill({
          json: {
            displayName: "Первый пользователь",
            username: "first",
            memberships: [],
            status: administrator ? "ACTIVE" : "PENDING",
            platformPermissions: administrator
              ? ["platform.users.read", "platform.workspace-roles.manage"]
              : [],
          },
        });
      if (!administrator)
        return route.fulfill({ status: 403, json: { code: "PLATFORM_ACCESS_DENIED" } });
      if (path.endsWith("/workspaces")) return route.fulfill({ json: [] });
      if (path.endsWith("/users"))
        return route.fulfill({
          json: {
            items: [
              {
                principalId: "first",
                displayName: "Первый пользователь",
                username: "first",
                status: "ACTIVE",
              },
            ],
            nextOffset: null,
          },
        });
      return route.fulfill({
        json: {
          principalId: "first",
          displayName: "Первый пользователь",
          username: "first",
          memberships: [],
          history: [],
          platformRoles: [
            { roleKey: "access-administrator", source: "CORPORATE_FIRST_LOGIN", revokedAt: null },
          ],
        },
      });
    });
    await page.goto(`${corporateOrigin}/access`);
  }
  test("first administrator can open the directory and see the bootstrap source", async ({
    page,
  }) => {
    await corporateAccess(page, true);
    await expect(page.getByText(/Рабочие роли ещё не назначены/)).toHaveCount(0);
    await page.getByRole("link", { name: "Управлять пользователями и ролями" }).click();
    await expect(page).toHaveURL(`${corporateOrigin}/admin/users`);
    await page.getByRole("button", { name: "Первый пользователь first" }).click();
    await expect(
      page.getByText(/Глобальный администратор · первый корпоративный вход/),
    ).toBeVisible();
  });
  test("subsequent users wait for roles and cannot open administration", async ({ page }) => {
    await corporateAccess(page, false);
    await expect(page.getByText(/Рабочие роли ещё не назначены/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Управлять пользователями и ролями" })).toHaveCount(
      0,
    );
    await page.goto(`${corporateOrigin}/admin/users`);
    await expect(
      page.getByText("Для этого раздела нужна роль «Администратор доступов»."),
    ).toBeVisible();
  });
});

import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    define: {
      "import.meta.env.VITE_AWP_COMPOSITION": JSON.stringify("qa-jira-gitlab-mattermost-test"),
      "import.meta.env.VITE_AWP_AUTH_MODE": JSON.stringify("corporate"),
      "import.meta.env.VITE_AWP_API_URL": JSON.stringify(""),
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

const projectId = "77777777-7777-4777-8777-777777777777";
async function install(page: Page, pending = false) {
  let stepped = false,
    created = false,
    name = "Первый проект",
    version = 1;
  const writes: {
    body: unknown;
    key: string | undefined;
    csrf: string | undefined;
    bearer: string | undefined;
    match: string | undefined;
  }[] = [];
  const localRequests: string[] = [];
  await page.route("**/local/**", (r) => {
    localRequests.push(r.request().url());
    return r.abort();
  });
  await page.route("**/api/v1/auth/**", (route) => {
    if (route.request().url().endsWith("/login")) {
      const input = route.request().postDataJSON() as { returnPath: string; stepUp: boolean };
      expect(input.stepUp).toBe(true);
      expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(43));
      stepped = true;
      // Navigate away and reload the app, just as an OIDC callback does.
      return route.fulfill({ json: { authorizationUrl: `${origin}${input.returnPath}` } });
    }
    return route.fulfill({
      json: {
        principalId: "admin",
        subject: "qa-admin",
        csrfToken: stepped ? "b".repeat(43) : "a".repeat(43),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    });
  });
  await page.route("**/api/v1/access/me", (route) =>
    route.fulfill({
      json: {
        displayName: "Администратор QA",
        username: "qa-admin",
        status: pending ? "PENDING" : "ACTIVE",
        platformPermissions: pending
          ? []
          : ["platform.users.read", "platform.workspace-roles.manage"],
        memberships: pending
          ? []
          : [
              {
                workspaceId: "qa",
                workspaceName: "QA",
                state: "ACTIVE",
                roleKeys: ["system-administrator"],
              },
            ],
      },
    }),
  );
  await page.route("**/v1/workspaces/**", (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (["POST", "PUT"].includes(req.method())) {
      writes.push({
        body: req.postDataJSON(),
        key: req.headers()["idempotency-key"],
        csrf: req.headers()["x-csrf-token"],
        bearer: req.headers().authorization,
        match: req.headers()["if-match"],
      });
      if (!stepped) return route.fulfill({ status: 403, json: { code: "STEP_UP_REQUIRED" } });
      if (req.method() === "PUT") {
        name = req.postDataJSON().name;
        version++;
        return route.fulfill({ json: { status: "APPLIED", version } });
      }
      created = true;
      return route.fulfill({ status: 201, json: { projectId } });
    }
    if (path.endsWith("/registration-options"))
      return route.fulfill({
        json: {
          workspaceName: "QA",
          owners: [{ id: "admin", displayName: "Администратор QA" }],
          criticalities: [{ key: "STANDARD", label: "Стандартная", description: "" }],
          classifications: [{ key: "INTERNAL", label: "Внутренние", description: "" }],
        },
      });
    if (path.endsWith("/metadata"))
      return route.fulfill({
        json: {
          project: {
            id: projectId,
            workspaceId: "qa",
            key: "FIRST",
            name,
            version,
            ownerIds: ["admin"],
            dataClassificationKey: "INTERNAL",
          },
          ownerOptions: [{ id: "admin", displayName: "Администратор QA" }],
          history: [],
        },
      });
    return route.fulfill({
      json: {
        items: created
          ? [{ id: projectId, key: "FIRST", name, stage: "DRAFT", capabilityMode: "MANUAL_ONLY" }]
          : [],
      },
    });
  });
  return { writes, localRequests };
}
test("corporate admin creates a project without losing the form or retry key at login", async ({
  page,
}) => {
  const { writes, localRequests } = await install(page);
  await page.goto(`${origin}/access`);
  await expect(page.getByRole("heading", { name: "Рабочая область QA" })).toBeVisible();
  await page.goto(`${origin}/projects/new`);
  await page.getByLabel("Название проекта", { exact: true }).fill("Первый проект");
  await page.getByLabel("Ключ проекта", { exact: true }).fill("FIRST");
  await page.getByLabel("Причина создания", { exact: true }).fill("Приём первого проекта");
  for (const label of [
    "Бизнес-ответственный",
    "Технический ответственный",
    "Ответственный QA",
    "Ответственный за безопасность",
    "Ответственный за эскалации",
  ])
    await page.getByLabel(label, { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(
    page.getByText("Подтвердите вход и повторите создание.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Первый проект");
  await expect(page.getByLabel("Причина создания", { exact: true })).toHaveValue(
    "Приём первого проекта",
  );
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByText("Проект FIRST создан", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Настроить подключение" })).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]!.body).toEqual(writes[0]!.body);
  expect(writes[1]!.key).toBe(writes[0]!.key);
  expect(writes.map((w) => w.csrf)).toEqual(["a".repeat(43), "b".repeat(43)]);
  expect(writes.every((w) => w.bearer === undefined)).toBe(true);
  expect(localRequests).toEqual([]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("awp:corporate-project-create:admin")),
  ).toBeNull();
  await page.getByRole("link", { name: "К проектам", exact: true }).click();
  await expect(page.getByText("Первый проект", { exact: true })).toBeVisible();
});
test("edit resumes the same project, metadata version and fields after step-up", async ({
  page,
}) => {
  const { writes } = await install(page);
  await page.goto(`${origin}/projects/${projectId}/edit`);
  await page.getByLabel("Название проекта", { exact: true }).fill("Обновлённый проект");
  await page.getByLabel("Причина изменения", { exact: true }).fill("Уточнение карточки");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(
    page.getByText("Подтвердите вход и повторите сохранение.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/projects/${projectId}/edit`);
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue(
    "Обновлённый проект",
  );
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]!.key).toBe(writes[0]!.key);
  expect(writes[1]!.match).toBe('"1"');
  expect(writes[1]!.body).toEqual(writes[0]!.body);
});
test("pending employee cannot open the creation form", async ({ page }) => {
  await install(page, true);
  await page.goto(`${origin}/projects/new`);
  await expect(page.getByText("Доступ к рабочей области ещё не назначен.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Создать проект", exact: true })).toHaveCount(0);
});

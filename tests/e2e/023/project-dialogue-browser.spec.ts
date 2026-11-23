import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";
import type { ProjectDialogueView } from "../../../packages/competency-ui-sdk/src/project-dialogue.ts";

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
test("customer without projects completes Hermes dialogue, keeps draft through step-up and retries an uncertain creation", async ({
  page,
}) => {
  let dialogue: ProjectDialogueView | undefined,
    stepped = false,
    uncertain = true;
  const confirmations: string[] = [];
  const session = () => ({
    accessToken: stepped ? "stepped" : "customer",
    persona: { key: "requester.alpha", label: "Заказчик", kind: "HUMAN" },
    context: { workspaceId: "workspace", workspaceKey: "local-functional" },
    projects: [],
    workspacePermissions: ["project.request.create"],
    grants: {
      roles: ["requester"],
      permissions: ["project.request.create"],
      classificationCeiling: "INTERNAL",
    },
  });
  await page.route("**/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/personas"))
      return route.fulfill({ json: [{ key: "requester.alpha", label: "Заказчик" }] });
    if (path.endsWith("/step-up")) stepped = true;
    return route.fulfill({ json: session() });
  });
  await page.route("**/api/v1/workspaces/workspace/project-dialogues**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "GET")
      return route.fulfill({ json: { items: dialogue ? [dialogue] : [] } });
    const body = request.postDataJSON() as Record<string, unknown>;
    if (path.endsWith("/messages"))
      dialogue = {
        ...dialogue!,
        version: 2,
        state: "READY",
        draft: { key: "P-SHOP", name: "Магазин", purpose: "Проверка оплаты" },
        messages: [
          ...dialogue!.messages,
          { role: "user", text: String(body.message) },
          { role: "assistant", text: "Проверьте карточку проекта и подтвердите создание." },
        ],
      };
    else if (path.endsWith("/confirm")) {
      confirmations.push(String(body.requestKey));
      if (!stepped) return route.fulfill({ status: 403, json: { code: "STEP_UP_REQUIRED" } });
      dialogue = { ...dialogue!, state: "CREATED", version: 3, projectId: "created" };
      if (uncertain) {
        uncertain = false;
        return route.abort("failed");
      }
    } else
      dialogue = {
        schemaVersion: 1,
        id: String(body.id),
        workspaceId: "workspace",
        version: 1,
        state: "COLLECTING",
        draft: { key: "P-SHOP" },
        messages: [{ role: "assistant", text: "Как называется проект и для чего он нужен?" }],
      };
    return route.fulfill({ status: 201, json: dialogue });
  });
  await page.goto(origin + "/projects/hermes");
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await page.getByRole("button", { name: "Начать диалог", exact: true }).click();
  await page.getByLabel("Сообщение Hermes").fill("Создай проект «Магазин» для проверки оплаты");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Магазин", exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/awp-023-dialogue-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByText("Подтвердите вход и повторите создание проекта.")).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Не удалось связаться с сервером" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.getByRole("link", { name: "Открыть проект", exact: true })).toBeVisible();
  expect(confirmations).toHaveLength(3);
  expect(new Set(confirmations).size).toBe(1);
});

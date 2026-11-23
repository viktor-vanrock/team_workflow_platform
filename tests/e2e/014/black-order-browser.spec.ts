import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;

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

async function install(page: Page) {
  const foreignAssets: string[] = [];
  page.on("request", (request) => {
    if (
      ["font", "image", "stylesheet", "script"].includes(request.resourceType()) &&
      !request.url().startsWith(origin)
    )
      foreignAssets.push(request.url());
  });
  await page.route("**/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/subjects")) return route.fulfill({ json: { items: [] } });
    await route.fulfill({
      json: path.endsWith("/personas")
        ? [{ key: "requester.alpha", label: "Заказчик · ALPHA" }]
        : {
            accessToken: "fixture",
            persona: { key: "requester.alpha", label: "Заказчик · ALPHA" },
            context: {
              workspaceId: "workspace",
              workspaceKey: "local-functional",
              projectId: "alpha",
              projectKey: "ALPHA",
            },
            projects: [
              {
                projectId: "alpha",
                projectKey: "ALPHA",
                permissions: ["work-item.read", "qa.request.create", "queue.portfolio.read"],
              },
            ],
            grants: {
              roles: ["requester"],
              permissions: ["work-item.read", "qa.request.create", "queue.portfolio.read"],
              classificationCeiling: "INTERNAL",
            },
          },
    });
  });
  await page.route("**/api/v1/workspaces/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/qa/intake")
        ? { draftId: "draft-014", state: "DRAFT", resourceVersion: 1 }
        : { items: [] },
    });
  });
  return foreignAssets;
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgb = (color: string) => {
      const values = color.match(/[\d.]+/gu)?.map(Number) ?? [];
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    };
    const luminance = (values: number[]) =>
      values.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    const ancestry: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement)
      ancestry.unshift(current);
    let background = [255, 255, 255];
    for (const ancestor of ancestry) {
      const layer = rgb(getComputedStyle(ancestor).backgroundColor);
      background = background.map((channel, index) =>
        Math.round(layer[index]! * layer[3]! + channel * (1 - layer[3]!)),
      );
    }
    const foreground = rgb(getComputedStyle(element).color);
    const text = foreground
      .slice(0, 3)
      .map(
        (channel, index) => channel * foreground[3]! + background[index]! * (1 - foreground[3]!),
      );
    const light = luminance(text);
    const dark = luminance(background);
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  });
}

for (const width of [360, 1024, 1440]) {
  test(`archive controls remain readable and usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1024 ? 860 : 1000 });
    const foreignAssets = await install(page);
    await page.goto(origin);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    expect(
      await page.evaluate(async () => {
        await document.fonts.ready;
        return ["Cormorant Garamond", "Manrope"].every((family) =>
          [...document.fonts].some(
            (font) => font.family.replaceAll('"', "") === family && font.status === "loaded",
          ),
        );
      }),
    ).toBe(true);
    const role = page.getByLabel("Участник и роль");
    await expect(role).toBeEnabled();
    expect(await contrast(role)).toBeGreaterThanOrEqual(4.5);
    await role.focus();
    await expect(role).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Tab");
    const enter = page.getByRole("button", { name: "Начать работу", exact: true });
    await expect(enter).toBeFocused();
    expect(await contrast(enter)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("banner").getByText("Архив ордена", { exact: true })).toBeVisible();
    expect(
      await contrast(page.getByRole("button", { name: "Сменить роль" })),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(page.getByRole("link", { name: "Перейти →", exact: true }).first()),
    ).toBeGreaterThanOrEqual(4.5);
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    expect(
      await contrast(nav.getByRole("link", { name: "Обзор", exact: true })),
    ).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });
    await nav.getByRole("link", { name: "Новый запрос", exact: true }).click();
    await page.getByRole("link", { name: "ALPHA", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Название", exact: true });
    await title.fill("Проверить оплату и возврат для международного проекта с длинным названием");
    expect(await contrast(title)).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Проверить запрос", exact: true }).click();
    const review = page.getByRole("heading", { name: "Проверьте запрос перед отправкой" });
    await expect(review).toBeFocused();
    const reviewBounds = await review.boundingBox();
    const bannerBounds = await page.getByRole("banner").boundingBox();
    expect(reviewBounds!.y).toBeGreaterThanOrEqual(bannerBounds!.y + bannerBounds!.height);
    expect(await contrast(review)).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true });
    expect(foreignAssets).toEqual([]);
  });
}

test("Hermes keeps proposal semantics in the archive and pilot inherits the dark canvas", async ({
  page,
}, testInfo) => {
  await install(page);
  await page.goto(origin);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByText("Дополнительно", { exact: true })
    .click();
  await page.getByRole("link", { name: "Предложения помощника", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Предложения помощника", exact: true }),
  ).toBeVisible();
  const warning = page.getByRole("alert").filter({ hasText: "Hermes формирует" });
  await expect(warning).toBeVisible();
  expect(await contrast(warning)).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByLabel("Запрос или обращение")).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("hermes.png"), fullPage: true });
  await page.goto(`${origin}/pilot/recovery`);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByRole("main")).toHaveCSS("background-color", "rgb(17, 17, 19)");
});

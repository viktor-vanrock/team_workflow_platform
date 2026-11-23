import { expect, test } from "@playwright/test";

const webUrl = process.env.AWP_WEB_URL ?? "http://127.0.0.1:5173";

test("Feature 006 queue is independently navigable for an authorized lead", async ({ page }) => {
  await page.goto(`${webUrl}/qa/queue`);
  await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
  await page.getByLabel("Участник и роль").selectOption("lead.alpha");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(page.locator("header").getByText(/Руководитель QA/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Очередь проекта" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Все доступные проекты" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("C-secret");
});

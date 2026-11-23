import { expect, test } from "@playwright/test";

test("OIDC selection page exposes guided intake without chat authority", async ({ page }) => {
  await page.goto("/qa/mattermost-intake");
  await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(page.getByText("Управляемый приём запроса из Mattermost")).toBeVisible();
  await page.getByRole("button", { name: "Получить доступные проекты" }).click();
  await expect(page.getByRole("button", { name: /Local Functional \/ Alpha/u })).toBeVisible();
});
test("Candidate, Hermes and notification health routes remain independently reachable", async ({
  page,
}) => {
  for (const [path, label] of [
    ["/qa/intake-candidates", "Приём кандидатов"],
    ["/qa/hermes-proposals", "Введите точный ID субъекта."],
    ["/qa/notification-health", "Введите точный ID намерения уведомления."],
  ] as const) {
    await page.goto(path);
    if (path === "/qa/notification-health")
      await page.getByLabel("Участник и роль").selectOption("integration-admin.alpha");
    await page.getByRole("button", { name: "Начать работу" }).click();
    await expect(page.getByText(label)).toBeVisible();
  }
});

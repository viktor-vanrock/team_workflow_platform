import { expect, test } from "@playwright/test";

test.describe("005 visible automated validation HUMAN authority journey", () => {
  test.setTimeout(180_000);

  test("keeps bounded planning and HUMAN review authority visible", async ({ page }) => {
    await page.goto("/qa/automated-session");
    await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
    await page.getByLabel("Участник и роль").selectOption("executor.alpha");
    await page.getByRole("button", { name: "Начать работу" }).click();
    await expect(page.locator("header").getByText(/Исполнитель QA · QA 1/u)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Сеанс автоматизированной проверки" }),
    ).toBeVisible();
    const manualPlanner = page.getByRole("link", { name: "Открыть планировщик ручного сеанса" });
    await expect(manualPlanner).toBeVisible();
    await expect(manualPlanner).toHaveAttribute("href", "/qa/requests");
    await expect(
      page.getByText(/Техническая автоматизация не подписывает заключение QA/u),
    ).toBeVisible();
    await expect(
      page.getByText(/Отправляются только опубликованные версии наборов проверок/u),
    ).toBeVisible();
    await expect(page.getByLabel("Опубликованный набор проверок")).toBeVisible();
    await expect(page.getByLabel("Неизменяемая цель")).toBeVisible();
    await expect(page.getByLabel("Непроизводственная среда")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Создать неизменяемый готовый сеанс" }),
    ).toBeDisabled();
  });
});

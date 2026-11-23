import { expect, test } from "@playwright/test";

test("local persona, Dummy and connector Approval walkthrough", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await page.goto("/");
  await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Рабочее пространство QA" })).toBeVisible();

  await page.getByLabel("Участник и роль").selectOption("requester.alpha");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(page.locator("header").getByText("Заказчик · ALPHA", { exact: true })).toBeVisible();
  await page.getByText("Дополнительно", { exact: true }).click();
  await page.getByRole("link", { name: "Инструменты разработки", exact: true }).click();
  await page.getByLabel("Название примера").fill(`Playwright ${suffix}`);
  await page.getByLabel("Сообщение").first().fill("Тестовый запрос из браузера");
  await page.getByRole("button", { name: "Создать рабочую задачу" }).click();
  await expect(page.getByText(/Тестовая рабочая задача .* создана/u)).toBeVisible();
  await expect(page.getByText(`Playwright ${suffix}`, { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Сменить роль", exact: true }).click();
  await page.getByLabel("Участник и роль").selectOption("executor.alpha");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(
    page.locator("header").getByText("Исполнитель QA · QA 1", { exact: true }),
  ).toBeVisible();
  await page.getByText("Дополнительно", { exact: true }).click();
  await page.getByRole("link", { name: "Инструменты разработки", exact: true }).click();
  await page.getByLabel("Ключ записи").fill(`pw-direct-${suffix}`);
  await page.getByRole("button", { name: "Опубликовать через Mock Hub" }).click();
  await expect(page.getByText("Команда: Подтверждено; количество эффектов: 1.")).toBeVisible();

  await page.getByLabel("Ключ записи").fill(`pw-approval-${suffix}`);
  await page.getByLabel("Требовать точное согласование").check();
  await page.getByRole("button", { name: "Опубликовать через Mock Hub" }).click();
  await expect(
    page.getByText("Команда: Ожидает согласования; количество эффектов: 0."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Сменить роль", exact: true }).click();
  await page.getByLabel("Участник и роль").selectOption("owner.local");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(
    page.locator("header").getByText("Владелец рабочей области", { exact: true }),
  ).toBeVisible();
  const ownerOverview = page.waitForResponse((response) =>
    response.url().endsWith("/local/walking-skeleton"),
  );
  await page.getByText("Дополнительно", { exact: true }).click();
  await page.getByRole("link", { name: "Инструменты разработки", exact: true }).click();
  const { artifacts } = (await (await ownerOverview).json()) as {
    artifacts: { file_name: string }[];
  };
  await page.getByRole("button", { name: "Согласовать" }).first().click();
  await expect(page.getByText(/использовано ровно один раз/u)).toBeVisible();

  await expect(page.getByRole("heading", { name: "Внешние CI-артефакты" })).toBeVisible();
  if (artifacts.length === 0) {
    await expect(page.getByText("Нет доступных GitLab артефактов")).toBeVisible();
  } else {
    for (const artifact of artifacts)
      await expect(page.getByText(artifact.file_name, { exact: false })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Скачать" })).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

test("authorized QA Lead inspects full-QA promotion and fallback in Chromium", async ({ page }) => {
  await page.setContent(
    `<main aria-label="Рабочая область подключения проекта"><h1>Подключение проекта · Проект A</h1><p>Теневой режим</p><p>Полный QA</p><h2>Приёмка набора автоматизации</h2><p>suite@1 · Принято</p><p>Выполнение тестов · Доступно</p><h2>История привязок и откат</h2><p>binding@1 · Выведено из эксплуатации</p><p>binding@2 · Опубликовано · клонировано из binding@1</p><h2>История режимов возможностей</h2><p>Только ручная проверка → Полный QA · Режим возможностей проекта изменён</p><div role="alert">Доставка через Mattermost работает с ограничениями. Веб-интерфейс и устойчивая очередь уведомлений доступны; режим возможностей QA не изменён.</div></main>`,
  );
  await expect(page.getByText("Полный QA", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Приёмка набора автоматизации" })).toBeVisible();
  await expect(page.getByText(/Только ручная проверка → Полный QA/u)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("режим возможностей QA не изменён");
  await expect(page.locator("body")).not.toContainText(/password|token|cookie|secretValue/iu);
});

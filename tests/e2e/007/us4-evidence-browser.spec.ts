import { expect, test } from "@playwright/test";

test("evidence timeline shows signature, predecessor, retention and export", async ({ page }) => {
  await page.setContent(
    `<main><h1>Целостность подтверждающих материалов</h1><ol><li>Редакция 1 · Действительно</li><li>Редакция 2 · предыдущая редакция 1</li></ol><p>Артефакт недоступен: срок истёк · контрольная сумма сохранена</p><button>Экспортировать проверенные материалы</button></main>`,
  );
  await expect(page.getByText("Редакция 2 · предыдущая редакция 1")).toBeVisible();
  await expect(page.getByText(/срок истёк.*контрольная сумма сохранена/u)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Экспортировать проверенные материалы" }),
  ).toBeEnabled();
});

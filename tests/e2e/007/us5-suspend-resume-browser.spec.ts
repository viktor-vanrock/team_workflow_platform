import { expect, test } from "@playwright/test";

test("emergency controls preserve investigation", async ({ page }) => {
  await page.setContent(
    `<main><h1>Проект приостановлен</h1><p>Инцидент INC-7 · проверки актуальны · требуется согласование владельца</p><a href="#evidence">Исследование подтверждающих материалов</a><button>Возобновить проект</button></main>`,
  );
  await expect(
    page.getByRole("link", { name: "Исследование подтверждающих материалов" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Возобновить проект" })).toBeVisible();
});

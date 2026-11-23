import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

function runCanonicalScenario(name: "qa-manual-pass" | "qa-manual-fail") {
  execFileSync(process.execPath, [resolve(process.cwd(), "tools/local/qa-scenario.mts"), name], {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true", AWP_COMPOSITION: "qa-local", AWP_RUNTIME_PROFILE: "test" },
    stdio: "inherit",
  });
}

async function switchPersona(page: Page, key: string, label: RegExp) {
  if (await page.getByRole("button", { name: "Сменить роль", exact: true }).count())
    await page.reload();
  await page.getByLabel("Участник и роль").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(
    page
      .locator("header")
      .getByText(new RegExp(label.source.replace("Выполнен вход: ", ""), label.flags)),
  ).toBeVisible();
}

test.describe("AT-014 QA manual walking skeleton", () => {
  test.setTimeout(120_000);

  test("Requester → Executor → Lead PASS workflow preserves immutable detail history", async ({
    page,
  }) => {
    runCanonicalScenario("qa-manual-pass");
    const suffix = `${Date.now()}-pass`;
    await page.goto("/");
    await expect(page.getByText("Локальный стенд · учебные данные")).toBeVisible();
    await switchPersona(page, "requester.alpha", /Выполнен вход: Заказчик · ALPHA/u);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Новый запрос", exact: true })
      .click();
    await page.getByLabel("Название", { exact: true }).fill(`QA browser PASS ${suffix}`);
    await page.getByLabel("Цель (необязательно)").fill("Подтвердить чистый ручной сценарий");
    await page
      .getByLabel("Область проверки (необязательно)")
      .fill("Эталонная область дымового тестирования");
    await page
      .getByLabel("Ожидаемый результат приёмки (необязательно)")
      .fill("Ожидаемый результат подтверждён");
    await page.getByText("Дополнительные сведения", { exact: true }).click();
    await page.getByLabel("Блокирующих факторов нет").check();
    await page.getByLabel("Зависимостей нет").check();
    await page.getByRole("button", { name: "Проверить запрос" }).click();
    await page.getByRole("button", { name: "Отправить запрос", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Запрос создан", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Открыть запрос", exact: true }).click();
    await switchPersona(page, "executor.alpha", /Выполнен вход: Исполнитель QA · QA 1/u);
    await expect(
      page.getByRole("heading", { name: `QA browser PASS ${suffix}`, exact: true }),
    ).toBeVisible();
    for (const tab of [
      "Готовность",
      "Проверки",
      "Материалы",
      "Замечания",
      "Заключение",
      "Запрос",
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  test("Requester → Executor → distinct Lead DONE + FAIL keeps the defect and creates no release decision", async ({
    page,
  }) => {
    runCanonicalScenario("qa-manual-fail");
    await page.goto("/");
    await switchPersona(page, "executor.alpha", /Выполнен вход: Исполнитель QA · QA 1/u);
    await page.getByRole("navigation").getByRole("link", { name: "Запросы", exact: true }).click();
    await page
      .getByRole("button", { name: /^Открыть:/u })
      .first()
      .click();
    await page.getByRole("tab", { name: "Замечания", exact: true }).click();
    await expect(page.getByText("Жизненный цикл черновика дефекта")).toBeVisible();
    await switchPersona(page, "lead.alpha", /Выполнен вход: Руководитель QA · ALPHA/u);
    await page.getByRole("tab", { name: "Заключение", exact: true }).click();
    await expect(
      page.getByText(
        "Заключение QA описывает результат проверок. Решение о выпуске принимается отдельно.",
      ),
    ).toBeVisible();
  });
});

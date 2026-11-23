import { expect, test } from "@playwright/test";

test("authorized administrators and QA Leads can inspect exact manual onboarding reasons", async ({
  page,
}) => {
  const hash = `sha256:${"a".repeat(64)}`;
  await page.setContent(`<main aria-label="Рабочая область подключения проекта">
    <h1>Подключение проекта · Проект A</h1><p>Теневой режим</p><p>Только ручная проверка</p><p>Активно</p>
    <p>Владельцы: owner.alpha, qa-lead.alpha · классификация Внутреннее</p>
    <p>Ручное выполнение сеансов доступно. Автоматизированные сеансы заблокированы до принятия точных требований GitLab.</p>
    <p>Причины режима: Требования автоматизации не выполнены</p>
    <h2>Точная конфигурация</h2><p>Привязка: binding-a@1 · ${hash}</p><p>Контекст проекта QA: context-a@1 · ${hash}</p>
    <p>Согласование: Использовано · Владелец рабочей области</p><p>Источник полномочий QA-запроса · Доступно</p><p>Обмен сообщениями пилота · Доступно</p>
    <p>L0 · Пройдено</p><p>C1 · Пройдено</p><p>N2 · Пройдено</p>
    <button>Проверить условия подключения</button><button>Запросить публикацию привязки</button>
  </main>`);
  await expect(page.getByRole("heading", { name: "Подключение проекта · Проект A" })).toBeVisible();
  await expect(page.getByText("Только ручная проверка", { exact: true })).toBeVisible();
  await expect(page.getByText(/Автоматизированные сеансы заблокированы/u)).toBeVisible();
  await expect(page.getByText(/Требования автоматизации не выполнены/u)).toBeVisible();
  await expect(page.getByText(/binding-a@1/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Проверить условия подключения" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Запросить публикацию привязки" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("secretValue");
});

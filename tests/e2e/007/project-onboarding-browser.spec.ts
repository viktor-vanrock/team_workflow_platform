import { expect, test } from "@playwright/test";

test("US1-US5 onboarding, scope, evidence and suspension are independently navigable", async ({
  page,
}) => {
  const digest = `sha256:${"a".repeat(64)}`;
  await page.route("http://awp.local/**", async (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<main aria-label="Рабочая область подключения проекта">
      <h1>Подключение проекта A</h1>
      <nav><a href="#onboarding">Подключение</a><a href="#automation">Автоматизация</a><a href="#evidence">Подтверждения</a><a href="#operations">Операции</a></nav>
      <section id="onboarding"><h2>Подключение</h2><p>Теневой режим &middot; Полный QA &middot; Активно</p><p>Привязка binding-a@2 &middot; ${digest}</p><p>Контекст QA context-a@1 &middot; ${digest}</p></section>
      <section id="automation"><h2>Автоматизация</h2><p>Набор suite-a@1 &middot; Принято</p><p>Согласование владельца &middot; Использовано</p><p>Проверка выполнения тестов &middot; Актуально</p></section>
      <section id="evidence"><h2>Подтверждения</h2><p>Редакция манифеста 2 &middot; подпись действительна</p><p>Срок хранения истёк &middot; контрольная сумма сохранена</p><button>Экспортировать проверенные материалы</button></section>
      <section id="operations"><h2>Операции</h2><div role="alert">Проект приостановлен &middot; инцидент INC-007</div><p>Исследование остаётся доступным &middot; для возобновления требуется согласование другого владельца</p><button>Возобновить проект</button></section>
    </main>`,
    }),
  );
  await page.goto("http://awp.local/projects/project-a/onboarding");
  for (const [link, heading] of [
    ["Подключение", "Подключение"],
    ["Автоматизация", "Автоматизация"],
    ["Подтверждения", "Подтверждения"],
    ["Операции", "Операции"],
  ] as const) {
    await page.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Теневой режим · Полный QA · Активно/u)).toBeVisible();
  await expect(page.getByText(/binding-a@2/u)).toContainText(digest);
  await expect(page.getByText(/подпись действительна/u)).toBeVisible();
  await expect(page.getByText(/Срок хранения истёк · контрольная сумма сохранена/u)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("приостановлен");
  await expect(page.locator("body")).not.toContainText(
    /Project C|forbiddenProject|password|token|cookie|privateKey/iu,
  );
});

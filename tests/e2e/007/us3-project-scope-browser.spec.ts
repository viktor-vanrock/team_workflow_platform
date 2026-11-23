import { expect, test } from "@playwright/test";

test("authorized Project navigation disappears after entitlement revocation", async ({ page }) => {
  await page.route("http://awp.local/**", async (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<main><h1>Доступные проекты</h1><nav><a id="project-a" href="/projects/a/onboarding">Проект A</a><a href="/projects/b/onboarding">Проект B</a></nav><section id="route">Подключение проекта A</section><button id="revoke">Отозвать доступ к проекту A</button><script>document.querySelector('#revoke').addEventListener('click',()=>{document.querySelector('#project-a').remove();document.querySelector('#route').textContent='Ресурс проекта недоступен';history.replaceState({},'', '/projects');});</script></main>`,
    }),
  );
  await page.goto("http://awp.local/projects/a/onboarding");
  await expect(page.getByRole("link", { name: "Проект A" })).toBeVisible();
  await page.getByRole("button", { name: "Отозвать доступ к проекту A" }).click();
  await expect(page.getByRole("link", { name: "Проект A" })).toHaveCount(0);
  await expect(page.getByText("Ресурс проекта недоступен")).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/u);
  await expect(page.locator("body")).not.toContainText(/Secret C|forbiddenProject|totalCount/u);
});

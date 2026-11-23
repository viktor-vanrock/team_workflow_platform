import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = process.env.AWP_017_WEB_URL ?? "http://localhost:55173";
const api = process.env.AWP_017_API_URL ?? "http://localhost:5300";
const roles = (await (await fetch(`${api}/local/personas`)).json()) as {
  key: string;
  label: string;
}[];
const browser = await chromium.launch({ headless: true });
const report: unknown[] = [];
try {
  for (const role of roles) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures: { path: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().startsWith(api))
        failures.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(origin);
    await page.getByLabel("Участник и роль").selectOption(role.key);
    await page.getByRole("button", { name: "Начать работу", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    await expect(page.getByLabel("Рабочий проект", { exact: true })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    if (await nav.getByText("Дополнительно", { exact: true }).count())
      await nav.getByText("Дополнительно", { exact: true }).click();
    const links = await nav.locator("a[href]").evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.textContent?.trim(),
        href: element.getAttribute("href")!,
      })),
    );
    const pages: unknown[] = [];
    for (const link of links.filter(
      (link) => !["/developer", "/qa/new", "/qa/mattermost-intake"].includes(link.href),
    )) {
      await page.evaluate((href) => {
        history.pushState(null, "", href);
        dispatchEvent(new PopStateEvent("popstate"));
      }, link.href);
      await expect(
        page.getByRole("navigation", { name: "Путь страницы" }).locator('[aria-current="page"]'),
      ).toHaveCount(1);
      await expect(page.getByRole("main")).not.toContainText("Раздел недоступен");
      if (link.href === "/qa/queue")
        await expect(page.getByLabel("Разрешённая очередь QA")).toBeVisible({ timeout: 15000 });
      if (link.href === "/qa/requests")
        await expect(page.getByLabel("Запросы всех проектов")).toBeVisible({ timeout: 15000 });
      if (link.href === "/qa/hermes-proposals")
        await expect(page.getByLabel("Запрос или обращение")).toBeVisible({ timeout: 15000 });
      if (["/projects/onboarding", "/qa/automated-session"].includes(link.href)) {
        const choice = page.getByRole("main").getByRole("link", { name: "ALPHA", exact: true });
        if (await choice.count()) await choice.click();
      }
      const detailActions: unknown[] = [];
      if (
        link.href === "/qa/requests" &&
        (await page.getByRole("link", { name: /^Открыть:/ }).count())
      ) {
        await page
          .getByRole("link", { name: /^Открыть:/ })
          .first()
          .click();
        await expect(page.getByRole("tab", { name: "Запрос", exact: true })).toBeVisible({
          timeout: 15000,
        });
        for (const name of ["Статус в Jira", "Замечания", "Заключение"]) {
          await page.getByRole("tab", { name, exact: true }).click();
          await expect(page.getByRole("tabpanel")).toBeVisible();
          detailActions.push({
            tab: name,
            buttons: await page
              .getByRole("tabpanel")
              .locator("button")
              .evaluateAll((elements) =>
                elements.map((element) => ({
                  text: element.textContent?.trim(),
                  disabled: (element as HTMLButtonElement).disabled,
                })),
              ),
          });
        }
      }
      pages.push({ path: link.href, label: link.label, detailActions });
    }
    const forbidden = role.key.endsWith(".docs")
      ? "/qa/queue"
      : role.key === "worker.local" || role.key === "outsider.delta"
        ? "/projects"
        : !["requester.alpha"].includes(role.key)
          ? "/qa/new"
          : "/docs/documents";
    await page.evaluate((href) => {
      history.pushState(null, "", href);
      dispatchEvent(new PopStateEvent("popstate"));
    }, forbidden);
    await expect(page.getByRole("main")).toContainText(/Раздел недоступен|Такого раздела нет/);
    report.push({ key: role.key, label: role.label, pages, forbidden, failures });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    "specs/017-workspace-wide-flow/live-ui.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    report.map((row) => {
      const item = row as { key: string; pages: unknown[]; failures: unknown[] };
      return { key: item.key, pages: item.pages.length, failures: item.failures };
    }),
    null,
    2,
  ),
);

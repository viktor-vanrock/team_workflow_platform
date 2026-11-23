import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

import type { LocalSession } from "../../apps/web/src/workspace/navigation.ts";

const api = "http://localhost:5300",
  origin = "http://localhost:55173",
  output = "specs/021-admin-workspace-projects";
const options = (await (await fetch(`${api}/local/personas`)).json()) as {
  key: string;
  label: string;
}[];
expect(options).toHaveLength(9);
async function session(key: string, workspaceId?: string): Promise<LocalSession> {
  const response = await fetch(`${api}/local/persona/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaKey: key, ...(workspaceId ? { workspaceId } : {}) }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<LocalSession>;
}
const admin = await session("owner.local"),
  workspaces = admin.workspaces!;
expect(workspaces).toHaveLength(3);
const results: unknown[] = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const option of options) {
    const current = await session(option.key);
    expect(current.workspaces).toHaveLength(option.key === "owner.local" ? 3 : 1);
    const statuses = [];
    for (const workspace of workspaces) {
      const read = await fetch(
        `${api}/api/v1/workspaces/${workspace.workspaceId}/projects/registration-options`,
        { headers: { authorization: `Bearer ${current.accessToken}` } },
      );
      const allowed =
        option.key === "owner.local" ||
        (option.key === "integration-admin.alpha" &&
          workspace.workspaceId === current.context.workspaceId);
      expect(read.status).toBe(allowed ? 200 : 404);
      statuses.push({ workspace: workspace.workspaceName, status: read.status });
      if (option.key === "owner.local") {
        const scoped = await session(option.key, workspace.workspaceId);
        if (workspace.workspaceKey !== "local-functional") {
          expect(new Set(scoped.grants.permissions)).toEqual(
            new Set([
              "project.register",
              "project.catalog.read",
              "project.onboarding.read",
              "project.metadata.update",
            ]),
          );
          expect(scoped.grants.roles).toEqual(["project-registrar"]);
        }
        const catalog = await fetch(`${api}/v1/workspaces/${workspace.workspaceId}/projects`, {
          headers: { authorization: `Bearer ${scoped.accessToken}` },
        });
        expect(catalog.status).toBe(200);
      }
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const isAdmin = ["owner.local", "integration-admin.alpha"].includes(option.key);
    await page.goto(
      origin + (isAdmin ? "/projects/new" : option.key.endsWith(".docs") ? "/" : "/qa/queue"),
    );
    await page.getByLabel("Участник и роль").selectOption(option.key);
    await page.getByRole("button", { name: "Начать работу", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    if (isAdmin) {
      const selector = page.getByLabel("Рабочая область проекта", { exact: true });
      await expect(selector.locator("option")).toHaveCount(option.key === "owner.local" ? 3 : 1);
      if (option.key === "owner.local") {
        await expect(
          page.getByRole("button", { name: "Создать проект", exact: true }),
        ).toBeEnabled();
        await page.screenshot({ path: `${output}/project-workspaces.png`, fullPage: true });
        const docs = workspaces.find((w) => w.workspaceKey === "local-tech-writing")!;
        await selector.selectOption(docs.workspaceId);
        await expect(
          page.getByLabel("Ответственный QA", { exact: true }).locator("option"),
        ).toHaveCount(4);
        await page.setViewportSize({ width: 390, height: 1000 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({ path: `${output}/project-workspaces-mobile.png`, fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByLabel("Предметная область").selectOption(docs.workspaceId);
        await expect(page.getByRole("link", { name: "Новый проект", exact: true })).toBeVisible();
        await expect(page.getByText("Каталог проектов недоступен.", { exact: false })).toHaveCount(
          0,
        );
        await page.screenshot({ path: `${output}/documentation-projects.png`, fullPage: true });
      }
    } else
      await expect(page.getByRole("button", { name: "Создать проект", exact: true })).toHaveCount(
        0,
      );
    expect(errors).toEqual([]);
    results.push({ persona: option.label, registrationOptions: statuses, ui: "PASS" });
    await context.close();
  }
  await writeFile(
    `${output}/live-checks.json`,
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log(
    `PASS: ${results.length} personas, ${workspaces.length} workspaces, no live project writes`,
  );
} finally {
  await browser.close();
}

import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

import type { LocalSession } from "../../apps/web/src/workspace/navigation.ts";

const api = "http://localhost:5300",
  origin = "http://localhost:55173",
  output = "specs/022-project-editing";
const options = (await (await fetch(`${api}/local/personas`)).json()) as {
  key: string;
  label: string;
}[];
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
const projects: { workspaceId: string; projectId: string; key: string; name: string }[] = [];
for (const workspace of workspaces) {
  const scoped = await session("owner.local", workspace.workspaceId);
  if (workspace.workspaceKey !== "local-functional")
    expect(new Set(scoped.grants.permissions)).toEqual(
      new Set([
        "project.register",
        "project.catalog.read",
        "project.onboarding.read",
        "project.metadata.update",
      ]),
    );
  const response = await fetch(`${api}/v1/workspaces/${workspace.workspaceId}/projects`, {
    headers: { authorization: `Bearer ${scoped.accessToken}` },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: { id: string; key: string; name: string }[] };
  for (const p of body.items)
    projects.push({
      workspaceId: workspace.workspaceId,
      projectId: p.id,
      key: p.key,
      name: p.name,
    });
}
expect(projects.length).toBeGreaterThanOrEqual(5);
const results: unknown[] = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const option of options) {
    const current = await session(option.key),
      checks = [];
    for (const p of projects) {
      const allowed =
        option.key === "owner.local" ||
        (option.key === "integration-admin.alpha" && p.workspaceId === current.context.workspaceId);
      const response = await fetch(
        `${api}/api/v1/workspaces/${p.workspaceId}/projects/${p.projectId}/metadata`,
        { headers: { authorization: `Bearer ${current.accessToken}` } },
      );
      expect(response.status, `${option.key} ${p.key}`).toBe(allowed ? 200 : 404);
      if (allowed) {
        const body = (await response.json()) as {
          project: { name: string };
          ownerOptions: { displayName: string }[];
        };
        expect(body.project.name).toBe(p.name);
        expect(body.ownerOptions.every((o) => !!o.displayName)).toBe(true);
      }
      checks.push({ project: p.key, status: response.status });
    }
    const own = projects.find((p) => p.workspaceId === current.context.workspaceId)!;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/projects/${own.projectId}/edit`);
    await page.getByLabel("Участник и роль").selectOption(option.key);
    await page.getByRole("button", { name: "Начать работу", exact: true }).click();
    if (["owner.local", "integration-admin.alpha"].includes(option.key)) {
      await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue(own.name);
      await expect(
        page.getByRole("heading", { name: "История изменений", exact: true }),
      ).toBeVisible();
      if (option.key === "owner.local") {
        await page.screenshot({ path: `${output}/project-edit-desktop.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: `${output}/project-edit-mobile.png`, fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        const docs = workspaces.find((w) => w.workspaceKey === "local-tech-writing")!;
        await page.getByLabel("Предметная область").selectOption(docs.workspaceId);
        await page.getByRole("link", { name: "Редактировать проект", exact: true }).first().click();
        await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue(
          projects.find((p) => p.workspaceId === docs.workspaceId)!.name,
        );
        await page.screenshot({ path: `${output}/project-edit-docs.png`, fullPage: true });
        const breadcrumbs = page.getByRole("navigation", { name: "Путь страницы" });
        await breadcrumbs.getByRole("link", { name: "ALPHA-DOCS", exact: true }).click();
        await expect(
          page.getByRole("link", { name: "Редактировать проект", exact: true }),
        ).toBeVisible();
      }
    } else {
      await expect(
        page.getByRole("heading", { name: "Раздел недоступен", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Название проекта", { exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await context.close();
    results.push({ persona: option.label, checks, ui: "PASS" });
  }
  await writeFile(
    `${output}/live-checks.json`,
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log(
    `PASS: ${options.length} personas, ${projects.length} projects, no live project writes`,
  );
} finally {
  await browser.close();
}

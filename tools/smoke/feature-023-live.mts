import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

import type { LocalSession } from "../../apps/web/src/workspace/navigation.ts";

const api = process.env.AWP_API_URL ?? "http://localhost:5300";
const origin = process.env.AWP_WEB_URL ?? "http://localhost:55173";
const output = "specs/023-hermes-customer-projects";
async function session(personaKey: string): Promise<LocalSession> {
  const response = await fetch(`${api}/local/persona/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaKey }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<LocalSession>;
}
const admin = await session("owner.local"),
  customer = await session("requester.alpha");
const workspaceId = customer.context.workspaceId;
async function get(path: string, as = customer) {
  return fetch(`${api}${path}`, { headers: { authorization: `Bearer ${as.accessToken}` } });
}
const detailResponse = await get(
  "/api/v1/access/users/30000000-0000-4000-8000-000000000003",
  admin,
);
expect(detailResponse.status).toBe(200);
const detail = (await detailResponse.json()) as {
  memberships: { workspaceId: string; requesterProjectIds: string[] }[];
};
const assigned = detail.memberships.find((m) => m.workspaceId === workspaceId)!.requesterProjectIds;
expect((customer.projects ?? []).map((p) => p.projectId).sort()).toEqual([...assigned].sort());
expect(customer.grants.permissions).toContain("project.request.create");
const catalogResponse = await get(`/v1/workspaces/${workspaceId}/projects`);
expect(catalogResponse.status).toBe(200);
const catalog = (await catalogResponse.json()) as { items: { id: string; key: string }[] };
expect(catalog.items.map((p) => p.id).sort()).toEqual([...assigned].sort());
const subjectResponse = await get(`/local/workspaces/${workspaceId}/subjects`);
expect(subjectResponse.status).toBe(200);
const subjects = (await subjectResponse.json()) as { items: { projectId: string }[] };
expect(subjects.items.every((s) => assigned.includes(s.projectId))).toBe(true);
const adminCatalogResponse = await get(`/v1/workspaces/${workspaceId}/projects`, admin);
expect(adminCatalogResponse.status).toBe(200);
const adminCatalog = (await adminCatalogResponse.json()) as {
  items: { id: string; key: string }[];
};
const denied = [];
for (const project of adminCatalog.items.filter((p) => !assigned.includes(p.id))) {
  const response = await get(`/v1/workspaces/${workspaceId}/projects/${project.id}/onboarding`);
  expect([403, 404]).toContain(response.status);
  denied.push({ project: project.key, status: response.status });
}
expect(denied.length).toBeGreaterThan(0);
const dialogueResponse = await get(`/api/v1/workspaces/${workspaceId}/project-dialogues`);
expect(dialogueResponse.status).toBe(200);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/projects/hermes`);
  await page.getByLabel("Участник и роль").selectOption("requester.alpha");
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(page.getByRole("button", { name: "Начать диалог", exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/dialogue-live-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/dialogue-live-mobile.png`, fullPage: true });
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
await writeFile(
  `${output}/live-checks.json`,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      customerProjects: catalog.items.map((p) => p.key),
      visibleTasks: subjects.items.length,
      denied,
      dialogue: "PASS",
      browser: "PASS",
      projectAndTaskWrites: 0,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "PASS: live customer project scope, foreign project denial, task scope and Hermes screen; no project/task writes",
);

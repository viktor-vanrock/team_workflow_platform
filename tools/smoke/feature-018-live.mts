import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = process.env.AWP_WEB_URL ?? "http://localhost:55173";
const api = process.env.AWP_API_URL ?? "http://localhost:5300";
const output = "specs/018-local-account-cleanup";
const expected = [
  "owner.local",
  "integration-admin.alpha",
  "requester.alpha",
  "executor.alpha",
  "executor.qa2",
  "lead.alpha",
  "viewer.beta",
  "writer.docs",
  "lead.docs",
];
const options = (await (await fetch(`${api}/local/personas`)).json()) as {
  key: string;
  label: string;
}[];
expect(options.map(({ key }) => key)).toEqual(expected);
const retired: { key: string; status: number }[] = [];
for (const key of ["limited.alpha", "outsider.delta", "auditor.local", "worker.local"]) {
  const response = await fetch(`${api}/local/persona/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaKey: key }),
  });
  expect(response.status).toBe(403);
  retired.push({ key, status: response.status });
}
const browser = await chromium.launch({ headless: true });
const users: unknown[] = [];
try {
  for (const option of options) {
    const response = await fetch(`${api}/local/persona/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personaKey: option.key }),
    });
    expect(response.status).toBe(201);
    const session = (await response.json()) as {
      persona: { kind: string };
      context: { workspaceId: string };
      projects: { projectKey: string }[];
      grants: { roles: string[] };
    };
    expect(session.persona.kind).toBe("HUMAN");
    expect(session.projects.map(({ projectKey }) => projectKey)).toEqual(
      option.key.endsWith(".docs")
        ? ["ALPHA-DOCS"]
        : option.key === "requester.alpha"
          ? ["ALPHA"]
          : ["ALPHA", "BETA"],
    );
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const failures: { path: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().startsWith(api) && response.status() >= 400)
        failures.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(origin);
    const picker = page.getByLabel("Участник и роль");
    await expect(picker.locator("option")).toHaveCount(9);
    await picker.selectOption(option.key);
    if (option.key === "viewer.beta") await page.screenshot({ path: `${output}/login-live.png` });
    await page.getByRole("button", { name: "Начать работу", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "Основная навигация" });
    await expect(navigation).toBeVisible();
    await expect(page.getByLabel("Рабочий проект", { exact: true })).toHaveCount(0);
    if (option.key.startsWith("executor.")) {
      await navigation.getByRole("link", { name: "Очередь", exact: true }).click();
      await expect(page.getByLabel("Разрешённая очередь QA")).toBeVisible();
      if (option.key === "executor.qa2")
        await page.screenshot({ path: `${output}/qa2-live.png`, fullPage: true });
    }
    expect(failures).toEqual([]);
    users.push({
      key: option.key,
      label: option.label,
      roles: session.grants.roles,
      projects: session.projects.map(({ projectKey }) => projectKey),
      ui: "passed",
      failures,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/live-access.json`, JSON.stringify({ retired, users }, null, 2) + "\n");
console.log(
  JSON.stringify({ workingHumans: users.length, rejectedExchanges: retired.length, ui: "passed" }),
);

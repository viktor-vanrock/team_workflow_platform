import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = process.env.AWP_WEB_URL ?? "http://localhost:55173";
const api = process.env.AWP_API_URL ?? "http://localhost:5300";
const output = "specs/019-platform-access-admin";
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
      accessToken: string;
      platformPermissions: string[];
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
    const globalResponse = await fetch(`${api}/api/v1/access/users`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(globalResponse.status).toBe(option.key === "owner.local" ? 200 : 403);
    expect(session.platformPermissions.includes("platform.users.read")).toBe(
      option.key === "owner.local",
    );
    const step = await fetch(`${api}/local/persona/step-up`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
        "x-awp-workspace-id": session.context.workspaceId,
      },
      body: "{}",
    });
    expect(step.status).toBe(201);
    const stepped = (await step.json()) as { accessToken: string };
    const edit = await fetch(
      `${api}/api/v1/access/users/30000000-0000-4000-8000-000000000011/workspaces/10000000-0000-4000-8000-000000000001`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${stepped.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          roleKeys: ["access-administrator"],
          classificationCeiling: "INTERNAL",
          expectedVersion: 0,
          requestKey: crypto.randomUUID(),
          reason: "Verify non-assignable platform role",
        }),
      },
    );
    expect(edit.status).toBe(option.key === "owner.local" ? 400 : 403);
    const failure = (await edit.json()) as { code: string };
    expect(failure.code).toBe(
      option.key === "owner.local" ? "ACCESS_ROLE_INVALID" : "PLATFORM_ACCESS_DENIED",
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
    const adminLink = navigation.getByRole("link", { name: "Пользователи и доступы", exact: true });
    if (option.key === "owner.local") {
      await adminLink.click();
      await expect(page.getByRole("heading", { name: "Пользователи", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /QA Executor.*QA 2/ }).click();
      await expect(
        page.getByRole("checkbox", { name: "Исполнитель QA", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("button", { name: "Сохранить роли", exact: true }),
      ).toBeDisabled();
      await page.screenshot({ path: `${output}/admin-live.png`, fullPage: true });
      const workspaceNames = await page
        .getByLabel("Рабочая область", { exact: true })
        .locator("option")
        .allTextContents();
      const docs = workspaceNames.find((name) => /писат|документ/i.test(name));
      if (!docs) throw new Error("DOC_WORKSPACE_OPTION_MISSING");
      await page.getByLabel("Рабочая область", { exact: true }).selectOption({ label: docs });
      await expect(
        page.getByRole("checkbox", { name: "Технический писатель", exact: true }),
      ).toBeVisible();
    } else await expect(adminLink).toHaveCount(0);
    expect(failures).toEqual([]);
    users.push({
      key: option.key,
      label: option.label,
      roles: session.grants.roles,
      platformPermissions: session.platformPermissions,
      globalDirectoryStatus: globalResponse.status,
      protectedWriteStatus: edit.status,
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

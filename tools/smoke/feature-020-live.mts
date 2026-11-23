import { writeFile } from "node:fs/promises";

import { chromium, expect } from "@playwright/test";

const origin = process.env.AWP_WEB_URL ?? "http://localhost:55173";
const api = process.env.AWP_API_URL ?? "http://localhost:5300";
const output = "specs/020-project-creation-queue";
const options = (await (await fetch(`${api}/local/personas`)).json()) as {
  key: string;
  label: string;
}[];
const results: unknown[] = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const option of options) {
    const session = (await (
      await fetch(`${api}/local/persona/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaKey: option.key }),
      })
    ).json()) as {
      accessToken: string;
      context: { workspaceId: string };
      persona: { key: string };
    };
    const root = `${api}/api/v1/workspaces/${session.context.workspaceId}/projects`;
    const administrator = ["owner.local", "integration-admin.alpha"].includes(option.key);
    const read = await fetch(`${root}/registration-options`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(read.status).toBe(administrator ? 200 : 404);
    let writeStatus: number | undefined;
    if (!option.key.endsWith(".docs")) {
      const step = (await (
        await fetch(`${api}/local/persona/step-up`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json",
            "x-awp-workspace-id": session.context.workspaceId,
          },
          body: "{}",
        })
      ).json()) as { accessToken: string };
      const write = await fetch(root, {
        method: "POST",
        headers: {
          authorization: `Bearer ${step.accessToken}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          key: "ALPHA",
          name: "Existing project conflict check",
          ownerIds: Object.fromEntries(
            ["business", "technical", "qa", "security", "escalation"].map((key) => [
              key,
              "30000000-0000-4000-8000-000000000001",
            ]),
          ),
          criticalityKey: "STANDARD",
          dataClassificationKey: "INTERNAL",
          reason: "Verify existing key conflict without mutation",
        }),
      });
      writeStatus = write.status;
      expect(write.status).toBe(administrator ? 409 : 404);
      if (administrator)
        expect(((await write.json()) as { code: string }).code).toBe("PROJECT_KEY_CONFLICT");
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(
      origin + (administrator ? "/projects" : option.key.endsWith(".docs") ? "/" : "/qa/queue"),
    );
    await page.getByLabel("Участник и роль").selectOption(option.key);
    await page.getByRole("button", { name: "Начать работу", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    if (administrator) {
      await page.getByRole("link", { name: "Новый проект", exact: true }).click();
      const form = page.getByRole("form", { name: "Создание проекта" });
      await expect(
        form.getByLabel("Ответственный QA", { exact: true }).locator("option"),
      ).toHaveCount(8);
      await expect(form.getByRole("button", { name: "Создать проект", exact: true })).toBeEnabled();
      if (option.key === "owner.local") {
        await page.screenshot({ path: `${output}/project-create-live.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 1000 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({ path: `${output}/project-create-mobile.png`, fullPage: true });
      }
    } else if (!option.key.endsWith(".docs")) {
      const list = page.getByRole("list", { name: "Задачи очереди" });
      await expect(list.getByRole("listitem")).toHaveCount(2);
      const summary = page.getByRole("region", { name: "Сводка очереди" });
      expect((await summary.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
      await expect(page.getByRole("button", { name: "Переместить в начало" })).toHaveCount(0);
      if (option.key === "executor.qa2") {
        await page.screenshot({ path: `${output}/queue-live.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 1000 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({ path: `${output}/queue-mobile.png`, fullPage: true });
      }
    }
    expect(pageErrors).toEqual([]);
    results.push({
      key: option.key,
      registrationOptionsStatus: read.status,
      protectedWriteStatus: writeStatus,
      ui: "passed",
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/live-checks.json`, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ users: results.length, ui: "passed", liveMutations: 0 }));

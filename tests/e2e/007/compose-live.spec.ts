import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { SmokeEvidence } from "../../../tools/smoke/007-http-journey.mts";

test("007 live Compose browser verifies suspended-project evidence and exports through explicit step-up", async ({
  page,
}) => {
  test.setTimeout(90000);
  const input = process.env.AWP_007_SMOKE_INPUT;
  if (!input) throw new Error("Use pnpm smoke:007 for the live Compose journey");
  const proof = JSON.parse(await readFile(input, "utf8")) as SmokeEvidence & {
    projectName: string;
  };
  expect(proof.projectName).toBe(process.env.AWP_LOCAL_PROJECT_NAME);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.AWP_WEB_URL}/projects/${proof.projectId}/onboarding`);
  await page.getByLabel("Участник и роль").selectOption("integration-admin.alpha");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await expect(
    page.getByText("Подключение проекта · Compose onboarding smoke", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Приостановлено", { exact: true })).toBeVisible();
  await page.goto(`${process.env.AWP_WEB_URL}/projects/${proof.projectId}/evidence`);
  await page.getByLabel("Участник и роль").selectOption("owner.local");
  await page.getByRole("button", { name: "Начать работу" }).click();
  await page.getByRole("textbox", { name: /^ID манифеста/u }).fill(proof.manifestId);
  await page.getByRole("button", { name: "Проверить материалы", exact: true }).click();
  await expect(page.getByText(/подпись — Пройдено/iu)).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить усиленную аутентификацию" }).click();
  await expect(page.getByText(/Дополнительное подтверждение входа действует/)).toBeVisible();
  await page
    .getByRole("textbox", { name: /^ID пакета подтверждающих материалов/u })
    .fill(proof.packageId);
  await page
    .getByRole("textbox", { name: /^Причина экспорта/u })
    .fill("Проверка браузера в Compose");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Экспортировать проверенные материалы", exact: true }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  const bytes = await readFile(file!, "utf8");
  expect(bytes).toContain(proof.packageId);
  expect(bytes).not.toMatch(/opaqueLocator|privateKey/u);
  await expect(
    page.getByText("Проверенные метаданные скачаны, экспорт записан в журнал аудита."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

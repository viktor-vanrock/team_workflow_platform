import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { chromium, expect } from "@playwright/test";

// This smoke deliberately addresses only the isolated dev project and loopback ports.
const project = "awp-local-pilot-dev";
const api = "http://localhost:5300";
for (const origin of [api, "http://localhost:5310"]) {
  const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { status: string }).status, "UP");
}
const browser = await chromium.launch({ headless: true });
const title = `Development smoke ${randomUUID()}`;
function docker(args: string[]) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 2_000_000,
  });
  assert.equal(result.status, 0, "DEV_DOCKER_OBSERVATION_FAILED");
  return `${result.stdout}${result.stderr}`;
}
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto("http://localhost:55173");
  const exchanged = page.waitForResponse((response) =>
    response.url().endsWith("/local/persona/exchange"),
  );
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  const session = (await (await exchanged).json()) as {
    accessToken: string;
    context: { workspaceId: string; projectId: string };
  };
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Новый запрос", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Название", exact: true }).fill(title);
  await page
    .getByRole("textbox", { name: "Цель (необязательно)", exact: true })
    .fill("Проверить локальный API и обработку запроса через эмулятор Jira.");
  const drafted = page.waitForResponse(
    (response) => response.url().endsWith("/qa/intake") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Проверить запрос" }).click();
  const draft = await drafted;
  assert.equal(draft.status(), 201);
  const draftId = ((await draft.json()) as { draftId: string }).draftId;
  assert.match(draftId, /^[0-9a-f-]{36}$/u);
  await page.getByRole("button", { name: "Отправить запрос" }).click();
  await expect(page.getByRole("heading", { name: "Запрос создан", exact: true })).toBeVisible({
    timeout: 70_000,
  });
  // The UI disables a second send; independently replay the exact API confirmation.
  const replay = await fetch(
    `${api}/api/v1/workspaces/${session.context.workspaceId}/projects/${session.context.projectId}/intake-drafts/${draftId}/qa-confirmation`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": `qa-ui:${draftId}`,
      },
      body: "{}",
    },
  );
  assert.equal(replay.status, 201);
  await page.getByRole("button", { name: "Открыть запрос", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const count = docker([
    "exec",
    `${project}-postgres-1`,
    "psql",
    "-U",
    "awp_mock_owner",
    "-d",
    "awp_mock",
    "-tAc",
    `SELECT count(*) FROM jira_mock_effect_calls WHERE operation='CREATE' AND request_body->'fields'->>'summary'='${title}'`,
  ]).trim();
  assert.equal(count, "1", "DEV_PROVIDER_WRITE_COUNT_INVALID");
  const collector = docker([
    "logs",
    "--since",
    "2m",
    "--tail",
    "300",
    `${project}-otel-collector-1`,
  ]);
  assert.match(collector, /Traces/u);
  assert.match(collector, /Metrics/u);
  console.log(
    JSON.stringify({
      status: "PASS",
      mode: "DEVELOPMENT_MOCKS",
      corporateReady: false,
      browserLogin: true,
      draftId,
      confirmedByWorker: true,
      repeatedConfirmation: true,
      independentlyCountedProviderCreates: Number(count),
      collectorTraces: true,
      collectorMetrics: true,
    }),
  );
} finally {
  await browser.close();
}

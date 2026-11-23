import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Route, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;
const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000002";
const runId = "pilot-run-008";
const path = `/workspaces/${workspaceId}/projects/${projectId}/pilot/runs/${runId}`;
const hash = `sha256:${"a".repeat(64)}`;
const guardrailKeys = [
  "CROSS_SCOPE_DISCLOSURES",
  "UNAUTHORIZED_EXTERNAL_WRITES",
  "DUPLICATE_EXTERNAL_EFFECTS",
  "AUDITED_CORRELATED_WRITE_COVERAGE",
  "VERDICT_EVIDENCE_CHAIN_COVERAGE",
  "AGENT_WITHOUT_HUMAN_ACTIONS",
  "SECRET_CANARY_OCCURRENCES",
];

test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await server?.close();
});
const send = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify(body),
  });

test("baseline to shadow, activation, expiry suspension and review preserves independent effect counts", async ({
  page,
}) => {
  // Keep the synthetic session and cohort window independent of the machine's date.
  await page.clock.setFixedTime(new Date("2026-09-05T13:00:00.000Z"));
  let step = 0;
  const states = [
    {
      stage: "SHADOW",
      baseline: { status: "MISSING", sampleSize: 0 },
      state: "CURRENT",
      guards: "UNKNOWN",
      writes: 0,
      duplicates: 0,
      incidents: [],
      review: null,
    },
    {
      stage: "SHADOW",
      baseline: { status: "CURRENT", sampleSize: 12, contentHash: hash },
      state: "CURRENT",
      guards: "PASS",
      writes: 0,
      duplicates: 0,
      incidents: [],
      review: null,
    },
    {
      stage: "LIMITED",
      baseline: { status: "CURRENT", sampleSize: 12, contentHash: hash },
      state: "CURRENT",
      guards: "PASS",
      writes: 3,
      duplicates: 0,
      incidents: [],
      review: null,
    },
    {
      stage: "STOPPED",
      baseline: { status: "CURRENT", sampleSize: 12, contentHash: hash },
      state: "REVOKED",
      guards: "PASS",
      writes: 3,
      duplicates: 0,
      incidents: ["incident:window-expired"],
      review: null,
    },
    {
      stage: "REVIEW",
      baseline: { status: "CURRENT", sampleSize: 12, contentHash: hash },
      state: "REVOKED",
      guards: "PASS",
      writes: 3,
      duplicates: 0,
      incidents: ["incident:window-expired"],
      review: { recommendation: "ADJUST", decidedAt: "2026-09-05T13:00:00.000Z" },
    },
  ] as const;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/session")) {
      await send(route, {
        principalId: "operator",
        subject: "pilot.operator",
        csrfToken: "a".repeat(43),
        expiresAt: "2026-09-05T14:00:00.000Z",
      });
      return;
    }
    const current = states[Math.min(step, states.length - 1)]!;
    await send(route, {
      workspaceId,
      projectId,
      runId,
      stage: current.stage,
      cohort: {
        version: 1,
        projectIds: [projectId],
        userCount: 2,
        channelCount: 1,
        startAt: "2026-09-05T10:00:00.000Z",
        endAt: "2026-09-05T12:00:00.000Z",
        state: current.state,
      },
      baseline: current.baseline,
      metrics: [
        {
          key: "REWORK_RATE",
          value: current.baseline.status === "CURRENT" ? 0.1 : null,
          denominator: current.baseline.sampleSize,
          missingCount: current.baseline.status === "CURRENT" ? 0 : 1,
          excludedCount: 1,
          censoredCount: 0,
        },
      ],
      guardrails: guardrailKeys.map((key) => ({ key, state: current.guards })),
      externalEffects: {
        writes: current.writes,
        duplicates: current.duplicates,
        source: "INDEPENDENT",
      },
      incidents: current.incidents,
      review: current.review,
      evaluatedAt: "2026-09-05T13:00:00.000Z",
    });
    step += 1;
  });
  await page.goto(`${origin}${path}`);
  const load = page.getByRole("button", { name: "Загрузить текущий отчёт" });
  await load.click();
  await expect(
    page.getByText(
      "Импортируйте и выборочно проверьте базовые показатели текущего процесса до установки целей.",
    ),
  ).toBeVisible();
  await load.click();
  await expect(page.getByText("Разрешённая выборка: 12")).toBeVisible();
  await load.click();
  await expect(page.getByText("Этап: Ограниченный пилот", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Записей: 3 · дублей: 0 · источник: Независимое наблюдение"),
  ).toBeVisible();
  await load.click();
  await expect(
    page.getByText("Требуется разбор инцидентов: incident:window-expired"),
  ).toBeVisible();
  await load.click();
  await expect(page.getByText("Скорректировать", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});

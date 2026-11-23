import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, type Route, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;
const now = Date.parse("2026-09-04T12:00:00.000Z");
const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  deploymentId: "10000000-0000-4000-8000-000000000003",
};
const secondProject = "10000000-0000-4000-8000-000000000004";
const csrf = "a".repeat(43);
const path = `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot/deployments/${scope.deploymentId}/readiness`;
const reference = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` });
const date = (offset: number) => new Date(now + offset).toISOString();
const health = (projectId = scope.projectId) => ({
  ...scope,
  projectId,
  projectState: "ACTIVE",
  onboardingState: "ACTIVE",
  stage: "SHADOW",
  capabilityMode: "FULL_QA",
  evaluatedAt: date(0),
  reasonCodes: [],
  capabilities: [
    {
      bindingRef: reference("jira-binding"),
      requirementKey: "qa-source",
      logicalRole: "QA_REQUEST_AUTHORITY",
      capabilityKey: "operational-work-item",
      operation: "request.read",
      status: "AVAILABLE",
      reasonCodes: [],
      observedAt: date(0),
      validUntil: date(2000),
    },
  ],
});
const readiness = (projectId = scope.projectId) => ({
  ...scope,
  projectId,
  deploymentRef: reference(scope.deploymentId),
  deploymentProfile: "pilot",
  gateReady: true,
  engineeringReady: true,
  corporateGatesReady: true,
  evaluatedAt: date(0),
  gates: ["L0", "C1", "N2", "P3"].map((kind) => ({
    kind,
    status: "PASS",
    reasonCodes: [],
    validUntil: date(2000),
  })),
  inputs: {
    validUntil: date(2000),
    entries: Array.from({ length: 12 }, (_, i) => ({
      id: `IN-${String(i + 1).padStart(2, "0")}`,
      ownerRole: projectId === scope.projectId ? "Owner for project A" : "Owner for project B",
      status: "PASS",
      reasonCodes: [],
    })),
  },
});
const send = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify(body),
  });
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

async function install(
  page: Page,
  options: { authenticated?: boolean; beforeRead?: (route: Route) => Promise<void> } = {},
) {
  let authenticated = options.authenticated ?? true;
  let denied = false;
  const calls: { path: string; headers: Record<string, string>; body: unknown }[] = [];
  await page.clock.setFixedTime(now);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const requestPath = url.pathname;
    calls.push({
      path: requestPath,
      headers: request.headers(),
      body: request.postData() ? request.postDataJSON() : undefined,
    });
    if (requestPath === "/api/v1/auth/session") {
      await send(
        route,
        authenticated
          ? {
              principalId: "human-a",
              subject: "pilot.operator",
              csrfToken: csrf,
              expiresAt: date(600_000),
            }
          : {},
        authenticated ? 200 : 401,
      );
      return;
    }
    if (requestPath === "/api/v1/auth/login") {
      await send(route, {
        authorizationUrl: "https://identity.example/authorize?state=controlled",
      });
      return;
    }
    if (requestPath === "/api/v1/auth/logout") {
      authenticated = false;
      await route.fulfill({ status: 204 });
      return;
    }
    if (denied) {
      await send(route, { detail: "PRIVATE_PROVIDER_CANARY" }, 403);
      return;
    }
    await options.beforeRead?.(route);
    const projectId = requestPath.split("/")[6]!;
    if (requestPath.endsWith("/health")) await send(route, health(projectId));
    else await send(route, readiness(projectId));
  });
  return {
    calls,
    deny: () => {
      denied = true;
    },
  };
}
async function check(page: Page) {
  await page.getByRole("button", { name: "Проверить готовность", exact: true }).click();
  await expect(
    page.getByText("Результаты контрольных этапов: готово", { exact: true }),
  ).toBeVisible();
}

test("corporate entry uses BFF login and never loads the local persona catalog", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const { calls } = await install(page, { authenticated: false });
  await page.route("https://identity.example/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Corporate identity</h1>" }),
  );
  await page.goto(`${origin}/pilot/readiness`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("https://identity.example/authorize?state=controlled");
  expect(calls.find((call) => call.path.endsWith("/login"))?.body).toEqual({
    returnPath: "/pilot/readiness",
  });
  expect(requests.some((url) => url.includes("/local/"))).toBe(false);
});

test("renders owners and expiry, then removes green status as evidence expires", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.goto(`${origin}${path}`);
  await check(page);
  await expect(page.getByText("Владелец: Owner for project A", { exact: true })).toHaveCount(12);
  await expect(page.getByText("Доступно", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("pilot-readiness-ui.png"), fullPage: true });
  await page.clock.setFixedTime(now + 3000);
  await expect(
    page.getByText("Результаты контрольных этапов: требуется действие", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Неизвестно", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Выполните этот контрольный этап повторно: срок результатов истёк.", {
      exact: true,
    }),
  ).toHaveCount(4);
  await expect(page.getByRole("button", { name: /activate/iu })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("cancels old project reads and never renders their late responses", async ({ page }) => {
  let release!: () => void;
  let waiting = 0;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await install(page, {
    beforeRead: async (route) => {
      if (route.request().url().includes(`/projects/${scope.projectId}/`)) {
        waiting++;
        await delayed;
      }
    },
  });
  try {
    await page.goto(`${origin}${path}`);
    await page.getByRole("button", { name: "Проверить готовность", exact: true }).click();
    await expect.poll(() => waiting).toBe(2);
    await page.getByRole("textbox", { name: /^ID проекта/u }).fill(secondProject);
    await check(page);
    release();
    await expect(page.getByText("Владелец: Owner for project B", { exact: true })).toHaveCount(12);
    await expect(page.getByText("Владелец: Owner for project A", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("clears results after access denial and signs out using the current CSRF value", async ({
  page,
}) => {
  const state = await install(page);
  await page.goto(`${origin}${path}`);
  await check(page);
  state.deny();
  await page.getByRole("button", { name: "Проверить готовность", exact: true }).click();
  await expect(
    page.getByText(
      "Доступ к проекту отсутствует. Попросите владельца проекта проверить ваши права.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Состояние подключений", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Результаты контрольных этапов: готово", { exact: true }),
  ).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain("PRIVATE_PROVIDER_CANARY");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  expect(state.calls.find((call) => call.path.endsWith("/logout"))?.headers["x-csrf-token"]).toBe(
    csrf,
  );
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});

const failedCommand = "10000000-0000-4000-8000-000000000008";
const deadLetterPath = `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot/dead-letters`;
const deadLetterItem = () => ({
  commandId: failedCommand,
  rowVersion: 3,
  ownerRef: scope.workspaceId,
  commandAgeMs: 1000,
  firstFailureAt: date(0),
  lastFailureAt: date(0),
  expiresAt: date(60_000),
  attemptCount: 2,
  reasonCode: "JIRA_NETWORK_ERROR",
  certainty: "NOT_DISPATCHED",
  eligibility: "ELIGIBLE",
  replayCount: 0,
  recordRef: reference(failedCommand),
});

test("dead-letter UI preserves the exact decision after a lost response and hides provider errors", async ({
  page,
}) => {
  await page.clock.setFixedTime(now);
  const decisions: unknown[] = [];
  let captured = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith("/session")) {
      await send(route, {
        principalId: "human-a",
        subject: "pilot.operator",
        csrfToken: csrf,
        expiresAt: date(600_000),
      });
      return;
    }
    if (url.pathname.endsWith("/diagnostics")) {
      expect(request.headers()["x-csrf-token"]).toBe(csrf);
      captured = true;
      await send(route, { recordRef: reference(failedCommand) }, 201);
      return;
    }
    if (url.pathname.endsWith("/replay-decisions")) {
      expect(request.headers()["x-csrf-token"]).toBe(csrf);
      decisions.push(request.postDataJSON());
      if (decisions.length === 1) {
        await send(route, { detail: "PRIVATE_PROVIDER_CANARY" }, 503);
        return;
      }
      await send(
        route,
        {
          commandId: failedCommand,
          decisionId: scope.deploymentId,
          outcome: "REQUEUED",
          recordedAt: date(0),
          expiresAt: date(60_000),
          resultingRowVersion: 4,
        },
        201,
      );
      return;
    }
    const item = deadLetterItem();
    await send(route, {
      ...scope,
      evaluatedAt: date(0),
      items: [
        captured ? item : { ...item, recordRef: undefined, eligibility: "DIAGNOSTICS_REQUIRED" },
      ],
    });
  });
  await page.goto(`${origin}${deadLetterPath}`);
  await page.getByRole("button", { name: "Загрузить диагностику", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить диагностику", exact: true }).click();
  const retry = page.getByRole("button", { name: "Повторить исходную команду", exact: true });
  await retry.click();
  await expect(page.getByText("Не удалось подтвердить действие.", { exact: false })).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain("PRIVATE_PROVIDER_CANARY");
  await expect(page.getByRole("combobox", { name: "Причина повтора" })).toBeDisabled();
  await retry.click();
  await expect(
    page.getByText("Исходная команда возвращена в очередь.", { exact: false }),
  ).toBeVisible();
  expect(decisions).toHaveLength(2);
  expect(decisions[0]).toEqual(decisions[1]);
  expect(decisions[0]).not.toHaveProperty("payload");
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});

test("dead-letter UI disables expired retries and clears scoped data after revocation", async ({
  page,
}) => {
  await page.clock.setFixedTime(now);
  let denied = false;
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/session")) {
      await send(route, {
        principalId: "human-a",
        subject: "pilot.operator",
        csrfToken: csrf,
        expiresAt: date(600_000),
      });
      return;
    }
    await send(
      route,
      denied
        ? { detail: "PRIVATE_PROVIDER_CANARY" }
        : { ...scope, evaluatedAt: date(0), items: [deadLetterItem()] },
      denied ? 403 : 200,
    );
  });
  await page.goto(`${origin}${deadLetterPath}`);
  await page.getByRole("button", { name: "Загрузить диагностику", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Повторить исходную команду", exact: true }),
  ).toBeEnabled();
  await page.clock.setFixedTime(now + 60_000);
  await expect(
    page.getByRole("button", { name: "Повторить исходную команду", exact: true }),
  ).toBeDisabled();
  denied = true;
  await page.getByRole("button", { name: "Загрузить диагностику", exact: true }).click();
  await expect(page.getByText("Доступ отсутствует.", { exact: false })).toBeVisible();
  await expect(page.getByText(`Ответственный: ${scope.workspaceId}`, { exact: true })).toHaveCount(
    0,
  );
  expect(await page.locator("body").textContent()).not.toContain("PRIVATE_PROVIDER_CANARY");
});

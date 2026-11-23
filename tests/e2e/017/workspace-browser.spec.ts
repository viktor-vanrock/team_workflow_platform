import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  createServer,
  type ViteDevServer,
} from "../../../apps/web/node_modules/vite/dist/node/index.js";
import { localPersonaCatalog } from "../../../packages/runtime-composition/src/security/local-security.ts";

let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    define: {
      "import.meta.env.VITE_AWP_COMPOSITION": JSON.stringify("qa-jira-gitlab-mattermost-local"),
    },
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await server?.close();
});
const subjects = [
  {
    id: "A",
    kind: "WORK_ITEM",
    title: "Проверка авторизации",
    projectId: "alpha",
    projectKey: "ALPHA",
    status: "NEW",
  },
  {
    id: "B",
    kind: "WORK_ITEM",
    title: "Проверка оплаты",
    projectId: "beta",
    projectKey: "BETA",
    status: "NEW",
  },
  {
    id: "D",
    kind: "DRAFT",
    title: "Черновик оплаты",
    projectId: "beta",
    projectKey: "BETA",
    status: "DRAFT",
  },
  {
    id: "C",
    kind: "CANDIDATE",
    title: "Обращение клиента",
    projectId: "alpha",
    projectKey: "ALPHA",
    status: "NEW",
  },
];
async function install(page: Page, key = "executor.alpha") {
  const calls: string[] = [];
  const persona = localPersonaCatalog.resolve(key);
  const projects = ["alpha", "beta"].map((id) => ({
    projectId: id,
    projectKey: id.toUpperCase(),
    permissions: persona.permissions,
  }));
  await page.route("**/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path.endsWith("/personas"))
      return route.fulfill({ json: localPersonaCatalog.publicOptions() });
    if (path.endsWith("/subjects"))
      return route.fulfill({
        json: { items: subjects.filter((s) => projects.some((p) => p.projectId === s.projectId)) },
      });
    return route.fulfill({
      json: {
        accessToken: key,
        persona: { key, label: persona.label },
        context: {
          workspaceId: "workspace",
          workspaceKey: "local-functional",
          projectId: "alpha",
          projectKey: "ALPHA",
        },
        projects,
        workspacePermissions: persona.permissions,
        grants: {
          roles: persona.roles,
          permissions: persona.permissions,
          classificationCeiling: persona.classificationCeiling,
        },
      },
    });
  });
  await page.route("**/v1/workspaces/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path.endsWith("/projects"))
      return route.fulfill({
        json: {
          items: projects.map((p) => ({
            id: p.projectId,
            key: p.projectKey,
            name: p.projectKey,
            stage: "DRAFT",
            capabilityMode: "MANUAL_ONLY",
          })),
        },
      });
    if (path.endsWith("/onboarding"))
      return route.fulfill({
        json: {
          project: {
            id: "beta",
            key: "BETA",
            name: "BETA",
            owners: [],
            classificationKey: "INTERNAL",
          },
          stage: "DRAFT",
          capabilityMode: "MANUAL_ONLY",
          operationalState: "ACTIVE",
          gates: [],
          probes: [],
          reasonCodes: [],
          canEvaluate: true,
          canRequestPublication: true,
        },
      });
    if (path.endsWith("/qa/queue"))
      return route.fulfill({
        json: {
          workspaceId: "workspace",
          scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: "hash" },
          freshness: "CURRENT",
          comparatorRef: "queue-order@1.0.0",
          orderState: { resourceVersion: 1, queueEpoch: 1, baseVisibleSetHash: "hash" },
          visibleCounts: { total: 2, byStage: { BACKLOG: 2 } },
          items: subjects
            .filter((s) => s.kind === "WORK_ITEM")
            .map((s, i) => ({
              ordinal: i + 1,
              entry: {
                queueEntryId: s.id,
                projectId: s.projectId,
                stage: "BACKLOG",
                subject: { kind: s.kind, id: s.id },
              },
            })),
          nextCursor: null,
        },
      });
    if (path.endsWith("/qa/backlog"))
      return route.fulfill({
        json: {
          items: subjects
            .filter((s) => s.kind === "WORK_ITEM" && path.includes(`/projects/${s.projectId}/`))
            .map((s) => ({
              requestExtension: { workItemId: s.id, resourceVersion: 1 },
              currentRequestInputRevision: {
                title: s.title,
                requestKind: "feature-validation",
                version: 1,
                contentHash: "sha256:a",
                responseChannelResolution: { state: "MISSING" },
              },
              operationalReadiness: { assessmentState: "NOT_EVALUATED", normalizedStatus: "NEW" },
            })),
        },
      });
    if (path.endsWith("/qa/detail"))
      return route.fulfill({
        json: {
          workItemId: path.includes("/B/") ? "B" : "A",
          operationalReadiness: { assessmentState: "NOT_EVALUATED" },
          readinessAssessments: [],
          requiredSessionPlanHistory: null,
          sessions: [],
          evidenceManifestHistories: [],
          findings: [],
          verdicts: [],
        },
      });
    if (path.includes("/hermes/triage/")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { items: [] } });
  });
  return calls;
}
async function login(page: Page, key = "executor.alpha", path = "/") {
  await page.goto(origin + path);
  await page.getByLabel("Участник и роль").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
}
for (const key of ["executor.alpha", "executor.qa2"])
  test(`${key}: common queue opens correct project and back restores all tasks`, async ({
    page,
  }) => {
    const calls = await install(page, key);
    await login(page, key, "/qa/queue");
    await expect(page.getByLabel("Рабочий проект", { exact: true })).toHaveCount(0);
    await expect(page.getByText("ALPHA · Проверка авторизации", { exact: false })).toBeVisible();
    await expect(page.getByText("BETA · Проверка оплаты", { exact: false })).toBeVisible();
    await page
      .getByTestId("queue-workspace-item-B")
      .getByRole("link", { name: "Открыть задачу" })
      .click();
    await expect(page).toHaveURL(/project=beta&request=B/);
    await expect(page.getByRole("heading", { name: "Проверка оплаты", exact: true })).toBeVisible();
    expect(calls.some((c) => c.endsWith("/projects/beta/work-items/B/qa/detail"))).toBe(true);
    await page.goBack();
    await expect(page.getByTestId("queue-workspace-item-A")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/project=beta&request=B/);
    expect(calls.some((c) => c.includes("/persona/projects/"))).toBe(false);
  });
test("breadcrumbs follow URL, retain deep link on login and have a single current page", async ({
  page,
}) => {
  await install(page);
  await login(page, "executor.alpha", "/projects/beta/onboarding");
  const crumbs = page.getByRole("navigation", { name: "Путь страницы" });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(crumbs).toContainText("Проект BETA");
  await crumbs.getByRole("link", { name: "Проекты", exact: true }).click();
  await expect(page).toHaveURL(origin + "/projects");
  await expect(crumbs).not.toContainText("BETA");
  await crumbs.getByRole("link", { name: "Архив ордена" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(origin + "/");
  await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(1);
});
test("Hermes offers named requests, drafts and candidates across projects", async ({ page }) => {
  const calls = await install(page);
  await login(page, "executor.alpha", "/qa/hermes-proposals");
  const select = page.getByLabel("Запрос или обращение");
  await expect(select.locator("option")).toHaveCount(5);
  await expect(page.getByLabel("ID субъекта")).toHaveCount(0);
  await select.selectOption("WORK_ITEM:B");
  await expect
    .poll(() => calls.some((c) => c.endsWith("/projects/beta/qa/hermes/triage/WORK_ITEM/B")))
    .toBe(true);
  await select.selectOption("DRAFT:D");
  await expect
    .poll(() => calls.some((c) => c.endsWith("/projects/beta/qa/hermes/triage/DRAFT/D")))
    .toBe(true);
  await select.selectOption("CANDIDATE:C");
  await expect
    .poll(() => calls.some((c) => c.endsWith("/projects/alpha/qa/hermes/triage/CANDIDATE/C")))
    .toBe(true);
  await expect(page.getByText("Для этой сущности сохранённых предложений пока нет.")).toBeVisible();
});
for (const key of [
  "owner.local",
  "integration-admin.alpha",
  "requester.alpha",
  "executor.alpha",
  "executor.qa2",
  "lead.alpha",
  "viewer.beta",
])
  test(`${key}: role menu, queue order and onboarding controls`, async ({ page }) => {
    await install(page, key);
    await login(page, key, "/qa/queue");
    const permissions = localPersonaCatalog.resolve(key).permissions;
    if (key === "lead.alpha") {
      await expect(
        page.getByRole("list", { name: "Задачи очереди" }).getByRole("listitem"),
      ).toHaveCount(2);
      for (const details of await page
        .getByRole("list", { name: "Задачи очереди" })
        .locator("summary")
        .all())
        await details.click();
    }
    await expect(page.getByRole("button", { name: "Переместить в начало" })).toHaveCount(
      permissions.includes("queue.order.move") ? 2 : 0,
    );
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    await expect(nav.getByRole("link", { name: "Новый запрос", exact: true })).toHaveCount(
      permissions.includes("qa.request.create") ? 1 : 0,
    );
    await page.evaluate(() => {
      history.pushState(null, "", "/projects/alpha/onboarding");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByLabel("Рабочая область подключения проекта")).toBeVisible();
    const suspend = page.getByRole("button", { name: /приостановить/i });
    if (permissions.includes("project.suspend")) await expect(suspend).toBeEnabled();
    else await expect(suspend).toBeDisabled();
    if (!permissions.includes("qa.request.create")) {
      await page.evaluate(() => {
        history.pushState(null, "", "/qa/new");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
    }
  });

test("accepted tasks remain visible before queue priorities are calculated", async ({ page }) => {
  await install(page);
  await page.route("**/workspaces/workspace/qa/queue?**", (route) =>
    route.fulfill({
      json: {
        workspaceId: "workspace",
        scope: { kind: "AUTHORIZED_PORTFOLIO", authorizedProjectSetHash: "hash" },
        freshness: "CURRENT",
        comparatorRef: "queue-order@1.0.0",
        orderState: { resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash: "hash" },
        visibleCounts: { total: 0, byStage: {} },
        items: [],
        nextCursor: null,
      },
    }),
  );
  await login(page, "executor.alpha", "/qa/queue");
  await expect(page.getByRole("list", { name: "Задачи очереди" })).toContainText(
    "ALPHA · Проверка авторизации",
  );
  await expect(page.getByRole("list", { name: "Задачи очереди" })).toContainText(
    "BETA · Проверка оплаты",
  );
  await expect(
    page
      .getByRole("list", { name: "Задачи очереди" })
      .getByRole("link", { name: "Открыть задачу" }),
  ).toHaveCount(2);
});

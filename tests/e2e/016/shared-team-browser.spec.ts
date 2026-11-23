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
async function install(page: Page) {
  const calls: string[] = [];
  let deny = false;
  const projects = [
    { projectId: "alpha", projectKey: "ALPHA" },
    { projectId: "beta", projectKey: "BETA" },
  ];
  await page.route("**/local/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/personas"))
      return route.fulfill({ json: localPersonaCatalog.publicOptions() });
    if (path.endsWith("/subjects")) return route.fulfill({ json: { items: [] } });
    const input = request.postDataJSON();
    const key = path.endsWith("/exchange")
      ? input.personaKey
      : request.headers().authorization?.replace("Bearer ", "");
    const selectedProject = /\/persona\/projects\/([^/]+)$/u.exec(path)?.[1];
    if (selectedProject && deny) return route.fulfill({ status: 403, json: {} });
    const persona = localPersonaCatalog.resolve(key);
    const project =
      projects.find((project) => project.projectId === selectedProject) ?? projects[0]!;
    return route.fulfill({
      json: {
        accessToken: key,
        persona: { key, label: persona.label },
        context: { workspaceId: "workspace", workspaceKey: "local-functional", ...project },
        projects: projects.map((project) => ({ ...project, permissions: persona.permissions })),
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
          items: projects.map((project) => ({
            id: project.projectId,
            key: project.projectKey,
            name: project.projectKey,
            stage: "DRAFT",
            capabilityMode: "MANUAL_ONLY",
          })),
        },
      });
    if (path.endsWith("/onboarding")) {
      const project = projects.find((project) => path.includes(`/projects/${project.projectId}/`))!;
      return route.fulfill({
        json: {
          project: {
            id: project.projectId,
            key: project.projectKey,
            name: project.projectKey,
            owners: [],
            classificationKey: "INTERNAL",
          },
          stage: "DRAFT",
          capabilityMode: "MANUAL_ONLY",
          operationalState: "ACTIVE",
          gates: [],
          probes: [],
          reasonCodes: [],
          canEvaluate: false,
          canRequestPublication: false,
        },
      });
    }
    await route.fulfill({ json: { items: [] } });
  });
  return {
    calls,
    deny: () => {
      deny = true;
    },
  };
}
async function login(page: Page, key = "executor.alpha") {
  await page.goto(origin);
  await page.getByLabel("Участник и роль").selectOption(key);
  await page.getByRole("button", { name: "Начать работу", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
}
for (const key of ["executor.alpha", "executor.qa2"])
  test(`${key}: shared team opens any catalog project without changing persona`, async ({
    page,
  }) => {
    const f = await install(page);
    await login(page, key);
    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Проекты", exact: true })
      .click();
    await page
      .locator(".MuiCard-root")
      .filter({ has: page.getByRole("heading", { name: "BETA", exact: true }) })
      .getByRole("link", { name: "Открыть подключение" })
      .click();
    await expect(page).toHaveURL(/projects\/beta\/onboarding$/u);
    await expect(page.getByRole("navigation", { name: "Путь страницы" })).toContainText(
      "Проект BETA",
    );
    await expect(page.getByLabel("Рабочий проект", { exact: true })).toHaveCount(0);
    await expect
      .poll(() => f.calls.some((path) => path.includes("/projects/beta/onboarding")))
      .toBe(true);
  });
